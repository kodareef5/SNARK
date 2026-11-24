# The caravan as a survivor's salvage leaves it: a shell, its hood and tailgate, bumpers, lamps, roof rack and seats
# gone with its doors and wheels.
# Built from ../caravan's own model; ../parked_common/salvaged.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from salvaged import build

OFF = (
    "hood", "tailgate skin", "upper rear door", "blind top pressing", "lower rear pressing", "barn door joint", "rear hinge", "latch",
    "rear protector", "hatch lip", "liftgate",
    "bonded hatch glass", "rear glass", "rear wiper", "high stop light", "impact beam", "rear impact beam", "impact strip", "bumper",
    "upper grille", "bright grille wing", "grille blade", "lower bright accent", "headlight", "fog", "lamp seal", "segmented rear lamp",
    "rear light housing", "red tail wing", "reversing optic", "outboard amber optic", "indicator", "reflector", "upper reflector strip", "tail light gasket",
    "plate", "registration", "maker emblem", "wiper", "tail pipe", "roof rail", "rack foot",
    "cushion", "moulded seat back", "seat back insert", "seat riser", "headrest", "inset cloth", "belt buckle", "armrest",
    "radio", "instrument face", "interior mirror", "courtesy lamp",
)
build("caravan", "caravan_abandoned", ("shell",), off=OFF)
