# The semi's tractor as a survivor's salvage leaves it: stripped, and a shell with its bonnet, stacks, tanks, mudguards,
# bumper, lamps and seats gone with its doors and wheels.
# Built from ../semi's own model; ../parked_common/salvaged.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from salvaged import build

# The engine's frame, metres: (x0, x1, y0, y1, z0, z1). A prepared part wholly in one of these is off the shell,
# at its finest and at its hand-made levels.
OFF = (
    (-0.7, 0.7, 0.85, 2.1, 1.85, 4.0),  # the bonnet
    (-9, 9, 0, 9, 3.8, 9), (0.75, 9, 0.9, 1.3, 3.5, 3.9), (-9, -0.75, 0.9, 1.3, 3.5, 3.9),  # bumper, grille and lamps
    (0.4, 1.1, 0.9, 9, -1.35, -0.8), (-1.1, -0.4, 0.9, 9, -1.35, -0.8),  # the stacks
    (0.45, 9, 0, 1.02, 0.2, 1.9), (-9, -0.45, 0, 1.02, 0.2, 1.9),  # tanks and steps
    (0.6, 9, 0.2, 1.3, -9, -1.2), (-9, -0.6, 0.2, 1.3, -9, -1.2),  # the rear mudguards and flaps
    (1.03, 9, 2.1, 2.8, 1.7, 2.0), (-9, -1.03, 2.1, 2.8, 1.7, 2.0),  # the mirrors
    (-9, 9, 3.2, 9, -9, 9),  # the roof markers
    (-1.0, 1.0, 1.2, 2.15, 0.9, 2.05),  # seats and dash
)
build("semi", "semi_abandoned", ("stripped", "shell"), levels=(2, 3, 4, 5), off=OFF)
