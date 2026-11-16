// store.rs — in-memory store model, faithful port of app.ts (7ebc300) lines 400-480.
// Deterministic: sequential counters only, no clock, no randomness.

use crate::git::{GitObj, FIXED_EPOCH};
use indexmap::IndexMap;
use std::collections::HashMap;

pub const VIEWER_LOGIN: &str = "adaiversen";
pub const STRANGER_LOGIN: &str = "olgabauer";
pub const DEFAULT_BRANCH: &str = "main";
pub const FIXED_TS: &str = "2026-01-01T00:00:00Z";
pub const IDENTITY: &str = "Conformance <conformance@make.fun>";
pub const ZERO_OID: &str = "0000000000000000000000000000000000000000";
pub const JSON_TYPE: &str = "application/json; charset=utf-8";
pub const AGENT: &str = "github-core-clone/1.0";

#[derive(Clone, Debug)]
pub struct Label {
    pub name: String,
    pub color: String,
}

#[derive(Clone, Debug)]
pub struct Issue {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub body: String,
    pub state: String, // "open" | "closed"
    pub labels: Vec<Label>,
    pub seq: i64,
    pub json: Vec<u8>, // cached serialized form
}

#[derive(Clone, Debug)]
pub struct Comment {
    pub id: i64,
    pub body: String,
}

#[derive(Clone, Debug)]
pub struct Pull {
    pub number: i64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub merged: bool,
    pub merged_at: Option<String>,
    pub merge_sha: Option<String>,
    pub head_branch: String,
    pub base_branch: String,
    pub base_sha_at_creation: String,
    pub seq: i64,
}

#[derive(Clone, Debug)]
pub struct Repo {
    pub name: String,
    pub id: i64,
    pub node_id: String,
    pub owner: String,
    pub priv_: bool,
    pub description: String,
    pub refs: IndexMap<String, String>,
    pub objects: HashMap<String, GitObj>,
    pub issues: Vec<Issue>,
    pub labels: IndexMap<String, Label>,
    pub comments: HashMap<i64, Vec<Comment>>,
    pub pulls: Vec<Pull>,
    pub next_issue: i64,
    pub next_pull: i64,
    pub seq: i64,
    pub version: i64,
    pub fetch_cache: HashMap<String, Vec<u8>>,
    pub ls_cache: HashMap<String, Vec<u8>>,
}

pub struct Store {
    pub repos: HashMap<String, Repo>, // keyed by name; owner checked separately
    pub global_id_seq: i64,
    pub req_seq: i64,
    pub repo_seq: i64,
    pub token: String,
}

impl Store {
    pub fn new() -> Store {
        Store {
            repos: HashMap::new(),
            global_id_seq: 1000,
            req_seq: 0,
            repo_seq: 0,
            token: std::env::var("MAKEFUN_SHOP_TOKEN").unwrap_or_default(),
        }
    }

    pub fn req_id(&mut self) -> String {
        self.req_seq += 1;
        // Reference format (app.ts reqId): `req-N`, unpadded, global monotonic.
        // Responses are built fresh per request, so no in-place digit-width
        // issue exists; padding would only deviate from the reference.
        // Manual digits instead of format!: one small allocation, no formatter.
        let mut s = String::with_capacity(12);
        s.push_str("req-");
        let mut n = self.req_seq;
        let mut digits = [0u8; 20];
        let mut i = digits.len();
        if n == 0 {
            s.push('0');
        } else {
            while n > 0 {
                i -= 1;
                digits[i] = b'0' + (n % 10) as u8;
                n /= 10;
            }
            s.push_str(std::str::from_utf8(&digits[i..]).unwrap());
        }
        s
    }

    pub fn is_viewer_owner(owner: &str) -> bool {
        owner != STRANGER_LOGIN
    }

    pub fn find_repo(&self, owner: &str, name: &str) -> Option<&Repo> {
        if !Store::is_viewer_owner(owner) {
            return None;
        }
        self.repos.get(name)
    }

    pub fn find_repo_mut(&mut self, owner: &str, name: &str) -> Option<&mut Repo> {
        if !Store::is_viewer_owner(owner) {
            return None;
        }
        self.repos.get_mut(name)
    }

    pub fn create_repo(&mut self, name: &str, priv_: bool, description: &str) -> &mut Repo {
        let id = self.global_id_seq + 1;
        self.global_id_seq = id;
        self.repo_seq += 1;
        let seq = self.repo_seq;
        let repo = Repo {
            name: name.to_string(),
            id,
            node_id: global_id("Repository", &[id.to_string()]),
            owner: VIEWER_LOGIN.to_string(),
            priv_,
            description: description.to_string(),
            refs: IndexMap::new(),
            objects: HashMap::new(),
            issues: Vec::new(),
            labels: IndexMap::new(),
            comments: HashMap::new(),
            pulls: Vec::new(),
            next_issue: 1,
            next_pull: 1,
            seq,
            version: 0,
            fetch_cache: HashMap::new(),
            ls_cache: HashMap::new(),
        };
        self.repos.insert(name.to_string(), repo);
        self.repos.get_mut(name).unwrap()
    }
}

pub fn global_id(kind: &str, parts: &[String]) -> String {
    use std::fmt::Write;
    let mut s = String::new();
    let _ = write!(s, "{}:{}", kind, parts.join(":"));
    base64_encode(s.as_bytes())
}

pub fn decode_global_id(id: &str) -> Option<(String, Vec<String>)> {
    let text = String::from_utf8(base64_decode(id)?).ok()?;
    let idx = text.find(':')?;
    if idx == 0 {
        return None;
    }
    let kind = text[..idx].to_string();
    let parts: Vec<String> = text[idx + 1..].split(':').map(|s| s.to_string()).collect();
    Some((kind, parts))
}

pub fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i] as u32;
        let b1 = if i + 1 < data.len() { data[i + 1] as u32 } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if i + 1 < data.len() { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if i + 2 < data.len() { T[(n & 63) as usize] as char } else { '=' });
        i += 3;
    }
    out
}

pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let mut vals: Vec<u8> = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let mut quad = [0u8; 4];
        let mut pad = 0;
        for j in 0..4 {
            if i + j >= bytes.len() {
                return None;
            }
            let c = bytes[i + j];
            quad[j] = match c {
                b'A'..=b'Z' => c - b'A',
                b'a'..=b'z' => c - b'a' + 26,
                b'0'..=b'9' => c - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                b'=' => {
                    pad += 1;
                    0
                }
                _ => return None,
            };
        }
        let n = ((quad[0] as u32) << 18) | ((quad[1] as u32) << 12) | ((quad[2] as u32) << 6) | (quad[3] as u32);
        vals.push((n >> 16) as u8);
        if pad < 2 {
            vals.push((n >> 8) as u8);
        }
        if pad < 1 {
            vals.push(n as u8);
        }
        i += 4;
    }
    Some(vals)
}

pub fn bump_repo(repo: &mut Repo) {
    repo.version += 1;
    repo.fetch_cache.clear();
    repo.ls_cache.clear();
}

pub fn default_tip(repo: &Repo) -> Option<String> {
    repo.refs.get(&format!("refs/heads/{}", DEFAULT_BRANCH)).cloned()
}

pub fn ref_tip(repo: &Repo, r: &str) -> Option<String> {
    if r.starts_with("refs/") {
        repo.refs.get(r).cloned()
    } else {
        repo.refs.get(&format!("refs/heads/{}", r)).cloned()
    }
}

pub fn resolve_ref_to_commit(repo: &Repo, r: &str) -> Option<String> {
    if crate::git::is_oid(r) {
        return if repo.objects.contains_key(r) { Some(r.to_string()) } else { None };
    }
    let tip = ref_tip(repo, r)?;
    crate::git::peel_to_commit(&repo.objects, &tip).or(Some(tip))
}

pub fn put_object(repo: &mut Repo, typ: u8, data: Vec<u8>) -> String {
    let oid = crate::git::hash_object(typ, &data);
    repo.objects.entry(oid.clone()).or_insert(GitObj { typ, data });
    oid
}

/// JSON string escaping exactly as JSON.stringify (subset sufficient for our data).
pub fn json_escape(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

pub fn fixed_epoch() -> i64 {
    FIXED_EPOCH
}
