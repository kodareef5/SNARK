# The cards' real sizes have changed

The modeller's latest model (merged here) rebuilt some cards. `tex/paint/pieces.json` now gives every card rectangle's real size on the bird under `cards`, measured from the model each time the bake changes: `card_mm` is the whole rectangle's width and height in millimetres on the bird, and `mm_per_texel` the size of one texel of your 2,048 card picture across and down. Read them in `paint.py` rather than fixed numbers, as you do the pieces.

Today: the tail feather is 42 by 129 mm (was 35 by 124); the mane card is 146 mm across and 81 down (was 78 by 70), now four layers wrapping the back of the neck; the finger 23 by 54, forehead 24 by 12, hood strip 156 by 11.5, body strip 98.5 by 33, trousers 227 by 59.

If your cards are among those that changed, draw them again to their new proportions, so that each feather is its real shape on the bird, and look at them with `zsh tex/paint/look.sh <dir>` (it now also draws `nape_*` and `hood_edge_*`). Report briefly what changed.
