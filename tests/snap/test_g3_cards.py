"""G3 (SNAP-R137, SNAP-R138): words the pack itself sends to a model.
- F-E25: the Krea 2 DynamicCharacterSheet card's prompt is prose: no capital headings and no [TAG] lines (Krea drew them
  onto 4/4 sheets as garbled labels; the prose wording drew 0/4), and it still asks for the same panels (hero three-quarter
  view, front/side/back, action poses with a low and a high angle, silhouettes, faces, detail crops).
- The operator's call 2026-11-06: prompt cites are plain <Picture n>: no card, skill or doc in the pack writes a name
  inside a cite tag.
No server. usage: python3 -I test_g3_cards.py   prints "g3cards n/m" last
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snaptest_config as C  # noqa: E402

PACK = C.PACK


def methods(o):
    if isinstance(o, dict):
        if "slot" in o and "id" in o:
            yield o
        for v in o.values():
            yield from methods(v)
    elif isinstance(o, list):
        for v in o:
            yield from methods(v)


cards = {m["id"]: m for m in methods(json.load(open(PACK / "snap_cards" / "methods.json", encoding="utf-8")))}
krea = cards["krea2_dynamic"]["anchors"]["prompt"]
words = re.sub(r"\{\w+\}", "", krea)  # the slots ({name}, {design_lines}) are filled from the Cast
caps = re.findall(r"\b[A-Z][A-Z_]{2,}\b", words)
tags = re.findall(r"^\s*\[[^\]]*\]", words, re.M)
# a cite with anything but a number (or Snap's "?" for a picture taken out) inside the tag
named = []
for root in ("web", "docs", ".claude", "snap_cards", "tools"):
    for d, _, fs in os.walk(PACK / root):
        for f in fs:
            if f.endswith((".js", ".md", ".json", ".py")):
                text = open(os.path.join(d, f), encoding="utf-8", errors="replace").read()
                for m in re.finditer(r"<(Picture|Video|Audio) ([^>\n]{1,40})>", text):
                    inner = m.group(2).strip()
                    if not re.fullmatch(r"\d+|\?|n|N|\$\{[^}]+\}|\(\\d\+\)|\\d\+|\(\[\^>\]\*\)|\?\)", inner):
                        named.append(f"{os.path.relpath(os.path.join(d, f), PACK)}: {m.group(0)}")
checks = {
    "F-E25: the Krea sheet prompt has no capital headings": not caps,
    "F-E25: the Krea sheet prompt has no [TAG] lines": not tags,
    "F-E25: it asks for no text on the sheet, in prose": "no text of any kind" in krea and krea.rstrip().split("\n")[-1].startswith("Avoid: any text"),
    "F-E25: it keeps the panels (hero three-quarter, front/side/back, low and high angle, silhouettes, faces, detail crops)": all(x in krea for x in ("three-quarter view", "front, side and back", "low angle", "high angle", "silhouettes", "face drawings", "close-up crops")),
    "F-E25: the Cast's name and design lines still fill it": "{name}" in krea and "{design_lines}" in krea,
    "placeholders: no name inside a <Picture n> cite anywhere in the pack": not named,
}
for k, v in checks.items():
    print(f"{'PASS' if v else 'FAIL'} {k}")
if caps or tags or named:
    print(json.dumps({"caps": caps, "tags": tags, "named": named}, indent=1))
print(f"g3cards {sum(checks.values())}/{len(checks)}")
