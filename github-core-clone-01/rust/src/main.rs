// forge-server — static Rust git forge (spike). Entry: main.ts spawns this
// binary; it binds an ephemeral port, prints it, and serves until killed.
// Determinism: no clock, no randomness; fixed timestamps and counters only.

mod git;
mod graphql;
mod handlers;
mod http;
mod mcp;
mod store;

use http::Response;
use std::io::Write;
use std::net::TcpListener;
use store::Store;

fn handle(store: &mut Store, req: &http::Request) -> Response {
    // Top-level safety net (app.ts createApp): a handler panic becomes a
    // 500 {"message": ...} instead of killing the process.
    let mut resp = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handlers::handle_request(store, req)))
        .unwrap_or_else(|_| {
            let body = serde_json::to_vec(&serde_json::json!({ "message": "Internal error" })).unwrap_or_default();
            Response::json(500, body, store.req_id())
        });
    // Node strips response bodies for HEAD requests; headers stay as for GET.
    if req.method == "HEAD" {
        resp.omit_body = true;
    }
    resp
}

fn main() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    println!("[forge] port={}", port);
    let _ = std::io::stdout().flush();
    let mut store = Store::new();
    if let Err(e) = http::run_server(listener, &mut store, handle) {
        eprintln!("[forge] server error: {}", e);
        std::process::exit(1);
    }
}
