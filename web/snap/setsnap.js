// Set snapshots (LIBRARY.md): the set's state as data is the authority; the top-down plan, the side elevation and the
// set block text are compiled from it exactly, so a later shot starts from how this one ended. Units are metres; the
// plan's +y is north, angles are degrees clockwise from north. Diagrams carry marks, never people pictures.

const W = 1024, H = 768;
const rad = (deg) => (deg * Math.PI) / 180;
const dir = (deg) => [Math.sin(rad(deg)), Math.cos(rad(deg))];

// objects in the camera's view, left to right, and the set block that pins them ("exactly these N and nothing else")
export function setBlock(s) {
  const cam = s.camera, [fx, fy] = dir(cam.facing), half = Math.atan(36 / (2 * cam.lens));
  const seen = s.props.map((p) => {
    const dx = p.at[0] - cam.at[0], dy = p.at[1] - cam.at[1];
    const ahead = dx * fx + dy * fy, side = dx * fy - dy * fx; // side > 0 is camera-right
    return { ...p, angle: Math.atan2(side, ahead), inView: ahead > 0 && Math.abs(Math.atan2(side, ahead)) <= half };
  }).filter((p) => p.inView).sort((a, b) => a.angle - b.angle); // image left to right is by viewing angle
  const names = seen.map((p) => (p.state ? `${p.name} (${p.state})` : p.name));
  const light = s.light.description[0].toUpperCase() + s.light.description.slice(1);
  if (!names.length) return `Set: ${s.name}. ${light}. Bare walls only: no furniture or props in view.`;
  const these = names.length === 1 ? "this one object" : `these ${names.length} objects`;
  return `Set: ${s.name}. ${light}. Exactly ${these} and nothing else, left to right: ${names.join(", ")}.`;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

// one sentence per actor: where they stand (by the nearest named thing), which way they face, what their hands hold
export function blocking(s) {
  const things = [...s.props.map((p) => [p.name, p.at]), ...s.room.openings.map((o) => [`the ${o.kind}`, [(o.from[0] + o.to[0]) / 2, (o.from[1] + o.to[1]) / 2]])];
  return s.actors.map((a) => {
    const [near] = things.reduce((best, t) => (Math.hypot(t[1][0] - a.at[0], t[1][1] - a.at[1]) < Math.hypot(best[1][0] - a.at[0], best[1][1] - a.at[1]) ? t : best));
    return `${a.name} stands by ${near.replace(/^(?!the )/, "the ")}, facing ${COMPASS[Math.round(((a.facing % 360) + 360) % 360 / 45) % 8]}${a.hands ? `, ${a.hands}` : ""}.`;
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

// which side of the line between the two actors a camera stands on (+1 / -1); 0 when there is no pair
export function side(s, at = s.camera.at) {
  if (s.actors.length !== 2) return 0;
  const [a, b] = s.actors.map((x) => x.at);
  return Math.sign((b[0] - a[0]) * (at[1] - a[1]) - (b[1] - a[1]) * (at[0] - a[0]));
}

// top-down plan: walls, openings, props, actor marks with facing, the last camera's frustum, and the 180° line.
// `into` redraws an existing canvas (the editor); `selected` is outlined
export function drawPlan(s, { into, selected, handles } = {}) {
  const [c, g] = canvas(into);
  const [rw, rd] = s.room.size;
  const { k, X, Y } = planFrame(s);
  g.strokeStyle = "#222"; g.lineWidth = 6;
  g.strokeRect(X(-rw / 2), Y(rd / 2), rw * k, rd * k);
  for (const o of s.room.openings) {
    const [x0, y0] = o.from, [x1, y1] = o.to;
    g.strokeStyle = o.kind === "window" ? "#5b8fd9" : "#f4f1ea"; g.lineWidth = o.kind === "window" ? 8 : 10;
    g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke();
    label(g, o.kind, (X(x0) + X(x1)) / 2, (Y(y0) + Y(y1)) / 2 + (y0 === y1 ? (y0 < 0 ? 22 : -22) : 0), "#5b6575");
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
