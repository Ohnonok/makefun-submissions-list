// git.rs — git object/pack core, faithful port of app.ts (commit 7ebc300) lines 28-399.
// No wall clock, no randomness: deterministic, identical request sequences
// produce identical state.

use flate2::write::ZlibEncoder;
use flate2::Compression;
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};


pub type ObjType = u8;
pub const T_COMMIT: ObjType = 1;
pub const T_TREE: ObjType = 2;
pub const T_BLOB: ObjType = 3;
pub const T_TAG: ObjType = 4;

#[derive(Clone, Debug)]
pub struct GitObj {
    pub typ: ObjType,
    pub data: Vec<u8>,
}

pub fn sha1_hex(data: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(data);
    hex(&h.finalize())
}

pub fn hash_object(typ: ObjType, data: &[u8]) -> String {
    let type_name = type_name(typ);
    let mut h = Sha1::new();
    h.update(format!("{} {}\0", type_name, data.len()).as_bytes());
    h.update(data);
    hex(&h.finalize())
}

pub fn type_name(typ: ObjType) -> &'static str {
    match typ {
        T_COMMIT => "commit",
        T_TREE => "tree",
        T_BLOB => "blob",
        T_TAG => "tag",
        _ => "?",
    }
}

pub fn type_code(name: &str) -> Option<ObjType> {
    match name {
        "commit" => Some(T_COMMIT),
        "tree" => Some(T_TREE),
        "blob" => Some(T_BLOB),
        "tag" => Some(T_TAG),
        _ => None,
    }
}

pub fn is_oid(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit() && (b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

pub fn hex(bytes: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(H[(b >> 4) as usize] as char);
        s.push(H[(b & 15) as usize] as char);
    }
    s
}

pub fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(s.len() / 2);
    let mut i = 0;
    while i < b.len() {
        let hi = (b[i] as char).to_digit(16)?;
        let lo = (b[i + 1] as char).to_digit(16)?;
        out.push((hi * 16 + lo) as u8);
        i += 2;
    }
    Some(out)
}

// ---------------------------------------------------------------- trees / commits

#[derive(Clone, Debug)]
pub struct TreeEntry {
    pub mode: String,
    pub name: String,
    pub oid: String,
}

pub fn parse_tree(data: &[u8]) -> Vec<TreeEntry> {
    let mut out = Vec::new();
    let mut off = 0usize;
    while off < data.len() {
        let sp = match data[off..].iter().position(|&b| b == b' ') {
            Some(p) => off + p,
            None => break,
        };
        let nul = match data[sp + 1..].iter().position(|&b| b == 0) {
            Some(p) => sp + 1 + p,
            None => break,
        };
        let mode = String::from_utf8_lossy(&data[off..sp]).into_owned();
        let name = String::from_utf8_lossy(&data[sp + 1..nul]).into_owned();
        let oid = hex(&data[nul + 1..nul + 21]);
        out.push(TreeEntry { mode, name, oid });
        off = nul + 21;
    }
    out
}

pub fn build_tree(entries: &[TreeEntry]) -> Vec<u8> {
    let mut sorted: Vec<&TreeEntry> = entries.iter().collect();
    sorted.sort_by(|a, b| {
        let an = if a.mode == "40000" { format!("{}/", a.name) } else { a.name.clone() };
        let bn = if b.mode == "40000" { format!("{}/", b.name) } else { b.name.clone() };
        an.as_bytes().cmp(bn.as_bytes())
    });
    let mut out = Vec::new();
    for e in sorted {
        out.extend_from_slice(format!("{} {}\0", e.mode, e.name).as_bytes());
        if let Some(raw) = unhex(&e.oid) {
            out.extend_from_slice(&raw);
        }
    }
    out
}

#[derive(Clone, Debug, Default)]
pub struct CommitView {
    pub tree: String,
    pub parents: Vec<String>,
    pub author: String,
    pub committer: String,
    pub message: String,
}

pub const FIXED_EPOCH: i64 = 1_700_000_000;
pub const IDENTITY: &str = "Conformance <conformance@make.fun>";

pub fn parse_commit(data: &[u8]) -> CommitView {
    let blank = find_subslice(data, b"\n\n");
    let head_end = blank.unwrap_or(data.len());
    let message = match blank {
        Some(b) => String::from_utf8_lossy(&data[b + 2..]).into_owned(),
        None => String::new(),
    };
    let mut view = CommitView { message, ..Default::default() };
    let head = String::from_utf8_lossy(&data[..head_end]);
    for line in head.split('\n') {
        if line.is_empty() {
            continue;
        }
        let (k, v) = match line.find(' ') {
            Some(sp) => (&line[..sp], &line[sp + 1..]),
            None => (line, ""),
        };
        match k {
            "tree" => view.tree = v.to_string(),
            "parent" => view.parents.push(v.to_string()),
            "author" => view.author = v.to_string(),
            "committer" => view.committer = v.to_string(),
            _ => {}
        }
    }
    view
}

pub fn build_commit(tree: &str, parents: &[String], message: &str) -> Vec<u8> {
    let who = format!("{} {} +0000", IDENTITY, FIXED_EPOCH);
    let mut lines: Vec<String> = vec![format!("tree {}", tree)];
    for p in parents {
        lines.push(format!("parent {}", p));
    }
    lines.push(format!("author {}", who));
    lines.push(format!("committer {}", who));
    lines.push(String::new());
    let msg = if message.ends_with('\n') { message.to_string() } else { format!("{}\n", message) };
    format!("{}\n{}", lines.join("\n"), msg).into_bytes()
}

#[derive(Clone, Debug, Default)]
pub struct TagView {
    pub object: String,
    pub typ: String,
    pub tag: String,
    pub tagger: String,
    pub message: String,
}

pub fn parse_tag(data: &[u8]) -> TagView {
    let blank = find_subslice(data, b"\n\n");
    let head_end = blank.unwrap_or(data.len());
    let mut v = TagView::default();
    let head = String::from_utf8_lossy(&data[..head_end]);
    for line in head.split('\n') {
        if line.is_empty() {
            continue;
        }
        if let Some(sp) = line.find(' ') {
            let (k, val) = (&line[..sp], &line[sp + 1..]);
            match k {
                "object" => v.object = val.to_string(),
                "type" => v.typ = val.to_string(),
                "tag" => v.tag = val.to_string(),
                "tagger" => v.tagger = val.to_string(),
                _ => {}
            }
        }
    }
    v.message = match blank {
        Some(b) => String::from_utf8_lossy(&data[b + 2..]).into_owned(),
        None => String::new(),
    };
    v
}

pub fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

// ---------------------------------------------------------------- pkt-line

pub fn pkt_line(payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 4);
    out.extend_from_slice(format!("{:04x}", payload.len() + 4).as_bytes());
    out.extend_from_slice(payload);
    out
}

pub fn pkt_lines(items: &[PktItem]) -> Vec<u8> {
    let mut total = 0usize;
    for it in items {
        total += match it {
            PktItem::Flush | PktItem::Delim => 4,
            PktItem::Data(d) => 4 + d.len(),
        };
    }
    let mut out = Vec::with_capacity(total);
    for it in items {
        match it {
            PktItem::Flush => out.extend_from_slice(b"0000"),
            PktItem::Delim => out.extend_from_slice(b"0001"),
            PktItem::Data(d) => {
                out.extend_from_slice(format!("{:04x}", d.len() + 4).as_bytes());
                out.extend_from_slice(d);
            }
        }
    }
    out
}

#[derive(Clone, Debug)]
pub enum PktItem {
    Data(Vec<u8>),
    Flush,
    Delim,
}

#[derive(Clone, Debug)]
pub enum Pkt {
    Data(Vec<u8>),
    Flush,
    Delim,
    End,
}

pub fn parse_hex4(buf: &[u8], off: usize) -> i32 {
    if off + 4 > buf.len() {
        return -1;
    }
    let mut v: i32 = 0;
    for i in 0..4 {
        let c = buf[off + i];
        v = match c {
            b'0'..=b'9' => v * 16 + (c - b'0') as i32,
            b'a'..=b'f' => v * 16 + (c - b'a' + 10) as i32,
            b'A'..=b'F' => v * 16 + (c - b'A' + 10) as i32,
            _ => return -1,
        };
    }
    v
}

pub fn decode_pkts(buf: &[u8]) -> Vec<Pkt> {
    let mut out = Vec::new();
    let mut off = 0usize;
    while off + 4 <= buf.len() {
        let len = parse_hex4(buf, off);
        if len < 0 || len > 65520 {
            break;
        }
        let len = len as usize;
        if len == 0 {
            out.push(Pkt::Flush);
            off += 4;
            continue;
        }
        if len == 1 {
            out.push(Pkt::Delim);
            off += 4;
            continue;
        }
        if len == 2 {
            out.push(Pkt::End);
            off += 4;
            continue;
        }
        if off + len > buf.len() {
            break;
        }
        out.push(Pkt::Data(buf[off + 4..off + len].to_vec()));
        off += len;
    }
    out
}

// ---------------------------------------------------------------- packfile

fn read_varint(buf: &[u8], start: usize) -> (usize, usize, u8) {
    let mut b = buf[start];
    let first = b;
    let mut size = (b & 0x0f) as usize;
    let mut shift = 4u32;
    let mut off = start + 1;
    while b & 0x80 != 0 {
        b = buf[off];
        off += 1;
        size += ((b & 0x7f) as usize) << shift;
        shift += 7;
    }
    (size, off, first)
}

fn read_ofs_base(buf: &[u8], start: usize) -> (usize, usize) {
    let mut b = buf[start];
    let mut off = start + 1;
    let mut v = (b & 0x7f) as usize;
    while b & 0x80 != 0 {
        b = buf[off];
        off += 1;
        v = ((v + 1) * 128) + ((b & 0x7f) as usize);
    }
    (v, off)
}

/// Inflate a zlib stream starting at `offset`; returns (data, next_offset).
/// flate2's Decompress reports consumed input via total_in().
pub fn inflate_at(buf: &[u8], offset: usize, end: usize) -> Result<(Vec<u8>, usize), String> {
    let mut dec = flate2::Decompress::new(true);
    let mut out: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 16384];
    let mut in_off = offset;
    loop {
        let before_in = dec.total_in();
        let before_out = dec.total_out();
        // NOTE: FlushDecompress::Finish CORRUPTS multi-chunk inflates
        // (miniz_oxide: after BufError at a full 16 KiB chunk, the next
        // Finish call errors "deflate decompression error" — proven
        // 2026-11-16 on a 16,385-byte blob). Flush::None streams
        // correctly: the first call consumes all input, later calls drain
        // the internal buffer to StreamEnd with the exact next offset.
        let status = dec
            .decompress(&buf[in_off..end], &mut chunk, flate2::FlushDecompress::None)
            .map_err(|e| format!("inflate: {}", e))?;
        let n_in = (dec.total_in() - before_in) as usize;
        let n_out = (dec.total_out() - before_out) as usize;
        in_off += n_in;
        out.extend_from_slice(&chunk[..n_out]);
        match status {
            flate2::Status::StreamEnd => break,
            flate2::Status::Ok | flate2::Status::BufError => {
                // Reaching end-of-input is NOT truncation: miniz may have
                // consumed the whole stream while output is still buffered
                // (proven 2026-11-16: 818-byte stream, iter 0 eats all
                // input, 3,630 output bytes still pending). The drain call
                // below runs with an empty input slice; only zero progress
                // on a drain means the stream is genuinely cut short.
                if n_in == 0 && n_out == 0 {
                    return Err("inflate: stalled".to_string());
                }
            }
        }
    }
    Ok((out, in_off))
}

fn apply_delta(base: &[u8], delta: &[u8]) -> Result<Vec<u8>, String> {
    let mut off = 0usize;
    let mut read_size = |off: &mut usize| -> usize {
        let mut v = 0usize;
        let mut sh = 0u32;
        loop {
            let b = delta[*off];
            *off += 1;
            v += ((b & 0x7f) as usize) << sh;
            sh += 7;
            if b & 0x80 == 0 {
                break;
            }
        }
        v
    };
    let src_size = read_size(&mut off);
    let tgt_size = read_size(&mut off);
    if src_size != base.len() {
        return Err("delta base size mismatch".to_string());
    }
    let mut out = vec![0u8; tgt_size];
    let mut written = 0usize;
    while off < delta.len() {
        let op = delta[off];
        off += 1;
        if op & 0x80 != 0 {
            let mut co = 0usize;
            let mut cs = 0usize;
            let mut sh = 0u32;
            for bit in 0..4 {
                if op & (1 << bit) != 0 {
                    co += (delta[off] as usize) << sh;
                    off += 1;
                }
                sh += 8;
            }
            sh = 0;
            for bit in 4..7 {
                if op & (1 << bit) != 0 {
                    cs += (delta[off] as usize) << sh;
                    off += 1;
                }
                sh += 8;
            }
            if cs == 0 {
                cs = 0x10000;
            }
            if co + cs > base.len() || written + cs > tgt_size {
                return Err("delta copy out of range".to_string());
            }
            out[written..written + cs].copy_from_slice(&base[co..co + cs]);
            written += cs;
        } else if op != 0 {
            let lit = (op & 0x7f) as usize;
            if off + lit > delta.len() || written + lit > tgt_size {
                return Err("delta literal out of range".to_string());
            }
            out[written..written + lit].copy_from_slice(&delta[off..off + lit]);
            off += lit;
            written += lit;
        } else {
            return Err("delta opcode 0".to_string());
        }
    }
    if written != tgt_size {
        return Err("delta size mismatch".to_string());
    }
    Ok(out)
}

struct Raw {
    offset: usize,
    type_code: u8,
    size: usize,
    data: Vec<u8>,
    base_offset: Option<usize>,
    base_oid: Option<String>,
}

fn read_u32be(buf: &[u8], off: usize) -> u32 {
    u32::from_be_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]])
}

/// Parse a packfile into objects (resolving OFS/REF deltas). Errors on corruption.
pub fn read_pack(pack: &[u8]) -> Result<HashMap<String, GitObj>, String> {
    if pack.len() < 32 || &pack[0..4] != b"PACK" {
        return Err("bad pack header".to_string());
    }
    let version = read_u32be(pack, 4);
    if version != 2 && version != 3 {
        return Err("bad pack version".to_string());
    }
    let count = read_u32be(pack, 8) as usize;
    let trailer_start = pack.len() - 20;
    let trailer = hex(&pack[trailer_start..]);
    if sha1_hex(&pack[..trailer_start]) != trailer {
        return Err("pack checksum mismatch".to_string());
    }
    let mut raw: Vec<Raw> = Vec::with_capacity(count);
    let mut by_offset: HashMap<usize, usize> = HashMap::new();
    let mut off = 12usize;
    for _ in 0..count {
        let entry_offset = off;
        let (size, next, first) = read_varint(pack, off);
        off = next;
        let type_code = (first >> 4) & 0x07;
        let mut e = Raw { offset: entry_offset, type_code, size, data: Vec::new(), base_offset: None, base_oid: None };
        if type_code == 6 {
            let (base, next2) = read_ofs_base(pack, off);
            off = next2;
            e.base_offset = Some(entry_offset - base);
        } else if type_code == 7 {
            e.base_oid = Some(hex(&pack[off..off + 20]));
            off += 20;
        } else if !(1..=4).contains(&type_code) {
            return Err("bad pack type code".to_string());
        }
        let (data, next3) = inflate_at(pack, off, trailer_start)?;
        if data.len() != size {
            return Err("pack entry size mismatch".to_string());
        }
        e.data = data;
        off = next3;
        by_offset.insert(entry_offset, raw.len());
        raw.push(e);
    }
    if off != trailer_start {
        return Err("pack trailing bytes".to_string());
    }
    // Resolve with memoization (index-based, mirrors the TS _r cache).
    let mut resolved: Vec<Option<(ObjType, Vec<u8>, String)>> = vec![None; raw.len()];
    let mut resolved_by_oid: HashMap<String, usize> = HashMap::new();
    let mut resolving: HashSet<usize> = HashSet::new();
    fn resolve(
        idx: usize,
        raw: &[Raw],
        by_offset: &HashMap<usize, usize>,
        resolved: &mut Vec<Option<(ObjType, Vec<u8>, String)>>,
        resolved_by_oid: &mut HashMap<String, usize>,
        resolving: &mut HashSet<usize>,
    ) -> Result<(ObjType, Vec<u8>, String), String> {
        if let Some(r) = &resolved[idx] {
            return Ok(r.clone());
        }
        if resolving.contains(&idx) {
            return Err("delta cycle".to_string());
        }
        resolving.insert(idx);
        let e = &raw[idx];
        let (typ, data): (ObjType, Vec<u8>) = if e.type_code == 6 {
            let base_idx = *by_offset.get(&e.base_offset.unwrap()).ok_or("ofs-delta base missing")?;
            let (bt, bd, _) = resolve(base_idx, raw, by_offset, resolved, resolved_by_oid, resolving)?;
            (bt, apply_delta(&bd, &e.data)?)
        } else if e.type_code == 7 {
            let base_idx = *resolved_by_oid.get(e.base_oid.as_ref().unwrap()).ok_or("ref-delta base missing (thin pack not supported)")?;
            let (bt, bd, _) = resolve(base_idx, raw, by_offset, resolved, resolved_by_oid, resolving)?;
            (bt, apply_delta(&bd, &e.data)?)
        } else {
            (e.type_code, e.data.clone())
        };
        let oid = hash_object(typ, &data);
        let r = (typ, data, oid.clone());
        resolved[idx] = Some(r.clone());
        resolved_by_oid.insert(oid, idx);
        resolving.remove(&idx);
        Ok(r)
    }
    let mut objects: HashMap<String, GitObj> = HashMap::new();
    for i in 0..raw.len() {
        let (typ, data, oid) = resolve(i, &raw, &by_offset, &mut resolved, &mut resolved_by_oid, &mut resolving)?;
        objects.entry(oid).or_insert(GitObj { typ, data });
    }
    Ok(objects)
}

fn write_pack_object_header(typ: ObjType, size: usize) -> Vec<u8> {
    let code: u8 = typ;
    let mut bytes: Vec<u8> = Vec::new();
    let mut rem = size;
    let mut first = (code << 4) | ((rem & 0x0f) as u8);
    rem /= 16;
    while rem > 0 {
        bytes.push(first | 0x80);
        first = (rem & 0x7f) as u8;
        rem /= 128;
    }
    bytes.push(first);
    bytes
}

/// Build a packfile from plain objects (no deltas). Deflate level 1 (spec).
pub fn write_pack(objects: &[GitObj]) -> Vec<u8> {
    let mut body: Vec<u8> = Vec::new();
    body.extend_from_slice(b"PACK");
    body.extend_from_slice(&2u32.to_be_bytes());
    body.extend_from_slice(&(objects.len() as u32).to_be_bytes());
    for o in objects {
        body.extend_from_slice(&write_pack_object_header(o.typ, o.data.len()));
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::new(1));
        use std::io::Write;
        enc.write_all(&o.data).unwrap();
        let comp = enc.finish().unwrap();
        body.extend_from_slice(&comp);
    }
    let trailer = Sha1::digest(&body);
    body.extend_from_slice(&trailer);
    body
}

// ---------------------------------------------------------------- reachability

pub fn collect_reachable<F: Fn(&str) -> Option<GitObj>>(
    roots: &[String],
    lookup: F,
    max_depth: i64,
) -> HashSet<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue: Vec<(String, i64)> = Vec::new();
    for r in roots {
        if is_oid(r) {
            queue.push((r.clone(), 0));
        }
    }
    while let Some((oid, depth)) = queue.pop() {
        if seen.contains(&oid) {
            continue;
        }
        let obj = match lookup(&oid) {
            Some(o) => o,
            None => continue,
        };
        seen.insert(oid.clone());
        if max_depth >= 0 && depth >= max_depth {
            continue;
        }
        match obj.typ {
            T_COMMIT => {
                let c = parse_commit(&obj.data);
                queue.push((c.tree, depth + 1));
                for p in c.parents {
                    queue.push((p, depth + 1));
                }
            }
            T_TAG => {
                let t = parse_tag(&obj.data);
                queue.push((t.object, depth + 1));
            }
            T_TREE => {
                for e in parse_tree(&obj.data) {
                    if e.mode != "160000" {
                        queue.push((e.oid, depth + 1));
                    }
                }
            }
            _ => {}
        }
    }
    seen
}

pub fn collect_shallow<F: Fn(&str) -> Option<GitObj>>(
    wants: &[String],
    lookup: F,
    depth: f64, // f64: JS parseInt('deepen abc') yields NaN; gen+1 < NaN is false,
                // so every wanted commit becomes a boundary commit (reproduced).
) -> (HashSet<String>, HashSet<String>) {
    let mut seen: HashSet<String> = HashSet::new();
    let mut boundary: HashSet<String> = HashSet::new();
    let mut queue: Vec<(String, i64)> = Vec::new();
    for w in wants {
        if is_oid(w) {
            queue.push((w.clone(), 0));
        }
    }
    while let Some((oid, gen)) = queue.pop() {
        if seen.contains(&oid) {
            continue;
        }
        let obj = match lookup(&oid) {
            Some(o) => o,
            None => continue,
        };
        seen.insert(oid.clone());
        match obj.typ {
            T_COMMIT => {
                let c = parse_commit(&obj.data);
                queue.push((c.tree, gen + 1));
                if ((gen + 1) as f64) < depth {
                    for p in c.parents {
                        queue.push((p, gen + 1));
                    }
                } else if !c.parents.is_empty() {
                    boundary.insert(oid.clone());
                }
            }
            T_TAG => {
                let t = parse_tag(&obj.data);
                queue.push((t.object, gen + 1));
            }
            T_TREE => {
                for e in parse_tree(&obj.data) {
                    if e.mode != "160000" {
                        queue.push((e.oid, gen + 1));
                    }
                }
            }
            _ => {}
        }
    }
    (seen, boundary)
}

pub fn is_ancestor(objects: &HashMap<String, GitObj>, ancestor: &str, tip: &str) -> bool {
    if ancestor == tip {
        return true;
    }
    if let Some(tip_obj) = objects.get(tip) {
        if tip_obj.typ == T_COMMIT && parse_commit(&tip_obj.data).parents.iter().any(|p| p == ancestor) {
            return true;
        }
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue = vec![tip.to_string()];
    while let Some(oid) = queue.pop() {
        if oid == ancestor {
            return true;
        }
        if seen.contains(&oid) {
            continue;
        }
        seen.insert(oid.clone());
        let obj = match objects.get(&oid) {
            Some(o) => o,
            None => continue,
        };
        if obj.typ != T_COMMIT {
            continue;
        }
        for p in parse_commit(&obj.data).parents {
            queue.push(p);
        }
    }
    false
}

pub fn peel_to_commit(objects: &HashMap<String, GitObj>, oid: &str) -> Option<String> {
    let mut cur = oid.to_string();
    for _ in 0..10 {
        let obj = objects.get(&cur)?;
        if obj.typ == T_COMMIT {
            return Some(cur);
        }
        if obj.typ == T_TAG {
            cur = parse_tag(&obj.data).object;
            continue;
        }
        return None;
    }
    None
}
