# The monster truck as a survivor's salvage leaves it: stripped, and a shell down on its frame, its axles and springs,
# bumpers, lamps and seats gone with its doors and wheels.
# Built from ../monster_truck's own model; ../parked_common/salvaged.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from salvaged import build

# The engine's frame, metres: (x0, x1, y0, y1, z0, z1). A prepared part wholly in one of these is off the shell.
OFF = (
    (-9, 9, 2.42, 9, -9, 9),  # the roof lamps and their bar
    (-9, 9, 0, 9, 1.83, 9), (-9, 9, 0, 9, -9, -1.83),  # bumpers, lamps, grille and plate
    (-9, 9, 0, 1.27, -9, 9),  # axles, springs, dampers and differentials: it sits on its frame
    (0.69, 9, 0, 1.33, -9, 9), (-9, -0.69, 0, 1.33, -9, 9),  # the steps
    (-0.75, 0.75, 1.3, 2.15, -0.8, 0.3),  # seats and dash
)
build("monster_truck", "monster_truck_abandoned", ("stripped", "shell"), off=OFF)
