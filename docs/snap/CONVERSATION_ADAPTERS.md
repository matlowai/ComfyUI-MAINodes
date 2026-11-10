# Connected conversations

[Current pilot evidence and prioritized dependency DAG](CONVERSATION_STATUS_2026-11-09.md).

Conversation in the Room is a durable project journal, separate from graph undo and director notes. The browser subscribes to a local event stream. An optional external adapter connects an agent session and journals its text, delivery receipts, activity and questions. ComfyUI does not call a model, handle model credentials or launch an inference runtime.

The existing MCP/WebMCP tool table remains the creative-action channel. Runtime execution approval and Snap creative-action approval stay distinct. Connecting a conversation grants neither new render permission nor tool-policy exceptions.

## First adapter: existing Codex session

Use Python with `websockets` 15 or newer, an existing Codex app-server control socket, and a known existing thread. Open Conversation in Snap, then attach using its project id:

```sh
python tools/snap_chat.py --base http://127.0.0.1:8188 \
  --project <Snap-project-id> --thread <existing-Codex-thread-id> \
  --state <project-scratch>/snap-conversation.json
```

`--socket` selects a nondefault local control socket. `SNAP_TOKEN` and `SNAP_USER` use the existing account boundary. Keep the adapter running; the CLI window can be hidden for ordinary conversation. No new thread, model override, context-setting change or approval-policy override is sent. A currently active thread is marked live; continuation of an idle thread is marked resume. This distinction does not establish hot-attachment support for another provider.

Send while idle uses `turn/start`. Send while working uses `turn/steer` with its expected active turn id. A stale-turn rejection is reported rather than silently reinterpreted. Stable journal ids make a repeated browser send idempotent. Delivery intent is persisted before invoking the agent; uncertain acceptance after disconnect is recorded and never blindly resent. Recovery uses accepted turn identities and full agent-message snapshots, including older pending turns.

Agent deltas and completed messages enter the journal directly, including unsolicited messages. Neither the browser nor an MCP `answer_note` call is required for each reply. Refreshing the browser replays journal events; switching workflows shows the other project's journal while accepted work and replies remain bound to the original conversation. Graph undo never changes that journal. Existing director notes remain available separately under Project notes.

One controller lease per provider session is enforced within this Snap service/account. Disconnect invalidates its transport token; it does not cancel already accepted agent work. An unrelated native CLI client can still send to its runtime. Avoid using both interfaces to control a turn concurrently; Snap does not claim to prevent actions taken outside its lease system. Runtime-resolved approval notifications reconcile answers made elsewhere.

Commands offer Allow once or Decline. File approvals offer approval only when actual changes are available. Structured user questions can be answered in Snap. Unsupported request kinds remain visible and require the runtime's own interface. Responses are tied to their live controller epoch; stale requests cannot grant permission after reconnect. Outstanding approval replay across a native runtime reconnect still requires live qualification. Synthetic HTTP and adapter tests are not evidence that every native permission path works.

## Storage and local service

Each ComfyUI account stores `snap_conversations/<conversation-id>.jsonl` in its existing user-data directory. The first event binds the conversation to its project; messages, context references, delivery state, agent output and responses have stable ids and increasing sequence numbers. Appends flush and fsync before acknowledgement. Keep these journals with project continuity/backups; workflow files alone do not back them up. A malformed journal fails visibly rather than being silently truncated.

The same-origin `/mainodes/snap/conversations` routes provide project journal selection, send, event replay/SSE, attachment binding, heartbeat/publication, response and disconnect. They inherit ComfyUI's account boundary. Adapter lease tokens are kept server-side and in the adapter process, never exposed to the Room. Heartbeats are transient; after a server restart the binding remains historical/offline until an adapter reattaches. Native graph/tool execution still requires a visible, eligible Snap page; durable chat does not remove that requirement.

## Provider boundary and next adapter

The Room renders normalized journal events, not provider API messages. An adapter declares provider/session identity, attachment mode (`live`, `resume`, `handoff`) and supported capabilities. The Codex adapter maps app-server text, activity, user-input and approval events at that boundary. Claude Code and ChatGPT/MCP adapters are not included yet, and no provider/session picker is claimed complete.

Prioritize an ACP client adapter next, rather than another Room implementation. ACP defines initialization/capability negotiation, optional session loading, prompt/update streams and permission requests; it is separate from Snap's MCP/WebMCP creative tools. Support must be negotiated: ACP session loading is not proof of live attachment to an existing CLI. Handoff to another agent requires an explicit summary and shared project evidence; it does not transfer hidden model context.

Primary protocol references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [ACP overview](https://agentclientprotocol.com/protocol/v1/overview). The installed Codex schema remains the authority for its adapter mapping.

The full dedicated Snap integration gate, accessibility/renderer parity, native approval/reconnect coverage and other-provider adapters remain separate qualification work. Do not run destructive fixture suites against a person's production instance.
