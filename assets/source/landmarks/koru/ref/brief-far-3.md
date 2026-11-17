# Koru, third round: the rig, and one gate

Round two is accepted except for what is below. The joint cannot be found (`ref/pictures/joint.png`, and your table
is well under the bar). The sails from the shaded side are the brightest thing in the picture, and at 150 m with sails
set in Chrome the yacht is plainly nice. The ports, the boom, the furniture, the plaques' picture, the raked collision
and the Chrome column are all what was asked. Keep all of it.

Three things go back. The first must be fixed before anything merges. The second is the one that is not yet nice.

## 1. A link can make a player send commands
`client/core/app.ts`, `address()`: `run` is read on every page, measured or not, and each line goes out through
`session.text` as if the player typed it. So an address with `?run=...` sent to a player makes that player's client
send console lines as them when they open it. The game is not launched, but this ships in the client as it stands.

The bar: on a real server, opening any address never sends a line the player did not type, and never holds their
view. The tool's look still works where it is needed, which is a tool's own page on a server started for it. How is
yours: the measured pages already have a way of being told apart, a dev server has a way of saying it is one. A test
holds it: the same address on a page that is not a tool's sends nothing and holds nothing.

## 2. The rig still changes at one step, and still breaks into dots
The pictures, all Chrome on high, in `var/lod-study/koru-art/r2/browser-stowed/`:

- `d-250m-browser.png` against `k-300m-browser.png`, the same view 50 m apart. At 250 m: a web of hairlines, the
  triatics along the mastheads, the stays from each masthead down to the next mast, the shroud fans. At 300 m: three
  bare poles and three diagonals as heavy and as white as the masts. Everything fine goes at once and what is left
  gets two or three times bolder. A player walking away sees the rig change. Enlarged three times it is the first
  thing the eye finds.
- The same 250 m picture: the two long forestays are dotted over their lower halves.
- `h-bow-quarter-130m-browser.png`: the long forestay is a dotted line from the masthead to the bowsprit. This is
  level 0 at the far end of its reach.

Why, as I read it. Each level's wire has one width, and a level is drawn over a two to threefold span of distance. You
sized each for the far end of its span, so at the near end of level 2 (the hand-over) a wire is 1.5 px where level 1
has just shown 0.5 px, and level 0's true 6 cm wire is 0.3 px at the end of its span, which four samples cannot hold.
And the set of wires changes at the same place the width does. Tone stands in for coverage against the sky, but
against the land, the hull and the sails a pale wire is a bright line, not a faint one.

What I want to see has not changed: walking out from 40 m to 700 m, the rig is dark and fine near, thins and fades
evenly, and is gone somewhere past 500 m; at no distance is a wire dots, and at no step can I say what changed. Judge
it the way I did: Chrome on high, pairs of pictures either side of every hand-over (levels 0 and 1 at 138 m, the near
store's edge at about 250 m, levels 2 and 3 at 716 m; and medium's 88, 210 and 456 m), the yacht enlarged three
times, against the sky and against the land. If I cannot say which of a pair is which, it is done.

What makes a step is the product of a wire's drawn width and how strongly it shows. Hold that product to the true
wire's on both sides of every hand-over and keep the same wires on both sides, and there is nothing to see. Tone
cannot do that against every backdrop. Showing a wide wire by a share of itself can. If that takes a small general
property of a finish, as `sheet` was, build it, under the same conditions as the finishes: stated by the landmark's
art, nothing changes for a landmark that states none, low poly's pinned text stays, the rasterizer keeps its twin,
your lines in `gl.ts`, `raster.ts` and `scene.ts` few and reported. It will not be Koru's alone: rails, cables,
antennas and lattice on every large model to come have this same fault, so make it the tool they will use. If you
find something simpler that meets the pictures, better.

With it, the set of wires need not be thinned by level at all, except what lies within a pixel of a mast. A light
shroud then goes before a heavy stay because it is thinner, not because a level left it out.

## 3. Small things
- A struck sail is left to the far mesh; a sail on its way up or down is not struck. As it is, someone watching from
  400 m sees nothing while a sail rises and then the whole sail at once, and a sail vanish the moment it starts down.
  A part in motion is drawn as a set part is.
- The sun deck's white box (`browser-stowed/i-sun-deck-aft-browser.png`, left of the mast) is still a box. Whatever
  it is, make it that.
- The README says the rig goes "with no step". Make it say what is true when you are done, with the pairs of pictures
  as its evidence, in `ref/pictures/`.

## Not asked
The hull mirrors only the sky, interiors are lit only by the sky, and the rasterizer's black far land: these are the
engine's, noted for the owner, not for this round.

## Housekeeping
Merge main before you start and before the last check, `bun run check -- --slow`. Decision rows stay unnumbered. Copy
this file to `assets/source/landmarks/koru/ref/brief-far-3.md`. Every Chrome a tool starts is muted. One heavy job at
a time. When you think it is done, look at the 250 m and 300 m pair again and ask whether you could tell them apart.
