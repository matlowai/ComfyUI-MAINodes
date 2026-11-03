// Snap view styles. Colours come from ComfyUI's own palette variables so the view follows the active theme.
export const STYLE = `
.snap-root {
  --s-bg: var(--comfy-menu-bg, #1b1c20); --s-card: var(--comfy-input-bg, #24262c); --s-fg: var(--fg-color, #e8e8ea);
  --s-dim: var(--descrip-text, #9a9ca5); --s-line: var(--border-color, #3a3c44); --s-accent: #6aa8ff; --veil: 1;
  position: absolute; inset: 0; z-index: 2; box-sizing: border-box; display: flex; padding: var(--chrome-top, 0) 0 0 var(--chrome-left, 0); flex-direction: column; color: var(--s-fg);
  background: color-mix(in srgb, var(--s-bg) calc(var(--veil) * 100%), transparent);
  font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; outline: none; overflow: hidden; contain: layout paint;
}
.snap-root [hidden] { display: none !important; } /* the controls below use all: unset, which would undo [hidden] */
.snap-root:not(.open) .snap-top, .snap-root:not(.open) .snap-rail, .snap-root:not(.open) .snap-inspector { opacity: var(--veil); }
.snap-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 6px 16px 10px; border-bottom: 1px solid var(--s-line); }
.snap-title { font-size: 14px; font-weight: 600; }
.snap-spacer { flex: 1; }
.snap-status { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--s-card); color: var(--s-dim); }
.snap-status::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; background: currentColor; vertical-align: 1px; }
.snap-status.ok { color: #57c785; } .snap-status.warn { color: #f0b445; }
.snap-seg { display: flex; background: var(--s-card); border-radius: 8px; padding: 2px; }
.snap-seg button { all: unset; cursor: pointer; padding: 4px 12px; border-radius: 6px; color: var(--s-dim); transition: background-color .15s ease-out, color .15s ease-out; }
.snap-seg button.on { background: var(--s-bg); color: var(--s-fg); box-shadow: 0 1px 2px #0005; }
.snap-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 180px minmax(0, 1fr) 280px; }
.snap-rail, .snap-inspector { overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.snap-rail { border-right: 1px solid var(--s-line); }
.snap-inspector { border-left: 1px solid var(--s-line); }
.snap-rail-title, .snap-insp-title { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--s-dim); margin: 6px 0 2px; }
.snap-insp-title { font-size: 13px; text-transform: none; letter-spacing: 0; color: var(--s-fg); font-weight: 600; }
.snap-insp-type { font-size: 11px; color: var(--s-dim); margin: 8px 0 4px; }
.snap-tile { display: flex; align-items: center; gap: 8px; padding: 8px 10px; min-height: 28px; border-radius: 10px; background: var(--s-card);
  border: 1px solid var(--s-line); cursor: grab; touch-action: none; user-select: none; }
.snap-tile.used { opacity: .45; cursor: default; }
.snap-rail-part { display: flex; flex-direction: column; gap: 6px; }
.snap-lib-q { font: inherit; color: var(--s-fg); background: var(--s-bg); border: 1px solid var(--s-line); border-radius: 8px; padding: 6px 8px; min-height: 30px; box-sizing: border-box; }
.snap-lib-for { all: unset; cursor: pointer; font-size: 11px; color: var(--s-accent); padding: 2px 0; }
.snap-lib-results { display: flex; flex-direction: column; gap: 4px; }
.snap-card { display: flex; flex-direction: column; gap: 1px; padding: 6px 9px; border-radius: 9px; background: var(--s-card); border: 1px solid var(--s-line);
  border-left: 3px solid hsl(var(--hue) 70% 60% / .7); cursor: grab; touch-action: none; user-select: none; }
.snap-card:hover { border-color: hsl(var(--hue) 70% 60% / .6); }
.snap-kind { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; color: hsl(var(--hue) 70% 70%); }
.snap-card-title { font-size: 12px; }
.snap-brick.snap-accepts { border-color: hsl(var(--hue) 70% 60% / .5); border-style: dashed; }
.snap-brick.snap-target { border-style: solid; border-color: hsl(var(--hue) 70% 60%); box-shadow: 0 0 0 4px hsl(var(--hue) 70% 60% / .22); }
.snap-stack { overflow: auto; padding: 16px 24px 48px; display: flex; flex-direction: column; row-gap: 12px; align-items: stretch; max-width: 760px; width: 100%; justify-self: center; }
.snap-brick { position: relative; background: color-mix(in srgb, var(--s-card) calc(var(--veil) * 100%), transparent);
  border: 1px solid color-mix(in srgb, var(--s-line) calc(var(--veil) * 100%), transparent); border-radius: 14px; padding: 10px 12px 12px;
  box-shadow: 0 1px 2px #0003; transition: box-shadow .15s ease-out, border-color .15s ease-out; outline: none; }
/* during a view switch only the card shell morphs; its content is gone in the first half of the flight */
.snap-brick > * { opacity: clamp(0, calc((var(--veil) - .55) * 2.2), 1); }
.graph-canvas-container.snap-open .litegraph-minimap { display: none; }
.snap-brick::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; border-radius: 14px 0 0 14px; background: hsl(var(--hue) 70% 60%); }
.snap-brick.selected, .snap-brick:focus-visible { border-color: hsl(var(--hue) 70% 60% / .8); box-shadow: 0 0 0 3px hsl(var(--hue) 70% 60% / .18); }
.snap-brick.attached { margin-left: 28px; }
.snap-brick.attached::after { content: ""; position: absolute; left: -16px; top: -13px; width: 12px; height: 30px; border: 2px solid var(--s-line); border-top: 0; border-right: 0; border-radius: 0 0 0 8px; }
.snap-head { display: flex; align-items: baseline; gap: 8px; cursor: grab; touch-action: none; user-select: none; min-height: 24px; }
.snap-grip { width: 22px; height: 22px; display: inline-grid; place-items: center; border-radius: 6px; background: hsl(var(--hue) 70% 60% / .16); color: hsl(var(--hue) 70% 70%); flex: none; align-self: center; }
.snap-name { font-weight: 600; }
.snap-blurb { color: var(--s-dim); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snap-x { all: unset; cursor: pointer; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; color: var(--s-dim); opacity: 0; transition: opacity .15s ease-out; }
.snap-brick:hover .snap-x, .snap-brick:focus-within .snap-x { opacity: 1; }
.snap-x:hover { background: #ffffff14; color: var(--s-fg); }
.snap-face { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-top: 10px; }
.snap-field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--s-dim); }
.snap-field.snap-textarea { grid-column: 1 / -1; }
.snap-field input, .snap-field select, .snap-field textarea { font: inherit; font-size: 13px; color: var(--s-fg); background: var(--s-bg); border: 1px solid var(--s-line);
  border-radius: 8px; padding: 5px 8px; min-height: 30px; box-sizing: border-box; width: 100%; resize: vertical; }
.snap-field input[type=checkbox] { width: 18px; min-height: 18px; }
.snap-scrub { cursor: ew-resize; touch-action: none; user-select: none; }
.snap-binds { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
.snap-bind { all: unset; cursor: pointer; font-size: 11px; color: var(--s-dim); padding: 2px 7px; border-radius: 999px; background: var(--s-bg); border-bottom: 2px solid #6aa8ff99; }
.snap-bind.inferred { border-bottom-style: dashed; }
.snap-bind.override { border-bottom-color: #f0b445; color: #f0b445; cursor: default; }
.snap-bind:hover { color: var(--s-fg); }
.snap-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.snap-chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: hsl(35 80% 60% / .15); color: hsl(35 80% 72%); }
.snap-meter { display: flex; align-items: center; gap: 3px; margin-top: 8px; }
.snap-meter span { width: 14px; height: 6px; border-radius: 3px; background: var(--s-line); }
.snap-meter span.on { background: hsl(var(--hue) 70% 60%); }
.snap-meter em { font-style: normal; font-size: 11px; color: var(--s-dim); margin-left: 6px; }
.snap-pics { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.snap-pics figure { margin: 0; width: 132px; }
.snap-pics img { width: 132px; height: 99px; object-fit: cover; border-radius: 8px; border: 1px solid var(--s-line); display: block; background: #f4f1ea; }
.snap-pics figcaption { font-size: 11px; color: var(--s-dim); margin-top: 3px; }
.snap-card { position: relative; }
.snap-edit { all: unset; cursor: pointer; position: absolute; right: 6px; top: 5px; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; color: var(--s-dim); }
.snap-edit:hover { background: #ffffff14; color: var(--s-fg); }
.snap-pics figure.editable { cursor: pointer; }
.snap-sheet { position: absolute; inset: var(--chrome-top, 12px) 12px 12px calc(var(--chrome-left, 0px) + 12px); z-index: 80; display: flex; flex-direction: column; background: var(--s-bg); border: 1px solid var(--s-line);
  border-radius: 16px; box-shadow: 0 30px 80px #000b; overflow: hidden; animation: snap-sheet-in .18s ease-out; }
@keyframes snap-sheet-in { from { opacity: 0; transform: translateY(8px) scale(.99); } }
.snap-sheet > header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--s-line); }
.snap-set-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; padding: 16px; }
.snap-set-plan { width: 100%; height: auto; max-height: 100%; object-fit: contain; border-radius: 12px; touch-action: none; cursor: grab; background: #f4f1ea; align-self: start; outline: none; }
.snap-set-body aside { display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.snap-set-block { margin: 0; font-size: 13px; line-height: 1.45; }
.snap-set-notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.snap-set-notes li { padding: 5px 8px; border-radius: 8px; background: var(--s-card); }
.snap-set-notes li b { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; margin-right: 4px; }
.snap-set-notes li.break { background: #f0b445; color: #1b1c20; }
.snap-set-notes li.check b { color: #f0b445; }
.snap-set-notes li.note b, .snap-set-notes li.none { color: var(--s-dim); }
.snap-set-actions { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 760px) { .snap-set-body { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { .snap-sheet { animation: none; } }
.snap-proposals { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 4px 2px 10px; border-radius: 999px; background: #a78bfa22; color: #c4b5fd; }
.snap-proposals button { all: unset; cursor: pointer; padding: 2px 8px; border-radius: 999px; }
.snap-proposals button:hover { background: #ffffff14; }
.snap-ghost-brick { display: flex; align-items: center; gap: 8px; border-style: dashed; border-color: hsl(var(--hue) 70% 60% / .6); background: color-mix(in srgb, var(--s-card) 45%, transparent); opacity: .85; }
.snap-ghost-brick::before { opacity: .4; }
.snap-proposal { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 6px 8px; border: 1px dashed #a78bfa88; border-radius: 10px; font-size: 12px; }
.snap-agent { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; color: #c4b5fd; background: #a78bfa22; padding: 1px 6px; border-radius: 999px; }
.snap-proposal-what { font-weight: 600; }
.snap-accept, .snap-reject { all: unset; cursor: pointer; padding: 3px 10px; border-radius: 8px; font-size: 12px; min-height: 22px; }
.snap-accept { background: #57c78533; color: #8fe3b0; margin-left: auto; }
.snap-reject { color: var(--s-dim); }
.snap-accept:hover { background: #57c78555; } .snap-reject:hover { background: #ffffff14; color: var(--s-fg); }
.snap-ghost-brick:focus-visible, .snap-proposal:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
.snap-note { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 10px; padding: 7px 9px; border-radius: 10px; background: #f5d76e1f; border: 1px solid #f5d76e55; font-size: 12px; }
.snap-stack > .snap-note { margin: 0; }
.snap-note-tag { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; color: #f5d76e; background: #f5d76e22; padding: 1px 6px; border-radius: 999px; }
.snap-note-text { font-weight: 600; flex: 1 1 200px; }
.snap-note-reply { flex-basis: 100%; color: var(--s-dim); }
.snap-note.answered { border-color: #a78bfa66; }
.snap-note-compose { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--s-line); }
.snap-note-input { font: inherit; font-size: 13px; color: var(--s-fg); background: var(--s-bg); border: 1px solid var(--s-line); border-radius: 8px; padding: 6px 8px; resize: vertical; }
.snap-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--s-dim); }
.snap-quiet { color: var(--s-dim); font-size: 12px; margin-top: 6px; }
.snap-empty { margin: 12vh auto 0; text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.snap-empty-title { font-size: 18px; font-weight: 600; }
.snap-primary, .snap-link { all: unset; cursor: pointer; padding: 8px 14px; border-radius: 10px; background: var(--s-accent); color: #0b1220; font-weight: 600; margin-top: 8px; }
.snap-link { background: var(--s-card); color: var(--s-fg); font-weight: 500; align-self: flex-start; }
.snap-pressed { filter: brightness(1.08); }
.snap-lifted { position: relative; z-index: 5; box-shadow: 0 12px 32px #0007, 0 2px 6px #0004; cursor: grabbing; }
.snap-ghost { z-index: 60; pointer-events: none; }
.snap-ghost.snap-acquired { border-color: var(--s-accent); }
.snap-quiet-btn { margin-top: 0; padding: 4px 10px; font-size: 12px; color: var(--s-dim); }
.snap-quiet-btn:hover { color: var(--s-fg); }
.snap-palette { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); width: min(520px, calc(100% - 32px)); z-index: 70;
  background: var(--s-bg); border: 1px solid var(--s-line); border-radius: 14px; box-shadow: 0 24px 64px #000a; overflow: hidden; }
.snap-palette input { all: unset; box-sizing: border-box; width: 100%; padding: 14px 16px; font-size: 15px; border-bottom: 1px solid var(--s-line); }
.snap-results { max-height: 320px; overflow: auto; padding: 6px; }
.snap-hit { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; min-height: 28px; }
.snap-hit.on, .snap-hit:hover { background: var(--s-card); }
.snap-toast { position: absolute; left: 50%; bottom: 20px; transform: translate(-50%, 12px); opacity: 0; pointer-events: none; padding: 8px 14px;
  border-radius: 10px; background: var(--s-fg); color: var(--s-bg); font-size: 12px; transition: opacity .15s ease-out, transform .15s ease-out; }
.snap-toast.show { opacity: 1; transform: translate(-50%, 0); }
.snap-toast.bad { background: #f0b445; color: #1b1c20; }
@media (max-width: 760px) { .snap-body { grid-template-columns: minmax(0, 1fr); } .snap-rail, .snap-inspector { display: none; } .snap-stack { padding: 12px 12px 48px; } .snap-top { padding: 6px 12px 8px; } }
@media (prefers-reduced-motion: reduce) { .snap-toast, .snap-seg button, .snap-brick { transition: none; } }
`;
