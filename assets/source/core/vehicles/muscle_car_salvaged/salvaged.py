# The muscle car as a survivor's salvage leaves it: stripped, and a shell with its bumpers, lamps, scoop and seats gone
# with its doors and wheels.
# Built from ../muscle_car's own model; ../parked_common/salvaged.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from salvaged import build

# The engine's frame, metres: (x0, x1, y0, y1, z0, z1). A prepared part wholly in one of these is off the shell.
OFF = (
    (-9, 9, 0, 9, 2.12, 9), (-9, 9, 0, 9, -9, -2.12),  # bumpers, lamps, grille, plates and spoiler
    (-0.3, 0.3, 0.85, 1.05, 0.85, 1.6),  # the bonnet scoop
    (-0.6, 0.6, 0.2, 0.4, -2.4, -1.9),  # the exhaust tips
    (-0.75, 0.75, 0.3, 1.1, -0.7, 0.6),  # seats and dash
)
build("muscle_car", "muscle_car_abandoned", ("stripped", "shell"), off=OFF)
