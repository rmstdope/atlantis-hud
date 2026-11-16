//! An MCP server whose tools are answered somewhere else.
//!
//! The desktop shell hosts this so that an assistant such as Claude Code can read the open turn and
//! write orders into it. Every tool lives in the frontend, which is where the open game, the live
//! orders document and every input the order checks read are already put together: answering a
//! call here would mean putting all of that together a second time, in a second language, and
//! keeping the two in step. So this crate is a relay and knows nothing about Atlantis:
//!
//! - the frontend registers its tools ([`Relay::set_tools`]), each a name, a description and a JSON
//!   Schema for its arguments, exactly as MCP lists them;
//! - each call a client makes is handed to the dispatcher the shell supplied, as a [`ToolCall`]
//!   with an id, and waits;
//! - the frontend answers it by id ([`Relay::answer`]), and that answer is the call's result.
//!
//! A call nobody answers within the relay's timeout fails as a tool error rather than hanging the
//! client: the window may be closed, or still opening a game. A tool that waits on the player - a
//! send that needs the faction password typed in - is given longer ([`Relay::allow_longer`]).
//!
//! The frontend is told when a call it was handed ends unanswered - the client cancelled it or went
//! away, or the timeout passed - through the withdraw callback, so a prompt waiting on the player can
//! stop waiting too.
//!
//! A connected client is told when the tools may have changed, so a new tool is not invisible to
//! an assistant that listed them before. The relay advertises `listChanged` and serves
//! `subscriptions/listen` (MCP 2026-07-28): each open listen hears
//! `notifications/tools/list_changed` once as it opens - the client may be reconnecting to a HUD
//! restarted on a newer build, and nothing here knows what it listed last - and again every time
//! the frontend registers its tools ([`Relay::set_tools`]), as a reloaded window does.
//!
//! Served over Streamable HTTP on a loopback port, statelessly and as plain JSON responses. Every
//! request must carry `Authorization: Bearer <token>`: a loopback port is reachable by every
//! process on the machine, and the tools write the player's orders.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::Response;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, SubscriptionFilter,
    Tool,
};
use rmcp::service::{RequestContext, SubscriptionContext};
use rmcp::transport::streamable_http_server::session::never::NeverSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{ErrorData, RoleServer, ServerHandler};
use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, watch};
mod file;

pub use file::write_assistant_file;
pub use tokio_util::sync::CancellationToken;

/// One call a client made, as the frontend is handed it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    /// What the answer is filed under; unique for the life of the relay.
    pub id: u64,
    pub name: String,
    /// The call's arguments, an object; `{}` when the client sent none.
    pub arguments: serde_json::Value,
}

/// The frontend's answer to one call: text for the assistant to read, and whether it is a refusal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnswer {
    pub text: String,
    pub is_error: bool,
}

type Dispatch = dyn Fn(ToolCall) + Send + Sync;
type Withdraw = dyn Fn(u64) + Send + Sync;

/// The tools the frontend registered, and the calls waiting on it.
pub struct Relay {
    tools: RwLock<Vec<Tool>>,
    /// Counts registrations, so every open listen hears that the tools changed.
    changes: watch::Sender<u64>,
    pending: Mutex<HashMap<u64, oneshot::Sender<ToolAnswer>>>,
    next_id: AtomicU64,
    timeout: Duration,
    longer: Mutex<HashMap<String, Duration>>,
    dispatch: Box<Dispatch>,
    withdraw: Box<Withdraw>,
}

/// What a call that is not answered says.
const NOT_ANSWERED: &str = "Atlantis HUD did not answer. Is its window open, with a game loaded?";

/// Holds a dispatched call's place in `pending`, and withdraws it however the wait ends - unless an
/// answer took it first. A guard rather than code after the wait, because a client that goes away
/// drops the waiting future without running anything after its `.await`.
struct Waiting<'a> {
    relay: &'a Relay,
    id: u64,
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        let unanswered = self
            .relay
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.id);
        if unanswered.is_some() {
            (self.relay.withdraw)(self.id);
        }
    }
}

impl Relay {
    /// A relay with no tools yet, handing each call to `dispatch` and giving up on one that is not
    /// answered within `timeout`. `withdraw` is told the id of every dispatched call that ended
    /// without an answer.
    pub fn new(
        timeout: Duration,
        dispatch: impl Fn(ToolCall) + Send + Sync + 'static,
        withdraw: impl Fn(u64) + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            tools: RwLock::new(Vec::new()),
            changes: watch::Sender::new(0),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            timeout,
            longer: Mutex::new(HashMap::new()),
            dispatch: Box::new(dispatch),
            withdraw: Box::new(withdraw),
        })
    }

    /// Lets calls to `tool` wait `timeout` rather than the relay's own: a tool that waits on the
    /// player rather than on the frontend's arithmetic.
    pub fn allow_longer(&self, tool: &str, timeout: Duration) {
        self.longer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(tool.to_string(), timeout);
    }

    fn timeout_for(&self, tool: &str) -> Duration {
        self.longer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(tool)
            .copied()
            .unwrap_or(self.timeout)
    }

    /// Replaces the tool list with `tools`, an array of MCP tool definitions, and ends every call
    /// still waiting: tools are registered when a window starts, so one that registers again after
    /// a reload is not the window those calls were handed to. Every client listening for changes
    /// is told the tools changed.
    ///
    /// # Errors
    ///
    /// When `tools` is not an array of tool definitions; the list is then left as it was.
    pub fn set_tools(&self, tools: &serde_json::Value) -> Result<(), String> {
        let parsed: Vec<Tool> = serde_json::from_value(tools.clone())
            .map_err(|error| format!("tools could not be read: {error}"))?;
        *self
            .tools
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = parsed;
        self.changes.send_modify(|count| *count += 1);
        let stranded: Vec<(u64, oneshot::Sender<ToolAnswer>)> = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain()
            .collect();
        for (id, sender) in stranded {
            let _ = sender.send(ToolAnswer {
                text: NOT_ANSWERED.to_string(),
                is_error: true,
            });
            (self.withdraw)(id);
        }
        Ok(())
    }

    /// Answers the call filed under `id`. `false` when no call is waiting under it - already
    /// answered, timed out, or never made.
    pub fn answer(&self, id: u64, answer: ToolAnswer) -> bool {
        let waiting = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&id);
        waiting.is_some_and(|sender| sender.send(answer).is_ok())
    }

    fn tools(&self) -> Vec<Tool> {
        self.tools
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn knows(&self, name: &str) -> bool {
        self.tools
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .any(|tool| tool.name == name)
    }

    async fn call(
        &self,
        name: String,
        arguments: serde_json::Value,
        cancelled: CancellationToken,
    ) -> ToolAnswer {
        if !self.knows(&name) {
            return ToolAnswer {
                text: format!("Atlantis HUD has no tool called \"{name}\"."),
                is_error: true,
            };
        }
        let timeout = self.timeout_for(&name);
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id, sender);
        let _waiting = Waiting { relay: self, id };
        (self.dispatch)(ToolCall {
            id,
            name,
            arguments,
        });
        tokio::select! {
            answered = tokio::time::timeout(timeout, receiver) => match answered {
                Ok(Ok(answer)) => answer,
                _ => ToolAnswer {
                    text: NOT_ANSWERED.to_string(),
                    is_error: true,
                },
            },
            () = cancelled.cancelled() => ToolAnswer {
                text: "The call was cancelled.".to_string(),
                is_error: true,
            },
        }
    }
}

/// What the relay says about itself to a client that connects.
const INSTRUCTIONS: &str = "Atlantis HUD: the player's open game of Atlantis, a play-by-email \
strategy game. The tools read the turn on screen - the report, the faction's units and regions, \
the orders document - and write orders into it. Every write lands in the player's editor at once \
and is checked by the HUD's own order validator.";

#[derive(Clone)]
struct Handler(Arc<Relay>);

impl ServerHandler for Handler {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_tool_list_changed()
                .build(),
        )
            .with_server_info(Implementation::new(
                "atlantis-hud",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(INSTRUCTIONS)
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(self.0.tools()))
    }

    fn accepted_subscription_filter(
        &self,
        _requested: &SubscriptionFilter,
    ) -> Option<SubscriptionFilter> {
        Some(SubscriptionFilter::builder().tools_list_changed().build())
    }

    async fn listen(&self, context: SubscriptionContext) -> Result<(), ErrorData> {
        let mut changes = self.0.changes.subscribe();
        if context.sink().notify_tool_list_changed().await.is_err() {
            return Ok(());
        }
        loop {
            tokio::select! {
                () = context.cancelled() => return Ok(()),
                changed = changes.changed() => {
                    if changed.is_err() || context.sink().notify_tool_list_changed().await.is_err() {
                        return Ok(());
                    }
                }
            }
        }
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let arguments = serde_json::Value::Object(request.arguments.unwrap_or_default());
        let answer = self
            .0
            .call(request.name.into_owned(), arguments, context.ct)
            .await;
        let content = vec![ContentBlock::text(answer.text)];
        Ok(if answer.is_error {
            CallToolResult::error(content)
        } else {
            CallToolResult::success(content)
        }
        .into())
    }
}

async fn require_token(
    State(expected): State<Arc<String>>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let presented = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    if presented == Some(expected.as_str()) {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

/// Serves `relay` at `/mcp` on `listener` until `stop` is cancelled.
///
/// # Errors
///
/// When the listener fails.
pub async fn serve(
    relay: Arc<Relay>,
    listener: tokio::net::TcpListener,
    token: String,
    stop: CancellationToken,
) -> std::io::Result<()> {
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_sse_keep_alive(Some(Duration::from_secs(15)))
        .with_cancellation_token(stop.child_token());
    let service: StreamableHttpService<Handler, NeverSessionManager> =
        StreamableHttpService::new(move || Ok(Handler(relay.clone())), Arc::default(), config);
    let router =
        axum::Router::new()
            .nest_service("/mcp", service)
            .layer(middleware::from_fn_with_state(
                Arc::new(token),
                require_token,
            ));
    axum::serve(listener, router)
        .with_graceful_shutdown(async move { stop.cancelled_owned().await })
        .await
}
