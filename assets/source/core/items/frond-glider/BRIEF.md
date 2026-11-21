# Brief: the frond glider

For whoever looks at it next, and for artist if its pictures are ever painted. What it is for and how it flies are in
[the note](../../../../../planning/workstreams/glider.md).

## What it is

A glider a survivor new on the beach lashes together from what one or two palms give: two bowed sticks, palm fronds and
fibre cord. It is two wings that meet over the head. Each is a spar with fronds bound along it and lying back from it
like the feathers of a wing, a batten behind its root, a brace between the two, and a handle hung under the spar for the
hand of its side. Folded, the wings lie together with the fronds laid back along the sticks, tied in three places: that
bundle is the item in the hand, on the ground and in its inventory picture.

It should read as made by hand in an afternoon, and as something that would bear a body: the spars thick at the root,
every joint bound, the fronds overlapping with no gap a body would fall through.

## What the engine needs

- `wing_l` and `wing_r` (`model.py`): each modelled as its hand holds it open, the handle's grip at the origin and the
  body's axes when the wing lies flat, its root at the lashing 27 cm toward the body's middle and 10 cm up. The poses
  are made to those two numbers (`shared/anim/glide-clips.ts`); the art check holds a wing to them.
- `bundle`: a held piece, the grip at the origin, its length along +Z.
- At most three materials, and none of its own: the fronds wear the coconut palm's frond picture, the sticks and
  bindings the stone tools' wood and lashing (`asset.ts`). A frond is a card folded along its midrib with both sides
  modelled, as a palm's is.
- A wing is 1,702 triangles at its finest and is seen from 3 to 6 m in third person, and from under it at arm's length
  from the eye.

## What to look at

```sh
bun run art -- core:frond-glider          # the model, its check and its sheet
bun run snap -- --glide --face 150        # the four poses side by side
bun tools/glider/review.ts                # one glide, as a player flies it
```

1. From behind and above, as third person sees it: do the two wings read as one glider, and the fronds as fronds?
2. From the eye, looking up: are the hands round their handles, and do the bindings sit on the wood?
3. In a dive, with the wings drawn back, and flared, with them tipped up: does anything come apart at the lashing?

## What it wants

- **Pictures of its own.** The palm's frond picture shows a frond 5 m long; here it is on fronds of 0.8 to 1.3 m, so its
  leaflets are finer than a young frond's would be. Dry, split and bound fronds, and cord that crosses a frond's stalk,
  would be this asset's own.
- **Wear that shows.** A glider near its last flight looks as a new one does.
