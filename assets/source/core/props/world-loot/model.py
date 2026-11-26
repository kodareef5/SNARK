"""Build the world loot props and the slingshot's flying stone."""

from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent.parent / "items")]

from bags import bag, cache
from crate import event_crate
from hand_geometry import Prop
from heap import feces, stone_shot

SWATCHES = {
    "linen": (0.36, (188, 169, 135)),
    "cloth": (0.16, (154, 114, 73)),
    "rubber": (0.22, (54, 58, 53)),
    "iron": (0.16, (88, 94, 91)),
    "crate_iron": (0.16, (62, 66, 67)),
    "crate_rubber": (0.16, (38, 40, 37)),
    "crate_bronze": (0.28, (156, 112, 54)),
    "dung": (0.24, (83, 57, 34)),
    "dung_fold": (0.24, (109, 76, 43)),
    "pebble": (0.21, (133, 127, 108)),
    "pebble_seam": (0.21, (108, 112, 101)),
}

for build in (bag, cache, event_crate, feces, stone_shot):
    for level in range(4):
        prop = Prop(level, SWATCHES)
        build(prop)
        prop.build(build.__name__, grounded=build is not stone_shot)
