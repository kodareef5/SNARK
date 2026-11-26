"""Closed cartridge and rocket pickups with progressively simpler profiles."""

from pathlib import Path
import sys

parent = Path(__file__).resolve().parent
sys.path[:0] = [str(parent), str(parent.parent)]

from hand_geometry import Prop
from long_rounds import round_advanced_rifle, round_advanced_sniper, round_rifle
from rocket import rocket
from short_rounds import round_advanced, round_pistol, round_shotgun

SWATCHES = {
    "brass": (0.16, (170, 124, 48)),
    "iron": (0.16, (92, 98, 110)),
    "steel": (0.24, (150, 152, 156)),
    "green": (0.18, (86, 140, 92)),
    "orange": (0.18, (228, 130, 70)),
}

for build in (round_pistol, round_rifle, round_shotgun, round_advanced, round_advanced_rifle, round_advanced_sniper, rocket):
    for level in range(4):
        prop = Prop(level, SWATCHES)
        build(prop)
        prop.build(build.__name__, grounded=True)
