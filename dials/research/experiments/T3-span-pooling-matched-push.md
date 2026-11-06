# T3: is span pooling better, or just bigger? (2026-11-06)

**Question.** T1 found that pooling only the differing span gives vectors 1.2-1.9× larger than Make Dial's whole-prompt
mean, pointing 0.94-0.996 the same way. At **equal push** (strength × vector size), does the span version move the
intended quality more, or with less collateral change?

**Setup.** The two dials whose span variant differs most from today's (sinister: cos 0.94; memory_present: cos 0.965).
Span variants are raw (no debias); the shipped dials have Make Dial's debias (2.8 % and 6 % removed), a small confound.
Strengths matched to the shipped dial's push: sinister +1 ↔ span +0.525; memory +3 ↔ span +1.664. Pika H3 Flex 6-step,
text-to-video, de-rope off; train-platform scene at seeds 42 and 43 and the office dialogue scene (seed 2101, sinister only),
each against its own control on the same GPU. 7 new renders, the rest reused from earlier sweeps.

**Results** (change from the control; colour/dark/contrast from decoded frames at 320 px, every 2nd frame; "distance" is
the mean absolute pixel difference from the control, 0-255):

| context | arm | Δcold (−(R−B)) | Δdark (−luma) | Δcontrast | distance |
|---|---|---|---|---|---|
| train, seed 42 | sinister shipped | +17.8 | +18.0 | −13.7 | 32.7 |
| | sinister span | +12.9 | +19.4 | −17.8 | 32.3 |
| train, seed 43 | sinister shipped | +5.3 | +15.4 | +1.7 | 33.7 |
| | sinister span | +5.8 | +19.9 | −0.2 | 40.7 |
| office | sinister shipped | +7.9 | +16.4 | +1.0 | 43.2 |
| | sinister span | +11.0 | +18.0 | +1.2 | 40.9 |
| train, seed 42 | memory shipped | −4.4 | −5.9 | +2.0 | 73.7 |
| | memory span | −1.8 | −6.7 | −1.6 | 68.2 |
| train, seed 43 | memory shipped | −1.3 | +3.2 | −1.7 | 42.8 |
| | memory span | +2.7 | +5.9 | −8.4 | 47.5 |

Contact sheets: the span versions look like the shipped ones: the same cold-blue sinister platform and looming office,
the same hazy memory profile. On seed 43 span-sinister reads slightly darker and more silhouetted.

**What it shows.** At matched push the two poolings are close. Span-sinister darkens a little more in 3 of 3 contexts
(+1.4 to +4.5), but coldness and total change go both ways; memory shows no consistent difference. So most of the
"span pooling is stronger" impression at equal *strength* comes from its larger vectors. With 2 seeds and 2 scenes, a
small real difference can't be ruled out, but nothing here justifies changing Make Dial's default.

**What it changes.** Gate not met: span pooling is not adopted as default. It stays a candidate *option* (it may matter
for pairs whose sides differ in several clauses, like the villainy templates, where the span carries only 53 % of the
direction). The bigger lever is matching push when comparing dials; the plan keeps that as a rule.
