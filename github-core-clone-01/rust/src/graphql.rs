// graphql.rs — GraphQL v4 port of app.ts (7ebc300) lines 1501-2044.
// Faithful port: tokenizer, parser, validation, execution, mutations.
// No clock, no randomness; fixed timestamps via store constants.

use crate::handlers::{create_issue_obj, create_pull, diff_trees, pull_conflicts, refresh_issue};
use crate::http::{Request, Response};
use crate::store::*;
use serde_json::{json, Map, Value};

// ---------------------------------------------------------------- tokenizer

/// Tokenizer (gqlTokenize): string tokens are JSON-encoded (with quotes),
/// exactly like the TS version, so parseValue can JSON.parse them.
pub fn gql_tokenize(src: &str) -> Vec<String> {
    let chars: Vec<char> = src.chars().collect();
    let mut toks: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == ',' {
            i += 1;
            continue;
        }
        if ch == '.' && i + 2 < chars.len() && chars[i + 1] == '.' && chars[i + 2] == '.' {
            toks.push("...".to_string());
            i += 3;
            continue;
        }
        if "!$():=@[]{}|".contains(ch) {
            toks.push(ch.to_string());
            i += 1;
            continue;
        }
        if ch == '"' {
            let mut j = i + 1;
            let mut out = String::new();
            while j < chars.len() && chars[j] != '"' {
                if chars[j] == '\\' && j + 1 < chars.len() {
                    let e = chars[j + 1];
                    match e {
                        'n' => out.push('\n'),
                        't' => out.push('\t'),
                        'r' => out.push('\r'),
                        'u' => {
                            let hex: String = chars[j + 2..(j + 6).min(chars.len())].iter().collect();
                            let code = u32::from_str_radix(&hex, 16).unwrap_or(0);
                            out.push(char::from_u32(code).unwrap_or('\0'));
                            j += 4;
                        }
                        _ => out.push(e),
                    }
                    j += 2;
                } else {
                    out.push(chars[j]);
                    j += 1;
                }
            }
            toks.push(serde_json::to_string(&out).unwrap_or_else(|_| "\"\"".to_string()));
            i = j + 1;
            continue;
        }
        if ch.is_ascii_digit() || ch == '-' {
            let mut j = i;
            while j < chars.len() && (chars[j].is_ascii_digit() || ".eE+-".contains(chars[j])) {
                j += 1;
            }
            toks.push(chars[i..j].iter().collect());
            i = j;
            continue;
        }
        if ch.is_ascii_alphabetic() || ch == '_' {
            let mut j = i;
            while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            toks.push(chars[i..j].iter().collect());
            i = j;
            continue;
        }
        i += 1;
    }
    toks
}

// ---------------------------------------------------------------- parser

#[derive(Clone, Debug)]
pub struct GqlField {
    pub name: String,
    pub alias: Option<String>,
    pub args: Map<String, Value>,
    pub selections: Vec<GqlSel>,
}

#[derive(Clone, Debug)]
pub enum GqlSel {
    Field(GqlField),
    Fragment { type_cond: Option<String>, selections: Vec<GqlSel> },
}

#[derive(Clone, Debug)]
pub struct GqlOp {
    pub is_mutation: bool,
    pub name: Option<String>,
    pub selections: Vec<GqlSel>,
}

pub struct GqlParser {
    pos: usize,
    toks: Vec<String>,
}

impl GqlParser {
    pub fn new(toks: Vec<String>) -> GqlParser {
        GqlParser { pos: 0, toks }
    }

    fn peek(&self) -> &str {
        self.toks.get(self.pos).map(|s| s.as_str()).unwrap_or("")
    }

    fn next(&mut self) -> String {
        let t = self.toks.get(self.pos).cloned().unwrap_or_default();
        self.pos += 1;
        t
    }

    fn expect(&mut self, t: &str) {
        if self.peek() == t {
            self.pos += 1;
        }
    }

    pub fn parse_document(&mut self) -> Vec<GqlOp> {
        let mut ops: Vec<GqlOp> = Vec::new();
        while self.pos < self.toks.len() {
            let t = self.peek();
            if t == "query" || t == "mutation" {
                let is_mutation = t == "mutation";
                self.next();
                let mut name: Option<String> = None;
                if self.peek() != "(" && self.peek() != "{" && self.peek() != "@" {
                    name = Some(self.next());
                }
                self.skip_var_defs();
                self.skip_directives();
                ops.push(GqlOp { is_mutation, name, selections: self.parse_selection_set() });
            } else if t == "{" {
                ops.push(GqlOp { is_mutation: false, name: None, selections: self.parse_selection_set() });
            } else if t == "fragment" {
                self.next();
                self.next(); // fragment name
                if self.peek() == "on" {
                    self.next();
                    self.next();
                }
                self.skip_directives();
                self.parse_selection_set();
            } else {
                self.next();
            }
        }
        ops
    }

    fn skip_var_defs(&mut self) {
        if self.peek() != "(" {
            return;
        }
        let mut depth = 0i32;
        while self.pos < self.toks.len() {
            let t = self.next();
            if t == "(" || t == "[" || t == "{" {
                depth += 1;
            } else if t == ")" || t == "]" || t == "}" {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
        }
    }

    fn skip_directives(&mut self) {
        while self.peek() == "@" {
            self.next();
            self.next();
            if self.peek() == "(" {
                self.skip_var_defs();
            }
        }
    }

    fn parse_selection_set(&mut self) -> Vec<GqlSel> {
        self.expect("{");
        let mut sels: Vec<GqlSel> = Vec::new();
        while self.pos < self.toks.len() && self.peek() != "}" {
            sels.push(self.parse_selection());
        }
        self.expect("}");
        sels
    }

    fn parse_selection(&mut self) -> GqlSel {
        if self.peek() == "..." {
            self.next();
            if self.peek() == "on" {
                self.next();
                let type_cond = self.next();
                self.skip_directives();
                return GqlSel::Fragment { type_cond: Some(type_cond), selections: self.parse_selection_set() };
            }
            let frag_name = self.next();
            self.skip_directives();
            return GqlSel::Fragment { type_cond: Some(frag_name), selections: Vec::new() };
        }
        let name = self.next();
        let mut alias: Option<String> = None;
        let mut field_name = name.clone();
        if self.peek() == ":" {
            self.next();
            alias = Some(name);
            field_name = self.next();
        }
        let mut args: Map<String, Value> = Map::new();
        if self.peek() == "(" {
            self.next();
            while self.peek() != ")" && self.pos < self.toks.len() {
                let arg_name = self.next();
                self.expect(":");
                args.insert(arg_name, self.parse_value());
            }
            self.expect(")");
        }
        self.skip_directives();
        let selections = if self.peek() == "{" { self.parse_selection_set() } else { Vec::new() };
        GqlSel::Field(GqlField { name: field_name, alias, args, selections })
    }

    fn parse_value(&mut self) -> Value {
        let t = self.next();
        if t == "$" {
            let name = self.next();
            let mut m = Map::new();
            m.insert("__var".to_string(), Value::String(name));
            return Value::Object(m);
        }
        if t == "[" {
            let mut arr: Vec<Value> = Vec::new();
            while self.peek() != "]" && self.pos < self.toks.len() {
                arr.push(self.parse_value());
            }
            self.expect("]");
            return Value::Array(arr);
        }
        if t == "{" {
            let mut obj: Map<String, Value> = Map::new();
            while self.peek() != "}" && self.pos < self.toks.len() {
                let k = self.next();
                self.expect(":");
                obj.insert(k, self.parse_value());
            }
            self.expect("}");
            return Value::Object(obj);
        }
        if t.starts_with('"') {
            return serde_json::from_str(&t).unwrap_or(Value::Null);
        }
        if t == "true" {
            return Value::Bool(true);
        }
        if t == "false" {
            return Value::Bool(false);
        }
        if t == "null" {
            return Value::Null;
        }
        // Number(t) not NaN AND /^-?\d/ — else the raw token as a string (enum).
        let first_ok = {
            let b = t.as_bytes();
            !b.is_empty() && (b[0].is_ascii_digit() || (b[0] == b'-' && b.len() > 1 && b[1].is_ascii_digit()))
        };
        if first_ok {
            if let Ok(iv) = t.parse::<i64>() {
                return json!(iv);
            }
            if let Ok(fv) = t.parse::<f64>() {
                if fv.is_finite() {
                    return json!(fv);
                }
            }
        }
        Value::String(t)
    }
}

// ---------------------------------------------------------------- variables

pub type Vars = Map<String, Value>;

pub fn resolve_var(v: &Value, vars: &Vars) -> Value {
    match v {
        Value::Object(m) if m.contains_key("__var") => {
            let name = m.get("__var").and_then(|x| x.as_str()).unwrap_or("");
            vars.get(name).cloned().unwrap_or(Value::Null)
        }
        Value::Array(a) => Value::Array(a.iter().map(|x| resolve_var(x, vars)).collect()),
        Value::Object(m) => {
            let mut out = Map::new();
            for (k, val) in m {
                out.insert(k.clone(), resolve_var(val, vars));
            }
            Value::Object(out)
        }
        _ => v.clone(),
    }
}

pub fn arg_str(args: &Map<String, Value>, name: &str, vars: &Vars) -> Option<String> {
    let v = resolve_var(args.get(name)?, vars);
    v.as_str().map(|s| s.to_string())
}

pub fn arg_int(args: &Map<String, Value>, name: &str, vars: &Vars) -> Option<i64> {
    let v = resolve_var(args.get(name)?, vars);
    if let Some(i) = v.as_i64() {
        return Some(i);
    }
    v.as_f64().map(|f| f as i64)
}

pub fn arg_arr(args: &Map<String, Value>, name: &str, vars: &Vars) -> Option<Vec<Value>> {
    let v = resolve_var(args.get(name)?, vars);
    v.as_array().cloned()
}

pub fn arg_obj(args: &Map<String, Value>, name: &str, vars: &Vars) -> Option<Map<String, Value>> {
    let v = resolve_var(args.get(name)?, vars);
    v.as_object().cloned()
}

// ---------------------------------------------------------------- validation tables

pub fn gql_fields(type_name: &str) -> Option<&'static [&'static str]> {
    Some(match type_name {
        "Query" => &["viewer", "repository", "node", "__type", "__schema"],
        "Viewer" => &["id", "login", "name", "email"],
        "Repository" => &["id", "databaseId", "name", "nameWithOwner", "owner", "defaultBranchRef", "viewerPermission", "hasIssuesEnabled", "issue", "issues", "pullRequests", "pullRequest"],
        "Issue" => &["id", "number", "title", "state", "body", "url"],
        "IssueConnection" => &["nodes", "edges", "pageInfo", "totalCount"],
        "IssueEdge" => &["node", "cursor"],
        "PullRequest" => &["id", "number", "title", "body", "state", "merged", "mergeable", "headRefName", "baseRefName", "files"],
        "PullRequestConnection" => &["nodes", "edges", "pageInfo", "totalCount"],
        "PullRequestEdge" => &["node", "cursor"],
        "PullRequestFileConnection" => &["nodes", "edges", "pageInfo", "totalCount"],
        "PullRequestFile" => &["path", "filename", "additions", "deletions", "changes", "status"],
        "IssueComment" => &["id", "body"],
        "User" => &["login", "id", "name"],
        "BranchRef" => &["name"],
        "PageInfo" => &["hasNextPage", "endCursor", "hasPreviousPage", "startCursor"],
        "Node" => &["id"],
        "Mutation" => &["createIssue", "closeIssue", "createPullRequest", "mergePullRequest", "addComment"],
        "CreateIssuePayload" => &["issue", "clientMutationId"],
        "CloseIssuePayload" => &["issue", "clientMutationId"],
        "CreatePullRequestPayload" => &["pullRequest", "clientMutationId"],
        "MergePullRequestPayload" => &["pullRequest", "clientMutationId"],
        "AddCommentPayload" => &["commentEdge", "subject", "clientMutationId"],
        "CommentEdge" => &["node", "cursor"],
        "__Type" => &["name", "kind", "fields", "enumValues", "description"],
        "__Field" => &["name", "type"],
        "__EnumValue" => &["name", "description"],
        _ => return None,
    })
}

pub fn gql_child(parent: &str, field: &str) -> Option<&'static str> {
    Some(match (parent, field) {
        ("Query", "viewer") => "Viewer",
        ("Query", "repository") => "Repository",
        ("Query", "node") => "Node",
        ("Query", "__type") => "__Type",
        ("Mutation", "createIssue") => "CreateIssuePayload",
        ("Mutation", "closeIssue") => "CloseIssuePayload",
        ("Mutation", "createPullRequest") => "CreatePullRequestPayload",
        ("Mutation", "mergePullRequest") => "MergePullRequestPayload",
        ("Mutation", "addComment") => "AddCommentPayload",
        ("Repository", "issue") => "Issue",
        ("Repository", "issues") => "IssueConnection",
        ("Repository", "pullRequests") => "PullRequestConnection",
        ("Repository", "pullRequest") => "PullRequest",
        ("Repository", "owner") => "User",
        ("Repository", "defaultBranchRef") => "BranchRef",
        ("IssueConnection", "nodes") => "Issue",
        ("IssueConnection", "edges") => "IssueEdge",
        ("IssueConnection", "pageInfo") => "PageInfo",
        ("IssueEdge", "node") => "Issue",
        ("PullRequestConnection", "nodes") => "PullRequest",
        ("PullRequestConnection", "edges") => "PullRequestEdge",
        ("PullRequestConnection", "pageInfo") => "PageInfo",
        ("PullRequestEdge", "node") => "PullRequest",
        ("PullRequest", "files") => "PullRequestFileConnection",
        ("PullRequestFileConnection", "nodes") => "PullRequestFile",
        ("PullRequestFileConnection", "edges") => "PullRequestFile",
        ("CreateIssuePayload", "issue") => "Issue",
        ("CloseIssuePayload", "issue") => "Issue",
        ("CreatePullRequestPayload", "pullRequest") => "PullRequest",
        ("MergePullRequestPayload", "pullRequest") => "PullRequest",
        ("AddCommentPayload", "commentEdge") => "CommentEdge",
        ("AddCommentPayload", "subject") => "Issue",
        ("CommentEdge", "node") => "IssueComment",
        ("__Type", "fields") => "__Field",
        ("__Type", "enumValues") => "__EnumValue",
        _ => return None,
    })
}

pub fn validate_selections(sels: &[GqlSel], type_name: &str, errors: &mut Vec<Value>) {
    let allowed = match gql_fields(type_name) {
        Some(a) => a,
        None => return,
    };
    for sel in sels {
        match sel {
            GqlSel::Fragment { type_cond, selections } => {
                if let Some(tc) = type_cond {
                    if !selections.is_empty() {
                        validate_selections(selections, tc, errors);
                    }
                }
            }
            GqlSel::Field(f) => {
                if !allowed.contains(&f.name.as_str()) {
                    errors.push(json!({ "message": format!("Cannot query field \"{}\" on type \"{}\".", f.name, type_name) }));
                    continue;
                }
                if let Some(child) = gql_child(type_name, &f.name) {
                    if !f.selections.is_empty() {
                        validate_selections(&f.selections, child, errors);
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- execution values

/// A GraphQL object: typename kept separate (stripped from output, like TS
/// stripTypename); fields in insertion order.
#[derive(Clone, Debug)]
pub struct GqlObj {
    pub typename: &'static str,
    pub fields: indexmap::IndexMap<String, GqlVal>,
}

impl GqlObj {
    pub fn new(typename: &'static str) -> GqlObj {
        GqlObj { typename, fields: indexmap::IndexMap::new() }
    }

    pub fn put(mut self, key: &str, val: GqlVal) -> GqlObj {
        self.fields.insert(key.to_string(), val);
        self
    }

    pub fn scalar(mut self, key: &str, val: Value) -> GqlObj {
        self.fields.insert(key.to_string(), GqlVal::Value(val));
        self
    }
}

#[derive(Clone, Debug)]
pub enum GqlVal {
    Value(Value),
    Obj(GqlObj),
    Arr(Vec<GqlVal>),
    Thunk(Thunk),
}

/// Lazy field resolvers — resolved with (&Store, &GqlField, &Vars) at
/// execution time, mirroring the TS function-valued fields.
#[derive(Clone, Debug)]
pub enum Thunk {
    DefaultBranchRef { repo_id: i64 },
    RepoIssue { repo_id: i64 },
    RepoIssues { repo_id: i64 },
    RepoPullRequests { repo_id: i64 },
    RepoPullRequest { repo_id: i64 },
    PullFiles { repo_id: i64, pull_number: i64 },
}

pub fn find_repo_by_id<'a>(store: &'a Store, id: i64) -> Option<&'a Repo> {
    store.repos.values().find(|r| r.id == id)
}

pub fn issue_gql_obj(repo: &Repo, issue: &Issue) -> GqlObj {
    GqlObj::new("Issue")
        .scalar("id", json!(global_id("Issue", &[repo.id.to_string(), issue.number.to_string()])))
        .scalar("number", json!(issue.number))
        .scalar("title", json!(issue.title))
        .scalar("state", json!(if issue.state == "open" { "OPEN" } else { "CLOSED" }))
        .scalar("body", json!(issue.body))
        .scalar("url", json!(format!("http://localhost/{}/issues/{}", repo.name, issue.number)))
}

pub fn pull_gql_obj(repo: &Repo, pull: &Pull) -> GqlObj {
    GqlObj::new("PullRequest")
        .scalar("id", json!(global_id("PullRequest", &[repo.id.to_string(), pull.number.to_string()])))
        .scalar("number", json!(pull.number))
        .scalar("title", json!(pull.title))
        .scalar("body", json!(pull.body))
        .scalar("state", json!(if pull.state == "open" { "OPEN" } else { "CLOSED" }))
        .scalar("merged", json!(pull.merged))
        .scalar("mergeable", json!(if pull_conflicts(repo, pull) { "CONFLICTING" } else { "MERGEABLE" }))
        .scalar("headRefName", json!(pull.head_branch))
        .scalar("baseRefName", json!(pull.base_branch))
        .put("files", GqlVal::Thunk(Thunk::PullFiles { repo_id: repo.id, pull_number: pull.number }))
}

pub fn repo_gql_obj(repo: &Repo) -> GqlObj {
    let mut owner = GqlObj::new("User");
    owner = owner
        .scalar("login", json!(repo.owner))
        .scalar("id", json!(1000))
        .scalar("name", json!("ada iversen"));
    GqlObj::new("Repository")
        .scalar("id", json!(global_id("Repository", &[repo.id.to_string()])))
        .scalar("databaseId", json!(repo.id))
        .scalar("name", json!(repo.name))
        .scalar("nameWithOwner", json!(format!("{}/{}", repo.owner, repo.name)))
        .put("owner", GqlVal::Obj(owner))
        .put("defaultBranchRef", GqlVal::Thunk(Thunk::DefaultBranchRef { repo_id: repo.id }))
        .scalar("viewerPermission", json!("ADMIN"))
        .scalar("hasIssuesEnabled", json!(true))
        .put("issue", GqlVal::Thunk(Thunk::RepoIssue { repo_id: repo.id }))
        .put("issues", GqlVal::Thunk(Thunk::RepoIssues { repo_id: repo.id }))
        .put("pullRequests", GqlVal::Thunk(Thunk::RepoPullRequests { repo_id: repo.id }))
        .put("pullRequest", GqlVal::Thunk(Thunk::RepoPullRequest { repo_id: repo.id }))
}

pub fn node_gql_obj(store: &Store, id: &str) -> Option<GqlObj> {
    let (kind, parts) = decode_global_id(id)?;
    let repo_id = crate::handlers::js_parse_int(parts.first()?).unwrap_or(0);
    let repo = find_repo_by_id(store, repo_id)?;
    match kind.as_str() {
        "Repository" => Some(repo_gql_obj(repo)),
        "Issue" => {
            let num = crate::handlers::js_parse_int(parts.get(1)?).unwrap_or(0);
            let issue = repo.issues.iter().find(|i| i.number == num)?;
            Some(issue_gql_obj(repo, issue))
        }
        "PullRequest" => {
            let num = crate::handlers::js_parse_int(parts.get(1)?).unwrap_or(0);
            let pull = repo.pulls.iter().find(|p| p.number == num)?;
            Some(pull_gql_obj(repo, pull))
        }
        "IssueComment" => {
            let cid = crate::handlers::js_parse_int(parts.get(1)?).unwrap_or(0);
            let mut found: Option<&Comment> = None;
            for arr in repo.comments.values() {
                if let Some(c) = arr.iter().find(|c| c.id == cid) {
                    found = Some(c);
                    break;
                }
            }
            let c = found?;
            Some(
                GqlObj::new("IssueComment")
                    .scalar("id", json!(global_id("IssueComment", &[repo.id.to_string(), c.id.to_string()])))
                    .scalar("body", json!(c.body)),
            )
        }
        _ => None,
    }
}

pub fn type_info(name: &str) -> Option<(&'static str, &'static [&'static str], &'static [&'static str])> {
    Some(match name {
        "Issue" => ("OBJECT", &["id", "number", "title", "state", "body"], &[]),
        "PullRequest" => ("OBJECT", &["id", "number", "headRefName", "baseRefName", "mergeable", "state", "merged", "files"], &[]),
        "Repository" => ("OBJECT", &["id", "databaseId", "name", "nameWithOwner", "owner", "defaultBranchRef", "viewerPermission", "hasIssuesEnabled", "issue", "issues", "pullRequests", "pullRequest"], &[]),
        "SearchType" => ("ENUM", &[], &["ISSUE", "PULL_REQUEST", "REPOSITORY", "USER", "DISCUSSION"]),
        _ => return None,
    })
}

fn cursor(n: i64) -> String {
    base64_encode(format!("cursor:{}", n).as_bytes())
}

fn resolve_thunk(store: &Store, thunk: &Thunk, field: &GqlField, vars: &Vars) -> GqlVal {
    match thunk {
        Thunk::DefaultBranchRef { repo_id } => {
            let repo = match find_repo_by_id(store, *repo_id) {
                Some(r) => r,
                None => return GqlVal::Value(Value::Null),
            };
            match crate::store::default_tip(repo) {
                Some(_) => {
                    let mut o = GqlObj::new("BranchRef");
                    o = o.scalar("name", json!(DEFAULT_BRANCH));
                    GqlVal::Obj(o)
                }
                None => GqlVal::Value(Value::Null),
            }
        }
        Thunk::RepoIssue { repo_id } => {
            let repo = match find_repo_by_id(store, *repo_id) {
                Some(r) => r,
                None => return GqlVal::Value(Value::Null),
            };
            let num = arg_int(&field.args, "number", vars);
            match num.and_then(|n| repo.issues.iter().find(|i| i.number == n)) {
                Some(issue) => GqlVal::Obj(issue_gql_obj(repo, issue)),
                None => GqlVal::Value(Value::Null),
            }
        }
        Thunk::RepoIssues { repo_id } => {
            let repo = match find_repo_by_id(store, *repo_id) {
                Some(r) => r,
                None => return GqlVal::Value(Value::Null),
            };
            let mut list: Vec<&Issue> = repo.issues.iter().collect();
            if let Some(states) = arg_arr(&field.args, "states", vars) {
                let want: std::collections::HashSet<String> = states
                    .iter()
                    .map(|s| match s {
                        Value::String(x) => x.to_ascii_lowercase(),
                        other => serde_json::to_string(other).unwrap_or_default().to_ascii_lowercase(),
                    })
                    .collect();
                list.retain(|i| want.contains(&i.state));
            }
            if let Some(order_by) = arg_obj(&field.args, "orderBy", vars) {
                let dir = order_by.get("direction").and_then(|v| v.as_str()).unwrap_or("");
                if dir == "DESC" {
                    list.sort_by(|a, b| b.number.cmp(&a.number));
                } else {
                    list.sort_by(|a, b| a.number.cmp(&b.number));
                }
            } else {
                list.sort_by(|a, b| a.number.cmp(&b.number));
            }
            let mut start: usize = 0;
            if let Some(after) = arg_str(&field.args, "after", vars) {
                let decoded = String::from_utf8_lossy(&crate::handlers::base64_decode_lenient(&after)).into_owned();
                let idx_str = decoded.get(7..).unwrap_or("");
                if let Some(idx) = crate::handlers::js_parse_int(idx_str) {
                    start = (idx + 1).max(0) as usize;
                }
            }
            let first = arg_int(&field.args, "first", vars).unwrap_or(100);
            let first = if first < 0 { 0 } else { first as usize };
            let page: Vec<&Issue> = list.iter().skip(start).take(first).cloned().collect();
            let end_cursor = if page.is_empty() {
                Value::Null
            } else {
                json!(cursor((start + page.len() - 1) as i64))
            };
            let nodes: Vec<GqlVal> = page.iter().map(|i| GqlVal::Obj(issue_gql_obj(repo, i))).collect();
            let edges: Vec<GqlVal> = page
                .iter()
                .enumerate()
                .map(|(k, i)| {
                    let mut e = GqlObj::new("IssueEdge");
                    e = e.put("node", GqlVal::Obj(issue_gql_obj(repo, i)));
                    e = e.scalar("cursor", json!(cursor((start + k) as i64)));
                    GqlVal::Obj(e)
                })
                .collect();
            let mut pi = GqlObj::new("PageInfo");
            pi = pi
                .scalar("hasNextPage", json!(start + page.len() < list.len()))
                .scalar("endCursor", end_cursor);
            let mut conn = GqlObj::new("IssueConnection");
            conn = conn
                .put("nodes", GqlVal::Arr(nodes))
                .put("edges", GqlVal::Arr(edges))
                .put("pageInfo", GqlVal::Obj(pi))
                .scalar("totalCount", json!(list.len() as i64));
            GqlVal::Obj(conn)
        }
        Thunk::RepoPullRequests { repo_id } => {
            let repo = match find_repo_by_id(store, *repo_id) {
                Some(r) => r,
                None => return GqlVal::Value(Value::Null),
            };
            let mut list: Vec<&Pull> = repo.pulls.iter().filter(|p| p.state == "open").collect();
            if let Some(states) = arg_arr(&field.args, "states", vars) {
                let want: std::collections::HashSet<String> = states
                    .iter()
                    .map(|s| match s {
                        Value::String(x) => x.to_ascii_uppercase(),
                        other => serde_json::to_string(other).unwrap_or_default().to_ascii_uppercase(),
                    })
                    .collect();
                list = repo
                    .pulls
                    .iter()
                    .filter(|p| want.contains(if p.state == "open" { "OPEN" } else { "CLOSED" }))
                    .collect();
            }
            let first = arg_int(&field.args, "first", vars).unwrap_or(100);
            let first = if first < 0 { 0 } else { first as usize };
            let page: Vec<&Pull> = list.iter().take(first).cloned().collect();
            let nodes: Vec<GqlVal> = page.iter().map(|p| GqlVal::Obj(pull_gql_obj(repo, p))).collect();
            let edges: Vec<GqlVal> = page
                .iter()
                .map(|p| {
                    let mut e = GqlObj::new("PullRequestEdge");
                    e = e.put("node", GqlVal::Obj(pull_gql_obj(repo, p)));
                    e = e.scalar("cursor", json!(cursor(p.number)));
                    GqlVal::Obj(e)
                })
                .collect();
            let mut pi = GqlObj::new("PageInfo");
            pi = pi.scalar("hasNextPage", json!(list.len() > first)).scalar("endCursor", Value::Null);
            let mut conn = GqlObj::new("PullRequestConnection");
            conn = conn
                .put("nodes", GqlVal::Arr(nodes))
                .put("edges", GqlVal::Arr(edges))
                .put("pageInfo", GqlVal::Obj(pi))
                .scalar("totalCount", json!(list.len() as i64));
            GqlVal::Obj(conn)
        }
        Thunk::RepoPullRequest { repo_id } => {
            let repo = match find_repo_by_id(store, *repo_id) {
                Some(r) => r,
                None => return GqlVal::Value(Value::Null),
            };
            let num = arg_int(&field.args, "number", vars);
            match num.and_then(|n| repo.pulls.iter().find(|p| p.number == n)) {
                Some(pull) => GqlVal::Obj(pull_gql_obj(repo, pull)),
                None => GqlVal::Value(Value::Null),
            }
        }
        Thunk::PullFiles { repo_id, pull_number } => {
            let repo = match find_repo_by_id(store, *repo_id) {
                Some(r) => r,
                None => return GqlVal::Value(Value::Null),
            };
            let pull = match repo.pulls.iter().find(|p| p.number == *pull_number) {
                Some(p) => p,
                None => return GqlVal::Value(Value::Null),
            };
            let head_tip = crate::store::ref_tip(repo, &pull.head_branch);
            let diff: Vec<Value> = match head_tip {
                Some(tip) => match diff_trees(repo, &pull.base_sha_at_creation, &tip) {
                    Value::Array(a) => a,
                    _ => Vec::new(),
                },
                None => Vec::new(),
            };
            let first = arg_int(&field.args, "first", vars).unwrap_or(100);
            let first = if first < 0 { 0 } else { first as usize };
            let nodes: Vec<GqlVal> = diff
                .iter()
                .take(first)
                .map(|d| {
                    let mut o = GqlObj::new("PullRequestFile");
                    let get = |k: &str| d.get(k).cloned().unwrap_or(Value::Null);
                    o = o
                        .scalar("path", get("filename"))
                        .scalar("filename", get("filename"))
                        .scalar("additions", get("additions"))
                        .scalar("deletions", get("deletions"))
                        .scalar("changes", get("changes"))
                        .scalar("status", get("status"));
                    GqlVal::Obj(o)
                })
                .collect();
            let mut pi = GqlObj::new("PageInfo");
            pi = pi.scalar("hasNextPage", json!(false)).scalar("endCursor", Value::Null);
            let mut conn = GqlObj::new("PullRequestFileConnection");
            conn = conn
                .put("nodes", GqlVal::Arr(nodes))
                .put("pageInfo", GqlVal::Obj(pi))
                .scalar("totalCount", json!(diff.len() as i64));
            GqlVal::Obj(conn)
        }
    }
}

fn exec_value(store: &Store, val: &GqlVal, sel: &GqlField, vars: &Vars, parent_type: &str) -> Value {
    match val {
        GqlVal::Value(v) => v.clone(),
        GqlVal::Thunk(t) => {
            let resolved = resolve_thunk(store, t, sel, vars);
            exec_value(store, &resolved, sel, vars, parent_type)
        }
        GqlVal::Arr(items) => {
            let out: Vec<Value> = items
                .iter()
                .map(|el| match el {
                    GqlVal::Obj(o) if !sel.selections.is_empty() => {
                        let el_type = gql_child(parent_type, &sel.name).unwrap_or(o.typename);
                        exec_selections(store, o, &sel.selections, vars, el_type)
                    }
                    GqlVal::Obj(o) => obj_with_typename(o),
                    GqlVal::Thunk(t) => {
                        let resolved = resolve_thunk(store, t, sel, vars);
                        exec_value(store, &resolved, sel, vars, parent_type)
                    }
                    other => exec_value(store, other, sel, vars, parent_type),
                })
                .collect();
            Value::Array(out)
        }
        GqlVal::Obj(o) => {
            if sel.selections.is_empty() {
                obj_with_typename(o)
            } else {
                let child_type = gql_child(parent_type, &sel.name).unwrap_or(o.typename);
                exec_selections(store, o, &sel.selections, vars, child_type)
            }
        }
    }
}

/// Serialize an object WITH __typename (TS execValue returns the raw object
/// when the field has no sub-selections).
fn obj_with_typename(o: &GqlObj) -> Value {
    let mut m = Map::new();
    m.insert("__typename".to_string(), json!(o.typename));
    for (k, v) in &o.fields {
        m.insert(k.clone(), gql_val_to_value(v));
    }
    Value::Object(m)
}

fn gql_val_to_value(v: &GqlVal) -> Value {
    match v {
        GqlVal::Value(x) => x.clone(),
        GqlVal::Obj(o) => obj_with_typename(o),
        GqlVal::Arr(items) => Value::Array(items.iter().map(gql_val_to_value).collect()),
        GqlVal::Thunk(_) => Value::Null,
    }
}

fn exec_selections(store: &Store, obj: &GqlObj, sels: &[GqlSel], vars: &Vars, type_name: &str) -> Value {
    let mut out = Map::new();
    for sel in sels {
        match sel {
            GqlSel::Fragment { type_cond, selections } => {
                if selections.is_empty() {
                    continue;
                }
                if let Some(tc) = type_cond {
                    if tc != type_name {
                        continue;
                    }
                    if let Value::Object(m) = exec_selections(store, obj, selections, vars, tc) {
                        for (k, v) in m {
                            out.insert(k, v);
                        }
                    }
                }
            }
            GqlSel::Field(f) => {
                let key = f.alias.clone().unwrap_or_else(|| f.name.clone());
                let val = match obj.fields.get(&f.name) {
                    Some(v) => exec_value(store, v, f, vars, type_name),
                    None => Value::Null,
                };
                out.insert(key, val);
            }
        }
    }
    Value::Object(out)
}

// ---------------------------------------------------------------- root execution

fn execute_gql(store: &mut Store, op: &GqlOp, variables: &Vars) -> Value {
    let mut errors: Vec<Value> = Vec::new();
    let root_type = if op.is_mutation { "Mutation" } else { "Query" };
    validate_selections(&op.selections, root_type, &mut errors);
    let has_validation_error = !errors.is_empty();
    let mut data = Map::new();
    for sel in &op.selections {
        let f = match sel {
            GqlSel::Fragment { .. } => continue,
            GqlSel::Field(f) => f,
        };
        let key = f.alias.clone().unwrap_or_else(|| f.name.clone());
        if has_validation_error {
            data.insert(key, Value::Null);
            continue;
        }
        if !op.is_mutation {
            match f.name.as_str() {
                "viewer" => {
                    let viewer = GqlObj::new("Viewer")
                        .scalar("id", json!(global_id("User", &["1000".to_string()])))
                        .scalar("login", json!(VIEWER_LOGIN))
                        .scalar("name", json!("ada iversen"))
                        .scalar("email", json!("adaiversen@example.invalid"));
                    data.insert(key, exec_selections(store, &viewer, &f.selections, variables, "Viewer"));
                }
                "repository" => {
                    let owner = arg_str(&f.args, "owner", variables);
                    let name = arg_str(&f.args, "name", variables);
                    let repo = match (owner, name) {
                        (Some(o), Some(n)) => store.find_repo(&o, &n).map(|r| repo_gql_obj(r)),
                        _ => None,
                    };
                    match repo {
                        Some(obj) => {
                            data.insert(key, exec_selections(store, &obj, &f.selections, variables, "Repository"));
                        }
                        None => {
                            data.insert(key, Value::Null);
                        }
                    }
                }
                "node" => {
                    let id = arg_str(&f.args, "id", variables);
                    let node = id.and_then(|i| node_gql_obj(store, &i));
                    match node {
                        Some(obj) => {
                            let t = obj.typename;
                            data.insert(key, exec_selections(store, &obj, &f.selections, variables, t));
                        }
                        None => {
                            data.insert(key, Value::Null);
                        }
                    }
                }
                "__type" => {
                    let name = arg_str(&f.args, "name", variables).unwrap_or_default();
                    match type_info(&name) {
                        Some((kind, fields, enum_values)) => {
                            let field_objs: Vec<GqlVal> = fields
                                .iter()
                                .map(|fl| {
                                    GqlVal::Obj(GqlObj::new("__Field").scalar("name", json!(*fl)))
                                })
                                .collect();
                            let enum_objs: Vec<GqlVal> = enum_values
                                .iter()
                                .map(|e| GqlVal::Obj(GqlObj::new("__EnumValue").scalar("name", json!(*e))))
                                .collect();
                            let tobj = GqlObj::new("__Type")
                                .scalar("name", json!(name))
                                .scalar("kind", json!(kind))
                                .put("fields", GqlVal::Arr(field_objs))
                                .put("enumValues", GqlVal::Arr(enum_objs))
                                .scalar("description", Value::Null);
                            data.insert(key, exec_selections(store, &tobj, &f.selections, variables, "__Type"));
                        }
                        None => {
                            data.insert(key, Value::Null);
                        }
                    }
                }
                "__schema" => {
                    let sobj = GqlObj::new("__Schema");
                    data.insert(key, exec_selections(store, &sobj, &f.selections, variables, "__Schema"));
                }
                _ => {
                    data.insert(key, Value::Null);
                }
            }
        } else {
            match f.name.as_str() {
                "createIssue" => {
                    let input = arg_obj(&f.args, "input", variables).unwrap_or_default();
                    let repo_id = input
                        .get("repositoryId")
                        .and_then(|v| v.as_str())
                        .and_then(decode_global_id);
                    let repo = repo_id.and_then(|(_, parts)| {
                        let id = crate::handlers::js_parse_int(parts.first()?).unwrap_or(0);
                        find_repo_by_id(store, id).map(|r| r.name.clone())
                    });
                    let mut gql_issue: Option<GqlObj> = None;
                    if let Some(repo_name) = repo {
                        let title = input.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let body = input.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let issue = create_issue_obj(store, &repo_name, title, body, Vec::new());
                        let r = store.repos.get(&repo_name).unwrap();
                        gql_issue = Some(issue_gql_obj(r, &issue));
                    }
                    let client_mutation_id = input.get("clientMutationId").cloned().unwrap_or(Value::Null);
                    let mut payload = GqlObj::new("CreateIssuePayload");
                    payload = match gql_issue {
                        Some(o) => payload.put("issue", GqlVal::Obj(o)),
                        None => payload.scalar("issue", Value::Null),
                    };
                    payload = payload.scalar("clientMutationId", client_mutation_id);
                    data.insert(key, exec_selections(store, &payload, &f.selections, variables, "CreateIssuePayload"));
                }
                "closeIssue" => {
                    let input = arg_obj(&f.args, "input", variables).unwrap_or_default();
                    let issue_id = input
                        .get("issueId")
                        .and_then(|v| v.as_str())
                        .and_then(decode_global_id);
                    let mut gql_issue: Option<GqlObj> = None;
                    if let Some((kind, parts)) = issue_id {
                        if kind == "Issue" {
                            let repo_id = crate::handlers::js_parse_int(parts.first().map(|s| s.as_str()).unwrap_or("0")).unwrap_or(0);
                            let num = crate::handlers::js_parse_int(parts.get(1).map(|s| s.as_str()).unwrap_or("0")).unwrap_or(0);
                            if let Some(repo) = store.repos.values_mut().find(|r| r.id == repo_id) {
                                if let Some(issue) = repo.issues.iter_mut().find(|i| i.number == num) {
                                    issue.state = "closed".to_string();
                                }
                                refresh_issue(repo, num);
                                let issue = repo.issues.iter().find(|i| i.number == num).unwrap();
                                gql_issue = Some(issue_gql_obj(repo, issue));
                            }
                        }
                    }
                    let client_mutation_id = input.get("clientMutationId").cloned().unwrap_or(Value::Null);
                    let mut payload = GqlObj::new("CloseIssuePayload");
                    payload = match gql_issue {
                        Some(o) => payload.put("issue", GqlVal::Obj(o)),
                        None => payload.scalar("issue", Value::Null),
                    };
                    payload = payload.scalar("clientMutationId", client_mutation_id);
                    data.insert(key, exec_selections(store, &payload, &f.selections, variables, "CloseIssuePayload"));
                }
                "createPullRequest" => {
                    let input = arg_obj(&f.args, "input", variables).unwrap_or_default();
                    let repo_id = input
                        .get("repositoryId")
                        .and_then(|v| v.as_str())
                        .and_then(decode_global_id);
                    let repo = repo_id.and_then(|(_, parts)| {
                        let id = crate::handlers::js_parse_int(parts.first().map(|s| s.as_str()).unwrap_or("0")).unwrap_or(0);
                        find_repo_by_id(store, id).map(|r| r.name.clone())
                    });
                    let mut gql_pull: Option<GqlObj> = None;
                    if let Some(repo_name) = repo {
                        let head = input.get("headRefName").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let base = input.get("baseRefName").and_then(|v| v.as_str()).unwrap_or(DEFAULT_BRANCH).to_string();
                        let title = input.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let body = input.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if let Some(pull) = create_pull(store, &repo_name, title, body, head, base) {
                            let r = store.repos.get(&repo_name).unwrap();
                            gql_pull = Some(pull_gql_obj(r, &pull));
                        }
                    }
                    let client_mutation_id = input.get("clientMutationId").cloned().unwrap_or(Value::Null);
                    let mut payload = GqlObj::new("CreatePullRequestPayload");
                    payload = match gql_pull {
                        Some(o) => payload.put("pullRequest", GqlVal::Obj(o)),
                        None => payload.scalar("pullRequest", Value::Null),
                    };
                    payload = payload.scalar("clientMutationId", client_mutation_id);
                    data.insert(key, exec_selections(store, &payload, &f.selections, variables, "CreatePullRequestPayload"));
                }
                "mergePullRequest" => {
                    let input = arg_obj(&f.args, "input", variables).unwrap_or_default();
                    let pr_id = input
                        .get("pullRequestId")
                        .and_then(|v| v.as_str())
                        .and_then(decode_global_id);
                    let mut gql_pull: Option<GqlObj> = None;
                    if let Some((kind, parts)) = pr_id {
                        if kind == "PullRequest" {
                            let repo_id = crate::handlers::js_parse_int(parts.first().map(|s| s.as_str()).unwrap_or("0")).unwrap_or(0);
                            let num = crate::handlers::js_parse_int(parts.get(1).map(|s| s.as_str()).unwrap_or("0")).unwrap_or(0);
                            if let Some(repo) = store.repos.values_mut().find(|r| r.id == repo_id) {
                                if let Some(pull) = repo.pulls.iter().find(|p| p.number == num) {
                                    if pull.state == "open" && !pull_conflicts(repo, pull) {
                                        crate::handlers::squash_merge(repo, num);
                                    }
                                }
                                if let Some(pull) = repo.pulls.iter().find(|p| p.number == num) {
                                    gql_pull = Some(pull_gql_obj(repo, pull));
                                }
                            }
                        }
                    }
                    let client_mutation_id = input.get("clientMutationId").cloned().unwrap_or(Value::Null);
                    let mut payload = GqlObj::new("MergePullRequestPayload");
                    payload = match gql_pull {
                        Some(o) => payload.put("pullRequest", GqlVal::Obj(o)),
                        None => payload.scalar("pullRequest", Value::Null),
                    };
                    payload = payload.scalar("clientMutationId", client_mutation_id);
                    data.insert(key, exec_selections(store, &payload, &f.selections, variables, "MergePullRequestPayload"));
                }
                "addComment" => {
                    let input = arg_obj(&f.args, "input", variables).unwrap_or_default();
                    let subject_id = input
                        .get("subjectId")
                        .and_then(|v| v.as_str())
                        .and_then(decode_global_id);
                    let mut edge: Option<GqlObj> = None;
                    if let Some((kind, parts)) = subject_id {
                        if kind == "Issue" {
                            let repo_id = crate::handlers::js_parse_int(parts.first().map(|s| s.as_str()).unwrap_or("0")).unwrap_or(0);
                            let num = crate::handlers::js_parse_int(parts.get(1).map(|s| s.as_str()).unwrap_or("0")).unwrap_or(0);
                            let body = input.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            if let Some(comment) = crate::handlers::add_comment(store, repo_id, num, body) {
                                let mut node = GqlObj::new("IssueComment");
                                node = node
                                    .scalar("id", json!(global_id("IssueComment", &[repo_id.to_string(), comment.id.to_string()])))
                                    .scalar("body", json!(comment.body));
                                let mut e = GqlObj::new("CommentEdge");
                                e = e
                                    .put("node", GqlVal::Obj(node))
                                    .scalar("cursor", json!(base64_encode(format!("cursor:{}", comment.id).as_bytes())));
                                edge = Some(e);
                            }
                        }
                    }
                    let client_mutation_id = input.get("clientMutationId").cloned().unwrap_or(Value::Null);
                    let mut payload = GqlObj::new("AddCommentPayload");
                    payload = match edge {
                        Some(e) => payload.put("commentEdge", GqlVal::Obj(e)),
                        None => payload.scalar("commentEdge", Value::Null),
                    };
                    payload = payload.scalar("subject", Value::Null).scalar("clientMutationId", client_mutation_id);
                    data.insert(key, exec_selections(store, &payload, &f.selections, variables, "AddCommentPayload"));
                }
                _ => {
                    data.insert(key, Value::Null);
                }
            }
        }
    }
    let mut result = Map::new();
    result.insert("data".to_string(), Value::Object(data));
    if !errors.is_empty() {
        result.insert("errors".to_string(), Value::Array(errors));
    }
    Value::Object(result)
}

// ---------------------------------------------------------------- HTTP entry

pub fn handle_graphql(store: &mut Store, req: &Request) -> Response {
    let parsed: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => {
            return crate::handlers::req_err(store, 400, "Invalid JSON");
        }
    };
    let run = |store: &mut Store, doc: &Value| -> Value {
        let query = doc.get("query").and_then(|v| v.as_str()).unwrap_or("");
        let variables: Vars = match doc.get("variables") {
            Some(Value::Object(m)) => m.clone(),
            _ => Map::new(),
        };
        let operation_name = doc.get("operationName").and_then(|v| v.as_str()).map(|s| s.to_string());
        let ops = GqlParser::new(gql_tokenize(query)).parse_document();
        let op = match &operation_name {
            Some(name) => ops.iter().find(|o| o.name.as_deref() == Some(name.as_str())).or(ops.first()),
            None => ops.first(),
        };
        match op {
            Some(op) => execute_gql(store, op, &variables),
            None => json!({ "data": {}, "errors": [{ "message": "No operation found." }] }),
        }
    };
    let result = match &parsed {
        Value::Array(docs) => {
            let mut out: Vec<Value> = Vec::new();
            for d in docs {
                out.push(run(store, d));
            }
            Value::Array(out)
        }
        _ => run(store, &parsed),
    };
    crate::handlers::req_json(store, 200, result, Vec::new())
}
