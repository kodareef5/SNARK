# The taxi as a survivor's salvage leaves it: stripped, and a shell with its roof sign, bumpers, lamps and seats gone
# with its doors and wheels.
# Built from ../taxi's own model; ../parked_common/salvaged.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from salvaged import build

# The engine's frame, metres: (x0, x1, y0, y1, z0, z1). A prepared part wholly in one of these is off the shell.
OFF = (
    (-9, 9, 1.44, 9, -9, 9),  # the roof sign
    (-9, 9, 0, 9, 2.15, 9), (-9, 9, 0, 9, -9, -2.15),  # bumpers, lamps, grille and plates
    (-0.75, 0.75, 0.3, 1.1, -1.2, 0.95),  # seats and dash
)
build("taxi", "taxi_abandoned", ("stripped", "shell"), off=OFF)
