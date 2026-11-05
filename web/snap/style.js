// Snap view styles. Colours start from ComfyUI's palette variables so the view follows the active theme.
export const STYLE = `
.snap-root {
  --s-bg: var(--comfy-menu-bg, #16171b); --s-app: color-mix(in srgb, var(--s-bg) 82%, #000); --s-card: var(--comfy-input-bg, #24262c); --s-fg: var(--fg-color, #ececef);
  --s-dim: var(--descrip-text, #9a9ca5); --s-line: color-mix(in srgb, var(--border-color, #3a3c44) 70%, transparent); --s-accent: #6aa8ff; --veil: 1; --gap: 40px;
  position: fixed; inset: 0; z-index: 1500; box-sizing: border-box; display: flex; container-type: inline-size; flex-direction: column; color: var(--s-fg);
  background: color-mix(in srgb, var(--s-app) calc(var(--veil) * 100%), transparent);
  font: 13px/1.4 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; outline: none; overflow: hidden; contain: layout paint;
}
.snap-root [hidden] { display: none !important; } /* the controls below use all: unset, which would undo [hidden] */
.snap-root:not(.open) .snap-top, .snap-root:not(.open) .snap-rail, .snap-root:not(.open) .snap-inspector, .snap-root:not(.open) .snap-lanes { opacity: var(--veil); }
.snap-top { position: relative; display: flex; align-items: center; gap: 10px; height: 54px; flex: none; padding: 0 14px 0 18px; border-bottom: 1px solid var(--s-line);
  background: color-mix(in srgb, var(--s-bg) calc(var(--veil) * 100%), transparent); }
.snap-brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; letter-spacing: -.01em; padding-right: 12px; margin-right: 2px; border-right: 1px solid var(--s-line); height: 26px; }
.snap-brand i { width: 20px; height: 20px; border-radius: 6px; background: conic-gradient(from 200deg, #6aa8ff, #c084fc, #f472b6, #f0b445, #57c785, #6aa8ff); box-shadow: 0 0 0 1px #ffffff1f inset; }
.snap-title { font-size: 14px; font-weight: 600; max-width: 32ch; min-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snap-spacer { flex: 1; }
.snap-status { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--s-card); color: var(--s-dim); cursor: default; white-space: nowrap; }
.snap-status::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; background: currentColor; vertical-align: 1px; }
.snap-status.ok { color: #57c785; } .snap-status.warn { color: #f0b445; }
.snap-seg { display: flex; background: var(--s-card); border-radius: 10px; padding: 3px; }
.snap-seg button { all: unset; cursor: pointer; padding: 5px 14px; border-radius: 7px; color: var(--s-dim); font-weight: 500; transition: background-color .15s ease-out, color .15s ease-out; }
.snap-seg button.on { background: var(--s-bg); color: var(--s-fg); box-shadow: 0 1px 3px #0006; }
.snap-run { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; padding: 7px 16px; border-radius: 10px; font-weight: 600; color: #0b1220;
  background: linear-gradient(180deg, #8ab9ff, #5b97f5); box-shadow: 0 1px 0 #ffffff55 inset, 0 4px 14px #5b97f540; transition: filter .15s ease-out, transform .1s ease-out; white-space: nowrap; }
.snap-run:hover { filter: brightness(1.08); } .snap-run:active { transform: scale(.97); }
.snap-run:disabled { opacity: .6; cursor: default; }
.snap-progress { position: absolute; left: 0; bottom: -1px; height: 2px; width: calc(var(--p, 0) * 100%); background: linear-gradient(90deg, #6aa8ff, #c084fc); transition: width .2s linear, opacity .3s; }
.snap-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 224px minmax(0, 1fr) 0px; transition: grid-template-columns .3s cubic-bezier(.2, .8, .2, 1); }
.snap-root.inspecting .snap-body { grid-template-columns: 224px minmax(0, 1fr) var(--insp-w, clamp(380px, 33vw, 860px)); }
.snap-body { position: relative; }
.snap-root.resizing .snap-body { transition: none; } .snap-root.resizing { cursor: col-resize; user-select: none; }
.snap-insp-handle { position: absolute; top: 0; bottom: 0; right: var(--insp-w, clamp(380px, 33vw, 860px)); width: 10px; margin-right: -5px; z-index: 6; cursor: col-resize; touch-action: none; display: none; }
.snap-root.inspecting .snap-insp-handle { display: block; }
.snap-insp-handle::after { content: ""; position: absolute; left: 4px; top: 0; bottom: 0; width: 2px; background: var(--s-accent); opacity: 0; transition: opacity .15s ease-out; }
.snap-insp-handle:hover::after, .snap-root.resizing .snap-insp-handle::after { opacity: .7; }
.snap-root:not(.inspecting) .snap-inspector { visibility: hidden; padding-left: 0; padding-right: 0; border: 0; }
.snap-rail, .snap-inspector { overflow: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 6px; background: color-mix(in srgb, var(--s-bg) calc(var(--veil) * 100%), transparent); }
.snap-rail { border-right: 1px solid var(--s-line); }
.snap-inspector { border-left: 1px solid var(--s-line); gap: 8px; min-width: 0; overflow: hidden auto; box-shadow: -12px 0 32px #0000002e; }
.snap-collapse { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 2px; padding: 2px 6px 2px 2px; margin-left: -2px; border-radius: 9px; color: var(--s-dim); transition: background-color .12s ease-out; }
.snap-collapse i { font-style: normal; font-size: 18px; line-height: 1; }
.snap-collapse:hover, .snap-collapse:focus-visible { background: #ffffff14; color: var(--s-fg); }
.snap-wired { font-size: 12px; color: var(--s-dim); padding: 6px 9px; border-radius: 9px; border: 1px dashed var(--s-line); }
.snap-dom { border-radius: 10px; padding: 8px; background: #0000002e; border: 1px solid #ffffff10; overflow: auto; }
.snap-dom > * { height: auto !important; }
.snap-widget-btn { align-self: stretch; text-align: center; margin-top: 0; }
.snap-thumbs { display: flex; gap: 6px; } .snap-thumbs img { width: 100%; max-height: 90px; object-fit: cover; border-radius: 8px; border: 1px solid #ffffff14; min-width: 0; }
.snap-thumbs.big img { max-height: 220px; object-fit: contain; background: #0003; }
.snap-out { position: relative; z-index: 1; margin: 0; border-radius: 9px; overflow: hidden; border: 1px solid #ffffff14; background: #0004; }
.snap-out img, .snap-out video { display: block; width: 100%; max-height: 120px; object-fit: cover; }
.snap-out img[hidden], .snap-out video[hidden] { display: none; }
.snap-out figcaption { position: absolute; z-index: 2; left: 6px; bottom: 6px; font-size: 10.5px; padding: 1px 7px; border-radius: 999px; background: #0009; color: var(--s-fg); }
.snap-out.previewing { border-color: var(--s-accent); }
.snap-out.previewing figcaption { background: var(--s-accent); color: #0d1320; }
.snap-insp-main { padding-bottom: 10px; border-bottom: 1px solid var(--s-line); }
.snap-insp-main .snap-field textarea { min-height: 120px; }
.snap-rail-title, .snap-insp-title { font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--s-dim); margin: 10px 2px 4px; }
.snap-rail-title:first-child { margin-top: 0; }
.snap-insp-title { font-size: 17px; text-transform: none; letter-spacing: -.01em; color: var(--s-fg); font-weight: 700; margin: 0; display: flex; align-items: center; gap: 10px; }
.snap-insp-type { font-size: 11px; color: var(--s-dim); margin: 10px 0 2px; }
/* short fields flow into columns as the inspector widens; text, panels and previews keep the full width */
.snap-insp-node { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px 12px; align-items: start; }
.snap-insp-node > .snap-textarea, .snap-insp-node > .snap-dom-field, .snap-insp-node > .snap-insp-type, .snap-insp-node > .snap-thumbs, .snap-insp-node > .snap-widget-btn { grid-column: 1 / -1; }
.snap-rail-part { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.snap-top .snap-link { margin-top: 0; align-self: center; white-space: nowrap; }
.snap-rail-part .snap-rail-title { grid-column: 1 / -1; }
.snap-tile { display: flex; align-items: center; gap: 8px; padding: 7px 8px; min-height: 30px; border-radius: 11px; font-size: 12px; font-weight: 500;
  background: linear-gradient(180deg, hsl(var(--hue) 25% 21%), hsl(var(--hue) 20% 16%)); border: 1px solid hsl(var(--hue) 45% 55% / .22); cursor: grab; touch-action: none; user-select: none;
  transition: transform .12s ease-out, border-color .12s ease-out; }
.snap-tile:hover { border-color: hsl(var(--hue) 60% 60% / .6); transform: translateY(-1px); }
.snap-tile.used { opacity: .4; cursor: default; transform: none; }
.snap-lib-q { font: inherit; color: var(--s-fg); background: var(--s-app); border: 1px solid var(--s-line); border-radius: 10px; padding: 7px 10px; min-height: 34px; box-sizing: border-box; outline: none; }
.snap-lib-q:focus { border-color: var(--s-accent); }
.snap-lib-for { all: unset; cursor: pointer; font-size: 11px; color: var(--s-accent); padding: 2px 2px; }
.snap-lib-results { display: flex; flex-direction: column; gap: 5px; }
.snap-lib-results.by-meaning::before { content: "ranked by meaning · EmbeddingGemma 2"; font-size: 10.5px; color: var(--s-dim); padding: 0 2px 2px; }
.snap-card { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 11px; background: var(--s-card); border: 1px solid var(--s-line);
  box-shadow: inset 3px 0 0 hsl(var(--hue) 70% 60% / .8); cursor: grab; touch-action: none; user-select: none; transition: border-color .12s ease-out, transform .12s ease-out; }
.snap-card:hover { border-color: hsl(var(--hue) 70% 60% / .55); transform: translateX(2px); }
.snap-kind { font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: hsl(var(--hue) 70% 72%); }
.snap-card-title { font-size: 12.5px; line-height: 1.3; padding-right: 44px; }
.snap-brick.snap-accepts { border-style: dashed; border-color: hsl(var(--hue) 70% 60% / .7); }
.snap-brick.snap-target { border-style: solid; border-color: hsl(var(--hue) 70% 62%); box-shadow: 0 0 0 5px hsl(var(--hue) 70% 60% / .22), 0 18px 40px #0008; }
.snap-main { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.snap-notes { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 40px 0; }
.snap-notes:not(:has(> :not([hidden]))) { display: none; }
.snap-notes > .snap-proposals { align-self: center; }
.snap-notes .snap-note, .snap-notes .snap-proposal { margin: 0; max-width: 680px; }
/* the recipe is a signal chain: bricks left to right, a coupler where one takes the previous one's output, bus lanes below */
.snap-stack { position: relative; flex: 1; min-height: 0; overflow: auto; display: grid; grid-auto-flow: column; grid-auto-columns: max-content; grid-auto-rows: max-content; align-items: stretch; align-content: safe center;
  justify-content: safe center; column-gap: var(--gap); row-gap: var(--gap); padding: 64px 32px calc(var(--lanes-h, 0px) + 56px); box-sizing: border-box; overscroll-behavior: contain; --gap: 26px; }
.snap-stack > .snap-empty { align-self: center; } /* rows are as tall as their tallest brick: in a short window the chain scrolls instead of a brick's face running past its card */
.snap-brick { position: relative; flex: none; width: 164px; min-height: 150px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px;
  background: linear-gradient(180deg, color-mix(in srgb, hsl(var(--hue) 24% 20%) calc(var(--veil) * 100%), transparent), color-mix(in srgb, hsl(var(--hue) 18% 14%) calc(var(--veil) * 100%), transparent));
  border: 1px solid hsl(var(--hue) 45% 58% / calc(var(--veil) * .28)); border-radius: 18px; padding: 14px;
  box-shadow: 0 1px 0 hsl(var(--hue) 70% 85% / .09) inset, 0 12px 32px #0000004d, 0 2px 4px #0003; transition: box-shadow .18s ease-out, border-color .18s ease-out; outline: none; }
.snap-brick.wide { width: 226px; }
/* a brick opened in place: wide enough for its details, the rest of the row keeps its own height */
.snap-brick.open { width: clamp(400px, 34vw, 640px); cursor: default; }
.snap-stack:has(.snap-brick.open) { align-items: start; }
.snap-brick.open .snap-head { cursor: pointer; }
.snap-details { display: flex; flex-direction: column; gap: 8px; animation: snap-details-in .26s cubic-bezier(.2, .8, .2, 1); }
@keyframes snap-details-in { from { opacity: 0; transform: translateY(6px); } }
.snap-mode { all: unset; cursor: pointer; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; color: var(--s-dim); font-size: 14px; }
.snap-mode:hover { background: #ffffff14; color: var(--s-fg); }
.snap-insp-title .snap-mode { margin-left: auto; }
.snap-head .snap-mode { grid-column: 3; grid-row: 1; }
/* during a view switch only the card shell morphs; its content is gone in the first half of the flight */
.snap-brick > * { opacity: clamp(0, calc((var(--veil) - .55) * 2.2), 1); }
.graph-canvas-container.snap-open .litegraph-minimap { display: none; }
.snap-brick:hover { border-color: hsl(var(--hue) 55% 62% / .5); }
.snap-brick.selected, .snap-brick:focus-visible { border-color: hsl(var(--hue) 75% 64% / .95); box-shadow: 0 0 0 4px hsl(var(--hue) 75% 60% / .2), 0 16px 40px #0006; }
.snap-brick.feeds::after { content: ""; position: absolute; z-index: 2; left: calc(100% - 10px); top: 22px; width: calc(var(--gap) + 20px); height: 18px; border-radius: 6px;
  background: radial-gradient(circle 3px at 15px 50%, #0007 90%, #0000), radial-gradient(circle 3px at calc(100% - 15px) 50%, #0007 90%, #0000),
    linear-gradient(90deg, hsl(var(--hue) 65% 58%), hsl(var(--next, var(--hue)) 65% 58%));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--s-app) 80%, transparent), 0 4px 12px #0006, inset 0 1px 0 #ffffff55;
  opacity: var(--veil); transition: opacity .15s ease-out; }
.snap-stack:has(.snap-lifted) .snap-brick::after { opacity: 0; }
.snap-head { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto auto; column-gap: 6px; align-items: center; cursor: grab; touch-action: none; user-select: none; }
.snap-head .snap-grip { grid-row: 1; width: 30px; height: 30px; font-size: 14px; border-radius: 9px; }
.snap-head .snap-name { grid-column: 2; font-size: 14px; line-height: 1.2; letter-spacing: -.005em; }
.snap-shot-line { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--s-dim); }
.snap-shot-line span { margin-left: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snap-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.snap-dot.beat { color: #f5d76e; } .snap-dot.character { color: #f08fb8; } .snap-dot.set, .snap-dot.blocking, .snap-dot.reference { color: #7fd1c7; } .snap-dot.camera { color: #a7b8ff; } .snap-dot.direction { color: #f0b445; }
.snap-head .snap-blurb { grid-column: 2; grid-row: 2; white-space: nowrap; }
.snap-head .snap-x { grid-column: 4; grid-row: 1; }
.snap-head .snap-fold { grid-column: 2 / -1; grid-row: 3; justify-self: start; margin: 6px 0 0; }
.snap-grip { width: 24px; height: 24px; display: inline-grid; place-items: center; border-radius: 7px; background: hsl(var(--hue) 70% 60% / .18); color: hsl(var(--hue) 80% 74%); flex: none; box-shadow: inset 0 0 0 1px hsl(var(--hue) 70% 70% / .18); }
.snap-name { font-weight: 650; }
.snap-blurb { color: var(--s-dim); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snap-x { all: unset; cursor: pointer; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 8px; color: var(--s-dim); opacity: 0; transition: opacity .15s ease-out; }
.snap-brick:hover .snap-x, .snap-brick:focus-within .snap-x { opacity: 1; }
.snap-x:hover { background: #ffffff14; color: var(--s-fg); }
.snap-face { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; }
.snap-fact { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.snap-fact span { font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--s-dim); }
.snap-fact b { font-size: 13px; font-weight: 600; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.snap-fact.missing b { color: #f0b445; font-weight: 500; }
.snap-prompt { grid-column: 1 / -1; }
.snap-model, .snap-fact.long { grid-column: 1 / -1; }
.snap-model span { display: flex; justify-content: space-between; gap: 6px; }
.snap-model span em { font-style: normal; font-weight: 500; letter-spacing: 0; text-transform: none; color: #8fe3b0; white-space: nowrap; }
.snap-model.missing span em { color: #f0b445; }
.snap-model b { font-size: 12px; line-height: 1.3; -webkit-line-clamp: 3; }
.snap-preset { all: unset; grid-column: 1 / -1; cursor: pointer; padding: 4px 9px; border-radius: 8px; font-size: 12px; font-weight: 600; background: hsl(var(--hue) 60% 60% / .16);
  box-shadow: inset 0 0 0 1px hsl(var(--hue) 60% 65% / .35); color: hsl(var(--hue) 80% 82%); overflow-wrap: anywhere; }
.snap-preset:hover, .snap-preset:focus-visible { background: hsl(var(--hue) 60% 60% / .26); }
.snap-preset.edited { box-shadow: inset 0 0 0 1px #f0b44599; }
.snap-check { font-size: 11.5px; line-height: 1.35; color: #f0b445; } .snap-check.ok { color: #8fe3b0; }
.snap-loras { display: flex; flex-direction: column; gap: 5px; }
.snap-lora { display: grid; grid-template-columns: auto 1fr auto; grid-template-areas: "on name x" ". kind v"; align-items: center; gap: 3px 6px; font-size: 12px; padding: 4px 0; border-top: 1px solid #ffffff0d; }
.snap-lora > input[type=checkbox] { grid-area: on; } .snap-lora-name { grid-area: name; } .snap-lora .snap-x { grid-area: x; }
.snap-lora-kind, .snap-lora-ask { grid-area: kind; justify-self: start; } .snap-lora-v { grid-area: v; width: 58px; }
.snap-warn { overflow-wrap: anywhere; }
.snap-lora.off { opacity: .5; }
.snap-lora-name { overflow-wrap: anywhere; line-height: 1.25; }
.snap-lora-kind { font-style: normal; font-size: 10px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; padding: 1px 6px; border-radius: 6px; background: #ffffff14; color: var(--s-dim); }
.snap-lora-kind.turbo { background: hsl(190 70% 50% / .22); color: hsl(190 80% 78%); } .snap-lora-kind.fix { background: hsl(150 60% 45% / .22); color: #8fe3b0; }
.snap-lora-kind.style { background: hsl(50 70% 50% / .2); color: #f5d76e; } .snap-lora-kind.identity { background: hsl(15 70% 55% / .22); color: #f4a988; }
.snap-lora-v, .snap-lora-ask, .snap-lora-add { background: #00000040; color: var(--s-fg); border: 1px solid var(--s-line); border-radius: 6px; font: inherit; font-size: 12px; padding: 2px 4px; min-width: 0; }
.snap-lora-add { justify-self: start; color: var(--s-dim); max-width: 100%; }
.snap-lora .snap-x { opacity: .6; }
.snap-turbo.on { background: hsl(190 70% 50% / .22); box-shadow: inset 0 0 0 1px hsl(190 70% 60% / .5); color: hsl(190 80% 82%); }
.snap-setup-about { font-size: 12px; line-height: 1.4; color: color-mix(in srgb, var(--s-fg) 80%, transparent); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.snap-setup-card strong em.tab { color: #a7b8ff; }
.snap-ab-waiting { color: #f0b445 !important; font-weight: 600; }
.snap-guidance { font-size: 11.5px; line-height: 1.35; }
.snap-setup-card.unwired { opacity: .55; cursor: default; } .snap-setup-card.unwired:hover { transform: none; box-shadow: inset 0 0 0 1px var(--s-line); }
.snap-keep { display: inline-flex; align-items: center; gap: 6px; margin-right: 10px; }
.snap-headline { grid-column: 1 / -1; font-size: 13px; font-weight: 650; line-height: 1.3; }
.snap-inline { grid-column: 1 / -1; display: flex; padding: 2px; gap: 2px; border-radius: 9px; background: #00000040; box-shadow: inset 0 0 0 1px #ffffff14; }
.snap-inline button { all: unset; flex: 1; text-align: center; cursor: pointer; padding: 3px 0; border-radius: 7px; font-size: 12px; font-weight: 600; color: var(--s-dim); }
.snap-inline button:hover { color: var(--s-fg); } .snap-inline button:focus-visible { box-shadow: 0 0 0 2px hsl(var(--hue) 75% 64%); }
.snap-inline button.on { background: hsl(var(--hue) 60% 55% / .32); color: var(--s-fg); }
.snap-brick.off > :not(.snap-head):not(.snap-face) { opacity: .45; } .snap-brick.off .snap-headline { color: var(--s-dim); } .snap-brick.off .snap-grip { filter: grayscale(1); }
.snap-setup, .snap-outside { all: unset; cursor: pointer; font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--s-card); white-space: nowrap; max-width: 46ch; min-width: 0; flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; }
.snap-setup { color: var(--s-fg); box-shadow: inset 0 0 0 1px hsl(265 60% 65% / .4); }
.snap-outside { color: #f0b445; }
.snap-setup:hover, .snap-outside:hover, .snap-setup:focus-visible, .snap-outside:focus-visible { background: #ffffff1a; }
.snap-sheet.snap-setup-sheet { inset: 64px max(24px, calc(50% - 500px)) auto; max-height: calc(100% - 100px); }
.snap-setup-scene { margin: 10px 16px 0; padding: 8px 12px; border-radius: 9px; font-size: 12.5px; background: hsl(45 80% 55% / .12); color: #f5d76e; }
.snap-setup-body { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.snap-setup-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; margin-top: 8px; }
.snap-setup-card { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 12px; background: var(--s-card); box-shadow: inset 0 0 0 1px var(--s-line); transition: box-shadow .12s ease-out, transform .12s ease-out; }
.snap-setup-card:hover, .snap-setup-card:focus-visible { box-shadow: inset 0 0 0 1px hsl(265 70% 68% / .8); transform: translateY(-1px); }
.snap-setup-card.on { box-shadow: inset 0 0 0 1px #57c78599; }
.snap-setup-card strong { font-size: 14px; display: flex; justify-content: space-between; gap: 8px; }
.snap-setup-card strong em { font-style: normal; font-size: 11px; font-weight: 500; color: #8fe3b0; }
.snap-setup-files { display: flex; flex-direction: column; gap: 4px; }
.snap-setup-files span { display: grid; grid-template-columns: 54px 1fr auto; gap: 8px; font-size: 12px; overflow-wrap: anywhere; }
.snap-setup-files i { font-style: normal; font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--s-dim); padding-top: 2px; }
.snap-setup-files em { font-style: normal; color: var(--s-dim); white-space: nowrap; }
.snap-setup-files span.missing em { color: #f0b445; }
.snap-prompt p { margin: 2px 0 0; font-size: 12px; line-height: 1.4; color: color-mix(in srgb, var(--s-fg) 85%, transparent); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.snap-field { display: flex; flex-direction: column; gap: 4px; font-size: 10.5px; font-weight: 500; letter-spacing: .02em; color: var(--s-dim); min-width: 0; }
.snap-field.snap-textarea { grid-column: 1 / -1; }
.snap-field input, .snap-field select, .snap-field textarea { font: inherit; font-size: 13px; letter-spacing: 0; color: var(--s-fg); background: #0000002e; border: 1px solid #ffffff10;
  border-radius: 9px; padding: 6px 9px; min-height: 32px; box-sizing: border-box; width: 100%; resize: vertical; outline: none; transition: border-color .12s ease-out, background-color .12s ease-out; }
.snap-field input:hover, .snap-field select:hover, .snap-field textarea:hover { background: #00000040; }
.snap-field input:focus, .snap-field select:focus, .snap-field textarea:focus { border-color: hsl(var(--hue, 215) 75% 64% / .9); }
.snap-brick .snap-field textarea { min-height: 76px; font-size: 12.5px; line-height: 1.4; }
.snap-inspector .snap-field { --hue: 215; }
.snap-field input[type=checkbox] { width: 18px; min-height: 18px; }
.snap-scrub { cursor: ew-resize; touch-action: none; user-select: none; }
.snap-binds { display: flex; flex-wrap: wrap; gap: 4px; margin-top: auto; padding-top: 2px; }
.snap-bind { all: unset; cursor: pointer; font-size: 11px; color: var(--s-dim); padding: 2px 8px; border-radius: 999px; background: #00000033;
  box-shadow: inset 0 0 0 1px hsl(var(--from, 215) 60% 60% / .45); white-space: nowrap; }
.snap-brick .snap-bind.more { display: none; }
.snap-bind.inferred { box-shadow: inset 0 0 0 1px hsl(var(--from, 215) 60% 60% / .45); border: 1px dashed transparent; }
.snap-bind.ask { box-shadow: inset 0 0 0 1px #a78bfa; color: #c4b5fd; cursor: default; display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; white-space: normal; border-radius: 10px; padding: 4px 6px; }
.snap-bind.chosen, .snap-bind.remembered { box-shadow: inset 0 0 0 1px #a78bfa; }
.snap-choice { all: unset; cursor: pointer; padding: 1px 7px; border-radius: 999px; background: #a78bfa26; }
.snap-choice:hover { background: #a78bfa4d; color: var(--s-fg); }
.snap-bind.override { box-shadow: inset 0 0 0 1px #f0b445; color: #f0b445; cursor: default; }
.snap-bind:hover { color: var(--s-fg); }
.snap-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.snap-chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: hsl(35 80% 60% / .15); color: hsl(35 80% 72%); }
.snap-meter { display: flex; align-items: center; gap: 3px; }
.snap-meter span { width: 12px; height: 6px; border-radius: 3px; background: #ffffff1a; }
.snap-meter span.on { background: hsl(var(--hue) 70% 60%); }
.snap-meter em { font-style: normal; font-size: 11px; color: var(--s-dim); margin-left: 6px; }
.snap-pics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.snap-pics figure { margin: 0; min-width: 0; }
.snap-pics img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 9px; border: 1px solid #ffffff14; display: block; background: #f4f1ea; }
.snap-pics figcaption { font-size: 10.5px; color: var(--s-dim); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snap-lanes { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }
.snap-lanes text { font: 600 10px/1 Inter, system-ui, sans-serif; letter-spacing: .05em; text-transform: uppercase; }
.snap-stack:has(.snap-lifted) .snap-lanes { opacity: 0 !important; transition: opacity .12s; }
.snap-card { position: relative; }
.snap-card-tools { position: absolute; right: 4px; top: 4px; display: flex; gap: 2px; }
.snap-edit { all: unset; cursor: pointer; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; color: var(--s-dim); }
.snap-edit:hover { background: #ffffff14; color: var(--s-fg); }
.snap-pics figure.editable { cursor: pointer; }
.snap-sheet { position: absolute; inset: var(--chrome-top, 12px) 12px 12px calc(var(--chrome-left, 0px) + 12px); z-index: 80; display: flex; flex-direction: column; background: var(--s-bg); border: 1px solid var(--s-line);
  border-radius: 16px; box-shadow: 0 30px 80px #000b; overflow: hidden; animation: snap-sheet-in .18s ease-out; }
@keyframes snap-sheet-in { from { opacity: 0; transform: translateY(8px) scale(.99); } }
.snap-sheet > header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--s-line); }
.snap-sheet > header .snap-x { opacity: 1; }
.snap-set-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; padding: 16px; }
.snap-set-plan { width: auto; height: auto; max-width: 100%; max-height: 100%; border-radius: 12px; touch-action: none; cursor: grab; background: #f4f1ea; align-self: start; outline: none; }
.snap-set-plancol { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.snap-set-plancol .snap-set-plan { max-height: calc(100% - 56px); }
.snap-scrub-row { display: flex; align-items: center; gap: 10px; }
.snap-scrub-stack { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.snap-side-track { display: flex; height: 6px; border-radius: 3px; overflow: hidden; }
.snap-side-track i { flex: 1; background: #57c78588; }
.snap-side-track i.b { background: #f0b445aa; }
.snap-side-track i.on { background: var(--s-dim); }
.snap-scrub-range { width: 100%; margin: 0; accent-color: var(--s-accent); }
.snap-set-body aside { display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.snap-set-block { margin: 0; font-size: 13px; line-height: 1.45; }
.snap-set-notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.snap-set-notes li { padding: 5px 8px; border-radius: 8px; background: var(--s-card); }
.snap-set-notes li b { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; margin-right: 4px; }
.snap-set-notes li.break { background: #f0b445; color: #1b1c20; }
.snap-set-notes li.check b { color: #f0b445; }
.snap-set-notes li.note b, .snap-set-notes li.none { color: var(--s-dim); }
.snap-set-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.snap-set-doors { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.snap-set-door { display: grid; grid-template-columns: 74px minmax(0, 1fr) 96px 22px; gap: 4px; align-items: center; }
.snap-set-door select, .snap-set-door input { min-width: 0; font: inherit; color: var(--s-fg); background: var(--s-card); border: 1px solid var(--s-line); border-radius: 6px; padding: 3px 4px; }
.snap-set-plates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.snap-set-plate { margin: 0; display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: 8px; background: var(--s-card); font-size: 11px; min-width: 0; }
.snap-set-plate img, .snap-set-plate-none { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 6px; background: #0003; }
.snap-set-plate-none { display: grid; place-items: center; color: var(--s-dim); }
.snap-set-plate figcaption { display: flex; flex-direction: column; min-width: 0; }
.snap-set-plate figcaption span { color: var(--s-dim); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.snap-set-plate figcaption button { align-self: flex-start; }
.snap-set-plate.missing .snap-set-plate-none { outline: 1px dashed var(--s-line); }
.snap-set-plate.previewing { box-shadow: inset 0 0 0 2px var(--s-accent); position: relative; }
.snap-set-preview { position: absolute; top: 8px; left: 8px; font-size: 10px; letter-spacing: .05em; text-transform: uppercase; padding: 1px 6px; border-radius: 999px; background: var(--s-accent); color: #0d1320; }
.snap-set-candrow { display: flex; flex-direction: column; gap: 4px; }
.snap-set-plates > .snap-set-candrow { grid-column: 1 / -1; padding: 2px 0 6px; }
.snap-set-count, .snap-take-sheet aside select { font: inherit; font-size: 12px; color: var(--s-fg); background: var(--s-card); border: 1px solid var(--s-line); border-radius: 8px; padding: 4px 6px; }
.snap-cands { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
.snap-cand { margin: 0; display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 8px; background: var(--s-card); font-size: 11px; min-width: 0; outline: none; }
.snap-cand:hover, .snap-cand:focus-visible { box-shadow: inset 0 0 0 1px var(--s-accent); }
.snap-cand.applied { box-shadow: inset 0 0 0 2px #57c785; }
.snap-cand.rejected, .snap-cand.failed { opacity: .55; }
.snap-cand.recommended { box-shadow: inset 0 0 0 1px #a78bfa; }
.snap-cand-pics { display: flex; gap: 3px; }
.snap-cand-pics img, .snap-cand-pics video, .snap-cand-none { flex: 1; min-width: 0; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 5px; background: #0003; }
.snap-cand.rendering .snap-cand-none { animation: snap-pulse 1.4s ease-in-out infinite; }
.snap-cand-crops { display: flex; gap: 3px; }
.snap-cand-crops img { width: 25%; aspect-ratio: 1; object-fit: cover; border-radius: 4px; background: #0003; }
.snap-cand figcaption { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.snap-cand-line { display: flex; gap: 6px; align-items: baseline; min-width: 0; }
.snap-cand-line span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snap-cand-notes { display: flex; flex-wrap: wrap; gap: 3px; }
.snap-cand-note { padding: 0 5px; border-radius: 5px; background: #ffffff10; color: var(--s-dim); white-space: nowrap; }
.snap-cand-note.warn { background: #f0b44526; color: #f0b445; }
.snap-cand-rec { color: #c4b5fd; }
.snap-cand-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.snap-cand-actions .snap-primary { margin: 0; padding: 3px 10px; font-size: 11px; }
.snap-cand-on { color: #8fe3b0; }
.snap-take-preview { grid-area: 1 / 1; width: 100%; height: 100%; min-height: 0; object-fit: contain; position: relative; z-index: 3; pointer-events: none; } /* above the video's own layer */
.snap-take-preview-tag { position: absolute; z-index: 4; top: 10px; left: 10px; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--s-accent); color: #0d1320; }
.snap-take-parent { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: #6aa8ff22; color: #9cc5ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.snap-take-edits { display: flex; flex-direction: column; gap: 8px; }
.snap-from { align-self: flex-start; font-size: 11px; }
.snap-set-plate.rendering .snap-set-plate-none { animation: snap-pulse 1.4s ease-in-out infinite; }
@keyframes snap-pulse { 50% { opacity: .45; } }
@container (max-width: 760px) { .snap-set-body { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { .snap-sheet { animation: none; } }
.snap-proposals { display: inline-flex; flex: none; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; padding: 2px 4px 2px 10px; border-radius: 999px; background: #a78bfa22; color: #c4b5fd; }
.snap-proposals button { all: unset; cursor: pointer; padding: 2px 8px; border-radius: 999px; }
.snap-proposals button:hover { background: #ffffff14; }
.snap-ghost-brick { display: flex; align-items: center; gap: 8px; border-style: dashed; border-color: hsl(var(--hue) 70% 60% / .6); background: color-mix(in srgb, var(--s-card) 45%, transparent); opacity: .85; }
.snap-ghost-brick::before { opacity: .4; }
.snap-proposal { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; padding: 6px 8px; border: 1px dashed #a78bfa88; border-radius: 10px; font-size: 12px; }
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
.snap-board { flex: 1; min-height: 0; display: flex; align-items: flex-start; gap: 0; overflow-x: auto; padding: 18px; }
.snap-board-frame { flex: none; width: 300px; margin: 0; cursor: pointer; border-radius: 12px; outline: none; }
.snap-board-frame:focus-visible, .snap-board-frame:hover { box-shadow: 0 0 0 2px var(--s-accent); }
.snap-board-plan { width: 300px; height: auto; border-radius: 10px; display: block; background: #f4f1ea; }
.snap-board-frame figcaption { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--s-dim); padding: 8px 2px; }
.snap-board-frame figcaption strong { color: var(--s-fg); }
.snap-board-gap { flex: none; width: 110px; align-self: flex-start; margin-top: 90px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: help; }
.snap-board-gap::before { content: ""; width: 54px; height: 2px; background: var(--s-line); margin-bottom: 4px; }
.snap-board-why { font-size: 11px; line-height: 1.3; color: var(--s-dim); padding: 0 6px; }
.snap-badge { font-size: 10px; letter-spacing: .04em; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; background: var(--s-card); color: var(--s-dim); }
.snap-badge.break { background: #f0b445; color: #1b1c20; }
.snap-badge.check { color: #f0b445; }
.snap-brick.snap-folded { display: none; }
.snap-fold { all: unset; cursor: pointer; font-size: 11px; color: var(--s-dim); padding: 2px 8px; border-radius: 999px; background: var(--s-bg); margin-left: 6px; }
.snap-fold:hover { color: var(--s-fg); }
.snap-shot-parts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; }
.snap-part { font-size: 10px; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; background: var(--s-bg); color: var(--s-dim); cursor: help; }
.snap-part.beat { color: #f5d76e; } .snap-part.character { color: #f08fb8; } .snap-part.set, .snap-part.blocking, .snap-part.reference { color: #7fd1c7; }
.snap-part.camera { color: #a7b8ff; } .snap-part.direction { color: #f0b445; }
.snap-quiet { color: var(--s-dim); font-size: 12px; }
/* dials: two-sided sliders on the rack brick, the picker, the maker */
.snap-dials { display: flex; flex-direction: column; gap: 10px; }
.snap-dial { display: flex; flex-direction: column; gap: 3px; }
.snap-dial.off { opacity: .45; }
.snap-dial-top { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.snap-dial-top input[type=checkbox] { margin: 0; accent-color: hsl(35 85% 60%); }
.snap-dial-name { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snap-dial-v { font: 600 12px/1 ui-monospace, monospace; color: hsl(35 85% 72%); }
.snap-dial .snap-x { width: 18px; height: 18px; }
.snap-dial:hover .snap-x { opacity: 1; }
.snap-dial-range { -webkit-appearance: none; appearance: none; width: 100%; height: 18px; margin: 0; background: transparent; cursor: ew-resize; }
.snap-dial-range::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: linear-gradient(90deg, transparent calc(50% - 1px), #ffffff55 calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)), var(--bands); }
.snap-dial-range::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -4px; border-radius: 50%; background: hsl(35 90% 65%); box-shadow: 0 0 0 3px #0006, 0 2px 6px #0008; }
.snap-dial-range::-moz-range-track { height: 6px; border-radius: 3px; background: var(--bands); }
.snap-dial-range::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 50%; background: hsl(35 90% 65%); }
.snap-dial-ends { display: flex; justify-content: space-between; gap: 6px; font-size: 10.5px; color: var(--s-dim); }
.snap-dial-ends em { font-style: normal; color: #f0b445; }
.snap-dial-warn { font-size: 11.5px; color: #f0b445; }
.snap-dial-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.snap-dial-actions .snap-quiet-btn { padding: 4px 8px; font-size: 11.5px; }
.snap-dial-sheet { inset: 40px max(24px, calc(50% - 560px)); }
.snap-dial-pick { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.snap-dial-grid { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; align-content: start; }
.snap-dial-tile { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 12px; background: var(--s-card); box-shadow: inset 0 0 0 1px var(--s-line); transition: box-shadow .12s ease-out, transform .12s ease-out; }
.snap-dial-tile:hover, .snap-dial-tile:focus-visible { box-shadow: inset 0 0 0 1px hsl(35 85% 60% / .8); transform: translateY(-1px); }
.snap-dial-tile.on { box-shadow: inset 0 0 0 1px #57c78599; }
.snap-dial-tile strong { font-size: 14px; }
.snap-dial-tile .snap-quiet { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.snap-dial-meta { display: flex; flex-wrap: wrap; gap: 4px; }
.snap-dial-meta i { font-style: normal; font-size: 10.5px; padding: 2px 7px; border-radius: 999px; background: #ffffff10; color: var(--s-dim); }
.snap-dial-meta i.warn { color: #f0b445; } .snap-dial-meta i.file { font-family: ui-monospace, monospace; background: none; padding-left: 0; } .snap-dial-meta i.ok { color: #8fe3b0; }
.snap-dial-make { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding: 16px 20px; }
.snap-dial-make .snap-field input, .snap-dial-make .snap-field textarea { --hue: 35; }
.snap-dial-sides { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: end; }
.snap-dial-arrow { font-size: 20px; color: var(--s-dim); padding-bottom: 6px; }
.snap-pairs { display: flex; flex-direction: column; gap: 8px; }
.snap-pair { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: start; }
.snap-pair textarea { font: inherit; font-size: 13px; color: var(--s-fg); background: #0000002e; border: 1px solid #ffffff14; border-radius: 9px; padding: 7px 9px; resize: vertical; }
.snap-pair textarea:first-child { border-left: 3px solid hsl(210 70% 60% / .7); } .snap-pair textarea:nth-child(2) { border-left: 3px solid hsl(35 85% 60% / .8); }
.snap-pair .snap-x { opacity: .6; }
.snap-dial-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.snap-dial-two > div { display: flex; flex-direction: column; gap: 8px; }
.snap-dial-go { display: flex; align-items: flex-start; gap: 12px; margin-top: 4px; }
.snap-dial-status { flex: 1; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 11.5px; max-height: 160px; overflow: auto; }
.snap-dial-go .snap-primary { margin: 0; }
/* live run on the bricks */
.snap-brick.running { border-color: hsl(var(--hue) 80% 66%); box-shadow: 0 0 0 4px hsl(var(--hue) 80% 60% / .22), 0 0 32px hsl(var(--hue) 80% 60% / .35); }
.snap-brick.running::before { content: ""; position: absolute; left: 14px; right: 14px; bottom: 8px; height: 3px; border-radius: 2px; background: linear-gradient(90deg, hsl(var(--hue) 80% 66%) calc(var(--run-p, 0) * 100%), #ffffff14 0); }
.snap-brick.failed { border-color: #f0b445; box-shadow: 0 0 0 4px #f0b44533; }
.snap-brick.failed::before { content: attr(data-error); position: absolute; left: 10px; right: 10px; top: calc(100% + 8px); font-size: 11px; color: #f0b445; line-height: 1.3; }
/* takes */
.snap-takes { flex: none; height: 232px; display: flex; flex-direction: column; border-top: 1px solid var(--s-line); background: color-mix(in srgb, var(--s-bg) calc(var(--veil) * 70%), transparent); }
.snap-takes.empty { height: 92px; }
.snap-takes > header { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; padding: 10px 18px 6px; }
.snap-takes-hint { white-space: nowrap; }
.snap-takes > header strong { font-size: 13px; }
.snap-takes-strip { flex: 1; min-height: 0; display: flex; gap: 12px; overflow: auto hidden; padding: 4px 18px 14px; align-items: stretch; }
.snap-takes-strip > .snap-quiet { align-self: center; }
.snap-take { flex: none; width: 216px; margin: 0; display: flex; flex-direction: column; gap: 6px; border-radius: 12px; cursor: pointer; outline: none; transition: transform .12s ease-out; }
.snap-take:hover, .snap-take:focus-visible { transform: translateY(-2px); }
.snap-take.dragging { opacity: .4; }
.snap-take.drop-before { box-shadow: -4px 0 0 var(--s-accent); }
.snap-take-media { position: relative; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden; background: #000; border: 1px solid #ffffff14; }
.snap-take-media video, .snap-take-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.snap-take.keep .snap-take-media { border-color: #57c785; } .snap-take.reject .snap-take-media { opacity: .55; }
.snap-take.error .snap-take-media, .snap-take.interrupted .snap-take-media { border-color: #f0b445; }
.snap-take-none { display: grid; place-items: center; height: 100%; color: var(--s-dim); font-size: 11px; }
.snap-take-rank { position: absolute; left: 6px; top: 6px; font: 700 12px/1 Inter, system-ui, sans-serif; padding: 4px 7px; border-radius: 7px; background: #000a; color: #fff; }
.snap-take-rank:empty { display: none; }
.snap-take-verdict { position: absolute; right: 6px; bottom: 6px; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: #000a; font-size: 12px; }
.snap-take.keep .snap-take-verdict { color: #57c785; } .snap-take.reject .snap-take-verdict { color: #f08f8f; }
.snap-take-prior { position: absolute; left: 6px; bottom: 6px; font-size: 10px; padding: 2px 6px; border-radius: 6px; background: #f5d76e; color: #1b1c20; font-weight: 700; }
.snap-take-pick { position: absolute; right: 6px; top: 6px; width: 16px; height: 16px; margin: 0; accent-color: var(--s-accent); opacity: .5; }
.snap-take:hover .snap-take-pick, .snap-take-pick:checked { opacity: 1; }
.snap-take figcaption { font-size: 12px; display: flex; flex-wrap: wrap; gap: 0 4px; align-items: baseline; }
.snap-take figcaption .snap-quiet { flex-basis: 100%; font-size: 11px; }
.snap-take figcaption em { color: #f0b445; font-style: normal; }
.snap-seed { grid-column: 1 / -1; }
.snap-seed-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.snap-seed .snap-inline button { padding: 3px 10px; }
.snap-toggle { display: grid; gap: 4px; } .snap-toggle .snap-inline { max-width: 160px; } .snap-toggle em { font-style: normal; font-size: 11.5px; color: var(--s-dim); line-height: 1.35; }
.snap-dice { all: unset; cursor: pointer; font-size: 16px; line-height: 1; padding: 1px 5px; border-radius: 6px; color: var(--s-dim); }
.snap-dice:hover { background: #ffffff14; color: inherit; }
.snap-take-stale { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: #f0b44526; color: #f0b445; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.snap-tile-kit { display: block; font-size: 10.5px; font-weight: 500; color: var(--s-dim); }
.snap-face-line { font-size: 12.5px; font-weight: 600; }
.snap-take-paint input[type=text], .snap-take-clips { font: inherit; font-size: 13px; color: var(--s-fg); background: #0000002e; border: 1px solid #ffffff14; border-radius: 9px; padding: 7px 9px; }
.snap-take-paint input[type=text] { flex: 1 1 100%; min-width: 0; }
.snap-take-paint input[type=text]:focus, .snap-take-clips:focus { outline: none; border-color: hsl(215 75% 64% / .9); }
.snap-cand-pin { display: block; font-size: 12px; margin: 2px 0; }
.snap-take-clips { width: 52px; }
.snap-take-burn { display: flex; gap: 8px; align-items: center; font-size: 12.5px; }
.snap-take-burn input { flex: 1; }
.snap-take-rating { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: #c0607a33; color: var(--s-fg); white-space: nowrap; }
.snap-take-ratingrow { display: grid; gap: 2px; font-size: 12.5px; }
.snap-take-ratingrow label { display: flex; gap: 6px; align-items: center; }
.snap-take-kept { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: #f0b44533; color: var(--s-fg); white-space: nowrap; }
.snap-take-keptline { margin: 0; padding: 8px 12px; border-radius: 10px; border: 1px solid #f0b44566; font-size: 12.5px; }
.snap-take-quiet { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: #6aa8ff33; color: var(--s-fg); white-space: nowrap; }
.snap-take-quietrow { display: grid; gap: 4px; padding: 10px 12px; border-radius: 10px; border: 1px solid #6aa8ff55; background: #6aa8ff14; }
.snap-take-quietrow .snap-set-actions { margin: 0; }
.snap-take-copy { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: #f0b445; color: #1b1c20; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.snap-take-copyline > div { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
.snap-take-lock { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: hsl(15 70% 55% / .22); color: #f4a988; }
.snap-take-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 16px; padding: 16px; }
.snap-take-left { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.snap-take-stage { position: relative; flex: 1; min-height: 0; background: #000; border-radius: 12px; overflow: hidden; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); }
.snap-take-stage > video, .snap-take-stage > img { width: 100%; height: 100%; min-height: 0; object-fit: contain; grid-area: 1 / 1; }
.snap-take-overlay { grid-area: 1 / 1; width: 100%; height: 100%; pointer-events: none; position: relative; z-index: 2; } /* above the video's own layer */
.snap-take-overlay.marking { pointer-events: auto; cursor: crosshair; }
.snap-take-markers { position: relative; height: 10px; margin: 0 12px; }
.snap-take-markers i { position: absolute; top: 0; width: 3px; height: 10px; margin-left: -1px; border-radius: 2px; background: #f0b445; }
.snap-take-markers i.right { background: #57c785; }
.snap-take-sheet aside { display: flex; flex-direction: column; gap: 8px; overflow: auto; min-height: 0; }
.snap-verdicts { display: flex; gap: 8px; }
.snap-verdict { all: unset; cursor: pointer; flex: 1; text-align: center; padding: 9px; border-radius: 10px; font-weight: 600; background: var(--s-card); box-shadow: inset 0 0 0 1px var(--s-line); }
.snap-verdict.keep.on { background: #57c78533; color: #8fe3b0; box-shadow: inset 0 0 0 1px #57c785; }
.snap-verdict.reject.on { background: #f08f8f2b; color: #f6b0b0; box-shadow: inset 0 0 0 1px #f08f8f; }
.snap-take-rankline { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--s-dim); }
.snap-sentiment { align-self: flex-start; }
.snap-sentiment button.on.wrong { color: #f0b445; } .snap-sentiment button.on.right { color: #57c785; }
.snap-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.snap-tag { all: unset; cursor: pointer; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--s-card); color: var(--s-dim); box-shadow: inset 0 0 0 1px var(--s-line); }
.snap-tag.on.wrong { background: #f0b44526; color: #f5c46a; box-shadow: inset 0 0 0 1px #f0b44599; }
.snap-tag.on.right { background: #57c78526; color: #8fe3b0; box-shadow: inset 0 0 0 1px #57c78599; }
.snap-take-noteline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.snap-take-noteline .snap-primary { margin: 0; padding: 7px 14px; }
.snap-link.on { box-shadow: inset 0 0 0 1px var(--s-accent); color: var(--s-fg); }
.snap-take-notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.snap-take-notes li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 5px 8px; border-radius: 9px; background: var(--s-card); border-left: 3px solid #f0b445; }
.snap-take-notes li.right { border-left-color: #57c785; }
.snap-take-delta { margin: 0; padding-left: 16px; font-size: 12px; color: var(--s-dim); } .snap-take-delta b { color: var(--s-fg); font-weight: 600; }
.snap-take-text { font-size: 12px; white-space: pre-wrap; color: var(--s-dim); }
.snap-compare { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 16px 16px 0; }
.snap-compare figure { margin: 0; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.snap-compare video, .snap-compare img { width: 100%; flex: 1; min-height: 0; object-fit: contain; background: #000; border-radius: 12px; }
.snap-compare figcaption { text-align: center; font-weight: 700; font-size: 15px; }
.snap-compare-pick { display: flex; gap: 10px; align-items: center; padding: 14px 16px 16px; }
.snap-compare-pick .snap-lib-q { flex: 1; }
.snap-compare-pick .snap-primary, .snap-compare-pick .snap-link { margin: 0; }
.snap-card-thumb { margin: -2px -4px 4px; border-radius: 8px; overflow: hidden; aspect-ratio: 16 / 9; background: #000; }
.snap-card-thumb video, .snap-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
@container (max-width: 760px) { .snap-takes { height: 200px; } .snap-takes-hint { order: 9; flex-basis: 100%; } .snap-takes.empty { height: auto; } /* phone: the hint gets its own row under Takes … Compare, and the empty strip's sentence its whole height */ .snap-take-body { grid-template-columns: minmax(0, 1fr); } }
.snap-empty { margin: auto; text-align: center; display: flex; flex-direction: column; gap: 10px; align-items: center; max-width: 440px; }
.snap-empty-art { display: flex; align-items: center; margin-bottom: 14px; }
.snap-empty-art i { width: 64px; height: 46px; border-radius: 12px; background: linear-gradient(180deg, hsl(var(--hue) 40% 30%), hsl(var(--hue) 30% 20%)); border: 1px solid hsl(var(--hue) 50% 60% / .4); }
.snap-empty-art b { width: 22px; height: 10px; margin: 0 -4px; z-index: 1; border-radius: 4px; background: hsl(var(--hue) 65% 58%); }
.snap-empty-title { font-size: 24px; font-weight: 700; letter-spacing: -.02em; }
.snap-primary, .snap-link { all: unset; cursor: pointer; padding: 9px 16px; border-radius: 11px; background: linear-gradient(180deg, #8ab9ff, #5b97f5); color: #0b1220; font-weight: 600; margin-top: 6px; box-shadow: 0 1px 0 #ffffff55 inset; }
.snap-link { background: var(--s-card); color: var(--s-fg); font-weight: 500; box-shadow: inset 0 0 0 1px var(--s-line); align-self: flex-start; }
.snap-empty .snap-link { align-self: center; }
.snap-link:hover, .snap-primary:hover { filter: brightness(1.1); }
.snap-primary:disabled { opacity: .4; cursor: default; filter: saturate(.3); }
.snap-pressed { filter: brightness(1.08); }
.snap-lifted { z-index: 5; box-shadow: 0 24px 48px #0009, 0 4px 10px #0005 !important; cursor: grabbing; }
.snap-ghost { z-index: 60; pointer-events: none; }
.snap-ghost.snap-acquired { border-color: var(--s-accent); }
.snap-quiet-btn { margin-top: 0; padding: 6px 11px; font-size: 12.5px; color: var(--s-dim); box-shadow: none; background: transparent; }
.snap-quiet-btn:hover { color: var(--s-fg); background: var(--s-card); }
/* the first thing to press when working with an agent: as big as Run, in the agents' violet */
.snap-see { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; padding: 7px 16px; border-radius: 10px; font-weight: 700; font-size: 13.5px; color: #1a1030;
  background: linear-gradient(180deg, #c4b5fd, #a78bfa); box-shadow: 0 1px 0 #ffffff66 inset, 0 4px 16px #a78bfa55; transition: filter .15s ease-out, transform .1s ease-out; white-space: nowrap; }
.snap-see:hover { filter: brightness(1.08); } .snap-see:active { transform: scale(.97); }
.snap-see.on { color: #fff; background: linear-gradient(180deg, #f87171, #dc2626); box-shadow: 0 1px 0 #ffffff44 inset, 0 0 0 0 #f8717188; animation: snap-see-pulse 2s ease-out infinite; }
@keyframes snap-see-pulse { 0% { box-shadow: 0 1px 0 #ffffff44 inset, 0 0 0 0 #f8717199; } 70% { box-shadow: 0 1px 0 #ffffff44 inset, 0 0 0 10px #f8717100; } 100% { box-shadow: 0 1px 0 #ffffff44 inset, 0 0 0 0 #f8717100; } }
@media (prefers-reduced-motion: reduce) { .snap-see.on { animation: none; } }
/* metadata in saved files: a switch beside Run, the knob right while on (SNAP-R20) */
.snap-account { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: 10px; font-size: 12.5px; white-space: nowrap; color: var(--s-dim); border: 1px solid var(--s-line); }
.snap-account strong { color: var(--s-fg); font-weight: 600; }
.snap-account span { padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 700; background: var(--s-card); color: var(--s-fg); }
.snap-account a { color: var(--s-accent); text-decoration: none; } .snap-account a:hover { text-decoration: underline; }
.snap-locked { position: fixed; z-index: 3000; top: 18px; left: 50%; transform: translateX(-50%); width: min(420px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 16px 18px; border-radius: 14px; background: var(--comfy-menu-bg, #16171b); color: var(--fg-color, #ececef); border: 1px solid #f5b94a88;
  box-shadow: 0 12px 40px #000a; font: 14px/1.45 system-ui, sans-serif; display: grid; gap: 6px; pointer-events: auto; } /* a core modal sets pointer-events: none on the body */
.snap-locked strong { font-size: 15px; } .snap-locked p { margin: 0; color: var(--descrip-text, #9a9ca5); }
.snap-locked .snap-primary { justify-self: start; }
.snap-meta { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 8px; border-radius: 10px; font-weight: 600; font-size: 12.5px; white-space: nowrap;
  color: var(--s-dim); background: var(--s-card); transition: color .15s ease-out; }
.snap-meta i { position: relative; width: 26px; height: 15px; border-radius: 999px; background: color-mix(in srgb, var(--s-dim) 45%, transparent); transition: background-color .15s ease-out; }
.snap-meta i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: var(--s-fg); transition: transform .15s ease-out; }
.snap-meta.on { color: var(--s-fg); } .snap-meta.on i { background: #57c785; } .snap-meta.on i::after { transform: translateX(11px); }
.snap-meta:hover { filter: brightness(1.1); } .snap-meta:focus-visible { box-shadow: 0 0 0 2px var(--s-accent); }
@container (max-width: 1440px) { .snap-kbd { display: none; } } /* the metadata switch needs the room; Ctrl K still works */
.snap-kbd { white-space: pre; }
@media (prefers-reduced-motion: reduce) { .snap-meta i, .snap-meta i::after { transition: none; } }
.snap-palette { position: absolute; left: 50%; top: 16%; transform: translateX(-50%); width: min(560px, calc(100% - 32px)); z-index: 70;
  background: var(--s-bg); border: 1px solid var(--s-line); border-radius: 16px; box-shadow: 0 30px 80px #000b; overflow: hidden; }
.snap-palette input { all: unset; box-sizing: border-box; width: 100%; padding: 16px 18px; font-size: 16px; border-bottom: 1px solid var(--s-line); }
.snap-results { max-height: 340px; overflow: auto; padding: 6px; }
.snap-hit { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; cursor: pointer; min-height: 30px; }
.snap-hit.on, .snap-hit:hover { background: var(--s-card); }
/* the toast sits under Run, at the chain's top right: at the bottom it covered the takes strip a run's take lands in (U51) */
.snap-toast { position: absolute; z-index: 90; top: 62px; right: 16px; transform: translateY(-8px); opacity: 0; pointer-events: none; padding: 10px 16px; max-width: min(560px, 70%);
  border-radius: 12px; background: var(--s-fg); color: var(--s-bg); font-size: 12.5px; box-shadow: 0 12px 32px #0008; transition: opacity .15s ease-out, transform .15s ease-out; }
.snap-toast.show { opacity: 1; transform: none; }
.snap-root.inspecting .snap-toast { right: calc(var(--insp-w, clamp(380px, 33vw, 860px)) + 16px); }
.snap-root:has(.snap-sheet) .snap-toast { top: 6px; right: 50%; transform: translate(50%, -8px); } .snap-root:has(.snap-sheet) .snap-toast.show { transform: translate(50%, 0); } /* over a sheet: its header row is clear in the middle */
.snap-toast.bad { background: #f0b445; color: #1b1c20; }
/* the scene navigator above the chain (U59): breadcrumb, shots strip; a scratch tab gets one quiet line */
.snap-scene { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 40px 0; min-width: 0; }
.snap-scene.scratch { flex-direction: row; align-items: center; gap: 8px; padding: 8px 40px 0; font-size: 12px; }
.snap-scene.busy { opacity: .6; pointer-events: none; }
.snap-scene-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.snap-crumbs { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: 13px; white-space: nowrap; overflow: hidden; }
.snap-crumbs > i { color: var(--s-dim); font-style: normal; padding: 0 2px; }
.snap-crumb { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 6px; color: var(--s-dim); overflow: hidden; text-overflow: ellipsis; }
.snap-crumb:hover, .snap-crumb:focus-visible { background: var(--s-card); color: var(--s-fg); }
.snap-crumbs > .snap-crumb:last-child { color: #f5d76e; font-weight: 600; }
.snap-crumb-here { font-weight: 600; padding: 2px 6px; overflow: hidden; text-overflow: ellipsis; }
.snap-scene-set { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--s-card); color: var(--s-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 32ch; }
.snap-shots { display: flex; gap: 10px; overflow: auto hidden; padding: 2px 2px 4px; }
.snap-shot-tile { flex: none; width: 136px; margin: 0; display: flex; flex-direction: column; gap: 4px; cursor: pointer; border-radius: 10px; outline: none; }
.snap-shot-media { position: relative; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: #000; border: 1px solid #ffffff14; }
.snap-shot-media video, .snap-shot-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.snap-shot-media .snap-take-none { font-size: 10.5px; padding: 0 8px; text-align: center; background: var(--s-card); }
.snap-shot-media b { position: absolute; left: 5px; top: 5px; font: 700 11px/1 Inter, system-ui, sans-serif; padding: 3px 6px; border-radius: 6px; background: #000a; color: #fff; }
.snap-shot-tile.on .snap-shot-media { border-color: var(--s-accent); box-shadow: 0 0 0 2px var(--s-accent); }
.snap-shot-tile:not(.on):hover .snap-shot-media, .snap-shot-tile:focus-visible .snap-shot-media { box-shadow: 0 0 0 2px #ffffff40; }
.snap-shot-tile figcaption { font-size: 12px; display: flex; flex-direction: column; min-width: 0; }
.snap-shot-tile figcaption strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.snap-shot-tile figcaption .snap-quiet { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.snap-shot-tile.dragging { opacity: .4; } .snap-shot-tile.drop-before .snap-shot-media { box-shadow: -4px 0 0 var(--s-accent); }
.snap-scene-menu { position: absolute; z-index: 90; display: flex; flex-direction: column; min-width: 240px; max-width: 420px; padding: 6px; background: var(--s-bg); border: 1px solid var(--s-line); border-radius: 12px; box-shadow: 0 16px 40px #000a; }
.snap-scene-menu button { all: unset; cursor: pointer; padding: 7px 10px; border-radius: 8px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.snap-scene-menu button:hover, .snap-scene-menu button:focus-visible { background: var(--s-card); }
.snap-sheet.snap-scenes-sheet { inset: 64px max(16px, calc(50% - 480px)) auto; max-height: calc(100% - 100px); }
.snap-scene-list { overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; }
.snap-scene-row { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(0, 2fr) auto; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px; background: var(--s-card); }
.snap-scene-acts { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; max-width: 520px; } .snap-scene-acts > .snap-quiet { font-size: 12px; max-width: 300px; }
.snap-danger { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600; background: #e5534b; color: #fff; white-space: nowrap; }
.snap-danger:hover, .snap-danger:focus-visible { background: #f06a62; }
.snap-shot-tile { position: relative; }
.snap-shot-more { all: unset; position: absolute; top: 4px; right: 4px; z-index: 2; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; background: #0009; color: #fff;
  font-size: 14px; cursor: pointer; opacity: 0; } .snap-shot-tile:hover .snap-shot-more, .snap-shot-tile.on .snap-shot-more, .snap-shot-more:focus-visible { opacity: 1; }
.snap-scene-rename { display: flex; gap: 6px; align-items: center; padding: 4px; } .snap-scene-rename input { flex: 1; min-width: 0; }
.snap-scene-confirm { display: flex; flex-direction: column; gap: 8px; padding: 6px 10px 8px; } .snap-scene-confirm .snap-quiet { white-space: normal; font-size: 12px; }
.snap-scene-confirm .snap-danger { align-self: flex-start; }
.snap-scene-menu button.snap-danger { background: #e5534b; color: #fff; font-weight: 600; padding: 6px 12px; } .snap-scene-menu button.snap-danger:hover { background: #f06a62; }
.snap-scene-menu button.snap-primary { background: linear-gradient(180deg, #8ab9ff, #5b97f5); color: #0b1220; font-weight: 600; padding: 6px 12px; margin: 0; }
.snap-scene-row.on { box-shadow: 0 0 0 1px var(--s-accent) inset; }
.snap-scene-name { display: flex; flex-direction: column; min-width: 0; }
.snap-scene-name .snap-quiet { font-size: 11.5px; }
.snap-scene-thumbs { display: flex; gap: 6px; overflow: hidden; min-width: 0; }
.snap-scene-thumbs .snap-shot-media { width: 84px; flex: none; }
.snap-scene-new { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-top: 1px solid var(--s-line); flex-wrap: wrap; }
.snap-scene-new .snap-lib-q { flex: 1; min-width: 200px; margin: 0; }
.snap-scene-new select { font: inherit; font-size: 12px; color: var(--s-fg); background: var(--s-card); border: 1px solid var(--s-line); border-radius: 8px; padding: 6px; max-width: 260px; }
/* a shot's takes as a tree: versions in a bracket after the take they came from; the active take wears a star */
.snap-take-family { flex: none; display: flex; gap: 8px; align-items: stretch; }
.snap-take-versions { display: flex; gap: 8px; padding-left: 10px; border-left: 2px solid #6aa8ff66; }
.snap-take.version { width: 188px; }
.snap-take.active .snap-take-media { border-color: #f5d76e; box-shadow: 0 0 0 1px #f5d76e; }
.snap-take-star { all: unset; cursor: pointer; font-size: 11px; padding: 0 5px; border-radius: 6px; color: var(--s-dim); }
.snap-take-star:hover { color: #f5d76e; background: #f5d76e1f; }
.snap-take-star.on { color: #1b1c20; background: #f5d76e; font-weight: 700; cursor: default; }
.snap-take figcaption .snap-take-of { flex-basis: auto; font-size: 11px; }
.snap-take-sheet > header .snap-crumbs { font-size: 14px; }
@container (max-width: 760px) { .snap-scene, .snap-scene.scratch { padding-left: 12px; padding-right: 12px; } .snap-scene.scratch, .snap-scene-top { flex-wrap: wrap; row-gap: 2px; } .snap-scene-set { display: none; }
  .snap-scene-top .snap-crumbs { flex: 1 1 100%; flex-wrap: wrap; white-space: normal; } .snap-scene-top .snap-spacer { display: none; }
  .snap-scene-row { grid-template-columns: minmax(0, 1fr) auto; } .snap-scene-thumbs { grid-column: 1 / -1; grid-row: 2; } }
/* narrow: a phone, or Snap docked in the sidebar next to the graph: the chain runs top to bottom */
@container (max-width: 760px) {
  .snap-body { grid-template-columns: minmax(0, 1fr); } .snap-rail, .snap-inspector { display: none; }
  .snap-stack { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; padding: 16px 12px 48px; --gap: 28px; }
  .snap-brick, .snap-brick.wide { width: auto; min-height: 0; }
  .snap-brick.feeds::after { left: 50%; top: calc(100% - 10px); width: 18px; height: calc(var(--gap) + 20px); margin-left: -9px; background: linear-gradient(180deg, hsl(var(--hue) 65% 58%), hsl(var(--next, var(--hue)) 65% 58%)); }
  .snap-lanes { display: none; } .snap-brick .snap-bind.more { display: inline-block; } .snap-insp-handle { display: none !important; }
  .snap-top { padding: 0 10px; gap: 6px; } .snap-brand, .snap-top .snap-quiet-btn { display: none; } .snap-notes { padding: 10px 12px 0; }
}
.snap-root.docked { position: absolute; z-index: 2; }
.snap-root.docked .snap-seg, .snap-root.docked .snap-run { display: none; }
@media (prefers-reduced-motion: reduce) { .snap-details { animation: none; } }
@media (prefers-reduced-motion: reduce) { .snap-toast, .snap-seg button, .snap-brick, .snap-tile, .snap-card { transition: none; } }
@container (max-width: 560px) { .snap-setup, .snap-outside, .snap-see, .snap-account { display: none; } .snap-meta span { display: none; } .snap-title { min-width: 0; } } /* phone width: the Setup chip opens the setups; the metadata switch keeps its knob and its name for screen readers */
/* onboarding (SNAP-R25): one calm question per step, a centred column, defaults pre-picked */
.snap-sheet.snap-onboard { inset: 0; border: 0; border-radius: 0; box-shadow: none; }
.snap-onboard .snap-ob-body { flex: 1; overflow: auto; padding: 48px max(24px, calc(50% - 360px)) 24px; display: flex; flex-direction: column; gap: 14px; }
.snap-onboard h2 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -.015em; }
.snap-onboard .snap-ob-body > p { margin: 0; font-size: 14px; max-width: 60ch; }
.snap-ob-dots { display: flex; gap: 6px; margin-right: 8px; } .snap-ob-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--s-line); }
.snap-ob-dots i.done { background: color-mix(in srgb, var(--s-accent) 45%, var(--s-line)); } .snap-ob-dots i.on { background: var(--s-accent); width: 18px; border-radius: 4px; }
.snap-ob-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-top: 8px; } .snap-ob-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 520px; }
.snap-ob-choice { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 12px; background: var(--s-card); box-shadow: inset 0 0 0 1px var(--s-line); transition: box-shadow .12s ease-out; }
.snap-ob-choice strong { font-size: 14px; font-weight: 600; } .snap-ob-choice:hover { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--s-fg) 35%, var(--s-line)); }
/* picked reads as picked (filled, an accent ring and a check); hover and keyboard focus stay neutral rings outside, so
   neither looks like a pick while the footer says "Pick at least one" */
.snap-ob-choice { position: relative; } .snap-ob-choice:focus-visible { outline: 2px solid color-mix(in srgb, var(--s-fg) 55%, transparent); outline-offset: 3px; }
.snap-ob-choice.on { box-shadow: inset 0 0 0 2px var(--s-accent); background: color-mix(in srgb, var(--s-accent) 16%, var(--s-card)); }
.snap-ob-choice.on::after { content: "✓"; position: absolute; top: 10px; right: 12px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: var(--s-bg); background: var(--s-accent); }
.snap-ob-scan, .snap-ob-tasks { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.snap-ob-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px; background: var(--s-card); } .snap-ob-row > strong { min-width: 150px; }
.snap-ob-row > span:not(.snap-spacer) { flex: 1; color: var(--s-dim); }
.snap-ob-state { font-style: normal; font-size: 12px; font-weight: 600; white-space: nowrap; color: var(--s-dim); } .snap-ob-state.ready { color: #57c785; } .snap-ob-state.missing { color: #f0b445; } .snap-ob-state.cant_load { color: #e5534b; }
.snap-ob-kit { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.snap-ob-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.snap-ob-card { display: flex; flex-direction: column; gap: 5px; padding: 14px 16px; border-radius: 12px; background: var(--s-card); box-shadow: inset 0 0 0 1px var(--s-line); }
.snap-ob-card strong { font-size: 15px; } .snap-ob-card .snap-quiet { font-size: 12px; }
.snap-ob-card-top { display: flex; justify-content: space-between; align-items: center; } .snap-ob-card-top i { font-style: normal; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--s-dim); }
.snap-ob-try { margin: 2px 0 0; font-size: 13px; color: var(--s-dim); } .snap-ob-try b { color: var(--s-fg); font-weight: 600; }
.snap-ob-downloads { margin-top: 18px; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--s-line); padding-top: 14px; } .snap-ob-downloads p { margin: 0; }
.snap-ob-dl { display: flex; flex-direction: column; gap: 8px; } .snap-ob-dl-row { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-radius: 10px; background: var(--s-card); }
.snap-ob-dl-row code { font: 11.5px/1.4 ui-monospace, Menlo, monospace; overflow-wrap: anywhere; user-select: all; color: var(--s-fg); opacity: .85; }
.snap-ob-foot { display: flex; align-items: center; gap: 10px; padding: 12px max(24px, calc(50% - 360px)); border-top: 1px solid var(--s-line); } .snap-ob-foot button { margin: 0; }
/* LoRAs by category (SNAP-R12): chips over a searchable list; "move to…" on each row */
.snap-lora-chips { display: flex; flex-wrap: wrap; gap: 6px; } .snap-lora-chips.rail { gap: 4px; margin: 2px 0 8px; }
.snap-lora-chip { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: 12px; background: var(--s-card); box-shadow: inset 0 0 0 1px var(--s-line); color: var(--s-fg); white-space: nowrap; }
.snap-lora-chip i { font-style: normal; color: var(--s-dim); font-size: 11px; } .snap-lora-chips.rail .snap-lora-chip { padding: 2px 8px; font-size: 11px; }
.snap-lora-chip.on { box-shadow: inset 0 0 0 2px var(--s-accent); background: color-mix(in srgb, var(--s-accent) 12%, var(--s-card)); }
.snap-lora-chip.drop { box-shadow: inset 0 0 0 2px #57c785; } .snap-lora-chip.undo { color: var(--s-accent); }
.snap-rail-sub { font-size: 11px; color: var(--s-dim); margin-top: 8px; }
.snap-sheet.snap-lora-sheet { inset: 64px max(24px, calc(50% - 460px)) auto; max-height: calc(100% - 100px); }
.snap-lora-pick { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; min-height: 0; overflow: hidden; }
.snap-lora-list { display: flex; flex-direction: column; gap: 4px; overflow: auto; min-height: 0; }
.snap-lora-row { display: grid; grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr) auto auto auto; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 9px; background: var(--s-card); cursor: grab; }
.snap-lora-filed { max-width: 34ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snap-lora-row strong { font-weight: 550; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .snap-lora-row .snap-quiet { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snap-lora-cats { display: flex; gap: 4px; align-items: center; min-width: 0; } .snap-lora-cats .tag { color: #f0b445; }
.snap-move { font-size: 11.5px; max-width: 110px; background: var(--s-bg); color: var(--s-dim); border: 1px solid var(--s-line); border-radius: 6px; padding: 2px 4px; }
.snap-card .snap-move { margin-top: 4px; align-self: flex-start; } .snap-dial-tile .snap-move { align-self: flex-start; }
.snap-lora-addrow { display: flex; gap: 6px; align-items: center; } .snap-lora-addrow .snap-lora-add { flex: 1; min-width: 0; } .snap-lora-browse { margin: 0; }
/* the Cast sheet (U86, SNAP-R59) */
.snap-sheet.snap-cast-sheet { inset: 64px max(24px, calc(50% - 480px)) auto; max-height: calc(100% - 100px); display: flex; flex-direction: column; }
.snap-cast-body { min-height: 0; overflow: auto; display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; padding: 16px; }
.snap-cast-fields { display: flex; flex-direction: column; gap: 10px; min-width: 0; } .snap-cast-body aside { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.snap-cast-body aside > input { font: inherit; font-size: 12.5px; color: var(--s-fg); background: #0000002e; border: 1px solid #ffffff10; border-radius: 8px; padding: 7px 9px; }
.snap-cast-lora { display: flex; gap: 6px; } .snap-cast-lora select { flex: 1; min-width: 0; } .snap-cast-lora input { width: 72px; }
.snap-cast-refs { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; } .snap-cast-refs .snap-set-actions { flex-basis: 100%; }
.snap-cast-refs figure { position: relative; margin: 0; width: 112px; display: flex; flex-direction: column; gap: 4px; }
.snap-cast-refs img, .snap-cast-missing { width: 112px; height: 112px; object-fit: cover; border-radius: 8px; background: var(--s-card); }
.snap-cast-missing { display: grid; place-items: center; text-align: center; font-size: 11px; color: #f08a7a; padding: 6px; box-sizing: border-box; }
.snap-cast-refs figure input { font: inherit; font-size: 11px; color: var(--s-fg); background: #0000002e; border: 1px solid #ffffff10; border-radius: 6px; padding: 3px 5px; min-width: 0; }
.snap-cast-refs figure .snap-x { position: absolute; top: 2px; right: 2px; }
.snap-cast-versions { display: flex; flex-direction: column; gap: 4px; }
.snap-cast-version { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 1px; padding: 6px 9px; border-radius: 8px; background: var(--s-card); box-shadow: inset 0 0 0 1px var(--s-line); font-size: 12px; }
.snap-cast-version.on { box-shadow: inset 0 0 0 2px var(--s-accent); } .snap-cast-version:focus-visible { outline: 2px solid var(--s-accent); outline-offset: 2px; }
.snap-new-cast { align-self: flex-start; margin: 2px 0 4px; }
@container (max-width: 760px) { .snap-sheet.snap-cast-sheet { inset: 56px 8px auto; } .snap-cast-body { grid-template-columns: minmax(0, 1fr); padding: 12px; } }
.snap-pins { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.snap-pin { font-size: 11px; padding: 2px 7px; border-radius: 999px; background: var(--s-card); color: var(--s-dim); box-shadow: inset 0 0 0 1px var(--s-line); }
.snap-pin.moved { all: unset; cursor: pointer; font-size: 11px; padding: 2px 8px; border-radius: 999px; color: #f0b445; background: #f0b44514; box-shadow: inset 0 0 0 1px #f0b44555; }
.snap-pin.moved:hover { background: #f0b44526; } .snap-pin.moved:focus-visible { outline: 2px solid var(--s-accent); outline-offset: 2px; } .snap-pin.missing { color: #f08a7a; }
.snap-set-note { font: inherit; font-size: 12px; color: var(--s-fg); background: #0000002e; border: 1px solid #ffffff10; border-radius: 8px; padding: 6px 8px; min-width: 0; flex: 1 1 180px; }
/* the World sheet and the opened-file sheet (U87, SNAP-R61/R62) */
.snap-sheet.snap-world-sheet, .snap-sheet.snap-opened-sheet, .snap-sheet.snap-rerun-sheet { inset: 64px max(24px, calc(50% - 480px)) auto; max-height: calc(100% - 100px); display: flex; flex-direction: column; }
.snap-world-body, .snap-opened-body { min-height: 0; overflow: auto; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
.snap-world-list, .snap-world-rows { display: flex; flex-direction: column; gap: 6px; }
.snap-world-item, .snap-world-row { background: var(--s-card); border-radius: 10px; box-shadow: inset 0 0 0 1px var(--s-line); padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.snap-world-item.archived { opacity: .7; } .snap-world-row.moved { box-shadow: inset 0 0 0 1px #f0b44566; } .snap-world-row.missing { box-shadow: inset 0 0 0 1px #f08a7a66; }
.snap-world-line, .snap-world-version { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; font-size: 12.5px; }
.snap-world-line strong { min-width: 0; overflow-wrap: anywhere; }
.snap-world-toggle { all: unset; cursor: pointer; width: 18px; text-align: center; color: var(--s-dim); } .snap-world-toggle:focus-visible { outline: 2px solid var(--s-accent); }
.snap-world-kind { font-size: 10.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--s-dim); }
.snap-world-versions { display: flex; flex-direction: column; gap: 3px; padding: 4px 0 2px 26px; }
.snap-world-confirm { background: #f08a7a14; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; } .snap-world-confirm p { margin: 0 0 6px; line-height: 1.4; }
.snap-danger { font: inherit; font-size: 12.5px; color: #fff; background: #c2453a; border: 0; border-radius: 8px; padding: 6px 12px; cursor: pointer; } .snap-danger:focus-visible { outline: 2px solid var(--s-accent); outline-offset: 2px; }
.snap-world-del { color: #f08a7a; }
.snap-world-fields { margin: 2px 0 0; padding-left: 18px; font-size: 12px; color: var(--s-dim); overflow-wrap: anywhere; }
/* the Re-run sheet (U89): each row's pick under its name, what the pick changes under it; the land, seed and buttons on one wrapping row */
.snap-rerun-sheet select { font: inherit; font-size: 12px; color: var(--s-fg); background: var(--s-card); border: 1px solid var(--s-line); border-radius: 8px; padding: 6px; }
.snap-rerun-pick { display: block; width: 100%; max-width: 100%; margin-top: 6px; }
.snap-rerun-what { font-size: 12px; margin-top: 4px; } .snap-rerun-what:empty { display: none; }
.snap-rerun-route { margin: 10px 0 4px; }
.snap-rerun-many { font-size: 12px; margin-top: 4px; } .snap-rerun-many label { display: inline-flex; gap: 4px; margin: 2px 10px 2px 0; }
.snap-rerun-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; } .snap-rerun-actions select { max-width: 100%; }
@container (max-width: 760px) { .snap-sheet.snap-world-sheet, .snap-sheet.snap-opened-sheet, .snap-sheet.snap-rerun-sheet { inset: 56px 8px auto; } .snap-world-line .snap-spacer { flex-basis: 100%; height: 0; } }
.snap-rail-actions { display: flex; flex-wrap: wrap; gap: 0 12px; }
.snap-world-warn { flex-basis: 100%; font-size: 12px; line-height: 1.4; color: #f0b445; }
.snap-take-unplaced { font-size: 11px; color: #f08a7a; }
`;
