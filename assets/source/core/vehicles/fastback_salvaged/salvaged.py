# The fastback as a survivor's salvage leaves it: a shell, its engine cover, lamps, panes, seats and dash gone with
# its doors and wheels.
# Built from ../fastback's own model; ../parked_common/salvaged.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from salvaged import build

OFF = (
    "Engine cover", "Trailing deck edge", "Lower bumper insert", "Rolled exhaust tip", "Rear license plate",
    "Full width rear light", "Rear direction lamp", "headlight optic", "lamp_edge optic", "projector optic", "Position arc", "Front marker",
    "Radiator grille", "Grille rib", "Inlet blade", "Fixed quarter glass", "Windscreen", "Wiper",
    "Seat", "Bucket cushion", "Checked seat back", "Integrated head restraint",
    "Analog dial", "Gauge bezel", "Instrument brow", "Dash", "Media stack", "Radio", "Climate knob", "Console", "Shift", "Gear lever", "Tunnel rail", "Steering column",
)
build("fastback", "fastback_abandoned", ("shell",), off=OFF)
