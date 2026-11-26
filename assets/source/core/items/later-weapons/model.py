"""Later equipment and the grips of the pieces carried in the hand."""

from math import pi
from pathlib import Path
import sys

from mathutils import Matrix

parent = Path(__file__).resolve().parent
sys.path[:0] = [str(parent), str(parent.parent)]

from attachments import flashlight, laser, scope, silencer
from hand_geometry import Prop
from long_props import rifle_assault, rifle_sniper, shotgun_pump
from pair import bow_compound, pistol_fabricated

SWATCHES = {
    "wood": (0.12, (112, 73, 44)),
    "brass": (0.14, (140, 108, 58)),
    "iron": (0.10, (68, 69, 70)),
    "rubber": (0.085, (42, 33, 28)),
    "steel": (0.16, (150, 152, 156)),
    "optic": (0.10, (64, 170, 170)),
    "polymer": (0.10, (92, 98, 110)),
}

attachments = (scope, silencer, flashlight, laser)
bow_grip = Matrix.Rotation(pi / 2, 3, "X")
for build in (scope, silencer, flashlight, pistol_fabricated, shotgun_pump, rifle_assault, laser, bow_compound, rifle_sniper):
    for level in range(4):
        prop = Prop(level, SWATCHES)
        build(prop)
        prop.build(build.__name__, rotation=bow_grip if build is bow_compound else None, grounded=build in attachments)
