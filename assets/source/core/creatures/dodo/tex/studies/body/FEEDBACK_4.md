# Body study, round 4: the bars are still a mask, not feathers

Thank you for the patience on this one; it is the hardest detail in the study and the one a stranger's eye goes to on the back. Look at `checks/round3_bars_comparison.png` again: the cream is now a fat crescent hanging under each feather, with a hard, smooth inner edge and a lumpy outer one, separated from its neighbours, so a row reads as a string of sliced bananas or fingernails. In the concept each pale tip is soft and pointed, like the tip of a brush, and the tips of a row melt into one fuzzy zigzag.

The difference is that in the concept the pale part **is the feather**: the barbs themselves turn pale toward their ends. Draw it that way:

- **Pale barb ends, not a pale patch.** Along the free end, the last few millimetres of each barb are cream. The barbs nearest the tip carry the longest cream ends (8 to 10 mm); moving out toward the sides, the cream ends shorten to nothing about two thirds of the way out. Because the barbs sweep out and down from the shaft, the boundary between grey and cream is a comb of fine streaks along the barbs, softest and longest at the centre: a soft, pointed V of pale strands. There is no smooth line anywhere in it, inside or out.
- **Region map the same way.** The yellow follows those barb ends strand by strand at 2,048; at the bird's size it will read as a soft V.
- **Let the tips meet.** The barred rows' feathers can be a little narrower and more pointed at the tip than the breast's (as on the concept's back), so the pale Vs of neighbours sit close and their side strands mingle into a continuous fuzzy zigzag.
- Your `body_plain` feathers look right because their look came from generated originals. A barred feather whose tip is pale in the generated original itself, with the pale strands drawn by the image tool, will very likely get you there faster than any mask laid over a grey feather.

Keep `body_plain` byte for byte. Same names and scale for `body_barred` and the barred elements of `body_tips`; update the report and finish with the same comparison beside the concept's back.
