// Agent text as structured DOM (the Room's Conversation tab): a small markdown subset parsed to a token tree, then built
// with an element factory and text only. No dependency, no HTML strings, nothing read back as markup.
// SNAP-R278 agent text is rendered as structured DOM: links only to http(s), never HTML; odd markup stays text, nothing
// of the original is dropped or reordered · see docs/snap/SNAP_RULES.md
// Tokens. Blocks: {type:"p"|"heading", children} · {type:"ul"|"ol", start?, items:[children]} · {type:"pre", text, lang, open}.
// Inline: {type:"text", text} · {type:"br"} · {type:"strong"|"em", children} · {type:"code", text} ·
// {type:"link", label, href} (href is http(s), checked) · {type:"ref", label, target} (any other target: shown, never followed)

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)\s*$/, HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/, BULLET = /^ {0,3}[-*+]\s+(.*)$/, NUMBER = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;
const LINK = /^\[([^\]\n]+)\]\(([^()\s]+)\)/, URL_AT = /^https?:\/\/[^\s<>()[\]{}"'`]+/i, TRAIL = /[.,;:!?]+$/;
const DEPTH = 4; // nested emphasis deeper than this is text

export function safeHref(target) {
  if (!/^https?:\/\//i.test(target)) return null;
  try { const u = new URL(target); return u.protocol === "http:" || u.protocol === "https:" ? u.href : null; } catch { return null; }
}

// inline: one pass, left to right; a marker without its partner is text, so partial streaming text never throws
export function inline(s, depth = 0) {
  const out = [];
  const text = (t) => { if (!t) return; const last = out.at(-1); if (last?.type === "text") last.text += t; else out.push({ type: "text", text: t }); };
  let i = 0;
  while (i < s.length) {
    const c = s[i], rest = s.slice(i), before = i ? s[i - 1] : "";
    if (c === "`") {
      const ticks = rest.match(/^`+/)[0], end = s.indexOf(ticks, i + ticks.length);
      if (end !== -1 && s.slice(i + ticks.length, end).trim()) { out.push({ type: "code", text: s.slice(i + ticks.length, end) }); i = end + ticks.length; continue; }
      text(ticks); i += ticks.length; continue;
    }
    if ((c === "*" || c === "_") && depth < DEPTH) {
      const two = s[i + 1] === c, mark = two ? c + c : c, from = i + mark.length;
      const wordy = c === "_" && /\w/.test(before); // snake_case stays text
      if (!wordy && s[from] && !/\s/.test(s[from])) {
        let end = s.indexOf(mark, from);
        if (!two) while (end !== -1 && s[end + 1] === c) end = s.indexOf(mark, end + 2); // a single marker skips a double one
        if (end > from && !/\s/.test(s[end - 1]) && !(c === "_" && /\w/.test(s[end + mark.length] ?? ""))) {
          out.push({ type: two ? "strong" : "em", children: inline(s.slice(from, end), depth + 1) }); i = end + mark.length; continue;
        }
      }
      text(mark); i += mark.length; continue;
    }
    if (c === "[") {
      const m = rest.match(LINK);
      if (m) { const href = safeHref(m[2]); out.push(href ? { type: "link", label: m[1], href } : { type: "ref", label: m[1], target: m[2] }); i += m[0].length; continue; }
      text(c); i++; continue;
    }
    if ((c === "h" || c === "H") && !/\w/.test(before)) {
      const m = rest.match(URL_AT);
      if (m) {
        const url = m[0].replace(TRAIL, ""), href = safeHref(url);
        if (href) { out.push({ type: "link", label: url, href }); i += url.length; continue; }
      }
    }
    const next = rest.slice(1).search(/[`*_[hH]/);
    const n = next === -1 ? s.length - i : next + 1;
    text(s.slice(i, i + n)); i += n;
  }
  return out;
}

// lines inside one block join with a line break token, so the text keeps its own line structure
const lines = (list) => list.flatMap((l, k) => (k ? [{ type: "br" }, ...inline(l)] : inline(l)));

export function parse(source) {
  const src = String(source ?? "").replace(/\r\n?/g, "\n").split("\n"), blocks = [];
  let para = [], list = null;
  const flush = () => { if (para.length) blocks.push({ type: "p", children: lines(para) }); para = []; if (list) blocks.push(list.block); list = null; };
  for (let k = 0; k < src.length; k++) {
    const line = src[k], fence = line.match(FENCE);
    if (fence) {
      flush();
      const body = []; let j = k + 1;
      for (; j < src.length; j++) { const close = src[j].match(/^ {0,3}(`{3,}|~{3,})\s*$/); if (close && close[1][0] === fence[1][0] && close[1].length >= fence[1].length) break; body.push(src[j]); }
      blocks.push({ type: "pre", text: body.join("\n"), lang: fence[2] || "", open: j >= src.length }); // an unclosed fence (mid-stream) runs to the end
      k = j; continue;
    }
    if (!line.trim()) { flush(); continue; }
    const head = line.match(HEADING);
    if (head) { flush(); blocks.push({ type: "heading", children: inline(head[1]) }); continue; }
    const b = line.match(BULLET), n = !b && line.match(NUMBER), kind = b ? "ul" : n ? "ol" : null;
    if (kind) {
      if (para.length || (list && list.kind !== kind)) flush();
      if (!list) list = { kind, block: kind === "ol" ? { type: "ol", start: Number(n[1]), items: [] } : { type: "ul", items: [] }, raw: [] };
      list.block.items.push(inline(b ? b[1] : n[2])); list.raw = [b ? b[1] : n[2]];
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.raw.push(line.trim()); list.block.items[list.block.items.length - 1] = lines(list.raw); continue; } // an indented continuation of the item
    if (list) flush();
    para.push(line);
  }
  flush();
  return blocks;
}

// the words of a token tree in order (what copy/select and tests read)
export function textOf(tokens) {
  return tokens.map((t) => t.type === "text" || t.type === "code" || t.type === "pre" ? t.text : t.type === "br" ? "\n" : t.type === "link" ? t.label : t.type === "ref" ? `${t.label} (${t.target})`
    : t.items ? t.items.map(textOf).join("\n") : t.children ? textOf(t.children) : "").join("");
}

// `h(tag, props, ...kids)` builds an element from properties; every agent string goes in as textContent or a text child.
// The only attribute taken from agent text is a link's href, and only after safeHref() said it is http(s)
export function render(blocks, h) {
  const kids = (list) => list.map((t) => {
    if (t.type === "text") return t.text;
    if (t.type === "br") return h("br", {});
    if (t.type === "strong") return h("strong", {}, ...kids(t.children));
    if (t.type === "em") return h("em", {}, ...kids(t.children));
    if (t.type === "code") return h("code", { textContent: t.text });
    if (t.type === "link") { const href = safeHref(t.href); return href ? h("a", { href, target: "_blank", rel: "noopener noreferrer", textContent: t.label }) : t.label; }
    if (t.type === "ref") return h("span", { className: "snap-md-ref" }, t.label, " ", h("code", { textContent: t.target })); // a local path or other scheme: shown, not followed
    return "";
  });
  return blocks.map((b) => {
    if (b.type === "pre") return h("pre", { className: `snap-md-pre${b.open ? " open" : ""}` }, h("code", { textContent: b.text }));
    if (b.type === "heading") return h("p", { className: "snap-md-h" }, h("strong", {}, ...kids(b.children)));
    if (b.type === "ul" || b.type === "ol") return h(b.type, b.type === "ol" && b.start !== 1 ? { start: b.start } : {}, ...b.items.map((item) => h("li", {}, ...kids(item))));
    return h("p", {}, ...kids(b.children));
  });
}
