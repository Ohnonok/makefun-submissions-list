// http.rs — single-threaded epoll HTTP/1.1 server (std + libc only).
// One loop, no threads, no timers: per-connection state machine, 64 KiB
// input buffer per connection, byte-search header parse, Content-Length
// and chunked bodies, single-buffer responses (status line + headers +
// body in one Vec<u8>, one write() call per flush).
// Determinism: no clock, no randomness anywhere in this file.

use crate::store::Store;
use std::collections::HashMap;
use std::io;
use std::os::unix::io::RawFd;

pub struct Request {
    pub method: String,
    pub pathname: String, // percent-decoded path, no query
    pub query: String,    // raw query string (no '?')
    pub headers: Vec<(String, String)>, // lowercased names
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

pub struct Response {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
    pub extra: Vec<(String, String)>,
    pub req_id: String,
    /// HEAD: emit headers (content-length = body.len()) but no body bytes.
    pub omit_body: bool,
    /// 204/202: no content-type header (204 also omits content-length per RFC 9110).
    pub no_content_type: bool,
    /// 204 + MCP 202 notification: no content-length either (Node's
    /// writeHead(204, [only x-github-request-id]) / writeHead(202, ...) emit
    /// no content-length; the body is empty).
    pub no_content_length: bool,
}

impl Response {
    pub fn new(status: u16, content_type: &'static str, body: Vec<u8>, req_id: String) -> Response {
        Response { status, content_type, body, extra: Vec::new(), req_id, omit_body: false, no_content_type: false, no_content_length: false }
    }
    pub fn json(status: u16, body: Vec<u8>, req_id: String) -> Response {
        Response::new(status, crate::store::JSON_TYPE, body, req_id)
    }
}

pub fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        422 => "Unprocessable Entity",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' => {
                if i + 2 >= b.len() {
                    return None;
                }
                let hi = (b[i + 1] as char).to_digit(16)?;
                let lo = (b[i + 2] as char).to_digit(16)?;
                out.push((hi * 16 + lo) as u8);
                i += 3;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

#[derive(PartialEq, Clone, Copy)]
enum BodyMode {
    None,
    Length(usize),
    Chunked,
}

#[derive(PartialEq, Clone, Copy)]
enum ChunkPhase {
    Size,
    Data,
    DataCrlf,
    Trailers,
}

struct Conn {
    fd: RawFd,
    in_buf: Vec<u8>,
    in_start: usize, // consumed prefix
    out_buf: Vec<u8>,
    out_off: usize,
    // request assembly
    headers_done: bool,
    method: String,
    pathname: String,
    query: String,
    headers: Vec<(String, String)>,
    body_mode: BodyMode,
    body: Vec<u8>,
    chunk_phase: ChunkPhase,
    chunk_left: usize,
    keep_alive: bool,
    want_write: bool,
    closed: bool,
}

impl Conn {
    fn new(fd: RawFd) -> Conn {
        Conn {
            fd,
            in_buf: Vec::with_capacity(65536),
            in_start: 0,
            out_buf: Vec::new(),
            out_off: 0,
            headers_done: false,
            method: String::new(),
            pathname: String::new(),
            query: String::new(),
            headers: Vec::new(),
            body_mode: BodyMode::None,
            body: Vec::new(),
            chunk_phase: ChunkPhase::Size,
            chunk_left: 0,
            keep_alive: true,
            want_write: false,
            closed: false,
        }
    }

    fn avail(&self) -> &[u8] {
        &self.in_buf[self.in_start..]
    }

    fn consume(&mut self, n: usize) {
        self.in_start += n;
        if self.in_start == self.in_buf.len() {
            self.in_buf.clear();
            self.in_start = 0;
        } else if self.in_start > 65536 {
            self.in_buf.drain(..self.in_start);
            self.in_start = 0;
        }
    }

    /// Try to assemble one complete request from buffered input.
    /// Returns Some(Request) when complete, None when more data is needed.
    /// Returns Err(()) on a malformed request (caller closes the connection).
    fn try_parse(&mut self) -> Result<Option<Request>, ()> {
        if !self.headers_done {
            let avail = self.avail();
            let mut idx = 0usize;
            let mut found: Option<usize> = None;
            while idx + 3 < avail.len() {
                if avail[idx] == b'\r' && avail[idx + 1] == b'\n' && avail[idx + 2] == b'\r' && avail[idx + 3] == b'\n' {
                    found = Some(idx);
                    break;
                }
                idx += 1;
            }
            let hdr_end = match found {
                Some(e) => e,
                None => {
                    if avail.len() > 65536 {
                        return Err(());
                    }
                    return Ok(None);
                }
            };
            let head = String::from_utf8_lossy(&avail[..hdr_end]).into_owned();
            self.consume(hdr_end + 4);
            let mut lines = head.split("\r\n");
            let request_line = lines.next().ok_or(())?;
            let mut parts = request_line.splitn(3, ' ');
            let method = parts.next().ok_or(())?.to_string();
            let target = parts.next().ok_or(())?.to_string();
            let version = parts.next().unwrap_or("HTTP/1.1").to_string();
            let mut headers: Vec<(String, String)> = Vec::new();
            for line in lines {
                if let Some(colon) = line.find(':') {
                    let name = line[..colon].trim().to_ascii_lowercase();
                    let value = line[colon + 1..].trim().to_string();
                    headers.push((name, value));
                }
            }
            let (raw_path, query) = match target.find('?') {
                Some(q) => (&target[..q], target[q + 1..].to_string()),
                None => (target.as_str(), String::new()),
            };
            let pathname = if raw_path.contains('%') {
                percent_decode(raw_path).ok_or(())?
            } else {
                raw_path.to_string()
            };
            let keep_alive = match headers.iter().find(|(k, _)| k == "connection") {
                Some((_, v)) => !v.eq_ignore_ascii_case("close"),
                None => version != "HTTP/1.0",
            };
            let te_chunked = headers
                .iter()
                .find(|(k, _)| k == "transfer-encoding")
                .map(|(_, v)| v.to_ascii_lowercase().contains("chunked"))
                .unwrap_or(false);
            let content_length: usize = headers
                .iter()
                .find(|(k, _)| k == "content-length")
                .and_then(|(_, v)| v.parse::<usize>().ok())
                .unwrap_or(0);
            self.method = method;
            self.pathname = pathname;
            self.query = query;
            self.headers = headers;
            self.keep_alive = keep_alive;
            self.body = Vec::new();
            if te_chunked {
                self.body_mode = BodyMode::Chunked;
                self.chunk_phase = ChunkPhase::Size;
                self.chunk_left = 0;
            } else if content_length > 0 {
                self.body_mode = BodyMode::Length(content_length);
            } else {
                self.body_mode = BodyMode::None;
            }
            self.headers_done = true;
            if self.body_mode == BodyMode::None {
                return Ok(Some(self.take_request()));
            }
        }
        // Body assembly.
        match self.body_mode {
            BodyMode::None => Ok(Some(self.take_request())),
            BodyMode::Length(need) => {
                let take = need.min(self.in_buf.len() - self.in_start);
                let start = self.in_start;
                self.body.extend_from_slice(&self.in_buf[start..start + take]);
                self.consume(take);
                if self.body.len() >= need {
                    Ok(Some(self.take_request()))
                } else {
                    Ok(None)
                }
            }
            BodyMode::Chunked => {
                loop {
                    match self.chunk_phase {
                        ChunkPhase::Size => {
                            let avail = self.avail();
                            let mut eol: Option<usize> = None;
                            for i in 0..avail.len().saturating_sub(1) {
                                if avail[i] == b'\r' && avail[i + 1] == b'\n' {
                                    eol = Some(i);
                                    break;
                                }
                            }
                            let eol = match eol {
                                Some(e) => e,
                                None => {
                                    if avail.len() > 1024 {
                                        return Err(());
                                    }
                                    return Ok(None);
                                }
                            };
                            let line = String::from_utf8_lossy(&avail[..eol]).into_owned();
                            self.consume(eol + 2);
                            let size_str = line.split(';').next().unwrap_or("").trim();
                            let size = usize::from_str_radix(size_str, 16).map_err(|_| ())?;
                            if size == 0 {
                                self.chunk_phase = ChunkPhase::Trailers;
                            } else {
                                self.chunk_left = size;
                                self.chunk_phase = ChunkPhase::Data;
                            }
                        }
                        ChunkPhase::Data => {
                            let take = self.chunk_left.min(self.in_buf.len() - self.in_start);
                            let start = self.in_start;
                            self.body.extend_from_slice(&self.in_buf[start..start + take]);
                            self.consume(take);
                            self.chunk_left -= take;
                            if self.chunk_left == 0 {
                                self.chunk_phase = ChunkPhase::DataCrlf;
                            } else {
                                return Ok(None);
                            }
                        }
                        ChunkPhase::DataCrlf => {
                            if self.avail().len() < 2 {
                                return Ok(None);
                            }
                            if self.avail()[0] != b'\r' || self.avail()[1] != b'\n' {
                                return Err(());
                            }
                            self.consume(2);
                            self.chunk_phase = ChunkPhase::Size;
                        }
                        ChunkPhase::Trailers => {
                            let avail = self.avail();
                            if avail.len() < 2 {
                                return Ok(None);
                            }
                            // Trailers end at an empty line; the env never sends any,
                            // so a bare CRLF ends the body.
                            if avail[0] == b'\r' && avail[1] == b'\n' {
                                self.consume(2);
                                return Ok(Some(self.take_request()));
                            }
                            // Skip one trailer line.
                            let mut eol: Option<usize> = None;
                            for i in 0..avail.len().saturating_sub(1) {
                                if avail[i] == b'\r' && avail[i + 1] == b'\n' {
                                    eol = Some(i);
                                    break;
                                }
                            }
                            match eol {
                                Some(e) => {
                                    self.consume(e + 2);
                                }
                                None => return Ok(None),
                            }
                        }
                    }
                }
            }
        }
    }

    fn take_request(&mut self) -> Request {
        let req = Request {
            method: std::mem::take(&mut self.method),
            pathname: std::mem::take(&mut self.pathname),
            query: std::mem::take(&mut self.query),
            headers: std::mem::take(&mut self.headers),
            body: std::mem::take(&mut self.body),
        };
        self.headers_done = false;
        self.body_mode = BodyMode::None;
        req
    }

    fn reset_for_keepalive(&mut self) {
        self.headers_done = false;
        self.body = Vec::new();
        self.headers.clear();
    }
}

fn set_nonblocking(fd: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    let r = unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) };
    if r < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Write a u64 as decimal digits, no allocation (replaces format! in the
/// per-response header path).
fn push_u64(out: &mut Vec<u8>, mut n: u64) {
    if n == 0 {
        out.push(b'0');
        return;
    }
    let mut buf = [0u8; 20];
    let mut i = buf.len();
    while n > 0 {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
    }
    out.extend_from_slice(&buf[i..]);
}

/// Build the full response packet (status line + headers + body) in one buffer.
/// Framing rules (keep-alive audit): content-length is ALWAYS emitted except
/// on 204 (RFC 9110: no Content-Length on 204; clients know 204 has no body),
/// so a client on a keep-alive connection can never hang waiting for a body
/// terminator. HEAD responses carry content-length = body length with no body
/// bytes (Node strips HEAD bodies the same way).
/// Zero-format! assembly: headers are written as literal byte slices plus
/// push_u64 digits — no String allocation anywhere on this path.
pub fn build_response(resp: &Response, keep_alive: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(256 + resp.body.len());
    out.extend_from_slice(b"HTTP/1.1 ");
    push_u64(&mut out, resp.status as u64);
    out.push(b' ');
    out.extend_from_slice(reason(resp.status).as_bytes());
    out.extend_from_slice(b"\r\n");
    if !resp.no_content_type {
        out.extend_from_slice(b"content-type: ");
        out.extend_from_slice(resp.content_type.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    if resp.status != 204 && !resp.no_content_length {
        out.extend_from_slice(b"content-length: ");
        push_u64(&mut out, resp.body.len() as u64);
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(b"x-github-request-id: ");
    out.extend_from_slice(resp.req_id.as_bytes());
    out.extend_from_slice(b"\r\n");
    for (k, v) in &resp.extra {
        out.extend_from_slice(k.as_bytes());
        out.extend_from_slice(b": ");
        out.extend_from_slice(v.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(if keep_alive { b"connection: keep-alive\r\n" } else { b"connection: close\r\n" });
    out.extend_from_slice(b"\r\n");
    if !resp.omit_body && resp.status != 204 {
        out.extend_from_slice(&resp.body);
    }
    out
}

/// Drive one connection: parse + dispatch every complete buffered request,
/// flushing each response before moving on. Returns true when the connection
/// should be closed.
fn drive_conn<F>(conn: &mut Conn, store: &mut Store, handler: &mut F) -> bool
where
    F: FnMut(&mut Store, &Request) -> Response,
{
    loop {
        // Dispatch every complete request already buffered.
        while !conn.closed && !conn.want_write {
            match conn.try_parse() {
                Ok(Some(req)) => {
                    let keep_alive = conn.keep_alive;
                    let resp = handler(store, &req);
                    conn.out_buf = build_response(&resp, keep_alive);
                    conn.out_off = 0;
                    conn.want_write = true;
                    conn.reset_for_keepalive();
                }
                Ok(None) => break,
                Err(()) => {
                    conn.closed = true;
                    break;
                }
            }
        }
        // Flush the pending response.
        if conn.want_write && !conn.closed {
            while conn.out_off < conn.out_buf.len() {
                let nwr = unsafe {
                    libc::write(conn.fd, conn.out_buf[conn.out_off..].as_ptr() as *const libc::c_void, conn.out_buf.len() - conn.out_off)
                };
                if nwr > 0 {
                    conn.out_off += nwr as usize;
                } else if nwr == 0 {
                    conn.closed = true;
                    break;
                } else {
                    let e = io::Error::last_os_error();
                    if e.kind() == io::ErrorKind::WouldBlock {
                        break;
                    }
                    conn.closed = true;
                    break;
                }
            }
            if conn.out_off >= conn.out_buf.len() {
                conn.want_write = false;
                conn.out_buf.clear();
                conn.out_off = 0;
                if !conn.keep_alive {
                    conn.closed = true;
                }
            }
        }
        // If a write is still pending (socket full), stop and wait for EPOLLOUT.
        if conn.want_write || conn.closed {
            break;
        }
        // If more pipelined requests are already buffered, keep going.
        if conn.in_start < conn.in_buf.len() {
            continue;
        }
        break;
    }
    conn.closed
}

/// Run the server forever on a bound listener. `handler` is called with the
/// store and each complete request; it must be fast (the loop is single-threaded).
pub fn run_server<F>(listener: std::net::TcpListener, store: &mut Store, mut handler: F) -> io::Result<()>
where
    F: FnMut(&mut Store, &Request) -> Response,
{
    use std::os::unix::io::AsRawFd;
    let lfd = listener.as_raw_fd();
    set_nonblocking(lfd)?;
    let epfd = unsafe { libc::epoll_create1(0) };
    if epfd < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut ev = libc::epoll_event { events: libc::EPOLLIN as u32, u64: lfd as u64 };
    let r = unsafe { libc::epoll_ctl(epfd, libc::EPOLL_CTL_ADD, lfd, &mut ev) };
    if r < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut conns: HashMap<RawFd, Conn> = HashMap::new();
    let mut events: Vec<libc::epoll_event> = vec![unsafe { std::mem::zeroed() }; 128];
    let mut tmp = [0u8; 65536];
    loop {
        let n = unsafe { libc::epoll_wait(epfd, events.as_mut_ptr(), events.len() as i32, -1) };
        if n < 0 {
            let e = io::Error::last_os_error();
            if e.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(e);
        }
        for i in 0..n as usize {
            let ev = events[i];
            let fd = ev.u64 as RawFd;
            let evmask = ev.events;
            if fd == lfd {
                // Accept all pending connections.
                loop {
                    let cfd = unsafe { libc::accept(lfd, std::ptr::null_mut(), std::ptr::null_mut()) };
                    if cfd < 0 {
                        break;
                    }
                    let _ = set_nonblocking(cfd);
                    // Disable Nagle: small responses go out immediately.
                    // TCP_QUICKACK: no delayed-ACK stall on the lockstep
                    // request/response bench (client waits for our ACK
                    // before sending the next request on the same socket).
                    let one: libc::c_int = 1;
                    unsafe {
                        libc::setsockopt(cfd, libc::IPPROTO_TCP, libc::TCP_NODELAY, &one as *const _ as *const libc::c_void, std::mem::size_of::<libc::c_int>() as libc::socklen_t);
                        libc::setsockopt(cfd, libc::IPPROTO_TCP, libc::TCP_QUICKACK, &one as *const _ as *const libc::c_void, std::mem::size_of::<libc::c_int>() as libc::socklen_t);
                    }
                    let mut cev = libc::epoll_event { events: libc::EPOLLIN as u32, u64: cfd as u64 };
                    let r = unsafe { libc::epoll_ctl(epfd, libc::EPOLL_CTL_ADD, cfd, &mut cev) };
                    if r < 0 {
                        unsafe { libc::close(cfd) };
                        continue;
                    }
                    conns.insert(cfd, Conn::new(cfd));
                }
                continue;
            }
            let Some(conn) = conns.get_mut(&fd) else { continue };
            if (evmask & (libc::EPOLLERR as u32 | libc::EPOLLHUP as u32)) != 0 {
                conn.closed = true;
            }
            // Readable: drain the socket into the input buffer.
            if (evmask & libc::EPOLLIN as u32) != 0 && !conn.closed {
                loop {
                    let nread = unsafe { libc::read(fd, tmp.as_mut_ptr() as *mut libc::c_void, tmp.len()) };
                    if nread > 0 {
                        conn.in_buf.extend_from_slice(&tmp[..nread as usize]);
                        if conn.in_buf.len() > 16 * 1024 * 1024 {
                            conn.closed = true;
                            break;
                        }
                    } else if nread == 0 {
                        conn.closed = true;
                        break;
                    } else {
                        let e = io::Error::last_os_error();
                        if e.kind() == io::ErrorKind::WouldBlock {
                            break;
                        }
                        conn.closed = true;
                        break;
                    }
                }
            }
            // TCP_QUICKACK is not sticky: the kernel clears it after sending
            // a quick ACK, so re-arm it per request to keep quick ACKs on
            // for the lockstep request/response bench.
            if !conn.closed {
                let one: libc::c_int = 1;
                unsafe {
                    libc::setsockopt(fd, libc::IPPROTO_TCP, libc::TCP_QUICKACK, &one as *const _ as *const libc::c_void, std::mem::size_of::<libc::c_int>() as libc::socklen_t);
                }
            }
            let closed = drive_conn(conn, store, &mut handler);
            if closed {
                unsafe {
                    libc::epoll_ctl(epfd, libc::EPOLL_CTL_DEL, fd, std::ptr::null_mut());
                    libc::close(fd);
                }
                conns.remove(&fd);
            } else {
                let want_out = conn.want_write;
                let mut cev = libc::epoll_event {
                    events: (libc::EPOLLIN as u32) | if want_out { libc::EPOLLOUT as u32 } else { 0 },
                    u64: fd as u64,
                };
                let _ = unsafe { libc::epoll_ctl(epfd, libc::EPOLL_CTL_MOD, fd, &mut cev) };
            }
        }
    }
}
