# Rex v2

The plan is [planning/workstreams/rex2.md](../../../../../../planning/workstreams/rex2.md). The source file is
described in [SOURCES.md](SOURCES.md).

## Old and new, side by side

Both are in their rest pose, measured from the skin. The pictures are in `ref/compare/`: the
[new side](compare/side-new.png), the [old side](compare/side-old.png), the [front](compare/front-both.png), the
[top](compare/top-both.png) and a [three-quarter view](compare/quarter-both.png).

| | Old Rex | New Rex |
|---|---:|---:|
| Length | 12.25 m | 12.0 m |
| Height | 4.56 m | 5.76 m |
| Width, across the thighs | 2.2 m | 3.2 m |
| Hip joint height | 3.02 m (25% of length) | 3.6 m (30%) |
| Belly, lowest point under the chest | 1.84 m | 2.49 m |
| Head top over the back at the hips | 0.6 m | 1.0 m |
| Head depth, 10% back from the snout | 1.36 m | 1.79 m |
| Tail tip height | 1.7 m | 3.0 m |

What made the old Rex look wrong:

- **Low and long.** Its legs are short for its length, so the body hangs low and reads as a long tube.
- **Head level with the back.** The head barely rises over the shoulders. The neck is as thick as the chest, so there
  is no neck curve.
- **Tail runs downhill.** From the hip, the tail slopes down to 1.7 m at the tip. In the new Rex it stays near hip
  height and balances the head.
- **Thin legs and flat sides.** The thighs barely show from the front, and there is no hip or rib shape.

The new Rex stands upright, with a deep chest, a big head on an S-shaped neck, heavy thighs, long legs and a level
tail. Keep all of that.

## Notes for the next steps

- The rest pose has the mouth open. The clips will show whether the jaw closes cleanly.
- There are no hand or toe bones. The arms are an upper arm and a forearm. The game only needs `jaw` and the sockets.
- The bone names are close to the game's already: `neck1` becomes `neck_1`, `tail1` becomes `tail_1`, `_L` becomes
  `_l`, `shin` becomes `shank`, `hpaw` becomes `toes`, and `head` becomes `skull`.
