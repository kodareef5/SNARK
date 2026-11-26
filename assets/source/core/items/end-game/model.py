"""Build the held prod, plasma pickups and shock dart."""

from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]

from ammo import dart_shock, plasma_cell, plasma_charge
from hand_geometry import Prop
from prod import prod

SWATCHES = {
    "steel": (0.18, (153, 152, 147)),
    "rubber": (0.12, (55, 59, 56)),
    "iron": (0.12, (82, 93, 104)),
    "amber": (0.12, (155, 95, 42)),
    "optic": (0.12, (60, 166, 170)),
    "ceramic": (0.18, (185, 181, 150)),
}

for build in (prod, plasma_charge, dart_shock, plasma_cell):
    for level in range(4):
        prop = Prop(level, SWATCHES)
        build(prop)
        prop.build(build.__name__, grounded=build is not prod)
