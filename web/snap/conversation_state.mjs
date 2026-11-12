// SNAP-R17/R30/R70: project journal projection; no graph mutation or provider-specific behavior.
export function projectEvents(events) {
  const messages = new Map(), requests = new Map(), activities = new Map();
  for (const e of events) {
    const d = e.data;
    if (e.type === 'human.message') messages.set(e.id, { id: e.id, role: 'human', text: d.text, context: d.context, state: d.wake ? 'saved' : 'recorded' });
    else if (e.type === 'delivery') { const m = messages.get(d.message); if (m) Object.assign(m, d); }
    else if (e.type === 'agent.message' || e.type === 'agent.delta') {
      const old = messages.get(d.id), text = e.type === 'agent.delta' ? (old?.text ?? '') + d.text : d.text;
      messages.set(d.id, { ...old, ...d, text, role: 'agent' });
    } else if (e.type === 'agent.request') requests.set(d.id, d);
    else if (e.type === 'request.resolved') requests.delete(d.id);
    else if (e.type === 'human.response') { const r = requests.get(d.request); if (r) requests.set(d.request, { ...r, response: d.response }); }
    else if (e.type === 'agent.activity') activities.set(d.id, d);
  }
  return { messages: [...messages.values()], requests: [...requests.values()], activities: [...activities.values()] };
}
// SNAP-R279: the composer's footer says the newest human message's receipt state (sending, delivered, completed... from
// the journal's delivery events) and whether an agent is attached; it never shows a fixed waiting text
export const COMPOSE_HINT = 'Enter to send · Shift+Enter for a new line.';
// `sent` ({id, wake}): a send the journal acknowledged that the stream has not brought back yet
export function deliveryLine(messages, c, sent = null) {
  const list = messages ?? [], ahead = sent && !list.some((x) => x.id === sent.id) ? [{ id: sent.id, role: 'human', state: sent.wake === false ? 'recorded' : 'saved' }] : [];
  const m = [...list, ...ahead].reverse().find((x) => x.role === 'human');
  if (!m || m.state === 'recorded' || m.state === 'completed') return COMPOSE_HINT; // nothing pending (completed: the agent's turn ended)
  const away = !c ? 'no agent connected' : !c.online ? `${c.provider ?? 'agent'} disconnected` : null;
  if (m.state === 'saved') return away ? `Saved in conversation · ${away}, so not delivered yet.` : 'Saved in conversation · waiting for delivery to your agent.';
  if (m.state === 'sending') return 'Delivering to your agent…';
  if (m.state === 'delivered') return away ? `Delivered · ${away} before its turn finished.` : c.phase === 'needs_input' ? 'Delivered · agent waiting for you.' : c.phase === 'working' ? 'Delivered · agent working.' : 'Delivered · agent idle, no finished turn recorded yet.';
  const said = { uncertain: 'delivery uncertain · not resent', failed: 'delivery failed', interrupted: "interrupted before the agent's turn finished" }[m.state] ?? m.state;
  return `Your last message: ${String(m.error ?? said).replace(/[.\s]+$/, '')}.`;
}
export function connectionLabel(c) {
  if (!c) return 'No agent connected · messages stay saved here.';
  if (!c.online) return `${c.provider ?? 'Agent'} disconnected · reconnect to continue.`;
  return `${c.provider} · ${c.phase === 'working' ? 'Working' : c.phase === 'needs_input' ? 'Waiting for you' : 'Connected'}`;
}
