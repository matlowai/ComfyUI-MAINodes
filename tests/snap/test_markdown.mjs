// SNAP-R278: agent chat text parses to a token tree and renders through an element factory; no HTML, links only to http(s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, render, textOf, safeHref } from '../../web/snap/markdown.mjs';

const KEYS = new Set(['type', 'children', 'items', 'start', 'text', 'lang', 'open', 'label', 'href', 'target']);
const walk = (tokens, fn) => { for (const t of tokens) { fn(t); if (t.children) walk(t.children, fn); for (const item of t.items ?? []) walk(item, fn); } };
const tokens = (tree) => { const out = []; walk(tree, (t) => out.push(t)); return out; };
// a factory that records what render asks for, as plain objects
const h = (tag, props = {}, ...kids) => ({ tag, props, kids: kids.flat() });
const nodes = (list) => list.flatMap((n) => (typeof n === 'string' ? [] : [n, ...nodes(n.kids)]));
const words = (list) => list.map((n) => (typeof n === 'string' ? n : (n.props.textContent ?? '') + words(n.kids))).join('');

test('paragraphs, line breaks and headings', () => {
  const tree = parse('# Title\nfirst line\nsecond line\n\nnext para');
  assert.deepEqual(tree.map((b) => b.type), ['heading', 'p', 'p']);
  assert.deepEqual(tree[1].children, [{ type: 'text', text: 'first line' }, { type: 'br' }, { type: 'text', text: 'second line' }]);
  assert.equal(render(tree, h)[0].props.className, 'snap-md-h');
});
test('bold, italic both ways, inline code; snake_case stays text', () => {
  const [p] = parse('a **bold** and *it* and _it2_ with `x < y` in some_name_here');
  assert.deepEqual(p.children.map((t) => t.type), ['text', 'strong', 'text', 'em', 'text', 'em', 'text', 'code', 'text']);
  assert.equal(p.children[7].text, 'x < y');
  assert.equal(p.children.at(-1).text, ' in some_name_here');
});
test('bullet and numbered lists, with an indented continuation', () => {
  const tree = parse('- one\n- two\n  more\n\n3. three\n4. four');
  assert.equal(tree[0].type, 'ul'); assert.equal(tree[0].items.length, 2); assert.equal(textOf(tree[0].items[1]), 'two\nmore');
  assert.equal(tree[1].type, 'ol'); assert.equal(tree[1].start, 3); assert.equal(tree[1].items.length, 2);
  assert.equal(render(tree, h)[1].props.start, 3);
});
test('fenced code keeps its text verbatim', () => {
  const [pre] = parse('```js\nconst a = "<b>**x**</b>";\n```');
  assert.deepEqual(pre, { type: 'pre', text: 'const a = "<b>**x**</b>";', lang: 'js', open: false });
});
test('http(s) links and bare URLs become safe anchors', () => {
  const [p] = parse('see [the docs](https://example.com/a?b=1) or http://example.org/x.');
  const links = tokens([p]).filter((t) => t.type === 'link');
  assert.deepEqual(links.map((l) => l.href), ['https://example.com/a?b=1', 'http://example.org/x']);
  assert.equal(textOf([p]).endsWith('x.'), true, 'trailing punctuation stays text');
  for (const a of nodes(render([p], h)).filter((n) => n.tag === 'a')) { assert.equal(a.props.target, '_blank'); assert.equal(a.props.rel, 'noopener noreferrer'); assert.match(a.props.href, /^https?:/); }
});
test('unsafe and local link targets show the label and the target as code, never clickable', () => {
  for (const target of ['/some/local/path.md', 'javascript:alert(1)', 'data:text/html;base64,PGI+', 'relative/file.md', 'file:///etc/x', 'JAVASCRIPT:x']) {
    const tree = parse(`[Current handoff](${target})`), built = nodes(render(tree, h));
    assert.equal(built.some((n) => n.tag === 'a'), false, target);
    assert.equal(tokens(tree).some((t) => t.href), false, target);
    assert.ok(words(render(tree, h)).includes('Current handoff'), target);
    assert.ok(words(render(tree, h)).includes(target.replace(/\)$/, '').split(')')[0]), target);
  }
  assert.equal(safeHref('javascript:alert(1)'), null); assert.equal(safeHref('https://ok.example/'), 'https://ok.example/');
});
test('partial and unterminated markup renders as text or an open block, without throwing', () => {
  // the text a reader sees: unpaired markers stay; a list marker or fence that did open is structure, not text
  const seen = { '**bold': '**bold', 'a *b': 'a *b', '`code': '`code', '[label](https://x': '[label](https://x', '[label': '[label', '_x': '_x', '***': '***', '**': '**', '*': '*',
    'a **b *c** d': 'a b *c d', '```py\nprint(1)': 'print(1)', '- ': '', '1.': '1.', '# ': '', '~~~\n': '' };
  for (const [s, want] of Object.entries(seen)) { const tree = parse(s); render(tree, h); assert.equal(textOf(tree), want, s); }
  const [pre] = parse('```py\nprint(1)'); assert.equal(pre.open, true); assert.equal(pre.text, 'print(1)');
});
test('a long plain message comes back whole and in order', () => {
  const long = Array.from({ length: 400 }, (_, i) => `Sentence ${i} has words, numbers 3.5 and (asides).`).join(' ');
  const tree = parse(long); assert.equal(tree.length, 1); assert.equal(textOf(tree), long);
});
test('no token carries raw HTML and render never sets markup properties', () => {
  const src = '<img src=x onerror=alert(1)> **<script>x</script>** [<b>l</b>](https://e.example/) `<i>`\n```\n<div>\n```';
  const tree = parse(src);
  walk(tree, (t) => { for (const k of Object.keys(t)) assert.ok(KEYS.has(k), `unexpected key ${k}`); });
  assert.ok(tokens(tree).some((t) => t.type === 'text' && t.text.includes('<img src=x onerror=alert(1)>')));
  for (const n of nodes(render(tree, h))) for (const k of Object.keys(n.props)) assert.ok(['textContent', 'className', 'href', 'target', 'rel', 'start'].includes(k), `prop ${k}`);
  for (const n of nodes(render(tree, h)).filter((x) => x.props.href)) assert.equal(n.tag, 'a');
});
