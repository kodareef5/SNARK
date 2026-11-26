"""Build the four resource families and the remnants left after gathering."""

from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent.parent / "items")]

from clam import clam_1, clam_1_depleted, clam_2, clam_2_depleted
from crystal import crystal_rock_1, crystal_rock_1_depleted, crystal_rock_2, crystal_rock_2_depleted
from dark import (
    obsidian_rock_1, obsidian_rock_1_depleted, obsidian_rock_2, obsidian_rock_2_depleted,
    oil_rock_1, oil_rock_1_depleted, oil_rock_2, oil_rock_2_depleted,
)
from hand_geometry import Prop

SWATCHES = {
    "bitumen": (0.20, (54, 50, 44)),
    "rock_dark": (0.21, (89, 87, 78)),
    "obsidian": (0.20, (45, 46, 57)),
    "quartz": (0.18, (170, 190, 199)),
    "crystal_host": (0.21, (158, 146, 131)),
    "clam_shell": (0.18, (147, 122, 102)),
    "clam_lip": (0.18, (212, 188, 180)),
    "pearl": (0.18, (228, 219, 226)),
}

for build in (
    oil_rock_1, oil_rock_1_depleted, oil_rock_2, oil_rock_2_depleted,
    crystal_rock_1, crystal_rock_1_depleted, crystal_rock_2, crystal_rock_2_depleted,
    obsidian_rock_1, obsidian_rock_1_depleted, obsidian_rock_2, obsidian_rock_2_depleted,
    clam_1, clam_1_depleted, clam_2, clam_2_depleted,
):
    for level in range(4):
        prop = Prop(level, SWATCHES)
        build(prop)
        prop.build(build.__name__)
