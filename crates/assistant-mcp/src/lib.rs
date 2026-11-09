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
//! client: the window may be closed, or still opening a game.
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
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::session::never::NeverSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{ErrorData, RoleServer, ServerHandler};
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
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

/// The tools the frontend registered, and the calls waiting on it.
pub struct Relay {
    tools: RwLock<Vec<Tool>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<ToolAnswer>>>,
    next_id: AtomicU64,
    timeout: Duration,
    dispatch: Box<Dispatch>,
}

impl Relay {
    /// A relay with no tools yet, handing each call to `dispatch` and giving up on one that is not
    /// answered within `timeout`.
    pub fn new(
        timeout: Duration,
        dispatch: impl Fn(ToolCall) + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            tools: RwLock::new(Vec::new()),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            timeout,
            dispatch: Box::new(dispatch),
        })
    }

    /// Replaces the tool list with `tools`, an array of MCP tool definitions.
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

    async fn call(&self, name: String, arguments: serde_json::Value) -> ToolAnswer {
        if !self.knows(&name) {
            return ToolAnswer {
                text: format!("Atlantis HUD has no tool called \"{name}\"."),
                is_error: true,
            };
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id, sender);
        (self.dispatch)(ToolCall {
            id,
            name,
            arguments,
        });
        let answered = tokio::time::timeout(self.timeout, receiver).await;
        // Whatever happened, nothing is waiting under this id any more.
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&id);
        match answered {
            Ok(Ok(answer)) => answer,
            _ => ToolAnswer {
                text: "Atlantis HUD did not answer. Is its window open, with a game loaded?"
                    .to_string(),
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
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
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

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let arguments = serde_json::Value::Object(request.arguments.unwrap_or_default());
        let answer = self.0.call(request.name.into_owned(), arguments).await;
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
        .with_sse_keep_alive(None)
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
