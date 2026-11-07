#!/usr/bin/env python3
"""Write ComfyUI-Dials docs/lab.html (the 2026-11-06 experimental-dials gallery) from the pair files and clip list.

usage: make_dials_lab_page.py <ComfyUI-Dials docs dir>
Clips/posters are expected in <docs>/lab/<key>.mp4|.jpg (encoded separately). Pair text is read verbatim from
pairs/new1106/<name>.txt (first '#' line = the A/B description) so the page shows exactly what was used.
"""
import html
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAIRS = os.path.join(HERE, "..", "pairs", "new1106")
HF = "https://huggingface.co/MATLOWAI/H3-Dials/blob/main"


def pairs(name):
    lines = [l.rstrip("\n") for l in open(os.path.join(PAIRS, name + ".txt"))]
    head = " ".join(l.lstrip("# ").strip() for l in lines if l.startswith("#"))
    body = [l for l in lines if l.strip() and not l.startswith("#")]
    return head, body


def esc(s):
    return html.escape(s, quote=True)


def clip(key, label, note="", flag=""):
    f = f'<span class="flag">{esc(flag)}</span>' if flag else ""
    n = f'<span class="d">{esc(note)}</span>' if note else ""
    return (f'<figure><video controls preload="none" playsinline poster="lab/{key}.jpg" src="lab/{key}.mp4"></video>'
            f'<figcaption><span class="k">{esc(label)}</span>{n}{f}</figcaption></figure>')


def strip(title, clips, note=""):
    n = f'<p class="note">{note}</p>' if note else ""
    return f'<div class="strip"><h4>{esc(title)}</h4>{n}<div class="row">{"".join(clip(*c) for c in clips)}</div></div>'


def dial_block(name, kind, subjects="subjects_adults"):
    head, body = pairs(name)
    file = f"h3_x_{name}.safetensors"
    pre = esc("\n".join(body))
    return (f'<details class="pairs"><summary>How it was made: <code>{file}</code> · {esc(kind)}</summary>'
            f'<p>{esc(head)}</p><pre>{pre}</pre>'
            f'<p class="small">Subjects: <code>{subjects}.txt</code> (each line replaces <code>{{subject}}</code>), so 3 templates × 8 subjects = 24 pairs. '
            f'Made with MAINodes <b>Make Dial</b>, post-refiner hook, debias on. '
            f'<a href="{HF}/dials/experimental/{file}">dial file</a> · '
            f'<a href="{HF}/example_pairs/experimental/{name}.txt">pair file</a></p></details>')


CTL = ("x_control", "control", "dial off")

SECTIONS = [
    ("oil", "Oil painting ↔ pixel art", "style continuum",
     "Style words arrive as an era first, then the medium appears only at the far end. Across two seeds, −3 kept "
     "putting a rider on a horse indoors, and +3 seed 43 even drew a game HUD.",
     [strip("−3 … +3", [CTL, ("oil_m3", "−3", "period drama"), ("oil_m1p5", "−1.5", "classical light"),
                        ("oil_p1p5", "+1.5", "side-scroller staging"), ("oil_p2", "+2", "isometric diorama"),
                        ("oil_p2p5", "+2.5", "pixel level"), ("oil_p3", "+3", "pixel-art game level"),
                        ("oil_p3_s43", "+3, seed 43", "with a HUD")])],
     dial_block("oil_pixel", "style continuum")),
    ("mosh", "Datamosh", "plain vs featured",
     "Built as “the plain sentence” vs “the same sentence plus a glitch clause”. Around <b>+2.25</b> the subject stays "
     "crisp while the background breaks into a glitch mosaic (2 seeds); by +2.5 the face changes; +3 is glitch only. The "
     "negative side reads as “anti-glitch”: a clean, wholesome vintage scene.",
     [strip("−3 … +3", [CTL, ("mosh_m3", "−3", "wholesome vintage"), ("mosh_p1p5", "+1.5", "no glitch yet"),
                        ("mosh_p2p25", "+2.25", "subject crisp, background moshed"), ("mosh_p2p25_s43", "+2.25, seed 43", "same again"),
                        ("mosh_p2p5", "+2.5", "glitch portrait"), ("mosh_p3", "+3", "glitch only")])],
     dial_block("datamosh", "plain vs featured")),
    ("paint", "Two dials together: an actual oil painting", "combination",
     "Oil ↔ pixel at −3 on its own gives a <em>photoreal</em> period drama. Add a datamosh row at +1.5 or +2.25 and the "
     "scene becomes a painted canvas with visible brushwork, on both seeds. A meaningless placebo dial pushed just as hard "
     "doesn't do it, and a generic “photoreal ↔ stylized” direction only gets a half-painted mural. Push two dials too far "
     "and the scene collapses instead.",
     [strip("Two rows in one Dial Rack", [("oil_m3", "oil −3 alone", "photoreal"), ("paint_mosh225", "oil −3 + mosh 2.25", "oil painting"),
                                         ("paint_mosh150", "oil −3 + mosh 1.5", "painting, in a frame"),
                                         ("paint_mosh225_s43", "oil −3 + mosh 2.25, seed 43", "painting again"),
                                         ("paint_placebo", "oil −3 + placebo", "no painting (control)"),
                                         ("paint_style", "oil −3 + stylized probe", "half-painted mural"),
                                         ("combo_collapse", "oil +2.5 + memory +3", "collapse")])],
     ""),
    ("owl", "Owl ↔ octopus", "creature continuum",
     "A creature dial needs its creature in the scene: on a person at a train station it only reshuffled the background. "
     "On an owl, the first step is a different owl, then the identity flips between +2 and +2.5 with no hybrid, and past +3 "
     "the setting follows the creature.",
     [strip("Owl scene", [("owl_control", "control", "tawny owl"), ("owl_p1p5", "+1.5", "barn owl"), ("owl_p2", "+2", "still an owl"),
                          ("owl_p2p5", "+2.5", "octopus"), ("owl_p3", "+3", "octopus on the post"), ("owl_p4p5", "+4.5", "coral reef")])],
     dial_block("owl_octopus", "creature continuum", "settings")),
    ("abstract", "Abstract ideas", "abstract",
     "Abstract pairs are written in three framings (presence in a space, light and colour, motion and sound) so the mean "
     "isn't one metaphor. Memory arrives as haze and fade; entropy arrives as disaster and motion.",
     [strip("memory ↔ present", [CTL, ("memory_m3", "−3", "vivid present"), ("memory_p3", "+3", "faded memory")]),
      strip("order ↔ entropy", [CTL, ("entropy_m3", "−3", "order"), ("entropy_p3", "+3", "debris, running")])],
     dial_block("memory_present", "abstract") + dial_block("order_entropy", "abstract")),
    ("eras", "Eras, formats and a negative result", "style",
     "Medium words mostly arrive as an era, setting or format: silent film gives 1920s clothes and carriages, VHS gives a "
     "4:3 frame and older trains. Describing the artifact instead (grain, dust, scratches) gave a cool grade and no grain, "
     "a negative result kept on purpose.",
     [strip("silent film ↔ cyberpunk", [CTL, ("silent_m3", "−3", "1920s"),
                                       ("cyber_p3", "+3", "the character is swapped for a younger-looking woman", "identity swap at +3")]),
      strip("VHS and film-artifact", [CTL, ("vhs_m3", "VHS −3", "clean digital"), ("vhs_p3", "VHS +3", "4:3, older train"),
                                      ("film_p3", "film-artifact +3", "desaturated, no grain")])],
     dial_block("silentfilm_cyberpunk", "style continuum") + dial_block("vhs", "opposites (look)")
     + dial_block("film_artifact", "artifact described, no era words")),
    ("villainy", "The villainy pack on Pika H3 Flex", "existing dials",
     "The eight evil dials at +2 on the same scene. They form a light-to-dark range: seductive and impish keep the warm "
     "sunset, the rest take it away. They move the soundtrack up to ±10 dB, so listen. The last clip is a meaningless "
     "placebo pushed as hard as sinister at +2: it changes the background but not the person.",
     [strip("+2 each", [("evil_control", "control", "dial off"), ("sinister_p1", "sinister +1"), ("sinister_p2", "sinister +2"),
                        ("creepy_p2", "creepy +2"), ("cold_p2", "cold +2"),
                        ("unhinged_p2", "unhinged +2", "screaming, lunging", "intense"),
                        ("seductive_p2", "seductive +2"), ("corrupted_p2", "corrupted +2"), ("dread_p2", "dread +2"),
                        ("impish_p2", "impish +2"), ("placebo_p8", "placebo", "control")])],
     dial_block("template_placebo", "control") + dial_block("sinister_noview", "control")),
    ("speech", "Does the dialogue survive?", "audio",
     "Two scripted lines, scored with Whisper against the script. On Pika H3 Flex every evil dial at +2 kept the words: "
     "word error 0.00 for sinister (with or without audio protect), seductive and creepy, 0.00 to 0.05 for unhinged (which "
     "shouts). One seed, one scene; on base H3 sinister +2 had crushed the same lines.",
     [strip("Office scene", [("dlg_control", "control", "WER 0.00"), ("dlg_sinister_p2", "sinister +2", "WER 0.00"),
                             ("dlg_unhinged_p2", "unhinged +2", "WER 0.00, shouted", "intense")])],
     ""),
]

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Dials Lab · experiments</title>
<meta name="description" content="Experimental Dials for MiniMax H3: style continua, glitch, creatures, abstract ideas and combinations, with the prompt pairs that made each one.">
<meta property="og:title" content="Dials Lab · experimental steering for MiniMax H3">
<meta property="og:description" content="Oil painting to pixel art, datamosh, owl to octopus, abstract ideas, and two dials that paint together. Every dial ships with its prompt pairs.">
<meta property="og:image" content="https://matlowai.github.io/ComfyUI-Dials/lab/paint_mosh225.jpg">
<style>
  /* Matches the Dials site: one dark theme, gold accent, system type. Layout: one column of strength strips. */
  :root { --bg: #0e0f13; --panel: #171920; --line: #25262c; --fg: #f2f2f0; --muted: #9a9ba0;
          --gold: #ffc145; --blue: #4f8ff7; --warn: #f08a4b; color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1180px; margin: 0 auto; padding-block: 0 64px;
         padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  header { padding: 48px 0 12px; }
  h1 { font-size: clamp(40px, 8vw, 72px); line-height: 1; margin: 0 0 12px; letter-spacing: -0.02em; }
  .tag { color: var(--gold); font-size: clamp(18px, 2.6vw, 22px); margin: 0 0 16px; }
  h2 { font-size: 28px; margin: 56px 0 6px; text-wrap: balance; }
  h2 small { display: block; font-size: 13px; font-weight: 600; color: var(--gold); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 4px; }
  h4 { margin: 0 0 8px; font-size: 15px; color: var(--muted); font-weight: 600; }
  p { margin: 0 0 14px; max-width: 75ch; }
  a { color: var(--blue); }
  nav { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 15px; margin: 4px 0 8px; }
  .buttons { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0 20px; }
  .btn { display: inline-block; padding: 10px 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel);
         color: var(--fg); text-decoration: none; font-weight: 600; }
  .btn.primary { background: var(--gold); color: #141519; border-color: var(--gold); }
  .strip { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin: 14px 0; }
  .strip .note { color: var(--muted); font-size: 14px; }
  .row { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  figure { margin: 0; min-width: 0; }
  video { width: 100%; max-width: 100%; aspect-ratio: 640 / 352; border-radius: 8px; border: 1px solid var(--line); background: #000; display: block; }
  figcaption { font-size: 13px; margin-top: 5px; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; color: var(--muted); }
  .k { color: var(--fg); font-weight: 700; font-variant-numeric: tabular-nums; }
  .flag { color: var(--warn); font-weight: 600; }
  details.pairs { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; margin: 10px 0; }
  details.pairs summary { cursor: pointer; font-weight: 600; }
  details.pairs summary:focus-visible, .btn:focus-visible, video:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; overflow-x: auto; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  .small { font-size: 14px; color: var(--muted); }
  ul li { margin-bottom: 6px; max-width: 75ch; }
  footer { color: var(--muted); font-size: 14px; border-top: 1px solid var(--line); margin-top: 56px; padding-top: 20px; }
</style>
</head>
<body>
<main>
<header>
  <h1>Dials Lab</h1>
  <p class="tag">Experimental dials for MiniMax H3, each with the prompt pairs that made it.</p>
  <p>A night of trying odd contrasts: two styles at opposite ends of a slider, a plain prompt against the same prompt with a
    glitch, an owl against an octopus, and ideas like “order vs entropy”. Every clip below is Pika H3 Flex (6 steps,
    text-to-video) on one scene, with one dial in the Dial Rack at the strength shown, starting from the same seed as its
    control. Seed 42 unless a clip says otherwise. Press play to hear the sound too.</p>
  <div class="buttons">
    <a class="btn primary" href="https://huggingface.co/MATLOWAI/H3-Dials/tree/main/dials/experimental">Get the dials</a>
    <a class="btn" href="index.html">Dials home</a>
    <a class="btn" href="guide.html">How to use Dials</a>
  </div>
  <nav>NAV</nav>
</header>
SECTIONS
<h2 id="learned"><small>notes</small>What these taught us about making dials</h2>
<ul>
  <li><b>Pair agreement is a floor, not a verdict.</b> Make Dial's agreement score was 0.75 to 0.85 for dials that worked and for
    dials that failed alike. Only renders tell them apart.</li>
  <li><b>Style words arrive as an era first.</b> Silent film, oil painting and VHS gave clothes, carriages and aspect ratios
    before (or instead of) the medium itself.</li>
  <li><b>Check against a placebo.</b> Any push the size of a dial reshuffles the background. What a meaningless dial of
    the same size doesn't do is what your dial does.</li>
  <li><b>Put the subject in the scene.</b> A creature or object continuum has nothing to act on if the prompt has none.</li>
  <li><b>Two rows can do what neither does.</b> Glitch + period drama made a painting; too much summed push breaks the scene.</li>
</ul>
<p class="small">One prompt and one or two seeds per finding, so treat these as starting points. Each dial file carries
  its own description, labels and useful/overcook strengths (open ⚙ on its row in the Dial Rack).</p>
<footer>Made with ComfyUI-MAINodes Make Dial and Dial Rack, MiniMax H3 and Pika H3 Flex. Dial files are Model Derivatives of
  MiniMax H3 under the MiniMax H3 Community License Agreement. Powered by MiniMax H3.</footer>
</main>
</body>
</html>
"""


def main():
    docs = sys.argv[1]
    nav = " ".join(f'<a href="#{sid}">{esc(t)}</a>' for sid, t, *_ in SECTIONS) + ' <a href="#learned">Notes</a>'
    body = []
    for sid, title, kind, intro, strips, blocks in SECTIONS:
        body.append(f'<h2 id="{sid}"><small>{esc(kind)}</small>{esc(title)}</h2><p>{intro}</p>{"".join(strips)}{blocks}')
    out = PAGE.replace("NAV", nav).replace("SECTIONS", "\n".join(body))
    import re
    refs = set(re.findall(r'(?:src|poster)="(lab/[^"]+)"', out))
    missing = sorted(r for r in refs if not os.path.exists(os.path.join(docs, r)))
    if missing:
        raise SystemExit("missing assets: " + ", ".join(missing))
    print(len(refs), "lab assets referenced, all present")
    open(os.path.join(docs, "lab.html"), "w").write(out)
    print("wrote", os.path.join(docs, "lab.html"), len(out), "bytes")


if __name__ == "__main__":
    main()
