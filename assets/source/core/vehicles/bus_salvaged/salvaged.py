# The bus as a survivor's salvage leaves it: stripped, and a shell with its bonnet, bumpers, lamps, mirrors and every
# seat gone with its doors and wheels.
# Built from ../bus's own model; ../parked_common/salvaged.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from salvaged import build

# The engine's frame, metres: (x0, x1, y0, y1, z0, z1). A prepared part wholly in one of these is off the shell.
OFF = (
    (-0.7, 0.7, 0.9, 1.85, 3.3, 5.3),  # the bonnet
    (-9, 9, 0, 9, 5.2, 9), (-9, 9, 0, 0.9, -9, -5.37), (-9, 9, 2.7, 9, -9, -5.49),  # bumpers, lamps, grille
    (1.08, 9, 2.0, 9, 3.45, 3.8), (-9, -1.08, 2.0, 9, 3.45, 3.8),  # the mirrors
    (1.24, 9, 1.25, 1.85, 2.1, 2.7),  # the stop arm
    (-1.15, 1.15, 1.0, 2.0, -4.6, 3.62),  # every seat, and the dash
)
build("bus", "bus_abandoned", ("stripped", "shell"), off=OFF)
