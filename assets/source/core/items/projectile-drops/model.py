"""The grounded arrows, dart, hook and thrown equipment."""

from pathlib import Path
import sys

parent = Path(__file__).resolve().parent
sys.path[:0] = [str(parent), str(parent.parent)]

from arrows import arrow_flame, arrow_metal, arrow_stone, arrow_tranq
from dart_hook import dart_tranq, grappling_hook
from hand_geometry import Prop
from thrown_cases import c4, grenade_poison, grenade_smoke

SWATCHES = {
    "wood": (0.16, (149, 108, 62)),
    "hide": (0.22, (128, 83, 52)),
    "iron": (0.16, (92, 98, 110)),
    "steel": (0.24, (150, 152, 156)),
    "brass": (0.16, (170, 124, 48)),
    "flint": (0.18, (78, 76, 72)),
    "green": (0.18, (86, 140, 92)),
    "orange": (0.18, (228, 130, 70)),
    "cloth": (0.16, (184, 161, 116)),
}

for build in (arrow_stone, arrow_tranq, grenade_smoke, arrow_flame, grenade_poison, grappling_hook, dart_tranq, c4, arrow_metal):
    for level in range(4):
        prop = Prop(level, SWATCHES)
        build(prop)
        prop.build(build.__name__, grounded=True)
