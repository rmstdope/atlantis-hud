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
    withdrawn: mpsc::UnboundedReceiver<u64>,
    stop: CancellationToken,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

async fn a_server(timeout: Duration) -> Server {
    let (sender, calls) = mpsc::unbounded_channel();
    let (withdraw, withdrawn) = mpsc::unbounded_channel();
    let relay = Relay::new(
        timeout,
        move |call| {
            let _ = sender.send(call);
        },
        move |id| {
            let _ = withdraw.send(id);
        },
    );
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
        withdrawn,
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

/// A tool call made on a client that gives up after `patience`, as an assistant that stops waiting
/// or disconnects does.
async fn abandoned_call(url: &str, patience: Duration) {
    let outcome = reqwest::Client::new()
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("Authorization", format!("Bearer {TOKEN}"))
        .timeout(patience)
        .body(
            json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call",
                    "params": { "name": "get_unit", "arguments": {} } })
            .to_string(),
        )
        .send()
        .await;
    assert!(outcome.is_err(), "the client gave up before an answer");
}

async fn next_withdrawn(server: &mut Server) -> u64 {
    tokio::time::timeout(Duration::from_secs(5), server.withdrawn.recv())
        .await
        .expect("a withdrawal within five seconds")
        .expect("the relay is still there")
}

#[tokio::test]
async fn a_call_the_client_abandons_is_withdrawn() {
    let mut server = a_server(Duration::from_secs(30)).await;

    abandoned_call(&server.url, Duration::from_millis(300)).await;
    let call = server.calls.recv().await.expect("the call was dispatched");

    assert_eq!(next_withdrawn(&mut server).await, call.id);
    assert!(
        !server.relay.answer(
            call.id,
            ToolAnswer {
                text: "too late".to_string(),
                is_error: false
            }
        ),
        "nothing waits for an answer any more"
    );
}

#[tokio::test]
async fn a_call_that_times_out_is_withdrawn() {
    let mut server = a_server(Duration::from_millis(100)).await;

    rpc(
        &server.url,
        "tools/call",
        json!({ "name": "get_unit", "arguments": {} }),
    )
    .await;
    let call = server.calls.recv().await.expect("the call was dispatched");

    assert_eq!(next_withdrawn(&mut server).await, call.id);
}

#[tokio::test]
async fn an_answered_call_is_never_withdrawn() {
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
            text: "Unit".to_string(),
            is_error: false,
        },
    );
    pending.await.expect("the request completes");

    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        server.withdrawn.try_recv().is_err(),
        "nothing was withdrawn"
    );
}

#[tokio::test]
async fn a_tool_allowed_longer_outlives_the_default_timeout() {
    let mut server = a_server(Duration::from_millis(100)).await;
    server
        .relay
        .allow_longer("get_unit", Duration::from_secs(10));
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
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(server.relay.answer(
        call.id,
        ToolAnswer {
            text: "Sent".to_string(),
            is_error: false
        }
    ));

    let answer = pending.await.expect("the request completes");
    assert_eq!(answer["result"]["content"][0]["text"], "Sent");
}

#[tokio::test]
async fn a_tool_allowed_forever_waits_and_is_answered() {
    // A fetch waits on the player with no time limit at all (ah-9vmbx.3): the largest duration
    // there is must neither overflow the deadline nor end the call.
    let mut server = a_server(Duration::from_millis(100)).await;
    server.relay.allow_longer("get_unit", Duration::MAX);
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
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(server.relay.answer(
        call.id,
        ToolAnswer {
            text: "Fetched".to_string(),
            is_error: false
        }
    ));

    let answer = pending.await.expect("the request completes");
    assert_eq!(answer["result"]["content"][0]["text"], "Fetched");
}

#[tokio::test]
async fn registering_tools_again_ends_calls_still_waiting() {
    let mut server = a_server(Duration::from_secs(30)).await;
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
    // A reloaded window registers its tools afresh; the one that took the call is gone.
    server.relay.set_tools(&json!([])).expect("tools register");

    let answer = tokio::time::timeout(Duration::from_secs(5), pending)
        .await
        .expect("the call ends at once")
        .expect("the request completes");
    assert_eq!(answer["result"]["isError"], true);
    assert_eq!(next_withdrawn(&mut server).await, call.id);
}

#[tokio::test]
async fn advertises_that_its_tool_list_can_change() {
    let server = a_server(Duration::from_secs(5)).await;

    let answer = rpc(
        &server.url,
        "initialize",
        json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": { "name": "test", "version": "1" }
        }),
    )
    .await;

    assert_eq!(
        answer["result"]["capabilities"]["tools"]["listChanged"], true,
        "{answer}"
    );
}

/// An open `subscriptions/listen` request, as a 2026-07-28 client opens one to hear about changes:
/// the server answers with an event stream that stays open.
struct Listening {
    response: reqwest::Response,
    seen: String,
}

const LIST_CHANGED: &str = "notifications/tools/list_changed";

async fn listen(url: &str, token: Option<&str>) -> reqwest::Response {
    let mut request = reqwest::Client::new()
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", "2026-07-28")
        .header("Mcp-Method", "subscriptions/listen")
        .body(
            json!({
                "jsonrpc": "2.0",
                "id": 11,
                "method": "subscriptions/listen",
                "params": {
                    "notifications": { "toolsListChanged": true },
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientCapabilities": {},
                        "io.modelcontextprotocol/clientInfo": { "name": "test", "version": "1" }
                    }
                }
            })
            .to_string(),
        );
    if let Some(token) = token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    request.send().await.expect("the server answers")
}

impl Listening {
    async fn open(url: &str) -> Self {
        let response = listen(url, Some(TOKEN)).await;
        if response.status() != 200 {
            panic!(
                "the listen is served: {}",
                response.text().await.unwrap_or_default()
            );
        }
        Self {
            response,
            seen: String::new(),
        }
    }

    /// Reads the stream until `count` tool-list changes have arrived on it in all, or fails after
    /// five seconds.
    async fn until_changes(&mut self, count: usize) {
        let read = async {
            while self.seen.matches(LIST_CHANGED).count() < count {
                let chunk = self
                    .response
                    .chunk()
                    .await
                    .expect("the stream reads")
                    .expect("the stream stays open");
                self.seen.push_str(&String::from_utf8_lossy(&chunk));
            }
        };
        tokio::time::timeout(Duration::from_secs(5), read)
            .await
            .unwrap_or_else(|_| panic!("{count} change(s) within five seconds; saw {}", self.seen));
    }

    /// Reads whatever arrives within `quiet`, and says how many tool-list changes the stream has
    /// carried in all.
    async fn changes_after(&mut self, quiet: Duration) -> usize {
        while let Ok(Ok(Some(chunk))) = tokio::time::timeout(quiet, self.response.chunk()).await {
            self.seen.push_str(&String::from_utf8_lossy(&chunk));
        }
        self.seen.matches(LIST_CHANGED).count()
    }
}

#[tokio::test]
async fn listening_needs_the_token() {
    let server = a_server(Duration::from_secs(5)).await;

    assert_eq!(listen(&server.url, None).await.status(), 401);
    assert_eq!(listen(&server.url, Some("guess")).await.status(), 401);
}

#[tokio::test]
async fn a_client_that_starts_listening_is_told_to_refresh_at_once() {
    // A client reconnecting to a HUD restarted on a newer build cannot know its tools changed, and
    // the new process cannot know what the client last listed: so every listen opens with a change.
    let server = a_server(Duration::from_secs(5)).await;

    let mut listening = Listening::open(&server.url).await;

    listening.until_changes(1).await;
    assert_eq!(listening.changes_after(Duration::from_millis(300)).await, 1);
}

#[tokio::test]
async fn registering_tools_again_tells_every_listening_client() {
    let server = a_server(Duration::from_secs(5)).await;
    let mut first = Listening::open(&server.url).await;
    let mut second = Listening::open(&server.url).await;
    first.until_changes(1).await;
    second.until_changes(1).await;

    // A reloaded window registers its tools afresh, a new one among them.
    server
        .relay
        .set_tools(&json!([
            { "name": "get_unit", "description": "One unit.", "inputSchema": { "type": "object" } },
            { "name": "fetch_report", "description": "This turn's report.", "inputSchema": { "type": "object" } }
        ]))
        .expect("tools register");

    first.until_changes(2).await;
    second.until_changes(2).await;
    let answer = rpc(&server.url, "tools/list", json!({})).await;
    let names: Vec<&str> = answer["result"]["tools"]
        .as_array()
        .expect("a tool list")
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert_eq!(names, ["get_unit", "fetch_report"]);
}
