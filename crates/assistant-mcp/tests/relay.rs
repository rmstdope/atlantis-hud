//! The relay as a client sees it: over HTTP, with a bearer token, answered by whoever the
//! dispatcher hands each call to.

use std::sync::Arc;
use std::time::Duration;

use atlantis_hud_assistant_mcp::{serve, CancellationToken, Relay, ToolAnswer, ToolCall};
use serde_json::{json, Value};
use tokio::sync::mpsc;

const TOKEN: &str = "test-token";

struct Server {
    url: String,
    relay: Arc<Relay>,
    calls: mpsc::UnboundedReceiver<ToolCall>,
    stop: CancellationToken,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

async fn a_server(timeout: Duration) -> Server {
    let (sender, calls) = mpsc::unbounded_channel();
    let relay = Relay::new(timeout, move |call| {
        let _ = sender.send(call);
    });
    relay
        .set_tools(&json!([
            {
                "name": "get_unit",
                "description": "One unit.",
                "inputSchema": { "type": "object", "properties": { "unitId": { "type": "string" } } }
            }
        ]))
        .expect("tools register");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a port");
    let url = format!("http://{}/mcp", listener.local_addr().expect("an address"));
    let stop = CancellationToken::new();
    tokio::spawn(serve(
        relay.clone(),
        listener,
        TOKEN.to_string(),
        stop.clone(),
    ));
    Server {
        url,
        relay,
        calls,
        stop,
    }
}

async fn post(url: &str, token: Option<&str>, body: Value) -> reqwest::Response {
    let mut request = reqwest::Client::new()
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .body(body.to_string());
    if let Some(token) = token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    request.send().await.expect("the server answers")
}

async fn rpc(url: &str, method: &str, params: Value) -> Value {
    let response = post(
        url,
        Some(TOKEN),
        json!({ "jsonrpc": "2.0", "id": 7, "method": method, "params": params }),
    )
    .await;
    assert_eq!(response.status(), 200, "{method} is served");
    response.json().await.expect("a JSON-RPC answer")
}

#[tokio::test]
async fn refuses_a_request_without_the_token() {
    let server = a_server(Duration::from_secs(5)).await;

    let without = post(&server.url, None, json!({})).await;
    let wrong = post(&server.url, Some("guess"), json!({})).await;

    assert_eq!(without.status(), 401);
    assert_eq!(wrong.status(), 401);
}

#[tokio::test]
async fn lists_the_tools_the_frontend_registered() {
    let server = a_server(Duration::from_secs(5)).await;

    let answer = rpc(&server.url, "tools/list", json!({})).await;

    let tools = answer["result"]["tools"].as_array().expect("a tool list");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["name"], "get_unit");
    assert_eq!(tools[0]["description"], "One unit.");
}

#[tokio::test]
async fn hands_a_call_to_the_dispatcher_and_returns_its_answer() {
    let mut server = a_server(Duration::from_secs(5)).await;
    let url = server.url.clone();

    let pending = tokio::spawn(async move {
        rpc(
            &url,
            "tools/call",
            json!({ "name": "get_unit", "arguments": { "unitId": "123" } }),
        )
        .await
    });
    let call = server.calls.recv().await.expect("the call is dispatched");
    assert_eq!(call.name, "get_unit");
    assert_eq!(call.arguments, json!({ "unitId": "123" }));
    assert!(server.relay.answer(
        call.id,
        ToolAnswer {
            text: "Unit 123".to_string(),
            is_error: false
        }
    ));

    let answer = pending.await.expect("the request completes");
    assert_eq!(answer["result"]["content"][0]["text"], "Unit 123");
    assert_eq!(answer["result"]["isError"], false);
}

#[tokio::test]
async fn passes_a_tool_error_through_as_one() {
    let mut server = a_server(Duration::from_secs(5)).await;
    let url = server.url.clone();

    let pending = tokio::spawn(async move {
        rpc(
            &url,
            "tools/call",
            json!({ "name": "get_unit", "arguments": {} }),
        )
        .await
    });
    let call = server.calls.recv().await.expect("the call is dispatched");
    server.relay.answer(
        call.id,
        ToolAnswer {
            text: "no unit 9".to_string(),
            is_error: true,
        },
    );

    let answer = pending.await.expect("the request completes");
    assert_eq!(answer["result"]["content"][0]["text"], "no unit 9");
    assert_eq!(answer["result"]["isError"], true);
}

#[tokio::test]
async fn says_so_when_nobody_answers_in_time() {
    let server = a_server(Duration::from_millis(100)).await;

    let answer = rpc(
        &server.url,
        "tools/call",
        json!({ "name": "get_unit", "arguments": {} }),
    )
    .await;

    assert_eq!(answer["result"]["isError"], true);
    let text = answer["result"]["content"][0]["text"]
        .as_str()
        .expect("a message");
    assert!(text.contains("did not answer"), "{text}");
}

#[tokio::test]
async fn refuses_a_tool_nobody_registered_without_dispatching_it() {
    let mut server = a_server(Duration::from_secs(5)).await;

    let answer = rpc(
        &server.url,
        "tools/call",
        json!({ "name": "launch_missiles", "arguments": {} }),
    )
    .await;

    assert_eq!(answer["result"]["isError"], true);
    assert!(server.calls.try_recv().is_err(), "nothing was dispatched");
}

#[tokio::test]
async fn an_answer_for_no_pending_call_is_reported_as_unclaimed() {
    let server = a_server(Duration::from_secs(5)).await;

    assert!(!server.relay.answer(
        999,
        ToolAnswer {
            text: String::new(),
            is_error: false
        }
    ));
}
