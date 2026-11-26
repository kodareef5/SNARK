"""Eight palm-centred hand tools with authored far silhouettes."""

from pathlib import Path
import sys

parent = Path(__file__).resolve().parent
sys.path[:0] = [str(parent), str(parent.parent)]

from blades import pike, sword
from early import club, slingshot, torch
from hand_geometry import Prop
from metal import hatchet_metal, pick_metal, sickle

SWATCHES = {
    "wood": (0.12, (112, 73, 44)),
    "hide": (0.12, (132, 85, 50)),
    "brass": (0.14, (140, 108, 58)),
    "iron": (0.10, (68, 69, 70)),
    "rubber": (0.085, (42, 33, 28)),
    "steel": (0.16, (150, 152, 155)),
    "cloth": (0.10, (164, 125, 78)),
    "char": (0.10, (47, 42, 37)),
}

for build in (torch, slingshot, club, hatchet_metal, pick_metal, pike, sickle, sword):
    for level in range(4):
        tool = Prop(level, SWATCHES)
        build(tool)
        tool.build(build.__name__)
