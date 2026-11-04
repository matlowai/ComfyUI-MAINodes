// Set snapshots (LIBRARY.md): the set's state as data is the authority; the top-down plan, the side elevation and the
// set block text are compiled from it exactly, so a later shot starts from how this one ended. Units are metres; the
// plan's +y is north, angles are degrees clockwise from north. Diagrams carry marks, never people pictures.
// SNAP-R22 doors and windows are said from the shot's camera · see docs/SNAP_RULES.md

const W = 1024, H = 768;
const rad = (deg) => (deg * Math.PI) / 180;
const dir = (deg) => [Math.sin(rad(deg)), Math.cos(rad(deg))];
const halfView = (cam) => Math.atan(36 / (2 * cam.lens));
// a point's bearing in the camera's frame, in radians: negative is left of centre, beyond 90 degrees behind the camera
function bearing(cam, at) {
  const [fx, fy] = dir(cam.facing), dx = at[0] - cam.at[0], dy = at[1] - cam.at[1];
  return Math.atan2(dx * fy - dy * fx, dx * fx + dy * fy);
}
const sentence = (text) => text[0].toUpperCase() + text.slice(1);
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// the wall an opening is in: the one its middle lies on (openings are drawn on the room's outline)
const middle = (o) => [(o.from[0] + o.to[0]) / 2, (o.from[1] + o.to[1]) / 2];
export function wallOf(s, o) {
  const [hw, hd] = s.room.size.map((v) => v / 2), [x, y] = middle(o);
  const off = { north: Math.abs(y - hd), east: Math.abs(x - hw), south: Math.abs(y + hd), west: Math.abs(x + hw) };
  return Object.keys(off).reduce((a, b) => (off[b] < off[a] ? b : a));
}

// each door and window as this camera sees it (U21/U48: H3 put the window on the wrong wall when the text didn't say):
// where it sits in the frame (from the part of it in view), or which way it is out of view
export function openings(s) {
  const cam = s.camera, half = halfView(cam);
  return s.room.openings.map((o) => {
    const seen = [o.from, middle(o), o.to].map((p) => bearing(cam, p)).filter((a) => Math.abs(a) <= half);
    const a = seen.length ? seen.reduce((x, y) => x + y) / seen.length : bearing(cam, middle(o)), k = a / half, side = a < 0 ? "left" : "right";
    const where = !seen.length ? `${Math.abs(a) > (3 * Math.PI) / 4 ? "behind the camera" : `to the camera's ${side}`}, out of view`
      : Math.abs(k) <= 0.15 ? "in the centre" : Math.abs(k) > 0.5 ? `on the ${side}` : `${side} of centre`;
    return `the ${o.name || o.kind} in the ${wallOf(s, o)} wall is ${where}`;
  });
}

// objects in the camera's view, left to right, and the set block that pins them ("exactly these N and nothing else"),
// then where each door and window is from this camera
export function setBlock(s) {
  const cam = s.camera, half = halfView(cam);
  const seen = s.props.map((p) => ({ ...p, angle: bearing(cam, p.at) }))
    .filter((p) => Math.abs(p.angle) <= half).sort((a, b) => a.angle - b.angle); // image left to right is by viewing angle
  const names = seen.map((p) => (p.state ? `${p.name} (${p.state})` : p.name));
  const light = sentence(s.light.description), doors = openings(s);
  const walls = doors.length ? ` ${sentence(doors.join("; "))}.` : "";
  if (!names.length) return `Set: ${s.name}. ${light}. Bare walls only: no furniture or props in view.${walls}`;
  const these = names.length === 1 ? "this one object" : `these ${names.length} objects`;
  return `Set: ${s.name}. ${light}. Exactly ${these} and nothing else, left to right: ${names.join(", ")}.${walls}`;
}

// where the camera stands and looks, in words: a corner, by a wall or the middle of the room, and the compass direction
export function cameraAt(s) {
  const cam = s.camera, [hw, hd] = s.room.size.map((v) => v / 2);
  const ns = cam.at[1] > hd / 2 ? "north" : cam.at[1] < -hd / 2 ? "south" : "", ew = cam.at[0] > hw / 2 ? "east" : cam.at[0] < -hw / 2 ? "west" : "";
  const where = ns && ew ? `in the ${ns}-${ew} corner` : ns || ew ? `by the ${ns || ew} wall` : "in the middle of the room";
  return `${Math.abs((cam.height ?? 1.5) - 1.5) < 0.3 ? "at eye height" : `${cam.height} m up`} ${where}, looking ${compass(cam.facing)}`;
}

// what a picture of the set must keep: its walls and floor, each kind of opening, and every prop
export function keeps(s) {
  const list = ["walls", "floor", ...new Set(s.room.openings.map((o) => o.name || o.kind)), ...s.props.map((p) => p.name)];
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

// the set seen from another camera (a coverage setup, or the camera a plate was made for)
export const atCamera = (s, cam) => ({ ...s, camera: { ...s.camera, at: cam.at, facing: cam.facing, lens: cam.lens, height: cam.height ?? s.camera.height, setup: cam.setup ?? cam.name } });
// a camera's plate stays its plate while the camera hasn't moved since (10 cm, 10 degrees, the same lens)
export const sameCamera = (a, b) => !!a && !!b && Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) <= 0.1 && Math.abs((((a.facing - b.facing) % 360) + 540) % 360 - 180) <= 10 && a.lens === b.lens;

// one sentence per actor: where they stand (by the nearest named thing), which way they face, what their hands hold
export function blocking(s) {
  const things = [...s.props.map((p) => [p.name, p.at]), ...s.room.openings.map((o) => [`the ${o.kind}`, [(o.from[0] + o.to[0]) / 2, (o.from[1] + o.to[1]) / 2]])];
  return s.actors.map((a) => {
    const near = things.length && things.reduce((best, t) => (Math.hypot(t[1][0] - a.at[0], t[1][1] - a.at[1]) < Math.hypot(best[1][0] - a.at[0], best[1][1] - a.at[1]) ? t : best))[0];
    const where = near ? ` by ${near.replace(/^(?!the )/, "the ")}` : "";
    return `${a.name} stands${where}, facing ${compass(a.facing)}${a.hands ? `, ${a.hands}` : ""}.`;
  }).join(" ");
}

function canvas(c = document.createElement("canvas")) {
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, W, H);
  g.lineCap = "round"; g.lineJoin = "round";
  g.font = "18px system-ui, sans-serif";
  return [c, g];
}

function label(g, text, x, y, colour = "#222") {
  g.fillStyle = colour; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, x, y);
}

// metres <-> plan pixels; the editor uses the inverse to hit-test what is under the pointer
export function planFrame(s) {
  const [rw, rd] = s.room.size, k = Math.min((W - 160) / rw, (H - 160) / rd);
  const X = (x) => 80 + (x + rw / 2) * k, Y = (y) => H - 80 - (y + rd / 2) * k;
  return { k, X, Y, world: (px, py) => [(px - 80) / k - rw / 2, (H - 80 - py) / k - rd / 2] };
}

// which side of the line between the two actors a camera stands on (+1 / -1); 0 on the line (within 5 cm: a neutral
// shot) or when there is no pair
export function side(s, at = s.camera.at) {
  if (s.actors.length !== 2) return 0;
  const [a, b] = s.actors.map((x) => x.at);
  const d = ((b[0] - a[0]) * (at[1] - a[1]) - (b[1] - a[1]) * (at[0] - a[0])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
  return Math.abs(d) < 0.05 ? 0 : Math.sign(d);
}

// the shot between its In state (end of the last shot) and its Out state, at t in [0, 1]: actors (paired by name) and
// the camera move in straight lines and turn the short way round
export function between(a, b, t) {
  const mix = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const turnTo = (f, g) => (f + ((((g - f) % 360) + 540) % 360 - 180) * t + 360) % 360;
  const actors = b.actors.map((x) => { const y = a.actors.find((z) => z.name === x.name); return y ? { ...x, at: mix(y.at, x.at), facing: turnTo(y.facing, x.facing) } : x; });
  return { ...b, actors, camera: { ...b.camera, at: mix(a.camera.at, b.camera.at), facing: turnTo(a.camera.facing, b.camera.facing) } };
}

// the camera's side of the line through the shot, in `steps` samples, and where it changes (shown on screen, so legal)
export function sideTrack(a, b, steps = 48) {
  const track = Array.from({ length: steps + 1 }, (_, i) => side(between(a, b, i / steps)));
  const flips = [];
  let last = -1; // the previous sample off the line; samples on it (0) don't hide a change of side
  track.forEach((v, i) => {
    if (!v) return;
    if (last >= 0 && v !== track[last]) flips.push((last + i) / 2 / steps);
    last = i;
  });
  return { track, flips };
}

// standard coverage for a two-hander, all on one side of the line so cuts between them keep screen direction: the side
// of the shot this one continues from (else the current camera's). A master wide, an over-the-shoulder and a clean
// single on each actor; positions stay inside the room.
export function coverage(s) {
  if (s.actors.length !== 2) return [];
  // the actors in the previous shot's order (by name), so the side keeps its meaning if they swapped places
  const prev = s.previous?.actors.length === 2 && s.previous.actors.map((a) => s.actors.find((b) => b.name === a.name));
  const [A, B] = prev && prev.every(Boolean) ? prev : s.actors, [ax, ay] = A.at, [bx, by] = B.at;
  const len = Math.hypot(bx - ax, by - ay) || 1, u = [(bx - ax) / len, (by - ay) / len];
  const k = (prev && prev.every(Boolean) ? side(s.previous) : side(s)) || 1, n = [-u[1] * k, u[0] * k]; // unit normal toward that side
  const [hw, hd] = s.room.size.map((v) => v / 2 - 0.25);
  const clamp = ([x, y]) => [Math.max(-hw, Math.min(hw, x)), Math.max(-hd, Math.min(hd, y))];
  const toward = (from, to) => Math.round(((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI + 360) % 360);
  // the nearest clear spot to the ideal one: inside the room, out of furniture (15 cm margin), and at least 20 cm on
  // the camera's side of the line, so a blocked setup moves around an obstacle instead of onto the axis
  const inProp = ([x, y]) => s.props.some((p) => Math.abs(x - p.at[0]) < p.size[0] / 2 + 0.15 && Math.abs(y - p.at[1]) < p.size[1] / 2 + 0.15);
  const ahead = ([x, y]) => (x - ax) * n[0] + (y - ay) * n[1]; // signed distance from the line, + on the camera's side
  const at = (base, along, out) => {
    const ideal = [base[0] + u[0] * along + n[0] * out, base[1] + u[1] * along + n[1] * out];
    let best = null;
    for (let da = -0.6; da <= 0.6001; da += 0.1) for (let dout = -0.8; dout <= 1.0001; dout += 0.1) {
      const pos = clamp([ideal[0] + u[0] * da + n[0] * dout, ideal[1] + u[1] * da + n[1] * dout]);
      if (inProp(pos) || ahead(pos) < 0.2) continue;
      const d = Math.hypot(pos[0] - ideal[0], pos[1] - ideal[1]);
      if (!best || d < best.d) best = { pos, d };
    }
    return best?.pos ?? clamp(ideal);
  };
  const mid = [(ax + bx) / 2, (ay + by) / 2];
  const setups = [
    { name: "master", at: at(mid, 0, 3.2), look: mid, lens: 24 },
    { name: `OTS on ${B.name}`, at: at(A.at, -0.7, 0.45), look: B.at, lens: 50 },
    { name: `OTS on ${A.name}`, at: at(B.at, 0.7, 0.45), look: A.at, lens: 50 },
    { name: `single ${A.name}`, at: at(B.at, -0.25, 0.7), look: A.at, lens: 85 },
    { name: `single ${B.name}`, at: at(A.at, 0.25, 0.7), look: B.at, lens: 85 },
  ];
  return setups.map(({ name, at: pos, look, lens }) => ({ name, setup: name, at: pos.map((v) => Math.round(v * 100) / 100), facing: toward(pos, look), lens, height: s.camera.height }));
}

// the cameras a set gets plates for (SNAP-R21): its coverage setups and its own camera, by the name a shot uses for
// each (a shot card's `setup`, or the set's camera for a shot without one)
export const ownCamera = (s) => s.camera.setup ?? "set camera";
export function plateCameras(s) {
  const list = coverage(s);
  return list.some((c) => c.name === ownCamera(s)) ? list : [...list, { name: ownCamera(s), at: s.camera.at, facing: s.camera.facing, lens: s.camera.lens, height: s.camera.height }];
}

// the two classic bridges for an intended crossing of the line: a neutral shot on the axis itself (no side, so the next
// cut can go either way) and a cutaway onto a prop (no actors in frame). Cameras only; positions stay inside the room.
export function bridges(s) {
  if (s.actors.length !== 2) return {};
  const [A, B] = s.actors, len = Math.hypot(B.at[0] - A.at[0], B.at[1] - A.at[1]) || 1;
  const u = [(B.at[0] - A.at[0]) / len, (B.at[1] - A.at[1]) / len];
  const [hw, hd] = s.room.size.map((v) => v / 2 - 0.25);
  const inside = ([x, y]) => Math.abs(x) <= hw && Math.abs(y) <= hd;
  const toward = (from, to) => Math.round(((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI + 360) % 360);
  // on the axis, behind whichever actor leaves room for it: as far back as fits, at most 1.5 m
  let neutral = null;
  for (const [near, far, dir] of [[A, B, -1], [B, A, 1]]) {
    for (let d = 1.5; d >= 0.6 && !neutral; d -= 0.1) {
      const at = [near.at[0] + u[0] * d * dir, near.at[1] + u[1] * d * dir].map((v) => Math.round(v * 100) / 100);
      if (inside(at)) neutral = { at, facing: toward(at, far.at), lens: 35, height: s.camera.height, setup: "neutral (on the line)" };
    }
  }
  const mid = [(A.at[0] + B.at[0]) / 2, (A.at[1] + B.at[1]) / 2];
  const prop = [...s.props].sort((p, q) => Math.hypot(p.at[0] - mid[0], p.at[1] - mid[1]) - Math.hypot(q.at[0] - mid[0], q.at[1] - mid[1]))[0];
  let cutaway = null;
  if (prop) {
    const d = Math.hypot(mid[0] - prop.at[0], mid[1] - prop.at[1]) || 1, back = Math.max(prop.size[0], prop.size[1]) / 2 + 0.6;
    const at = [prop.at[0] + ((mid[0] - prop.at[0]) / d) * back, prop.at[1] + ((mid[1] - prop.at[1]) / d) * back].map((v) => Math.round(v * 100) / 100);
    cutaway = { at, facing: toward(at, prop.at), lens: 85, height: s.camera.height, setup: `cutaway (${prop.name})` };
  }
  return { neutral, cutaway };
}

// top-down plan: walls, openings, props, actor marks with facing, the last camera's frustum, and the 180° line.
// `into` redraws an existing canvas (the editor); `selected` is outlined
export function drawPlan(s, { into, selected, handles, ghosts = [] } = {}) {
  const [c, g] = canvas(into);
  const [rw, rd] = s.room.size;
  const { k, X, Y } = planFrame(s);
  g.strokeStyle = "#222"; g.lineWidth = 6;
  g.strokeRect(X(-rw / 2), Y(rd / 2), rw * k, rd * k);
  for (const o of s.room.openings) {
    const [x0, y0] = o.from, [x1, y1] = o.to;
    g.strokeStyle = o.kind === "window" ? "#5b8fd9" : "#f4f1ea"; g.lineWidth = o.kind === "window" ? 8 : 10;
    g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke();
    if (o === selected) { g.strokeStyle = "#e0a020"; g.lineWidth = 3; g.stroke(); }
    label(g, o.name || o.kind, (X(x0) + X(x1)) / 2, (Y(y0) + Y(y1)) / 2 + (y0 === y1 ? (y0 < 0 ? 22 : -22) : 0), "#5b6575");
  }
  g.lineWidth = 2;
  for (const p of s.props) {
    const [w, d] = p.size;
    g.fillStyle = "#d9cdb4"; g.strokeStyle = "#7a6a4a";
    g.lineWidth = p === selected ? 4 : 2;
    g.fillRect(X(p.at[0] - w / 2), Y(p.at[1] + d / 2), w * k, d * k); g.strokeRect(X(p.at[0] - w / 2), Y(p.at[1] + d / 2), w * k, d * k);
    label(g, p.name, X(p.at[0]), Y(p.at[1]) + d * k / 2 + 16, "#5a4a2a");
  }
  if (s.actors.length === 2) { // the axis between two actors: the camera must stay on one side of it from shot to shot
    const [a, b] = s.actors.map((x) => x.at);
    g.save(); g.beginPath(); g.rect(X(-rw / 2), Y(rd / 2), rw * k, rd * k); g.clip();
    g.setLineDash([10, 8]); g.strokeStyle = "#c0392b"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(X(a[0] - (b[0] - a[0]) * 9), Y(a[1] - (b[1] - a[1]) * 9)); g.lineTo(X(b[0] + (b[0] - a[0]) * 9), Y(b[1] + (b[1] - a[1]) * 9)); g.stroke();
    g.restore();
  }
  for (const a of s.actors) {
    const [x, y] = [X(a.at[0]), Y(a.at[1])], [fx, fy] = dir(a.facing);
    g.fillStyle = "#2c6e9e"; g.beginPath(); g.arc(x, y, 0.25 * k, 0, 7); g.fill();
    if (a === selected) { g.strokeStyle = "#0b2a40"; g.lineWidth = 3; g.stroke(); }
    g.strokeStyle = "#2c6e9e"; g.lineWidth = 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + fx * 0.6 * k, y - fy * 0.6 * k); g.stroke();
    label(g, a.name, x, y - 0.25 * k - 14, "#1d4c6e");
  }
  const cam = s.camera, half = Math.atan(36 / (2 * cam.lens)), reach = Math.max(rw, rd);
  const [cx, cy] = [X(cam.at[0]), Y(cam.at[1])];
  const prev = s.previous?.camera;
  if (prev && (prev.at[0] !== cam.at[0] || prev.at[1] !== cam.at[1] || prev.facing !== cam.facing)) { // the shot this one continues from
    const [px, py] = [X(prev.at[0]), Y(prev.at[1])], [dx, dy] = dir(prev.facing);
    g.setLineDash([6, 6]); g.strokeStyle = "#777"; g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, 7, 0, 7); g.moveTo(px, py); g.lineTo(px + dx * 0.9 * k, py - dy * 0.9 * k); g.stroke();
    g.setLineDash([]);
    label(g, "last shot", px, py + 20, "#777");
  }
  g.save();
  g.beginPath(); g.rect(X(-rw / 2), Y(rd / 2), rw * k, rd * k); g.clip(); // what the camera sees stops at the walls
  g.fillStyle = "#2222"; g.strokeStyle = "#222"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, cy);
  for (const t of [-half, half]) { const [dx, dy] = dir(cam.facing + (t * 180) / Math.PI); g.lineTo(cx + dx * reach * k, cy - dy * reach * k); }
  g.closePath(); g.fill(); g.stroke();
  g.restore();
  g.fillStyle = "#222"; g.beginPath(); g.arc(cx, cy, selected === cam ? 11 : 7, 0, 7); g.fill();
  label(g, `camera ${cam.lens} mm`, Math.max(cx, 140), cy - 18);
  for (const c of ghosts) { // proposed camera setups: dashed, labelled, clickable in the editor
    const [gx, gy] = [X(c.at[0]), Y(c.at[1])], [dx, dy] = dir(c.facing);
    g.setLineDash([5, 5]); g.strokeStyle = "#7c5cd6"; g.lineWidth = 2;
    g.beginPath(); g.arc(gx, gy, 9, 0, 7); g.moveTo(gx, gy); g.lineTo(gx + dx * 0.7 * k, gy - dy * 0.7 * k); g.stroke();
    g.setLineDash([]);
    label(g, `${c.name} · ${c.lens}`, gx, gy + 22, "#5b3fb5");
  }
  if (handles) { // editor only: grab dots on the camera's aim and each actor's arrow tip
    g.fillStyle = "#e0a020";
    for (const [o, len] of [[cam, 0.84], ...s.actors.map((a) => [a, 0.6])]) {
      const [dx, dy] = dir(o.facing);
      g.beginPath(); g.arc(X(o.at[0] + dx * len), Y(o.at[1] + dy * len), 8, 0, 7); g.fill();
    }
  }
  label(g, `${s.name} · plan · end of ${s.shot}`, W / 2, 30, "#444");
  label(g, "N ↑", W - 40, 30, "#444");
  return c;
}

// side elevation looking north: floor, wall height, window band, prop and actor heights, key light direction
export function drawElevation(s) {
  const [c, g] = canvas();
  const [rw] = s.room.size, h = s.room.height, k = Math.min((W - 160) / rw, (H - 200) / h);
  const X = (x) => 80 + (x + rw / 2) * k, Z = (z) => H - 100 - z * k;
  g.strokeStyle = "#222"; g.lineWidth = 6;
  g.beginPath(); g.moveTo(X(-rw / 2), Z(h)); g.lineTo(X(-rw / 2), Z(0)); g.lineTo(X(rw / 2), Z(0)); g.lineTo(X(rw / 2), Z(h)); g.stroke();
  for (const o of s.room.openings.filter((o) => o.kind === "window")) {
    g.fillStyle = "#5b8fd955";
    const x0 = Math.min(o.from[0], o.to[0]), x1 = Math.max(o.from[0], o.to[0]);
    g.fillRect(X(x0 === x1 ? x0 - 0.1 : x0), Z(o.top ?? 2), Math.max(0.2, x1 - x0) * k, ((o.top ?? 2) - (o.sill ?? 0.9)) * k);
  }
  g.lineWidth = 2;
  const placed = []; // label boxes so far: a label that would overlap one moves up a line
  const tag = (text, x, y, colour) => {
    const w = g.measureText(text).width + 8;
    while (placed.some(([px, py, pw]) => Math.abs(px - x) < (pw + w) / 2 && Math.abs(py - y) < 20)) y -= 22;
    placed.push([x, y, w]);
    label(g, text, x, y, colour);
  };
  for (const p of [...s.props].sort((a, b) => b.at[1] - a.at[1])) { // far to near, so near props paint over far ones
    g.fillStyle = "#d9cdb4"; g.strokeStyle = "#7a6a4a";
    g.fillRect(X(p.at[0] - p.size[0] / 2), Z(p.height), p.size[0] * k, p.height * k); g.strokeRect(X(p.at[0] - p.size[0] / 2), Z(p.height), p.size[0] * k, p.height * k);
  }
  for (const p of [...s.props].sort((a, b) => b.height - a.height)) tag(p.name, X(p.at[0]), Z(p.height) - 14, "#5a4a2a");
  for (const a of s.actors) { // a mark, not a figure: people in set references pull identity
    g.strokeStyle = "#2c6e9e"; g.lineWidth = 3; g.setLineDash([8, 6]);
    g.strokeRect(X(a.at[0]) - 0.2 * k, Z(a.height), 0.4 * k, a.height * k);
    g.setLineDash([]);
    tag(`${a.name} (mark)`, X(a.at[0]), Z(a.height) - 16, "#1d4c6e");
  }
  const [lx] = dir(s.light.from);
  g.strokeStyle = "#e0a020"; g.lineWidth = 4;
  const sx = lx > 0 ? X(rw / 2) + 40 : X(-rw / 2) - 40;
  g.beginPath(); g.moveTo(sx, Z(h)); g.lineTo(sx - Math.sign(lx) * 70, Z(h) + 60); g.stroke();
  label(g, "key", sx, Z(h) - 16, "#a06a00");
  label(g, `${s.name} · elevation (looking north) · end of ${s.shot}`, W / 2, 30, "#444");
  return c;
}

export const toBlob = (c) => new Promise((done) => c.toBlob(done, "image/png"));
