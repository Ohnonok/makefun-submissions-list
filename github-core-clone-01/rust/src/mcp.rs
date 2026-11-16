// mcp.rs — MCP (Streamable HTTP) port of app.ts (7ebc300) lines 2046-2244.
// POST /mcp only; JSON-RPC 2.0; plain JSON replies, no SSE, no session id.

use crate::handlers::{create_issue_obj, create_pull, pull_conflicts, pull_json, repo_json, squash_merge};
use crate::store::ref_tip;
use crate::http::{Request, Response};
use crate::store::*;
use serde_json::{json, Map, Value};

/// MCP_TOOLS — module constant, byte-identical across calls. Key order
/// matches app.ts exactly (serde_json preserve_order).
pub fn mcp_tools() -> Value {
    json!([
        { "name": "create_repo", "description": "Create a new repository", "inputSchema": { "type": "object", "properties": { "name": { "type": "string", "description": "Repository name" }, "description": { "type": "string", "description": "Repository description" }, "private": { "type": "boolean", "description": "Whether the repository is private" } }, "required": ["name"] } },
        { "name": "get_repo", "description": "Get a repository by owner and name", "inputSchema": { "type": "object", "properties": { "owner": { "type": "string", "description": "Repository owner" }, "repo": { "type": "string", "description": "Repository name" } }, "required": ["owner", "repo"] } },
        { "name": "create_issue", "description": "Create an issue in a repository", "inputSchema": { "type": "object", "properties": { "owner": { "type": "string", "description": "Repository owner" }, "repo": { "type": "string", "description": "Repository name" }, "title": { "type": "string", "description": "Issue title" }, "body": { "type": "string", "description": "Issue body" }, "labels": { "type": "array", "items": { "type": "string" }, "description": "Labels to apply" } }, "required": ["owner", "repo", "title"] } },
        { "name": "list_issues", "description": "List issues in a repository", "inputSchema": { "type": "object", "properties": { "owner": { "type": "string", "description": "Repository owner" }, "repo": { "type": "string", "description": "Repository name" }, "state": { "type": "string", "description": "Issue state: open, closed, or all" } }, "required": ["owner", "repo"] } },
        { "name": "create_pull_request", "description": "Create a pull request", "inputSchema": { "type": "object", "properties": { "owner": { "type": "string", "description": "Repository owner" }, "repo": { "type": "string", "description": "Repository name" }, "title": { "type": "string", "description": "Pull request title" }, "head": { "type": "string", "description": "Head branch" }, "base": { "type": "string", "description": "Base branch" }, "body": { "type": "string", "description": "Pull request body" } }, "required": ["owner", "repo", "title", "head", "base"] } },
        { "name": "merge_pull_request", "description": "Merge a pull request with a squash merge", "inputSchema": { "type": "object", "properties": { "owner": { "type": "string", "description": "Repository owner" }, "repo": { "type": "string", "description": "Repository name" }, "pull_number": { "type": "integer", "description": "Pull request number" } }, "required": ["owner", "repo", "pull_number"] } }
    ])
}

fn mcp_result(structured: Value) -> Value {
    let text = serde_json::to_string(&structured).unwrap_or_default();
    json!({ "structuredContent": structured, "content": [{ "type": "text", "text": text }] })
}

fn mcp_error_result(message: String) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

enum ToolOut {
    Result(Value),
    RpcError(i64, String),
}

fn need(args: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for k in keys {
        match args.get(*k) {
            None | Some(Value::Null) => return Some(format!("Missing required argument: {}", k)),
            Some(Value::String(s)) if s.is_empty() => return Some(format!("Missing required argument: {}", k)),
            _ => {}
        }
    }
    None
}

fn arg_string(args: &Map<String, Value>, key: &str) -> String {
    match args.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(v) => match v {
            Value::Null => String::new(),
            _ => serde_json::to_string(v).unwrap_or_default(),
        },
        None => String::new(),
    }
}

fn mcp_call_tool(store: &mut Store, name: &str, args: &Map<String, Value>) -> ToolOut {
    match name {
        "create_repo" => {
            if let Some(m) = need(args, &["name"]) {
                return ToolOut::Result(mcp_error_result(m));
            }
            let repo_name = arg_string(args, "name");
            if store.repos.contains_key(&repo_name) {
                return ToolOut::Result(mcp_error_result("Repository already exists".to_string()));
            }
            let priv_ = args.get("private") == Some(&Value::Bool(true));
            let desc = args.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let rj = {
                let repo = store.create_repo(&repo_name, priv_, &desc);
                repo_json(repo)
            };
            ToolOut::Result(mcp_result(rj))
        }
        "get_repo" => {
            if let Some(m) = need(args, &["owner", "repo"]) {
                return ToolOut::Result(mcp_error_result(m));
            }
            let owner = arg_string(args, "owner");
            let repo_name = arg_string(args, "repo");
            match store.find_repo(&owner, &repo_name) {
                Some(repo) => ToolOut::Result(mcp_result(repo_json(repo))),
                None => ToolOut::Result(mcp_error_result("Not Found".to_string())),
            }
        }
        "create_issue" => {
            if let Some(m) = need(args, &["owner", "repo", "title"]) {
                return ToolOut::Result(mcp_error_result(m));
            }
            let owner = arg_string(args, "owner");
            let repo_name = arg_string(args, "repo");
            if store.find_repo(&owner, &repo_name).is_none() {
                return ToolOut::Result(mcp_error_result("Not Found".to_string()));
            }
            let mut labels: Vec<Label> = Vec::new();
            if let Some(Value::Array(arr)) = args.get("labels") {
                for lname_v in arr {
                    let lname = match lname_v {
                        Value::String(s) => s.clone(),
                        other => serde_json::to_string(other).unwrap_or_default(),
                    };
                    match store.repos.get(&repo_name).unwrap().labels.get(&lname) {
                        Some(l) => labels.push(l.clone()),
                        None => {
                            return ToolOut::Result(mcp_error_result(format!("Label '{}' does not exist", lname)));
                        }
                    }
                }
            }
            let title = arg_string(args, "title");
            let body = args.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let issue = create_issue_obj(store, &repo_name, title, body, labels);
            let mut parsed: Map<String, Value> =
                serde_json::from_slice(&issue.json).unwrap_or_default();
            parsed.insert("number".to_string(), json!(issue.number));
            ToolOut::Result(mcp_result(Value::Object(parsed)))
        }
        "list_issues" => {
            if let Some(m) = need(args, &["owner", "repo"]) {
                return ToolOut::Result(mcp_error_result(m));
            }
            let owner = arg_string(args, "owner");
            let repo_name = arg_string(args, "repo");
            let repo = match store.find_repo(&owner, &repo_name) {
                Some(r) => r,
                None => return ToolOut::Result(mcp_error_result("Not Found".to_string())),
            };
            let state = args.get("state").and_then(|v| v.as_str()).unwrap_or("open");
            let list: Vec<Value> = repo
                .issues
                .iter()
                .filter(|i| state == "all" || i.state == state)
                .map(|i| serde_json::from_slice::<Value>(&i.json).unwrap_or(Value::Null))
                .collect();
            ToolOut::Result(mcp_result(json!({ "issues": list })))
        }
        "create_pull_request" => {
            if let Some(m) = need(args, &["owner", "repo", "title", "head", "base"]) {
                return ToolOut::Result(mcp_error_result(m));
            }
            let owner = arg_string(args, "owner");
            let repo_name = arg_string(args, "repo");
            if store.find_repo(&owner, &repo_name).is_none() {
                return ToolOut::Result(mcp_error_result("Not Found".to_string()));
            }
            let head = arg_string(args, "head");
            let base = arg_string(args, "base");
            {
                let repo = store.repos.get(&repo_name).unwrap();
                if ref_tip(repo, &head).is_none() || ref_tip(repo, &base).is_none() {
                    return ToolOut::Result(mcp_error_result("head or base branch does not exist".to_string()));
                }
            }
            let title = arg_string(args, "title");
            let body = args.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
            match create_pull(store, &repo_name, title, body, head, base) {
                Some(pull) => {
                    let repo = store.repos.get(&repo_name).unwrap();
                    ToolOut::Result(mcp_result(pull_json(repo, &pull)))
                }
                None => ToolOut::Result(mcp_error_result("head or base branch does not exist".to_string())),
            }
        }
        "merge_pull_request" => {
            if let Some(m) = need(args, &["owner", "repo", "pull_number"]) {
                return ToolOut::Result(mcp_error_result(m));
            }
            let owner = arg_string(args, "owner");
            let repo_name = arg_string(args, "repo");
            if store.find_repo(&owner, &repo_name).is_none() {
                return ToolOut::Result(mcp_error_result("Not Found".to_string()));
            }
            let pull_number = args
                .get("pull_number")
                .and_then(|v| v.as_i64())
                .unwrap_or_else(|| args.get("pull_number").and_then(|v| v.as_f64()).map(|f| f as i64).unwrap_or(0));
            let repo = store.repos.get(&repo_name).unwrap();
            let pull = match repo.pulls.iter().find(|p| p.number == pull_number) {
                Some(p) => p.clone(),
                None => return ToolOut::Result(mcp_error_result("Not Found".to_string())),
            };
            if pull.state != "open" {
                return ToolOut::Result(mcp_error_result("Pull request is already closed".to_string()));
            }
            if pull_conflicts(repo, &pull) {
                return ToolOut::Result(mcp_error_result("Merge conflict".to_string()));
            }
            let repo = store.repos.get_mut(&repo_name).unwrap();
            match squash_merge(repo, pull_number) {
                Some(sha) => ToolOut::Result(mcp_result(json!({
                    "sha": sha, "merged": true, "number": pull_number,
                    "message": format!("Pull request #{} merged", pull_number)
                }))),
                None => ToolOut::Result(mcp_error_result("Merge failed".to_string())),
            }
        }
        _ => ToolOut::RpcError(-32601, format!("Unknown tool: {}", name)),
    }
}

pub fn handle_mcp(store: &mut Store, req: &Request) -> Response {
    let rpc: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => {
            let body = serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": Value::Null, "error": { "code": -32700, "message": "Parse error" } })).unwrap_or_default();
            let mut r = Response::new(400, "application/json", body, store.req_id());
            r.no_content_type = false;
            return r;
        }
    };
    let rpc_obj: &Map<String, Value> = match rpc.as_object() {
        Some(m) => m,
        None => {
            // Non-object JSON (array/number/string): TS reads .id/.method as
            // undefined → falls through to "Method not found: ".
            let body = serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": Value::Null, "error": { "code": -32601, "message": "Method not found: " } })).unwrap_or_default();
            return Response::new(200, "application/json", body, store.req_id());
        }
    };
    let id: Value = rpc_obj.get("id").cloned().unwrap_or(Value::Null);
    let method = rpc_obj.get("method").and_then(|v| v.as_str()).unwrap_or("").to_string();
    // Notification: no `id` field + non-empty method → 202, empty body,
    // only x-github-request-id. content-length: 0 is emitted (unlike Node's
    // chunked framing) so a keep-alive client never hangs.
    if !rpc_obj.contains_key("id") && !method.is_empty() {
        let mut r = Response::new(202, "", Vec::new(), store.req_id());
        r.no_content_type = true;
        return r;
    }
    let reply = |store: &mut Store, payload: Value| -> Response {
        let body = serde_json::to_vec(&payload).unwrap_or_default();
        Response::new(200, "application/json", body, store.req_id())
    };
    let reply_error = |store: &mut Store, code: i64, message: String| -> Response {
        reply(store, json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }))
    };
    let empty_params = Map::new();
    let params: &Map<String, Value> = match rpc_obj.get("params") {
        Some(Value::Object(m)) => m,
        _ => &empty_params,
    };
    match method.as_str() {
        "server/discover" => reply(
            store,
            json!({ "jsonrpc": "2.0", "id": id, "result": {
                "supportedVersions": ["2026-07-28", "2025-06-18"],
                "serverInfo": { "name": "forge", "version": "1.0.0" },
                "capabilities": { "tools": {} },
                "_meta": { "io.modelcontextprotocol/serverInfo": { "name": "forge", "version": "1.0.0" } }
            } }),
        ),
        "initialize" => {
            let pv = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("2026-07-28")
                .to_string();
            reply(
                store,
                json!({ "jsonrpc": "2.0", "id": id, "result": {
                    "protocolVersion": pv,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "forge", "version": "1.0.0" }
                } }),
            )
        }
        "ping" => reply(store, json!({ "jsonrpc": "2.0", "id": id, "result": {} })),
        "tools/list" => reply(store, json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": mcp_tools() } })),
        "tools/call" => {
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let empty_args = Map::new();
            let args: &Map<String, Value> = match params.get("arguments") {
                Some(Value::Object(m)) => m,
                _ => &empty_args,
            };
            match mcp_call_tool(store, &tool_name, args) {
                ToolOut::Result(out) => reply(store, json!({ "jsonrpc": "2.0", "id": id, "result": out })),
                ToolOut::RpcError(code, message) => reply_error(store, code, message),
            }
        }
        _ => reply_error(store, -32601, format!("Method not found: {}", method)),
    }
}

/// MCP auth failure body (router calls this): 401 JSON-RPC -32001, id null.
pub fn mcp_auth_fail(store: &mut Store) -> Response {
    let body = serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": Value::Null, "error": { "code": -32001, "message": "Unauthorized" } })).unwrap_or_default();
    Response::new(401, "application/json", body, store.req_id())
}
