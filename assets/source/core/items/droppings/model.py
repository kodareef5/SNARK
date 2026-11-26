"""Build the four droppings that appear as single-item ground drops."""

from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]

from hand_geometry import Prop
from large import feces_large, feces_massive
from small import feces_medium, feces_small

SWATCHES = {
    "dung": (0.24, (83, 57, 34)),
    "dung_fold": (0.24, (109, 76, 43)),
}

for build in (feces_small, feces_medium, feces_large, feces_massive):
    for level in range(4):
        prop = Prop(level, SWATCHES)
        build(prop)
        prop.build(build.__name__, grounded=True)
