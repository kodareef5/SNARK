"""Build the three kit drops and the four placed pieces."""

from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]

from bunk import bunk_bed
from hand_geometry import Prop
from kits import boat_assembly, helicopter_assembly, zzzzzskateboard_assembly
from skate import zzzzzzskate_kicker, zzzzzzskate_ledge, zzzzzzskate_rail

SWATCHES = {
    "wood": (0.16, (144, 102, 62)),
    "iron": (0.16, (88, 94, 91)),
    "rubber": (0.22, (54, 58, 53)),
    "stone": (0.21, (123, 118, 103)),
    "hide": (0.48, (111, 69, 50)),
    "linen": (0.36, (184, 161, 116)),
    "steel": (0.26, (154, 157, 161)),
    "bronze": (0.26, (150, 107, 60)),
}

portables = (zzzzzskateboard_assembly, boat_assembly, helicopter_assembly)
placed = (zzzzzzskate_kicker, zzzzzzskate_rail, zzzzzzskate_ledge, bunk_bed)
for build in (*portables, *placed):
    for level in range(4):
        prop = Prop(level, SWATCHES)
        build(prop)
        prop.build(build.__name__, grounded=build in portables)
