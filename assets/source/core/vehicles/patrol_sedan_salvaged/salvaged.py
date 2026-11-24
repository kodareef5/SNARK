# The patrol sedan as a survivor's salvage leaves it: stripped, and a shell with its hood and deck lid, bumpers,
# lightbar, lamps and seats gone with its doors and wheels.
# Built from ../patrol_sedan's own model; ../parked_common/salvaged.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from salvaged import build

OFF = (
    "hood", "deck lid", "panel shut line", "formed bumper cover", "push bumper", "push plate", "upright rubber pad",
    "lightbar", "anodised lightbar cover", "ribbed lightbar optic", "clear takedown light", "optic separator", "aerial base", "rear whip antenna",
    "sealed beam", "headlight housing", "outer reflector", "stop and tail lens", "reverse lens", "corner indicator", "wraparound corner lens",
    "rear lamp perimeter", "tail lamp lower divider", "inset radiator grille", "radiator bright blade", "grille", "wiper", "tailpipe", "fleet registration",
    "contoured seat cushion", "cushion cloth insert", "sculpted seat back", "head restraint", "seat plinth",
    "computer housing", "dispatch display", "fleet computer pedestal", "radio", "microphone", "airbag pad", "analog cluster",
)
build("patrol_sedan", "patrol_sedan_abandoned", ("stripped", "shell"), off=OFF)
