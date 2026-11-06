---
name: snap-boards
description: >
  Plan a short or scene in Snap the way a studio does: design lane first, then one board per cut, an animatic and
  cut-pair checks, and only then video cuts rendered from approved boards, with the H3 prompt craft for style and
  sound. Use it whenever you make a short, a scene with several cuts, a trailer, or any multi-shot video in Snap, or
  when cuts don't connect (wrong positions, jumps in light, weak climax).
scope: [tool:run, tool:compile_shot]
rules: [SNAP-R36, SNAP-R67, SNAP-R70]
---

If a Snap server is reachable, `read_skill {"name": "snap-boards"}` returns the person's version of this skill (their edits over the pack's); this file is the pack's.

# Boards and animatic before video

Order of work: design lane → boards → animatic → approval → video. Blocking, framing, transitions, scale and intensity
are solved on boards, where a fix costs seconds. Agents left alone make cuts as islands: faces held, but transitions,
framing and blocking didn't. The Book's Boards step will hold this (planned, R67-R70); until then boards are takes in
each cut's shot.

## 1. Design lane

Character sheets (`snap-turnaround`), locations and plates (`snap-location`), voices (`snap-voice`). H3 Ref2V copies a
flat 2D sheet's style faithfully (2/2), so the look is decided here, not in the video prompt. Make original
characters, names, designs and settings; homage stays at genre level (no copied scenes, shots, designs or logos).

## 2. Boards

One board per cut, made with New view on the cut's plate (`snap-new-view`) and landed in the cut's shot:
- camera and lens; who stands where, facing which way (carried from the previous cut's end);
- scale drawn, not worded: tiny people beside the big thing, low angle, wide lens;
- the planned transition to the next cut: match on action, eyeline, screen direction, the 180° line;
- the beat's intensity, by the genre's playbook (a climax stands and delivers; horror holds).

## 3. Animatic and checks

Time the boards in order with temp audio. Run the cut-pair checks on boards (`snap-critic`): the previous cut's last
frame against this cut's first (position, facing, eyeline, light, props). Stop for the person's look before video.

## 4. Video cuts from boards

Each cut renders from its board as reference or first frame. FL2V or Ref2V: `snap-model-choice`. Video takes stay at
the setup's steps (6 on the Pika turbo). Prompt sections: AGENT_START §4.2.

**Style**
- Palette words get painted onto props: "teal and magenta neon glow" in the style line cycled an unlit lantern
  through both colours. Keep them out of shots where a light stays off.
- Say off states literally ("the lantern head stays completely dark the whole time": fixed 2/2 on the same seed), and
  describe a design by its silhouette ("shaped like a white lighthouse tower").

**Sound** (SNAP-R36)
- Lead `overall_soundscape:` with the discrete sounds the action makes; ambience last.
- Tonal words become drones: "a ship's horn sounding twice" came out as one held 4 s tone, "neon signs buzzing" a
  steady ~450 Hz hum. Use percussive events (thumps, clicks, crunching snow) unless the tone is the point. A Long
  extend stayed clean for 34 s once the tonal words left; with them a tone grew from ~9 s on.
- Loudness can't hear a drone: confirm with a spectrum (`ffmpeg -lavfi showspectrumpic`) before re-rolling.
- H3 renders short quoted lines cleanly; name the speaker's voice and cite their `<Audio n>` (`snap-voice`).
- Ripple (relight, Change something) re-renders the sound; Remake keeps it. Lay the take's own sound back after a
  relight.
