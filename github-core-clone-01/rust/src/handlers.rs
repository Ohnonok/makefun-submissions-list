// handlers.rs — REST v3 + git smart HTTP + request routing.
// Faithful port of app.ts (commit 7ebc300); SPEC.md is the guide, the
// reference code is the authority for every constant, status and shape.
// No clock, no randomness: all timestamps are FIXED_TS / FIXED_EPOCH.

use crate::git;
use crate::http::{Request, Response};
use crate::store::*;
use indexmap::IndexMap;
use serde_json::{json, Value};

// ---------------------------------------------------------------- response helpers

pub fn req_json(store: &mut Store, status: u16, body: Value, extra: Vec<(String, String)>) -> Response {
    let mut r = Response::json(status, serde_json::to_vec(&body).unwrap_or_default(), store.req_id());
    r.extra = extra;
    r
}

pub fn req_err(store: &mut Store, status: u16, message: &str) -> Response {
    req_json(store, status, json!({ "message": message }), Vec::new())
}

pub fn req_buf(store: &mut Store, status: u16, buf: Vec<u8>, content_type: &'static str) -> Response {
    Response::new(status, content_type, buf, store.req_id())
}

/// 204 DELETE repo: ONLY x-github-request-id, no content-type/length/body.
pub fn req_204(store: &mut Store) -> Response {
    let mut r = Response::new(204, "", Vec::new(), store.req_id());
    r.no_content_type = true;
    r.no_content_length = true;
    r
}

pub fn authed(store: &Store, req: &Request) -> bool {
    if store.token.is_empty() {
        return true;
    }
    match req.header("authorization") {
        Some(h) => h == format!("Bearer {}", store.token),
        None => false,
    }
}

// ---------------------------------------------------------------- query / pagination

/// JS parseInt(s, 10): leading whitespace, optional sign, digits; None if no digits.
pub fn js_parse_int(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() && matches!(b[i], b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c) {
        i += 1;
    }
    let mut neg = false;
    if i < b.len() && (b[i] == b'-' || b[i] == b'+') {
        neg = b[i] == b'-';
        i += 1;
    }
    let mut val: i64 = 0;
    let mut any = false;
    while i < b.len() && b[i].is_ascii_digit() {
        any = true;
        val = val.saturating_mul(10).saturating_add((b[i] - b'0') as i64);
        i += 1;
    }
    if !any {
        return None;
    }
    Some(if neg { -val } else { val })
}

pub fn parse_query(qs: &str) -> Result<IndexMap<String, String>, ()> {
    let mut out: IndexMap<String, String> = IndexMap::new();
    if qs.is_empty() {
        return Ok(out);
    }
    for part in qs.split('&') {
        if part.is_empty() {
            continue;
        }
        let eq = part.find('=');
        let (kraw, vraw) = match eq {
            Some(e) => (&part[..e], Some(&part[e + 1..])),
            None => (part, None),
        };
        let k = percent_decode_str(kraw).ok_or(())?;
        let v = match vraw {
            Some(v) => {
                let spaced: String = v.chars().map(|c| if c == '+' { ' ' } else { c }).collect();
                percent_decode_str(&spaced).ok_or(())?
            }
            None => String::new(),
        };
        out.insert(k, v);
    }
    Ok(out)
}

/// decodeURIComponent semantics: %XX decoded, invalid UTF-8 or bad % → None.
pub fn percent_decode_str(s: &str) -> Option<String> {
    if !s.contains('%') {
        return Some(s.to_string());
    }
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 2 >= b.len() {
                return None;
            }
            let hi = (b[i + 1] as char).to_digit(16)?;
            let lo = (b[i + 2] as char).to_digit(16)?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub struct PageOpts {
    pub per_page: i64,
    pub page: i64,
}

pub fn page_opts(q: &IndexMap<String, String>) -> PageOpts {
    // TS: parseInt(...) || 30 — 0 is falsy, so per_page=0 means 30 (not 1).
    let per_page_raw = js_parse_int(q.get("per_page").map(|s| s.as_str()).unwrap_or("30")).unwrap_or(30);
    let per_page = if per_page_raw == 0 { 30 } else { per_page_raw }.clamp(1, 100);
    let page = js_parse_int(q.get("page").map(|s| s.as_str()).unwrap_or("1"))
        .unwrap_or(1)
        .max(1);
    PageOpts { per_page, page }
}

pub fn paginate_len(n: usize, opts: &PageOpts) -> (usize, usize, bool, i64) {
    let total_pages = ((n as i64 + opts.per_page - 1) / opts.per_page).max(1);
    let start = (((opts.page - 1) * opts.per_page).max(0) as usize).min(n);
    let end = (start + opts.per_page as usize).min(n);
    let has_next = opts.page < total_pages;
    (start, end, has_next, total_pages)
}

/// URLSearchParams percent-encoding: A-Z a-z 0-9 - . _ * stay, space → '+', else %XX.
fn form_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'*' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub fn link_header(host: &str, pathname: &str, q: &IndexMap<String, String>, opts: &PageOpts, total_pages: i64) -> String {
    let build = |page: i64| -> String {
        let mut params: Vec<(String, String)> = Vec::new();
        for (k, v) in q {
            if k != "page" {
                params.push((k.clone(), v.clone()));
            }
        }
        // URLSearchParams.set: replace in place if present, else append.
        let mut set = |key: &str, val: String, params: &mut Vec<(String, String)>| {
            if let Some(e) = params.iter_mut().find(|(k, _)| k == key) {
                e.1 = val;
            } else {
                params.push((key.to_string(), val));
            }
        };
        set("per_page", opts.per_page.to_string(), &mut params);
        set("page", page.to_string(), &mut params);
        let qs = params.iter().map(|(k, v)| format!("{}={}", form_encode(k), form_encode(v))).collect::<Vec<_>>().join("&");
        format!("http://{}{}?{}", host, pathname, qs)
    };
    let mut parts: Vec<String> = Vec::new();
    if opts.page < total_pages {
        parts.push(format!("<{}>; rel=\"next\"", build(opts.page + 1)));
    }
    if total_pages > 1 {
        parts.push(format!("<{}>; rel=\"last\"", build(total_pages)));
    }
    if opts.page > 1 {
        parts.push(format!("<{}>; rel=\"first\"", build(1)));
        parts.push(format!("<{}>; rel=\"prev\"", build(opts.page - 1)));
    }
    parts.join(", ")
}

// ---------------------------------------------------------------- git model helpers

pub fn flatten_tree(repo: &Repo, tree_oid: &str, prefix: &str, out: &mut IndexMap<String, (String, String)>) {
    let obj = match repo.objects.get(tree_oid) {
        Some(o) if o.typ == git::T_TREE => o,
        _ => return,
    };
    for e in git::parse_tree(&obj.data) {
        let path = if prefix.is_empty() { e.name.clone() } else { format!("{}/{}", prefix, e.name) };
        if e.mode == "40000" {
            flatten_tree(repo, &e.oid, &path, out);
        } else {
            out.insert(path, (e.mode, e.oid));
        }
    }
}

struct FlatNode {
    files: IndexMap<String, (String, String)>,
    dirs: IndexMap<String, FlatNode>,
}

fn build_flat_node(repo: &mut Repo, node: &FlatNode) -> String {
    let mut entries: Vec<git::TreeEntry> = Vec::new();
    for (name, (mode, oid)) in &node.files {
        entries.push(git::TreeEntry { mode: mode.clone(), name: name.clone(), oid: oid.clone() });
    }
    for (name, child) in &node.dirs {
        let oid = build_flat_node(repo, child);
        entries.push(git::TreeEntry { mode: "40000".to_string(), name: name.clone(), oid });
    }
    let data = git::build_tree(&entries);
    put_object(repo, git::T_TREE, data)
}

pub fn build_tree_from_flat(repo: &mut Repo, flat: &IndexMap<String, (String, String)>) -> String {
    let mut root = FlatNode { files: IndexMap::new(), dirs: IndexMap::new() };
    for (path, entry) in flat {
        let segs: Vec<&str> = path.split('/').collect();
        let mut node = &mut root;
        for s in &segs[..segs.len() - 1] {
            node = node.dirs.entry(s.to_string()).or_insert_with(|| FlatNode { files: IndexMap::new(), dirs: IndexMap::new() });
        }
        node.files.insert(segs[segs.len() - 1].to_string(), entry.clone());
    }
    build_flat_node(repo, &root)
}

pub fn commit_file(repo: &mut Repo, branch: &str, path: &str, content: Vec<u8>, message: &str) -> (String, String) {
    let r = format!("refs/heads/{}", branch);
    let tip = repo.refs.get(&r).cloned();
    let mut flat: IndexMap<String, (String, String)> = IndexMap::new();
    if let Some(t) = &tip {
        if let Some(commit) = repo.objects.get(t) {
            if commit.typ == git::T_COMMIT {
                let tree = git::parse_commit(&commit.data).tree.clone();
                flatten_tree(repo, &tree, "", &mut flat);
            } else if commit.typ == git::T_TAG {
                if let Some(peeled) = git::peel_to_commit(&repo.objects, t) {
                    if let Some(pc) = repo.objects.get(&peeled) {
                        let tree = git::parse_commit(&pc.data).tree.clone();
                        flatten_tree(repo, &tree, "", &mut flat);
                    }
                }
            }
        }
    }
    let blob_sha = put_object(repo, git::T_BLOB, content);
    flat.insert(path.to_string(), ("100644".to_string(), blob_sha.clone()));
    let tree_oid = build_tree_from_flat(repo, &flat);
    let parents: Vec<String> = tip.clone().into_iter().collect();
    let commit_sha = put_object(repo, git::T_COMMIT, git::build_commit(&tree_oid, &parents, message));
    repo.refs.insert(r, commit_sha.clone());
    bump_repo(repo);
    (commit_sha, blob_sha)
}

pub fn delete_file(repo: &mut Repo, branch: &str, path: &str, message: &str) -> Option<String> {
    let r = format!("refs/heads/{}", branch);
    let tip = repo.refs.get(&r)?.clone();
    let commit = repo.objects.get(&tip)?;
    if commit.typ != git::T_COMMIT {
        return None;
    }
    let tree = git::parse_commit(&commit.data).tree.clone();
    let mut flat: IndexMap<String, (String, String)> = IndexMap::new();
    flatten_tree(repo, &tree, "", &mut flat);
    if !flat.contains_key(path) {
        return None;
    }
    flat.shift_remove(path);
    let tree_oid = build_tree_from_flat(repo, &flat);
    let commit_sha = put_object(repo, git::T_COMMIT, git::build_commit(&tree_oid, &[tip], message));
    repo.refs.insert(r, commit_sha.clone());
    bump_repo(repo);
    Some(commit_sha)
}

pub fn lookup_path(repo: &Repo, commit_oid: &str, path: &str) -> Option<(String, String)> {
    let commit = repo.objects.get(commit_oid)?;
    if commit.typ != git::T_COMMIT {
        return None;
    }
    let mut tree_oid = git::parse_commit(&commit.data).tree.clone();
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    for (i, seg) in segs.iter().enumerate() {
        let tree = repo.objects.get(&tree_oid)?;
        if tree.typ != git::T_TREE {
            return None;
        }
        let entry = git::parse_tree(&tree.data).into_iter().find(|e| e.name == *seg)?;
        if i == segs.len() - 1 {
            return Some((entry.oid, entry.mode));
        }
        if entry.mode != "40000" {
            return None;
        }
        tree_oid = entry.oid;
    }
    None
}

pub fn list_dir(repo: &Repo, commit_oid: &str, dir_path: &str) -> Option<Value> {
    let commit = repo.objects.get(commit_oid)?;
    if commit.typ != git::T_COMMIT {
        return None;
    }
    let mut tree_oid = git::parse_commit(&commit.data).tree.clone();
    let segs: Vec<&str> = dir_path.split('/').filter(|s| !s.is_empty()).collect();
    for seg in segs {
        let tree = repo.objects.get(&tree_oid)?;
        if tree.typ != git::T_TREE {
            return None;
        }
        let entry = git::parse_tree(&tree.data).into_iter().find(|e| e.name == seg)?;
        if entry.mode != "40000" {
            return None;
        }
        tree_oid = entry.oid;
    }
    let tree = repo.objects.get(&tree_oid)?;
    if tree.typ != git::T_TREE {
        return None;
    }
    let mut out: Vec<Value> = Vec::new();
    for e in git::parse_tree(&tree.data) {
        let p = if dir_path.is_empty() { e.name.clone() } else { format!("{}/{}", dir_path, e.name) };
        if e.mode == "40000" {
            out.push(json!({ "name": e.name, "path": p, "sha": e.oid, "type": "dir" }));
        } else {
            let size = repo.objects.get(&e.oid).map(|b| b.data.len()).unwrap_or(0);
            out.push(json!({ "name": e.name, "path": p, "sha": e.oid, "type": "file", "size": size }));
        }
    }
    Some(Value::Array(out))
}

// ---------------------------------------------------------------- issue / pull / repo JSON

pub fn issue_json(repo: &Repo, issue: &Issue) -> Vec<u8> {
    let labels: Vec<String> = issue
        .labels
        .iter()
        .map(|l| format!("{{\"name\":{},\"color\":{}}}", json_escape(&l.name), json_escape(&l.color)))
        .collect();
    let url = format!("/api/v3/repos/{}/{}/issues/{}", VIEWER_LOGIN, repo.name, issue.number);
    let comments = repo.comments.get(&issue.number).map(|v| v.len()).unwrap_or(0);
    let s = format!(
        "{{\"id\":{},\"node_id\":{},\"number\":{},\"title\":{},\"body\":{},\"state\":{},\"labels\":[{}],\"user\":{{\"login\":{},\"id\":1000}},\"created_at\":{},\"updated_at\":{},\"url\":{},\"html_url\":{},\"comments\":{}}}",
        issue.id,
        json_escape(&global_id("Issue", &[repo.id.to_string(), issue.number.to_string()])),
        issue.number,
        json_escape(&issue.title),
        json_escape(&issue.body),
        json_escape(&issue.state),
        labels.join(","),
        json_escape(VIEWER_LOGIN),
        json_escape(FIXED_TS),
        json_escape(FIXED_TS),
        json_escape(&url),
        json_escape(&format!("/{}/{}/issues/{}", VIEWER_LOGIN, repo.name, issue.number)),
        comments
    );
    s.into_bytes()
}

pub fn refresh_issue(repo: &mut Repo, number: i64) {
    let j = {
        let issue = match repo.issues.iter().find(|i| i.number == number) {
            Some(i) => i,
            None => return,
        };
        issue_json(repo, issue)
    };
    if let Some(issue) = repo.issues.iter_mut().find(|i| i.number == number) {
        issue.json = j;
    }
}

/// Creates the issue, pushes it, renders its cached JSON. Returns a clone.
pub fn create_issue_obj(store: &mut Store, repo_name: &str, title: String, body: String, labels: Vec<Label>) -> Issue {
    let (id, seq, number);
    {
        let Store { repos, global_id_seq, .. } = store;
        let repo = repos.get_mut(repo_name).expect("create_issue_obj: repo exists");
        *global_id_seq += 1;
        id = *global_id_seq;
        number = repo.next_issue;
        repo.next_issue += 1;
        seq = repo.seq * 1_000_000 + number;
        let issue = Issue { id, number, title, body, state: "open".to_string(), labels, seq, json: Vec::new() };
        repo.issues.push(issue);
    }
    {
        // Single position lookup: the old code ran three iter().find() scans
        // over the repo's issues Vec here (render, store, return-clone).
        let repo = store.repos.get_mut(repo_name).unwrap();
        let idx = repo.issues.iter().position(|i| i.number == number).unwrap();
        let j = issue_json(repo, &repo.issues[idx]);
        repo.issues[idx].json = j;
    }
    store.repos.get(repo_name).unwrap().issues.iter().find(|i| i.number == number).unwrap().clone()
}

/// Creates a pull exactly like REST POST /pulls (and the GraphQL/MCP
/// createPullRequest paths). Returns None when a tip is missing.
pub fn create_pull(store: &mut Store, repo_name: &str, title: String, body: String, head: String, base: String) -> Option<Pull> {
    let (head_tip, base_tip) = {
        let repo = store.repos.get(repo_name)?;
        (ref_tip(repo, &head), ref_tip(repo, &base))
    };
    let base_tip = base_tip?;
    let _ = head_tip?;
    store.global_id_seq += 1;
    let seq = store.global_id_seq;
    let repo = store.repos.get_mut(repo_name)?;
    let number = repo.next_pull;
    repo.next_pull += 1;
    let pull = Pull {
        number,
        title,
        body,
        state: "open".to_string(),
        merged: false,
        merged_at: None,
        merge_sha: None,
        head_branch: head,
        base_branch: base,
        base_sha_at_creation: base_tip,
        seq,
    };
    repo.pulls.push(pull.clone());
    Some(pull)
}

/// Appends a comment to an issue (REST POST comments + GraphQL addComment).
/// Allocates the id from the global sequence, refreshes the issue JSON.
pub fn add_comment(store: &mut Store, repo_id: i64, issue_number: i64, body: String) -> Option<Comment> {
    let repo_name = store.repos.values().find(|r| r.id == repo_id)?.name.clone();
    if store.repos.get(&repo_name)?.issues.iter().find(|i| i.number == issue_number).is_none() {
        return None;
    }
    store.global_id_seq += 1;
    let id = store.global_id_seq;
    let repo = store.repos.get_mut(&repo_name)?;
    let comment = Comment { id, body };
    repo.comments.entry(issue_number).or_default().push(comment.clone());
    refresh_issue(repo, issue_number);
    Some(comment)
}

pub fn pull_json(repo: &Repo, pull: &Pull) -> Value {
    let head_sha = ref_tip(repo, &pull.head_branch).unwrap_or_default();
    let base_sha = ref_tip(repo, &pull.base_branch).unwrap_or_default();
    json!({
        "id": pull.seq, "number": pull.number, "title": pull.title, "body": pull.body,
        "state": pull.state, "merged": pull.merged, "merged_at": pull.merged_at, "merge_commit_sha": pull.merge_sha,
        "head": { "ref": pull.head_branch, "sha": head_sha, "label": format!("{}:{}", VIEWER_LOGIN, pull.head_branch) },
        "base": { "ref": pull.base_branch, "sha": base_sha, "label": format!("{}:{}", VIEWER_LOGIN, pull.base_branch) },
        "user": { "login": VIEWER_LOGIN, "id": 1000 },
        "created_at": FIXED_TS, "updated_at": FIXED_TS,
        "url": format!("/api/v3/repos/{}/{}/pulls/{}", VIEWER_LOGIN, repo.name, pull.number),
        "html_url": format!("/{}/{}/pull/{}", VIEWER_LOGIN, repo.name, pull.number)
    })
}

pub fn repo_json(repo: &Repo) -> Value {
    json!({
        "id": repo.id, "node_id": repo.node_id, "name": repo.name,
        "full_name": format!("{}/{}", VIEWER_LOGIN, repo.name),
        "owner": { "login": VIEWER_LOGIN, "id": 1000, "type": "User" },
        "private": repo.priv_, "description": repo.description, "default_branch": DEFAULT_BRANCH,
        "has_issues": true, "has_projects": true, "has_wiki": true,
        "created_at": FIXED_TS, "updated_at": FIXED_TS, "pushed_at": FIXED_TS,
        "url": format!("/api/v3/repos/{}/{}", VIEWER_LOGIN, repo.name),
        "html_url": format!("/{}/{}", VIEWER_LOGIN, repo.name),
        "clone_url": format!("/{}/{}.git", VIEWER_LOGIN, repo.name)
    })
}

// ---------------------------------------------------------------- diff / conflicts / merge

fn line_count(repo: &Repo, oid: Option<&str>) -> i64 {
    let oid = match oid {
        Some(o) => o,
        None => return 0,
    };
    let o = match repo.objects.get(oid) {
        Some(o) => o,
        None => return 0,
    };
    let text = String::from_utf8_lossy(&o.data);
    if text.is_empty() {
        return 0;
    }
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    lines.len() as i64
}

pub fn diff_trees(repo: &Repo, base_commit_oid: &str, head_commit_oid: &str) -> Value {
    let mut base_flat: IndexMap<String, (String, String)> = IndexMap::new();
    let mut head_flat: IndexMap<String, (String, String)> = IndexMap::new();
    if let Some(bc) = repo.objects.get(base_commit_oid) {
        if bc.typ == git::T_COMMIT {
            let tree = git::parse_commit(&bc.data).tree.clone();
            flatten_tree(repo, &tree, "", &mut base_flat);
        }
    }
    if let Some(hc) = repo.objects.get(head_commit_oid) {
        if hc.typ == git::T_COMMIT {
            let tree = git::parse_commit(&hc.data).tree.clone();
            flatten_tree(repo, &tree, "", &mut head_flat);
        }
    }
    let mut names: Vec<&String> = base_flat.keys().chain(head_flat.keys()).collect();
    names.sort();
    names.dedup();
    let mut out: Vec<Value> = Vec::new();
    for name in names {
        let b = base_flat.get(name);
        let h = head_flat.get(name);
        match (b, h) {
            (Some(b), None) => {
                let d = line_count(repo, Some(&b.1));
                out.push(json!({ "filename": name, "status": "removed", "additions": 0, "deletions": d, "changes": d }));
            }
            (None, Some(h)) => {
                let a = line_count(repo, Some(&h.1));
                out.push(json!({ "filename": name, "status": "added", "additions": a, "deletions": 0, "changes": a }));
            }
            (Some(b), Some(h)) if b.1 != h.1 => {
                let a = line_count(repo, Some(&h.1));
                let d = line_count(repo, Some(&b.1));
                out.push(json!({ "filename": name, "status": "modified", "additions": a, "deletions": d, "changes": a + d }));
            }
            _ => {}
        }
    }
    Value::Array(out)
}

pub fn pull_conflicts(repo: &Repo, pull: &Pull) -> bool {
    let head_tip = match ref_tip(repo, &pull.head_branch) {
        Some(t) => t,
        None => return false,
    };
    let base_tip = match ref_tip(repo, &pull.base_branch) {
        Some(t) => t,
        None => return false,
    };
    let mut head_flat: IndexMap<String, (String, String)> = IndexMap::new();
    let mut base_flat: IndexMap<String, (String, String)> = IndexMap::new();
    let mut orig_flat: IndexMap<String, (String, String)> = IndexMap::new();
    let mut flat_of = |tip: &str, out: &mut IndexMap<String, (String, String)>| {
        if let Some(c) = repo.objects.get(tip) {
            if c.typ == git::T_COMMIT {
                let tree = git::parse_commit(&c.data).tree.clone();
                flatten_tree(repo, &tree, "", out);
            }
        }
    };
    flat_of(&head_tip, &mut head_flat);
    flat_of(&base_tip, &mut base_flat);
    flat_of(&pull.base_sha_at_creation, &mut orig_flat);
    let mut names: Vec<&String> = head_flat.keys().chain(base_flat.keys()).chain(orig_flat.keys()).collect();
    names.sort();
    names.dedup();
    for name in names {
        let h = head_flat.get(name).map(|e| e.1.as_str());
        let b = base_flat.get(name).map(|e| e.1.as_str());
        let o = orig_flat.get(name).map(|e| e.1.as_str());
        if h != o && b != o && h != b {
            return true;
        }
    }
    false
}

pub fn squash_merge(repo: &mut Repo, pull_number: i64) -> Option<String> {
    let (head_branch, base_branch, title) = {
        let p = repo.pulls.iter().find(|p| p.number == pull_number)?;
        (p.head_branch.clone(), p.base_branch.clone(), p.title.clone())
    };
    let head_tip = ref_tip(repo, &head_branch)?;
    let base_tip = ref_tip(repo, &base_branch)?;
    let hc = repo.objects.get(&head_tip)?;
    if hc.typ != git::T_COMMIT {
        return None;
    }
    let tree_oid = git::parse_commit(&hc.data).tree.clone();
    let message = format!("Merge pull request #{} from {}/{}\n\n{}", pull_number, VIEWER_LOGIN, head_branch, title);
    let merge_sha = put_object(repo, git::T_COMMIT, git::build_commit(&tree_oid, &[base_tip], &message));
    repo.refs.insert(format!("refs/heads/{}", base_branch), merge_sha.clone());
    if let Some(p) = repo.pulls.iter_mut().find(|p| p.number == pull_number) {
        p.state = "closed".to_string();
        p.merged = true;
        p.merged_at = Some(FIXED_TS.to_string());
        p.merge_sha = Some(merge_sha.clone());
    }
    bump_repo(repo);
    Some(merge_sha)
}

// ---------------------------------------------------------------- body field helpers

pub fn get_str<'a>(body: &'a Option<Value>, key: &str) -> Option<&'a str> {
    match body {
        Some(Value::Object(m)) => m.get(key).and_then(|v| v.as_str()),
        _ => None,
    }
}

pub fn get_bool(body: &Option<Value>, key: &str) -> bool {
    matches!(body, Some(Value::Object(m)) if m.get(key) == Some(&Value::Bool(true)))
}

/// Lenient base64 decode (JS Buffer.from(str, 'base64') ignores invalid chars).
pub fn base64_decode_lenient(s: &str) -> Vec<u8> {
    let clean: Vec<u8> = s.bytes().filter(|b| b.is_ascii_alphanumeric() || *b == b'+' || *b == b'/' || *b == b'=').collect();
    base64_decode(&String::from_utf8_lossy(&clean)).unwrap_or_default()
}

// ---------------------------------------------------------------- REST v3 (full surface, app.ts:793-1148)

fn parse_identity(line: &str) -> (String, String) {
    // /^(.*?) <([^>]*)>/ — lazy name, email inside <>.
    if let Some(lt) = line.find(" <") {
        if let Some(gt) = line[lt + 2..].find('>') {
            return (line[..lt].to_string(), line[lt + 2..lt + 2 + gt].to_string());
        }
    }
    (line.to_string(), String::new())
}

pub fn handle_rest(store: &mut Store, req: &Request, pathname: &str, method: &str, q: &IndexMap<String, String>, body: Option<Value>) -> Response {
    let segs: Vec<&str> = pathname.split('/').filter(|s| !s.is_empty()).collect();
    // segs[0]='api', segs[1]='v3'
    if segs.len() == 2 {
        if method != "GET" {
            return req_err(store, 404, "Not Found");
        }
        return req_json(
            store,
            200,
            json!({ "current_user_url": "/api/v3/user", "current_user_authorizations_html_url": "https://github.com/settings/applications", "rate_limit_url": "/api/v3/rate_limit" }),
            vec![("x-oauth-scopes".to_string(), "repo, read:org".to_string())],
        );
    }
    let rest = &segs[2..];
    if rest.is_empty() {
        return req_err(store, 404, "Not Found");
    }
    if rest[0] == "meta" && method == "GET" {
        return req_json(store, 200, json!({ "installed_version": "1.0.0" }), Vec::new());
    }
    if rest[0] == "rate_limit" && method == "GET" {
        return req_json(
            store,
            200,
            json!({ "resources": { "core": { "limit": 5000, "remaining": 5000, "reset": git::FIXED_EPOCH } }, "rate": { "limit": 5000, "remaining": 5000, "reset": git::FIXED_EPOCH } }),
            Vec::new(),
        );
    }
    if rest[0] == "user" && rest.len() == 1 && method == "GET" {
        return req_json(
            store,
            200,
            json!({ "login": VIEWER_LOGIN, "id": 1000, "node_id": global_id("User", &["1000".to_string()]), "type": "User", "name": "ada iversen", "email": "adaiversen@example.invalid" }),
            Vec::new(),
        );
    }
    // /user/repos
    if rest[0] == "user" && rest.len() >= 2 && rest[1] == "repos" {
        if method == "GET" {
            let (items, link): (Vec<Value>, Option<String>) = {
                let mut all: Vec<&Repo> = store.repos.values().collect();
                all.sort_by_key(|r| r.seq);
                let opts = page_opts(q);
                let (start, end, has_next, total_pages) = paginate_len(all.len(), &opts);
                let items: Vec<Value> = all[start..end].iter().map(|r| repo_json(r)).collect();
                let link = if has_next || total_pages > 1 {
                    let host = req.header("host").unwrap_or("localhost");
                    Some(link_header(host, pathname, q, &opts, total_pages))
                } else {
                    None
                };
                (items, link)
            };
            let mut r = req_json(store, 200, Value::Array(items), Vec::new());
            if let Some(link) = link {
                r.extra.push(("link".to_string(), link));
            }
            return r;
        }
        if method == "POST" {
            let name = get_str(&body, "name").unwrap_or("");
            if name.is_empty() {
                return req_err(store, 422, "name is required");
            }
            if store.repos.contains_key(name) {
                return req_err(store, 422, "Repository already exists");
            }
            let priv_ = get_bool(&body, "private");
            let desc = get_str(&body, "description").unwrap_or("").to_string();
            let rj = {
                let repo = store.create_repo(name, priv_, &desc);
                repo_json(repo)
            };
            return req_json(store, 201, rj, Vec::new());
        }
        return req_err(store, 404, "Not Found");
    }
    // /repos/:owner/:name
    if rest[0] == "repos" && rest.len() >= 3 {
        let owner = rest[1];
        let name = rest[2];
        if store.find_repo(owner, name).is_none() {
            return req_err(store, 404, "Not Found");
        }
        let tail = &rest[3..];
        if tail.is_empty() {
            if method == "GET" {
                let rj = repo_json(store.repos.get(name).unwrap());
                return req_json(store, 200, rj, Vec::new());
            }
            if method == "PATCH" {
                let repo = store.repos.get_mut(name).unwrap();
                if let Some(d) = get_str(&body, "description") {
                    repo.description = d.to_string();
                }
                if let Some(Value::Bool(p)) = body.as_ref().and_then(|b| b.get("private")) {
                    repo.priv_ = *p;
                }
                let rj = repo_json(store.repos.get(name).unwrap());
                return req_json(store, 200, rj, Vec::new());
            }
            if method == "DELETE" {
                store.repos.remove(name);
                return req_204(store);
            }
            return req_err(store, 404, "Not Found");
        }
        // branches
        if tail[0] == "branches" {
            if tail.len() == 1 && method == "GET" {
                let repo = store.repos.get(name).unwrap();
                let mut list: Vec<Value> = Vec::new();
                for (r, oid) in &repo.refs {
                    if let Some(b) = r.strip_prefix("refs/heads/") {
                        list.push(json!({ "name": b, "commit": { "sha": oid } }));
                    }
                }
                return req_json(store, 200, Value::Array(list), Vec::new());
            }
            if tail.len() >= 2 && method == "GET" {
                let branch = tail[1..].join("/");
                let tip = store.repos.get(name).unwrap().refs.get(&format!("refs/heads/{}", branch)).cloned();
                match tip {
                    Some(t) => return req_json(store, 200, json!({ "name": branch, "commit": { "sha": t } }), Vec::new()),
                    None => return req_err(store, 404, "Not Found"),
                }
            }
            return req_err(store, 404, "Not Found");
        }
        // commits
        if tail[0] == "commits" && method == "GET" {
            let r = q.get("sha").map(|s| s.as_str()).unwrap_or(DEFAULT_BRANCH);
            let tip = {
                let repo = store.repos.get(name).unwrap();
                resolve_ref_to_commit(repo, r)
            };
            let tip = match tip {
                Some(t) => t,
                None => return req_err(store, 404, "Not Found"),
            };
            let repo = store.repos.get(name).unwrap();
            let mut out: Vec<Value> = Vec::new();
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            let mut stack: Vec<String> = vec![tip];
            while let Some(oid) = stack.pop() {
                if seen.contains(&oid) {
                    continue;
                }
                seen.insert(oid.clone());
                let obj = match repo.objects.get(&oid) {
                    Some(o) if o.typ == git::T_COMMIT => o,
                    _ => continue,
                };
                let c = git::parse_commit(&obj.data);
                let (an, ae) = parse_identity(&c.author);
                let (cn, ce) = parse_identity(&c.committer);
                let msg = c.message.strip_suffix('\n').unwrap_or(&c.message).to_string();
                out.push(json!({
                    "sha": oid,
                    "commit": {
                        "message": msg,
                        "author": { "name": an, "email": ae, "date": FIXED_TS },
                        "committer": { "name": cn, "email": ce, "date": FIXED_TS },
                        "tree": { "sha": c.tree },
                    },
                    "author": { "login": VIEWER_LOGIN, "id": 1000 },
                    "committer": { "login": VIEWER_LOGIN, "id": 1000 },
                    "parents": c.parents.iter().map(|p| json!({ "sha": p })).collect::<Vec<_>>(),
                }));
                for p in &c.parents {
                    stack.push(p.clone());
                }
            }
            return req_json(store, 200, Value::Array(out), Vec::new());
        }
        // git refs
        if tail[0] == "git" && tail.len() >= 2 && tail[1] == "refs" {
            if method == "POST" && tail.len() == 2 {
                let r = get_str(&body, "ref").unwrap_or("");
                let sha = get_str(&body, "sha").unwrap_or("");
                if !r.starts_with("refs/") || !git::is_oid(sha) {
                    return req_err(store, 422, "Invalid ref or sha");
                }
                let repo = store.repos.get_mut(name).unwrap();
                repo.refs.insert(r.to_string(), sha.to_string());
                bump_repo(repo);
                return req_json(store, 201, json!({ "ref": r, "object": { "sha": sha } }), Vec::new());
            }
            if method == "GET" && tail.len() == 2 {
                let repo = store.repos.get(name).unwrap();
                let list: Vec<Value> = repo
                    .refs
                    .iter()
                    .map(|(r, oid)| json!({ "ref": r, "object": { "sha": oid } }))
                    .collect();
                return req_json(store, 200, Value::Array(list), Vec::new());
            }
            if method == "GET" && tail.len() >= 3 {
                let r = tail[2..].join("/");
                let full = format!("refs/{}", r);
                let tip = store.repos.get(name).unwrap().refs.get(&full).cloned();
                match tip {
                    Some(t) => return req_json(store, 200, json!({ "ref": full, "object": { "sha": t } }), Vec::new()),
                    None => return req_err(store, 404, "Not Found"),
                }
            }
            return req_err(store, 404, "Not Found");
        }
        // contents
        if tail[0] == "contents" {
            let file_path = tail[1..].join("/");
            let ref_param = q.get("ref").map(|s| s.as_str());
            if method == "GET" {
                let commit_oid = {
                    let repo = store.repos.get(name).unwrap();
                    match ref_param {
                        Some(rp) => resolve_ref_to_commit(repo, rp),
                        None => default_tip(repo),
                    }
                };
                let commit_oid = match commit_oid {
                    Some(c) => c,
                    None => return req_err(store, 404, "Not Found"),
                };
                let repo = store.repos.get(name).unwrap();
                if file_path.is_empty() {
                    match list_dir(repo, &commit_oid, "") {
                        Some(entries) => return req_json(store, 200, entries, Vec::new()),
                        None => return req_err(store, 404, "Not Found"),
                    }
                }
                let found = match lookup_path(repo, &commit_oid, &file_path) {
                    Some(f) => f,
                    None => return req_err(store, 404, "Not Found"),
                };
                if found.1 == "40000" {
                    match list_dir(repo, &commit_oid, &file_path) {
                        Some(entries) => return req_json(store, 200, entries, Vec::new()),
                        None => return req_err(store, 404, "Not Found"),
                    }
                }
                let blob = match repo.objects.get(&found.0) {
                    Some(b) => b,
                    None => return req_err(store, 404, "Not Found"),
                };
                let base_name = file_path.rsplit('/').next().unwrap_or(&file_path).to_string();
                return req_json(
                    store,
                    200,
                    json!({ "type": "file", "encoding": "base64", "size": blob.data.len(), "name": base_name, "path": file_path, "content": base64_encode(&blob.data), "sha": found.0 }),
                    Vec::new(),
                );
            }
            if method == "PUT" {
                let message = get_str(&body, "message").unwrap_or("update").to_string();
                let content_b64 = get_str(&body, "content").unwrap_or("").to_string();
                let branch = match get_str(&body, "branch") {
                    Some(b) if !b.is_empty() => b.to_string(),
                    _ => DEFAULT_BRANCH.to_string(),
                };
                let cleaned: String = content_b64.chars().filter(|c| !c.is_whitespace()).collect();
                let content = base64_decode_lenient(&cleaned);
                {
                    let repo = store.repos.get_mut(name).unwrap();
                    if !repo.refs.contains_key(&format!("refs/heads/{}", branch)) {
                        let base_tip = default_tip(repo);
                        if let Some(bt) = base_tip {
                            repo.refs.insert(format!("refs/heads/{}", branch), bt);
                            bump_repo(repo);
                        }
                    }
                }
                let (exists, current_sha) = {
                    let repo = store.repos.get(name).unwrap();
                    let tip = repo.refs.get(&format!("refs/heads/{}", branch)).cloned();
                    match tip {
                        Some(t) => match lookup_path(repo, &t, &file_path) {
                            Some((oid, mode)) if mode != "40000" => (true, oid),
                            _ => (false, String::new()),
                        },
                        None => (false, String::new()),
                    }
                };
                if exists {
                    let given_sha = get_str(&body, "sha").unwrap_or("");
                    if given_sha != current_sha {
                        return req_err(store, 409, "sha does not match the current blob");
                    }
                }
                let (commit_sha, blob_sha) = {
                    let repo = store.repos.get_mut(name).unwrap();
                    commit_file(repo, &branch, &file_path, content.clone(), &message)
                };
                let base_name = file_path.rsplit('/').next().unwrap_or(&file_path).to_string();
                return req_json(
                    store,
                    if exists { 200 } else { 201 },
                    json!({ "content": { "name": base_name, "path": file_path, "sha": blob_sha, "size": content.len(), "encoding": "base64", "type": "file" }, "commit": { "sha": commit_sha } }),
                    Vec::new(),
                );
            }
            if method == "DELETE" {
                let message = get_str(&body, "message").unwrap_or("delete").to_string();
                let branch = match get_str(&body, "branch") {
                    Some(b) if !b.is_empty() => b.to_string(),
                    _ => DEFAULT_BRANCH.to_string(),
                };
                let commit_sha = {
                    let repo = store.repos.get_mut(name).unwrap();
                    delete_file(repo, &branch, &file_path, &message)
                };
                match commit_sha {
                    Some(sha) => return req_json(store, 200, json!({ "commit": { "sha": sha } }), Vec::new()),
                    None => return req_err(store, 404, "Not Found"),
                }
            }
            return req_err(store, 404, "Not Found");
        }
        // labels
        if tail[0] == "labels" {
            if method == "POST" {
                let lname = get_str(&body, "name").unwrap_or("");
                if lname.is_empty() {
                    return req_err(store, 422, "name is required");
                }
                let color = get_str(&body, "color").unwrap_or("ededed").to_string();
                let label = Label { name: lname.to_string(), color: color.clone() };
                store.repos.get_mut(name).unwrap().labels.insert(lname.to_string(), label);
                return req_json(store, 201, json!({ "name": lname, "color": color, "description": "" }), Vec::new());
            }
            if method == "GET" {
                let repo = store.repos.get(name).unwrap();
                let list: Vec<Value> = repo
                    .labels
                    .values()
                    .map(|l| json!({ "name": l.name, "color": l.color, "description": "" }))
                    .collect();
                return req_json(store, 200, Value::Array(list), Vec::new());
            }
            return req_err(store, 404, "Not Found");
        }
        // issues
        if tail[0] == "issues" {
            if tail.len() == 1 {
                if method == "POST" {
                    let title = get_str(&body, "title").unwrap_or("");
                    if title.is_empty() {
                        return req_err(store, 422, "title is required");
                    }
                    let raw_labels: Vec<Value> = match &body {
                        Some(Value::Object(m)) => match m.get("labels") {
                            Some(Value::Array(a)) => a.clone(),
                            _ => Vec::new(),
                        },
                        _ => Vec::new(),
                    };
                    // Labels: string or {name} object form; other entries skipped.
                    let mut labels: Vec<Label> = Vec::new();
                    for entry in &raw_labels {
                        let lname: Option<String> = match entry {
                            Value::String(s) => Some(s.clone()),
                            Value::Object(m) => m.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            _ => None,
                        };
                        let lname = match lname {
                            Some(l) => l,
                            None => continue,
                        };
                        match store.repos.get(name).unwrap().labels.get(&lname) {
                            Some(l) => labels.push(l.clone()),
                            None => return req_err(store, 422, &format!("Label '{}' does not exist", lname)),
                        }
                    }
                    let body_str = get_str(&body, "body").unwrap_or("").to_string();
                    let issue = create_issue_obj(store, name, title.to_string(), body_str, labels);
                    return req_buf(store, 201, issue.json, JSON_TYPE);
                }
                if method == "GET" {
                    let state = q.get("state").map(|s| s.as_str()).unwrap_or("open");
                    let sort = q.get("sort").map(|s| s.as_str()).unwrap_or("created");
                    let direction = q.get("direction").map(|s| s.as_str()).unwrap_or("desc");
                    let (items, link): (Vec<Vec<u8>>, Option<String>) = {
                        let repo = store.repos.get(name).unwrap();
                        let mut list: Vec<&Issue> = repo.issues.iter().filter(|i| state == "all" || i.state == state).collect();
                        if sort == "created" {
                            if direction == "asc" {
                                list.sort_by_key(|i| i.number);
                            } else {
                                list.sort_by_key(|i| std::cmp::Reverse(i.number));
                            }
                        }
                        let opts = page_opts(q);
                        let (start, end, has_next, total_pages) = paginate_len(list.len(), &opts);
                        let items: Vec<Vec<u8>> = list[start..end].iter().map(|i| i.json.clone()).collect();
                        let link = if has_next || total_pages > 1 {
                            let host = req.header("host").unwrap_or("localhost");
                            Some(link_header(host, pathname, q, &opts, total_pages))
                        } else {
                            None
                        };
                        (items, link)
                    };
                    let mut buf: Vec<u8> = Vec::new();
                    buf.push(b'[');
                    for (idx, it) in items.iter().enumerate() {
                        if idx > 0 {
                            buf.push(b',');
                        }
                        buf.extend_from_slice(it);
                    }
                    buf.push(b']');
                    let mut r = req_buf(store, 200, buf, JSON_TYPE);
                    if let Some(link) = link {
                        r.extra.push(("link".to_string(), link));
                    }
                    return r;
                }
                return req_err(store, 404, "Not Found");
            }
            let num = js_parse_int(tail[1]).unwrap_or(0);
            if tail.len() == 2 {
                let found = store.repos.get(name).unwrap().issues.iter().find(|i| i.number == num).cloned();
                let issue = match found {
                    Some(i) => i,
                    None => return req_err(store, 404, "Not Found"),
                };
                if method == "GET" {
                    return req_buf(store, 200, issue.json, JSON_TYPE);
                }
                if method == "PATCH" {
                    let repo = store.repos.get_mut(name).unwrap();
                    if let Some(t) = get_str(&body, "title") {
                        let t = t.to_string();
                        repo.issues.iter_mut().find(|i| i.number == num).unwrap().title = t;
                    }
                    if let Some(b) = get_str(&body, "body") {
                        let b = b.to_string();
                        repo.issues.iter_mut().find(|i| i.number == num).unwrap().body = b;
                    }
                    if let Some(s) = get_str(&body, "state") {
                        if s == "open" || s == "closed" {
                            let s = s.to_string();
                            repo.issues.iter_mut().find(|i| i.number == num).unwrap().state = s;
                        }
                    }
                    refresh_issue(repo, num);
                    let issue = store.repos.get(name).unwrap().issues.iter().find(|i| i.number == num).unwrap().clone();
                    return req_buf(store, 200, issue.json, JSON_TYPE);
                }
                return req_err(store, 404, "Not Found");
            }
            if tail.len() >= 3 && tail[2] == "comments" {
                let exists = store.repos.get(name).unwrap().issues.iter().any(|i| i.number == num);
                if !exists {
                    return req_err(store, 404, "Not Found");
                }
                if method == "POST" {
                    let cbody = get_str(&body, "body").unwrap_or("").to_string();
                    let repo_id = store.repos.get(name).unwrap().id;
                    let comment = add_comment(store, repo_id, num, cbody.clone()).unwrap();
                    return req_json(
                        store,
                        201,
                        json!({ "id": comment.id, "node_id": global_id("IssueComment", &[repo_id.to_string(), comment.id.to_string()]), "body": cbody, "user": { "login": VIEWER_LOGIN, "id": 1000 }, "created_at": FIXED_TS, "updated_at": FIXED_TS }),
                        Vec::new(),
                    );
                }
                if method == "GET" {
                    let repo = store.repos.get(name).unwrap();
                    let arr = repo.comments.get(&num);
                    let list: Vec<Value> = match arr {
                        Some(a) => a
                            .iter()
                            .map(|c| json!({ "id": c.id, "node_id": global_id("IssueComment", &[repo.id.to_string(), c.id.to_string()]), "body": c.body, "user": { "login": VIEWER_LOGIN, "id": 1000 }, "created_at": FIXED_TS, "updated_at": FIXED_TS }))
                            .collect(),
                        None => Vec::new(),
                    };
                    return req_json(store, 200, Value::Array(list), Vec::new());
                }
                return req_err(store, 404, "Not Found");
            }
            return req_err(store, 404, "Not Found");
        }
        // pulls
        if tail[0] == "pulls" {
            if tail.len() == 1 {
                if method == "POST" {
                    let head = get_str(&body, "head").unwrap_or("").to_string();
                    let base = get_str(&body, "base").unwrap_or(DEFAULT_BRANCH).to_string();
                    let title = get_str(&body, "title").unwrap_or("").to_string();
                    let body_str = get_str(&body, "body").unwrap_or("").to_string();
                    match create_pull(store, name, title, body_str, head, base) {
                        Some(pull) => {
                            let repo = store.repos.get(name).unwrap();
                            let pj = pull_json(repo, &pull);
                            return req_json(store, 201, pj, Vec::new());
                        }
                        None => return req_err(store, 422, "head or base branch does not exist"),
                    }
                }
                if method == "GET" {
                    let state = q.get("state").map(|s| s.as_str()).unwrap_or("open");
                    let (items, link): (Vec<Value>, Option<String>) = {
                        let repo = store.repos.get(name).unwrap();
                        let mut list: Vec<&Pull> = repo
                            .pulls
                            .iter()
                            .filter(|p| state == "all" || (if state == "closed" { p.state == "closed" } else { p.state == "open" }))
                            .collect();
                        list.sort_by_key(|p| p.number);
                        let opts = page_opts(q);
                        let (start, end, has_next, total_pages) = paginate_len(list.len(), &opts);
                        let items: Vec<Value> = list[start..end].iter().map(|p| pull_json(repo, p)).collect();
                        let link = if has_next || total_pages > 1 {
                            let host = req.header("host").unwrap_or("localhost");
                            Some(link_header(host, pathname, q, &opts, total_pages))
                        } else {
                            None
                        };
                        (items, link)
                    };
                    let mut r = req_json(store, 200, Value::Array(items), Vec::new());
                    if let Some(link) = link {
                        r.extra.push(("link".to_string(), link));
                    }
                    return r;
                }
                return req_err(store, 404, "Not Found");
            }
            let pnum = js_parse_int(tail[1]).unwrap_or(0);
            if tail.len() == 2 {
                let pull = store.repos.get(name).unwrap().pulls.iter().find(|p| p.number == pnum).cloned();
                let pull = match pull {
                    Some(p) => p,
                    None => return req_err(store, 404, "Not Found"),
                };
                if method == "GET" {
                    let repo = store.repos.get(name).unwrap();
                    return req_json(store, 200, pull_json(repo, &pull), Vec::new());
                }
                return req_err(store, 404, "Not Found");
            }
            if tail.len() >= 3 && tail[2] == "files" && method == "GET" {
                let pull = store.repos.get(name).unwrap().pulls.iter().find(|p| p.number == pnum).cloned();
                let pull = match pull {
                    Some(p) => p,
                    None => return req_err(store, 404, "Not Found"),
                };
                let repo = store.repos.get(name).unwrap();
                let head_tip = match ref_tip(repo, &pull.head_branch) {
                    Some(t) => t,
                    None => return req_err(store, 404, "Not Found"),
                };
                let diff = diff_trees(repo, &pull.base_sha_at_creation, &head_tip);
                return req_json(store, 200, diff, Vec::new());
            }
            if tail.len() >= 3 && tail[2] == "merge" && method == "PUT" {
                let pull = store.repos.get(name).unwrap().pulls.iter().find(|p| p.number == pnum).cloned();
                let pull = match pull {
                    Some(p) => p,
                    None => return req_err(store, 404, "Not Found"),
                };
                if pull.state != "open" {
                    return req_err(store, 405, "Pull request is already closed");
                }
                let repo = store.repos.get(name).unwrap();
                if pull_conflicts(repo, &pull) {
                    return req_err(store, 405, "Merge conflict");
                }
                let repo = store.repos.get_mut(name).unwrap();
                match squash_merge(repo, pnum) {
                    Some(sha) => {
                        return req_json(store, 200, json!({ "sha": sha, "merged": true, "message": format!("Pull request #{} merged", pnum) }), Vec::new());
                    }
                    None => return req_err(store, 405, "Merge failed"),
                }
            }
            return req_err(store, 404, "Not Found");
        }
        return req_err(store, 404, "Not Found");
    }
    req_err(store, 404, "Not Found")
}
// ---------------------------------------------------------------- git smart HTTP

pub const CAPS_UPLOAD: &str = "side-band-64k shallow thin-pack ofs-delta multi_ack symref=HEAD:refs/heads/main agent=forge/1.0";
pub const CAPS_RECEIVE: &str = "report-status report-status-v2 side-band-64k delete-refs ofs-delta symref=HEAD:refs/heads/main agent=forge/1.0";

pub fn sorted_refs(repo: &Repo) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for (name, oid) in &repo.refs {
        if name.starts_with("refs/heads/") || name.starts_with("refs/tags/") {
            out.push((name.clone(), oid.clone()));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

pub fn head_tip(repo: &Repo) -> Option<String> {
    if let Some(t) = repo.refs.get("refs/heads/main") {
        return Some(t.clone());
    }
    sorted_refs(repo).into_iter().find(|(n, _)| n.starts_with("refs/heads/")).map(|(_, o)| o)
}

fn v0_advertisement(repo: &Repo, service: &str) -> Vec<u8> {
    let caps = if service == "git-upload-pack" { CAPS_UPLOAD } else { CAPS_RECEIVE };
    let mut lines: Vec<git::PktItem> = vec![
        git::PktItem::Data(format!("# service={}\n", service).into_bytes()),
        git::PktItem::Flush,
    ];
    let refs = sorted_refs(repo);
    let tip = head_tip(repo);
    if refs.is_empty() {
        lines.push(git::PktItem::Data(format!("{} capabilities^{{}}\0{}\n", ZERO_OID, caps).into_bytes()));
    } else {
        lines.push(git::PktItem::Data(format!("{} HEAD\0{}\n", tip.clone().unwrap_or_else(|| ZERO_OID.to_string()), caps).into_bytes()));
        for (name, oid) in &refs {
            lines.push(git::PktItem::Data(format!("{} {}\n", oid, name).into_bytes()));
            if name.starts_with("refs/tags/") {
                if let Some(obj) = repo.objects.get(oid) {
                    if obj.typ == git::T_TAG {
                        if let Some(peeled) = git::peel_to_commit(&repo.objects, oid) {
                            lines.push(git::PktItem::Data(format!("{} {}^{{}}\n", peeled, name).into_bytes()));
                        }
                    }
                }
            }
        }
    }
    lines.push(git::PktItem::Flush);
    git::pkt_lines(&lines)
}

fn v2_advertisement() -> Vec<u8> {
    git::pkt_lines(&[
        git::PktItem::Data(b"version 2\n".to_vec()),
        git::PktItem::Data(b"ls-refs=unborn\n".to_vec()),
        git::PktItem::Data(b"fetch=shallow\n".to_vec()),
        git::PktItem::Data(b"object-format=sha1\n".to_vec()),
        git::PktItem::Data(b"agent=github-core-clone/1.0\n".to_vec()),
        git::PktItem::Flush,
    ])
}

fn held_set(repo: &Repo, haves: &[String], shallow: &[String]) -> std::collections::HashSet<String> {
    let shallow_set: std::collections::HashSet<&str> = shallow.iter().map(|s| s.as_str()).collect();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut queue: Vec<String> = haves.to_vec();
    while let Some(oid) = queue.pop() {
        if seen.contains(&oid) {
            continue;
        }
        let obj = match repo.objects.get(&oid) {
            Some(o) => o,
            None => continue,
        };
        seen.insert(oid.clone());
        match obj.typ {
            git::T_COMMIT => {
                let c = git::parse_commit(&obj.data);
                queue.push(c.tree);
                if !shallow_set.contains(oid.as_str()) {
                    for p in c.parents {
                        queue.push(p);
                    }
                }
            }
            git::T_TAG => {
                let t = git::parse_tag(&obj.data);
                queue.push(t.object);
            }
            git::T_TREE => {
                for e in git::parse_tree(&obj.data) {
                    if e.mode != "160000" {
                        queue.push(e.oid);
                    }
                }
            }
            _ => {}
        }
    }
    seen
}

fn sideband_pack(pack: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut off = 0;
    while off < pack.len() {
        let end = (off + 32768).min(pack.len());
        let mut payload: Vec<u8> = Vec::with_capacity(1 + (end - off));
        payload.push(1);
        payload.extend_from_slice(&pack[off..end]);
        out.extend_from_slice(&git::pkt_line(&payload));
        off = end;
    }
    out
}

/// deepen: None = absent; Some(f64) = parsed value (NaN possible, JS parseInt semantics).
fn build_fetch_response(repo: &Repo, wants: &[String], haves: &[String], shallow: &[String], deepen: Option<f64>, v2: bool) -> Vec<u8> {
    let lookup = |oid: &str| repo.objects.get(oid).cloned();
    let (send, new_shallow, unshallow): (std::collections::HashSet<String>, Vec<String>, Vec<String>);
    if let Some(d) = deepen {
        let (objects, boundary) = git::collect_shallow(wants, lookup, d);
        let held = held_set(repo, haves, shallow);
        send = objects.difference(&held).cloned().collect();
        new_shallow = {
            let mut v: Vec<String> = boundary.into_iter().collect();
            v.sort();
            v
        };
        unshallow = shallow.iter().filter(|s| !new_shallow.contains(s)).cloned().collect();
    } else {
        let wanted = git::collect_reachable(wants, lookup, -1);
        let held = held_set(repo, haves, shallow);
        send = wanted.difference(&held).cloned().collect();
        new_shallow = if shallow.is_empty() { Vec::new() } else { let mut v = shallow.to_vec(); v.sort(); v };
        unshallow = Vec::new();
    }
    let mut oids: Vec<&String> = send.iter().collect();
    oids.sort();
    let mut objects: Vec<git::GitObj> = Vec::new();
    for oid in oids {
        if let Some(o) = repo.objects.get(oid) {
            objects.push(o.clone());
        }
    }
    let pack = git::write_pack(&objects);
    let mut parts: Vec<u8> = Vec::new();
    if v2 {
        if !haves.is_empty() {
            parts.extend_from_slice(&git::pkt_line(b"acknowledgments\n"));
            parts.extend_from_slice(&git::pkt_line(format!("ACK {}\n", haves[0]).as_bytes()));
            parts.extend_from_slice(&git::pkt_line(b"ready\n"));
            parts.extend_from_slice(b"0001");
        }
        if deepen.is_some() || !shallow.is_empty() {
            parts.extend_from_slice(&git::pkt_line(b"shallow-info\n"));
            for s in &new_shallow {
                parts.extend_from_slice(&git::pkt_line(format!("shallow {}\n", s).as_bytes()));
            }
            for s in &unshallow {
                parts.extend_from_slice(&git::pkt_line(format!("unshallow {}\n", s).as_bytes()));
            }
            parts.extend_from_slice(b"0001");
        }
        parts.extend_from_slice(&git::pkt_line(b"packfile\n"));
        parts.extend_from_slice(&sideband_pack(&pack));
        parts.extend_from_slice(b"0000");
    } else {
        if !haves.is_empty() {
            parts.extend_from_slice(&git::pkt_line(format!("ACK {}\n", haves[0]).as_bytes()));
        } else {
            parts.extend_from_slice(&git::pkt_line(b"NAK\n"));
        }
        for s in &new_shallow {
            parts.extend_from_slice(&git::pkt_line(format!("shallow {}\n", s).as_bytes()));
        }
        parts.extend_from_slice(&sideband_pack(&pack));
        parts.extend_from_slice(b"0000");
    }
    parts
}

fn deepen_str(d: Option<f64>) -> String {
    match d {
        None => String::new(),
        Some(v) if v.is_nan() => "NaN".to_string(),
        Some(v) => format!("{}", v as i64),
    }
}

pub fn handle_git(store: &mut Store, req: &Request, pathname: &str, method: &str, q: &IndexMap<String, String>, body_buf: &[u8]) -> Response {
    // Parse ^/([^/]+)/([^/]+)\.git(?:/(.*))?$ on the decoded pathname.
    let p = pathname.strip_prefix('/').unwrap_or(pathname);
    let slash1 = match p.find('/') {
        Some(i) => i,
        None => return req_err(store, 404, "Not Found"),
    };
    let owner_raw = &p[..slash1];
    let rest = &p[slash1 + 1..];
    let (repo_raw, suffix) = match rest.find('/') {
        Some(i) => {
            let seg = &rest[..i];
            if !seg.ends_with(".git") {
                return req_err(store, 404, "Not Found");
            }
            (&seg[..seg.len() - 4], &rest[i + 1..])
        }
        None => {
            if !rest.ends_with(".git") {
                return req_err(store, 404, "Not Found");
            }
            (&rest[..rest.len() - 4], "")
        }
    };
    let owner = match percent_decode_str(owner_raw) {
        Some(o) => o,
        None => return req_err(store, 500, "URI malformed"),
    };
    let repo_name = match percent_decode_str(repo_raw) {
        Some(r) => r,
        None => return req_err(store, 500, "URI malformed"),
    };

    if method == "GET" && suffix == "info/refs" {
        let repo = match store.find_repo(&owner, &repo_name) {
            Some(r) => r,
            None => return req_err(store, 404, "Not Found"),
        };
        let service = q.get("service").map(|s| s.as_str()).unwrap_or("");
        if service != "git-upload-pack" && service != "git-receive-pack" {
            return req_err(store, 404, "Not Found");
        }
        let ct: &'static str = if service == "git-upload-pack" {
            "application/x-git-upload-pack-advertisement"
        } else {
            "application/x-git-receive-pack-advertisement"
        };
        let is_v2 = service == "git-upload-pack" && req.header("git-protocol") == Some("version=2");
        let buf = if is_v2 { v2_advertisement() } else { v0_advertisement(repo, service) };
        return req_buf(store, 200, buf, &ct);
    }
    if method == "POST" && suffix == "git-upload-pack" {
        if store.find_repo(&owner, &repo_name).is_none() {
            return req_err(store, 404, "Not Found");
        }
        let is_v2 = req.header("git-protocol") == Some("version=2");
        let packets = git::decode_pkts(body_buf);
        let mut lines: Vec<String> = Vec::new();
        for p in &packets {
            if let git::Pkt::Data(d) = p {
                lines.push(String::from_utf8_lossy(d).into_owned());
            }
        }
        if is_v2 {
            let command = lines.first().map(|l| l.trim()).unwrap_or("");
            if command == "command=ls-refs" {
                let mut peel = false;
                let mut symrefs = false;
                let mut unborn = false;
                let mut prefixes: Vec<String> = Vec::new();
                for line in lines.iter().skip(1) {
                    let t = line.trim();
                    if t == "peel" {
                        peel = true;
                    } else if t == "symrefs" {
                        symrefs = true;
                    } else if t == "unborn" {
                        unborn = true;
                    } else if let Some(pr) = t.strip_prefix("ref-prefix ") {
                        prefixes.push(pr.to_string());
                    }
                }
                let repo = store.find_repo(&owner, &repo_name).unwrap();
                let cache_key = format!("ls:{}:{}:{}:{}:{}", repo.version, peel as u8, symrefs as u8, unborn as u8, prefixes.join(","));
                let cached = repo.ls_cache.get(&cache_key).cloned();
                if let Some(buf) = cached {
                    return req_buf(store, 200, buf, "application/x-git-upload-pack-result");
                }
                let refs = sorted_refs(repo);
                let tip = head_tip(repo);
                let mut out: Vec<git::PktItem> = Vec::new();
                let mut emit_ref = |oid: &str, name: &str, out: &mut Vec<git::PktItem>| {
                    let mut line = format!("{} {}", oid, name);
                    if name == "HEAD" && symrefs {
                        line.push_str(" symref-target:refs/heads/main");
                    }
                    if peel && name.starts_with("refs/tags/") {
                        if let Some(obj) = repo.objects.get(oid) {
                            if obj.typ == git::T_TAG {
                                if let Some(peeled) = git::peel_to_commit(&repo.objects, oid) {
                                    line.push_str(&format!(" peeled:{}", peeled));
                                }
                            }
                        }
                    }
                    line.push('\n');
                    out.push(git::PktItem::Data(line.into_bytes()));
                };
                if prefixes.is_empty() {
                    if let Some(t) = &tip {
                        emit_ref(t, "HEAD", &mut out);
                    } else if unborn {
                        out.push(git::PktItem::Data(b"unborn HEAD symref-target:refs/heads/main\n".to_vec()));
                    }
                    for (n, o) in &refs {
                        emit_ref(o, n, &mut out);
                    }
                } else {
                    if let Some(t) = &tip {
                        if prefixes.iter().any(|p| "HEAD".starts_with(p.as_str())) {
                            emit_ref(t, "HEAD", &mut out);
                        }
                    } else if unborn && prefixes.iter().any(|p| "HEAD".starts_with(p.as_str())) {
                        out.push(git::PktItem::Data(b"unborn HEAD symref-target:refs/heads/main\n".to_vec()));
                    }
                    for (n, o) in &refs {
                        if prefixes.iter().any(|p| n.starts_with(p.as_str())) {
                            emit_ref(o, n, &mut out);
                        }
                    }
                }
                out.push(git::PktItem::Flush);
                let buf = git::pkt_lines(&out);
                let repo = store.find_repo_mut(&owner, &repo_name).unwrap();
                repo.ls_cache.insert(cache_key, buf.clone());
                return req_buf(store, 200, buf, "application/x-git-upload-pack-result");
            }
            if command == "command=fetch" {
                let mut wants: Vec<String> = Vec::new();
                let mut haves: Vec<String> = Vec::new();
                let mut shallow: Vec<String> = Vec::new();
                let mut deepen: Option<f64> = None;
                for line in lines.iter().skip(1) {
                    let t = line.trim();
                    if t.starts_with("agent=") || t.starts_with("object-format=") || t == "done" || t == "thin-pack" || t == "no-progress" || t == "ofs-delta" || t.starts_with("filter ") {
                        continue;
                    }
                    if let Some(w) = t.strip_prefix("want ") {
                        wants.push(w.trim().to_string());
                    } else if let Some(h) = t.strip_prefix("have ") {
                        haves.push(h.trim().to_string());
                    } else if let Some(s) = t.strip_prefix("shallow ") {
                        shallow.push(s.trim().to_string());
                    } else if let Some(d) = t.strip_prefix("deepen ") {
                        deepen = Some(js_parse_int(d.trim()).map(|v| v as f64).unwrap_or(f64::NAN));
                    }
                }
                let repo = store.find_repo(&owner, &repo_name).unwrap();
                let cache_key = format!("f2:{}:{}|{}|{}|{}", repo.version, wants.join(","), haves.join(","), shallow.join(","), deepen_str(deepen));
                let cached = repo.fetch_cache.get(&cache_key).cloned();
                if let Some(buf) = cached {
                    return req_buf(store, 200, buf, "application/x-git-upload-pack-result");
                }
                let buf = build_fetch_response(repo, &wants, &haves, &shallow, deepen, true);
                let repo = store.find_repo_mut(&owner, &repo_name).unwrap();
                repo.fetch_cache.insert(cache_key, buf.clone());
                return req_buf(store, 200, buf, "application/x-git-upload-pack-result");
            }
            return req_err(store, 400, "unknown v2 command");
        }
        // v0 fetch
        let mut wants: Vec<String> = Vec::new();
        let mut haves: Vec<String> = Vec::new();
        let mut shallow: Vec<String> = Vec::new();
        let mut deepen: Option<f64> = None;
        let mut section = 0;
        for p in &packets {
            match p {
                git::Pkt::Flush => section += 1,
                git::Pkt::Data(d) => {
                    let t = String::from_utf8_lossy(d).trim().to_string();
                    if section == 0 {
                        if let Some(w) = t.strip_prefix("want ") {
                            wants.push(w.split(' ').next().unwrap_or("").to_string());
                        } else if let Some(s) = t.strip_prefix("shallow ") {
                            shallow.push(s.trim().to_string());
                        } else if let Some(dd) = t.strip_prefix("deepen ") {
                            deepen = Some(js_parse_int(dd.trim()).map(|v| v as f64).unwrap_or(f64::NAN));
                        }
                    } else if let Some(h) = t.strip_prefix("have ") {
                        haves.push(h.trim().to_string());
                    }
                }
                _ => {}
            }
        }
        if wants.is_empty() && lines.is_empty() && packets.is_empty() {
            return req_err(store, 400, "bad pkt-line");
        }
        let repo = store.find_repo(&owner, &repo_name).unwrap();
        let cache_key = format!("f0:{}:{}|{}|{}|{}", repo.version, wants.join(","), haves.join(","), shallow.join(","), deepen_str(deepen));
        let cached = repo.fetch_cache.get(&cache_key).cloned();
        if let Some(buf) = cached {
            return req_buf(store, 200, buf, "application/x-git-upload-pack-result");
        }
        let buf = build_fetch_response(repo, &wants, &haves, &shallow, deepen, false);
        let repo = store.find_repo_mut(&owner, &repo_name).unwrap();
        repo.fetch_cache.insert(cache_key, buf.clone());
        return req_buf(store, 200, buf, "application/x-git-upload-pack-result");
    }
    if method == "POST" && suffix == "git-receive-pack" {
        if store.find_repo(&owner, &repo_name).is_none() {
            return req_err(store, 404, "Not Found");
        }
        if !authed(store, req) {
            return req_err(store, 401, "Unauthorized");
        }
        // Manual byte scan: the pack follows the flush packet byte-exactly.
        struct Cmd {
            old_oid: String,
            new_oid: String,
            r: String,
        }
        let mut commands: Vec<Cmd> = Vec::new();
        let mut off = 0usize;
        let mut pack_start = body_buf.len();
        let mut bad = false;
        while off + 4 <= body_buf.len() {
            let len_str = match std::str::from_utf8(&body_buf[off..off + 4]) {
                Ok(s) => s,
                Err(_) => {
                    bad = true;
                    break;
                }
            };
            let hex_ok = len_str.len() == 4 && len_str.bytes().all(|b| b.is_ascii_hexdigit());
            let len = i32::from_str_radix(len_str, 16).unwrap_or(-1);
            if !hex_ok || len < 0 || len > 65520 {
                bad = true;
                break;
            }
            let len = len as usize;
            if len == 0 {
                pack_start = off + 4;
                break;
            }
            if len == 1 || len == 2 {
                off += 4;
                continue;
            }
            if off + len > body_buf.len() {
                bad = true;
                break;
            }
            let payload = String::from_utf8_lossy(&body_buf[off + 4..off + len]).into_owned();
            let line = match payload.find('\0') {
                Some(n) => payload[..n].to_string(),
                None => payload,
            };
            let line = line.strip_suffix('\n').unwrap_or(&line).to_string();
            let parts: Vec<&str> = line.split(' ').collect();
            if parts.len() >= 3 && git::is_oid(parts[0]) && git::is_oid(parts[1]) {
                commands.push(Cmd { old_oid: parts[0].to_string(), new_oid: parts[1].to_string(), r: parts[2..].join(" ") });
            }
            off += len;
        }
        if bad || commands.is_empty() {
            return req_err(store, 400, "bad pkt-line");
        }
        let mut report_lines: Vec<String> = Vec::new();
        let mut unpack_ok = true;
        let mut unpack_detail = "ok".to_string();
        let needs_pack = commands.iter().any(|c| c.new_oid != ZERO_OID);
        if needs_pack {
            if pack_start >= body_buf.len() {
                unpack_ok = false;
                unpack_detail = "unpacker error: missing pack".to_string();
            } else {
                match git::read_pack(&body_buf[pack_start..]) {
                    Ok(objects) => {
                        let repo = store.find_repo_mut(&owner, &repo_name).unwrap();
                        for (oid, obj) in objects {
                            repo.objects.entry(oid).or_insert(obj);
                        }
                    }
                    Err(e) => {
                        unpack_ok = false;
                        unpack_detail = format!("unpacker error: {}", e);
                    }
                }
            }
        }
        if unpack_ok {
            let repo = store.find_repo_mut(&owner, &repo_name).unwrap();
            for cmd in &commands {
                let current = repo.refs.get(&cmd.r).cloned();
                if cmd.new_oid == ZERO_OID {
                    if current.is_none() {
                        report_lines.push(format!("ng {} remote ref does not exist", cmd.r));
                    } else if cmd.old_oid != ZERO_OID && cmd.old_oid != current.clone().unwrap() {
                        report_lines.push(format!("ng {} non-fast-forward", cmd.r));
                    } else {
                        repo.refs.shift_remove(&cmd.r);
                        report_lines.push(format!("ok {}", cmd.r));
                    }
                } else if cmd.old_oid == ZERO_OID {
                    if current.is_some() {
                        report_lines.push(format!("ng {} already exists", cmd.r));
                    } else if !repo.objects.contains_key(&cmd.new_oid) {
                        report_lines.push(format!("ng {} object not found", cmd.r));
                    } else {
                        repo.refs.insert(cmd.r.clone(), cmd.new_oid.clone());
                        report_lines.push(format!("ok {}", cmd.r));
                    }
                } else {
                    if current.is_none() {
                        report_lines.push(format!("ng {} remote ref does not exist", cmd.r));
                    } else if cmd.old_oid != current.clone().unwrap() {
                        report_lines.push(format!("ng {} non-fast-forward", cmd.r));
                    } else if cmd.new_oid == current.clone().unwrap() {
                        report_lines.push(format!("ok {}", cmd.r));
                    } else if !repo.objects.contains_key(&cmd.new_oid) {
                        report_lines.push(format!("ng {} object not found", cmd.r));
                    } else if !git::is_ancestor(&repo.objects, current.as_ref().unwrap(), &cmd.new_oid) {
                        report_lines.push(format!("ng {} non-fast-forward", cmd.r));
                    } else {
                        repo.refs.insert(cmd.r.clone(), cmd.new_oid.clone());
                        report_lines.push(format!("ok {}", cmd.r));
                    }
                }
            }
            bump_repo(repo);
        } else {
            for cmd in &commands {
                report_lines.push(format!("ng {} unpack failed", cmd.r));
            }
        }
        let mut inner_items: Vec<git::PktItem> = vec![git::PktItem::Data(format!("unpack {}\n", unpack_detail).into_bytes())];
        for l in &report_lines {
            inner_items.push(git::PktItem::Data(format!("{}\n", l).into_bytes()));
        }
        inner_items.push(git::PktItem::Flush);
        let inner = git::pkt_lines(&inner_items);
        let mut band1: Vec<u8> = vec![1];
        band1.extend_from_slice(&inner);
        let mut outer: Vec<u8> = git::pkt_line(&band1);
        outer.extend_from_slice(b"0000");
        return req_buf(store, 200, outer, "application/x-git-receive-pack-result");
    }
    req_err(store, 404, "Not Found")
}

// ---------------------------------------------------------------- request routing

/// Parse /api/v3/repos/{owner}/{repo}/issues/{digits} without a regex.
pub fn parse_issue_get(p: &str) -> Option<(String, String, i64)> {
    if !p.starts_with("/api/v3/repos/") {
        return None;
    }
    let o_end = p[14..].find('/')? + 14;
    let r_end = p[o_end + 1..].find('/')? + o_end + 1;
    if p.len() < r_end + 8 || &p[r_end..r_end + 8] != "/issues/" {
        return None;
    }
    let num_str = &p[r_end + 8..];
    if num_str.is_empty() || !num_str.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut num: i64 = 0;
    for b in num_str.bytes() {
        num = num.checked_mul(10)?.checked_add((b - b'0') as i64)?;
    }
    if num <= 0 {
        return None;
    }
    Some((p[14..o_end].to_string(), p[o_end + 1..r_end].to_string(), num))
}

fn is_git_path(pathname: &str) -> bool {
    if !pathname.contains(".git/") && !pathname.ends_with(".git") {
        return false;
    }
    // ^\/[^/]+\/[^/]+\.git(?:\/|$)
    if !pathname.starts_with('/') {
        return false;
    }
    let p = &pathname[1..];
    let s1 = match p.find('/') {
        Some(i) => i,
        None => return false,
    };
    if s1 == 0 {
        return false;
    }
    let rest = &p[s1 + 1..];
    if rest.is_empty() {
        return false;
    }
    match rest.find('/') {
        Some(i) => {
            if i == 0 {
                return false;
            }
            rest[..i].ends_with(".git")
        }
        None => rest.ends_with(".git"),
    }
}

/// Top-level router (app.ts handleRequest).
pub fn handle_request(store: &mut Store, req: &Request) -> Response {
    let raw_url = &req.pathname;
    // NOTE: Request already carries decoded pathname + raw query from http.rs?
    // No — http.rs gives us pathname (decoded) + query (raw). Routing needs
    // the raw path for decode errors; http.rs decodes in try_parse, so a
    // malformed % already 400s at parse time. Here pathname is decoded.
    let pathname = raw_url.clone();
    let method = req.method.as_str();
    if method == "GET" && pathname == "/healthz" {
        return req_json(store, 200, json!({ "ok": true }), Vec::new());
    }
    // Fast path: read workload — 2,000 sequential issue GETs, cached buffer.
    if method == "GET" {
        if let Some((owner, repo, num)) = parse_issue_get(&pathname) {
            if !authed(store, req) {
                return req_err(store, 401, "Unauthorized");
            }
            let repo_obj = match store.find_repo(&owner, &repo) {
                Some(r) => r,
                None => return req_err(store, 404, "Not Found"),
            };
            let issue = match repo_obj.issues.iter().find(|i| i.number == num) {
                Some(i) => i,
                None => return req_err(store, 404, "Not Found"),
            };
            return req_buf(store, 200, issue.json.clone(), JSON_TYPE);
        }
    }
    let q = match parse_query(&req.query) {
        Ok(q) => q,
        Err(()) => return req_err(store, 500, "URI malformed"),
    };
    if is_git_path(&pathname) {
        if method == "GET" {
            return handle_git(store, req, &pathname, method, &q, &[]);
        }
        if method == "POST" {
            return handle_git(store, req, &pathname, method, &q, &req.body);
        }
        return req_err(store, 404, "Not Found");
    }
    if pathname == "/api/graphql" {
        if method != "POST" {
            return req_err(store, 404, "Not Found");
        }
        if !authed(store, req) {
            return req_err(store, 401, "Unauthorized");
        }
        return crate::graphql::handle_graphql(store, req);
    }
    if pathname == "/mcp" {
        if method != "POST" {
            return req_err(store, 404, "Not Found");
        }
        if !authed(store, req) {
            return crate::mcp::mcp_auth_fail(store);
        }
        return crate::mcp::handle_mcp(store, req);
    }
    if pathname.starts_with("/api/v3") {
        if !authed(store, req) {
            return req_err(store, 401, "Unauthorized");
        }
        if method == "GET" || method == "HEAD" {
            return handle_rest(store, req, &pathname, method, &q, None);
        }
        let body: Option<Value> = if req.body.is_empty() {
            None
        } else {
            match serde_json::from_slice(&req.body) {
                Ok(v) => Some(v),
                Err(_) => return req_err(store, 400, "Invalid JSON"),
            }
        };
        return handle_rest(store, req, &pathname, method, &q, body);
    }
    req_err(store, 404, "Not Found")
}
