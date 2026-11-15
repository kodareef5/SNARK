# Feedback on round 1 of the dodo's loose feathers

Thank you: the files are exactly what the engine needs, the dyes come through, and the flight and tail feathers are good. The attached picture is round 1 in the game's own renderer, a dodo landing hard and shedding feathers, drawn at four times the size a phone shows it from 3 m. Seen there, the body feathers do not yet read as feathers. Please paint `contour`, `contour_plain` and `down` again, and keep `flight` and `tail` unless you see something to improve. Same files, same layout and rules as `BRIEF.md`.

What falls short, seen in the game:

- **They read as leaves or petals.** `contour` and `contour_plain` are nearly round, about three quarters as wide as they are long, so a feather tumbling or lying on the grass at 20 to 60 pixels is a grey leaf. A loose body feather that reads at that size has its own signature: an elongated vane about twice as long as it is wide, a little curved; the shaft visible as a pale line along its middle right to the tip; one or two splits where the barbs part; and a soft fluff of down at the base on both sides of the quill. Aim for that signature first, at 32 and 128 pixels, and the detail second.
- **The tip bar on `contour` is a hard-edged cap.** On the bird the bars are pale tips of the barbs: make it a soft band that follows the edge of the vane and breaks up into the barbs, not a separate shape on top.
- **The quill is a pure white stick.** Keep it pale but greyer and a little shorter, so it does not glow on dark ground.
- **`down` is a dark maple-leaf blob.** A down or hood feather is a small wispy plume of fine barbs from a short quill, airy and partly see-through at its edges, so it reads as fluff and not as a solid cut-out.

Hand back the same set (the five pictures, their regions files, `preview.png` and a short `REPORT_2.md` saying what changed). Judge at game size before you finish: the 32 pixel versions should read as feathers on grass and on sand.
