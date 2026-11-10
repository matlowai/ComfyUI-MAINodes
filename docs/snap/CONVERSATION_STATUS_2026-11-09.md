# Connected conversation: current state and next work

## Current arc

Snap is becoming a shared human–agent workspace: project, conversation, decisions and results in one place. The first local Codex pilot works. This research branch is available for source review; it is not production qualification or a completed universal-agent integration.

Three responsibilities stay separate:

| Owner | Responsibility |
|---|---|
| Conversation/session service and external adapters | Normal chat, streamed replies, runtime questions, delivery/recovery and session binding |
| Existing Snap MCP/WebMCP tool table | Creative project inspection/actions, proposals, Work and native graph operations |
| Persistent project records and explicit handoffs | Decisions, annotations, artifacts, preferences and continuity across sessions/providers |

Conversation uses an account-scoped backend event journal, independent of graph undo and browser lifetime. Director notes remain native annotations; the new chat does not replace `get_notes` / `answer_note`. The Room shows legacy Project notes separately. No new creative tool registry, model runtime or model-download path was introduced.

## What is measured

| Behavior | Evidence / qualification |
|---|---|
| Existing-session attachment | Local adapter attached the already active Codex thread; no new thread or model/policy/context override |
| Active Send | A labelled Room message reached the active turn and its acknowledgement streamed back |
| Idle Send | A subsequent human “hi there” created the next turn in the same session; sending → delivered → completed receipts and the actual final reply were retained; one human-message record |
| Unsolicited agent output | Agent commentary entered the journal without requiring another human note or an MCP reply call |
| Browser refresh and adapter restart | Same conversation and prior reply recovered without repeating the human send; project recipe and director notes remained unchanged |
| Delivery and project boundaries | Six projection cases, six actual-handler draft cases, eleven CPU journal/adapter cases and three isolated actual HTTP/SSE/approval-route cases pass; existing six dial-card regressions also passed |
| Permissions | Command/file/question mappings and epoch-bound response routes exist; native runtime-origin requests and pending-approval recovery still need live qualification |

Source and tests: [adapter/service guide](CONVERSATION_ADAPTERS.md), [journal routes](../../snap_conversations.py), [Codex adapter](../../tools/snap_chat.py), [Room](../../web/snap/room.js), [CPU adapter tests](../../tests/snap/test_chat_adapter.py), [HTTP/SSE tests](../../tests/snap/test_conversation_service.py). Complete private session logs, live receipts and screenshots are retained locally; they are not published with the source.

## Remaining dependency DAG

Planning does not authorize experiments, installs or private-fixture jobs. Each row is a separately reviewable slice; serialize changes to shared owners. The local project handoff retains operational identities and evidence paths.

| Node / priority | Inputs and owned outputs | Blocked by | Status | Acceptance gate |
|---|---|---|---|---|
| R0 / P0 | Existing pilot, guide, lessons and this status index; scoped source review/branch commit | — | local pilot evidenced; research-branch publication authorized | Source, tests, decisions and explicit limits recoverable from the branch; no private journals/media/credentials included |
| R1 / P0 | Runtime request adapter, service response routes and Room request controls | R0 | pending live qualification | Real questions and command/file permissions answered in Snap; pending request survives or is honestly reconciled after refresh/reconnect; external resolution and stale/duplicate answers handled; no policy weakening or creative-approval bypass |
| R2 / P0 | Service journal/leases, adapter delivery/replay, client stream | R0 | targeted cases pass; broader work pending | Disconnect/process death at delivery boundaries; rapid sends and actual immediate project switching; no lost/duplicate accepted action; partial-response recovery; explicit corrupt-tail behavior; durable backup/recovery; multiple server writers either excluded or serialized; bounded UI cost without silent history truncation |
| R3 / P0 | Existing connection owner and Room controls | R1, R2 | pending | Choose/attach/resume/reconnect a known session from the UI, visible capabilities/mode, startup lifecycle, and a separate intentional Stop action; Disconnect must not imply cancellation; no simultaneous controllers inside the supported boundary |
| R4 / P1 | Provider-neutral service/Room; one ACP client adapter | R1, R2 | planned | Negotiate real provider capabilities and exercise another supported agent without changing the Room or creative-tool registry; distinguish saved-session loading from live CLI attachment |
| R5 / P1 | Existing director notes, instructions, decisions and journal reference/context fields | R0 | planned | Explicitly turn selected conversation content into a pinned project note/decision with origin and links; show relevant note/artifact context; preserve human/agent attribution; never silently promote chat into instructions |
| R6 / P1 | Project records, conversation journal, capabilities and reviewed summaries | R4, R5 | planned | Explicit cross-agent handoff names evidence, outstanding choices, constraints and destination; verify what the next agent received; do not claim hidden context transferred |
| R7 / P2 | Existing take/frame/mask/shot owners plus contextual chat references | R2, R5 | planned | Attach the exact selected artifact/region and provenance; editable voice input/output only as separately scoped work, with cancellation and no duplicate action |
| R8 / release gate | All selected changes and configured dedicated test servers/fixtures | R1, R2, R3 | pending | Full Snap integration, actual cross-project navigation, keyboard/accessibility, classic/Vue parity and concurrency checks; never use a personal instance as a destructive fixture |

Recommended next implementation slice: **R1, real agent questions/permissions and their recovery**. Basic conversation now works; questions that force the person back to a terminal are the next direct break in the paired workflow. R2 findings should be fixed at their current owners as they are reproduced. ACP follows the proven text/permission flow.

## Notes, continuity and scope

Ordinary chat, director annotations and active agent instructions have different meanings. Conversation history is already durable. Pinned-note/decision promotion and cross-agent summary construction are future UI work, not an automatic memory or learning feature. [Session lessons](research/2026-11-08/SESSION_LESSONS.md) records the architectural corrections and validation distinctions.

Controller leases currently cover one Snap service/account. Another native CLI can still issue runtime commands outside that boundary. The adapter is a session-local external process; a provider/session picker and installed startup management are unfinished. Unsupported native request types visibly require the provider interface. Multiple processes writing the same journal directory, long sessions and every native approval path are unqualified. The full dedicated gate remains pending.

The wider paired-Snap backlog remains: prior-run recipe rehydration, native preservation of both raw and final stages with genuine cache-only recovery, copied-shot fallback, Room keyboard/attribution, readable Director controls, selected-board provenance and accurate disabled-Upscale diagnostics. See the [paired workspace status](PAIRED_WORKSPACE_STATUS_2026-11-09.md) and [post-Director plan](director/post-director-2026-11-08/IMPLEMENTATION_PLAN.md). Sprite support is finished; no new creative trial is implied by this backlog.
