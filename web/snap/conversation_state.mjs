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
export function connectionLabel(c) {
  if (!c) return 'No agent connected · messages stay saved here.';
  if (!c.online) return `${c.provider ?? 'Agent'} disconnected · reconnect to continue.`;
  return `${c.provider} · ${c.phase === 'working' ? 'Working' : c.phase === 'needs_input' ? 'Waiting for you' : 'Connected'}`;
}
