"""Camp furniture and hearths in the centres of their placement boxes."""

from pathlib import Path
import sys

parent = Path(__file__).resolve().parent
sys.path[:0] = [str(parent), str(parent.parent.parent / "items")]

from beds import bed, sleeping_bag
from fires import campfire, cooking_pot, fireplace, standing_torch
from hand_geometry import Prop
from storage import storage_box, storage_large

SWATCHES = {
    "wood": (0.16, (144, 102, 62)),
    "hide": (0.48, (111, 69, 50)),
    "iron": (0.16, (88, 94, 91)),
    "stone": (0.21, (123, 118, 103)),
    "linen": (0.36, (184, 161, 116)),
    "ember": (0.18, (228, 130, 70)),
    "coal": (0.16, (50, 41, 34)),
}

for build in (campfire, storage_box, sleeping_bag, bed, standing_torch, cooking_pot, storage_large, fireplace):
    burns = build in (campfire, standing_torch, cooking_pot, fireplace)
    for level in range(4):
        off = Prop(level, SWATCHES)
        if burns:
            build(off, False)
            on = Prop(level, SWATCHES)
            build(on, True)
            on.build(f"{build.__name__}_lit")
        else:
            build(off)
        off.build(build.__name__)
