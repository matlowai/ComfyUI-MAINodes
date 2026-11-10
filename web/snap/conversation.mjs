// SNAP-R18/R30/R70: same-origin journal client. Agent transport remains in an external adapter.
import { api } from '../../../scripts/api.js';
import { projectEvents } from './conversation_state.mjs';
export { connectionLabel } from './conversation_state.mjs';
const projects = new Map(), prefix = '/mainodes/snap/conversations';
const entry = (project) => {
  if (!projects.has(project)) projects.set(project, { project, events: [], listeners: new Set(), connection: null, error: null });
  return projects.get(project);
};
const emit = (s) => { for (const fn of s.listeners) fn(); };
async function request(path, body, signal) {
  const response = await api.fetchApi(path, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal });
  if (!response.ok) { const text = await response.text(); throw Error(text); }
  return response;
}
async function ensure(project) {
  const s = entry(project);
  if (!s.ready) s.ready = request(prefix, { project }).then((r) => r.json()).then((body) => {
    s.id = body.id; s.events = body.events; s.connection = body.connection; s.error = null; emit(s); return s;
  }).catch((e) => { s.ready = null; s.error = e.message; emit(s); throw e; });
  return s.ready;
}
export function snapshot(project) {
  const s = entry(project);
  return { project, id: s.id, connection: s.connection, error: s.error, ...projectEvents(s.events) };
}
async function stream(s) {
  while (s.listeners.size) {
    s.abort = new AbortController();
    try {
      const after = s.events.at(-1)?.seq ?? 0;
      const response = await request(`${prefix}/${s.id}/stream?after=${after}`, undefined, s.abort.signal);
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      while (s.listeners.size) {
        const { value, done } = await reader.read();
        if (done) throw Error('Conversation stream disconnected');
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          if (!frame.startsWith('data: ')) continue;
          const body = JSON.parse(frame.slice(6));
          const last = s.events.at(-1)?.seq ?? 0;
          s.events.push(...body.events.filter((e) => e.seq > last)); s.connection = body.connection; s.error = null; emit(s);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') { s.error = e.message; emit(s); }
      if (s.listeners.size) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  s.streaming = false;
}
export function watch(project, fn) {
  const s = entry(project); s.listeners.add(fn);
  if (!s.streaming) {
    s.streaming = true;
    (async () => {
      while (s.listeners.size && !s.id) {
        try { await ensure(project); } catch { await new Promise((resolve) => setTimeout(resolve, 1000)); }
      }
      if (s.listeners.size) await stream(s); else s.streaming = false;
    })();
  }
  return () => { s.listeners.delete(fn); if (!s.listeners.size) s.abort?.abort(); };
}
export async function send(project, text, context, id, wake = true) {
  const s = await ensure(project);
  const event = await (await request(`${prefix}/${s.id}/send`, { project, text, context, id, wake })).json();
  return event;
}
export async function disconnect(project) { const s = await ensure(project); await request(`${prefix}/${s.id}/disconnect`, {}); }
export async function respond(project, requestId, response) { const s = await ensure(project); await request(`${prefix}/${s.id}/respond`, { request: requestId, response }); }
