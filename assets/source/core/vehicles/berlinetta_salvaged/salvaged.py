# The berlinetta as a survivor's salvage leaves it: stripped, and a shell with its bonnet and engine lid, bumpers,
# lamps, brakes and seats gone with its doors and wheels.
# Built from ../berlinetta's own model; ../parked_common/salvaged.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from salvaged import build

OFF = (
    "front clip skin", "frunk shutline", "rear clip skin", "engine cover spine", "engine observation lid", "deck cooling slot", "louvre blade",
    "front bumper", "front splitter", "rear diffuser", "diffuser", "tailpipe", "number plate", "plate plinth", "driver wiper",
    "headlight enclosure", "daylight signature", "lower rear LED", "rear chevron LED", "tail lamp", "turn repeater",
    "bucket shell and back", "seat cushion", "rolled cushion welt", "airbag", "centre screen", "driver instrument LCD", "rearview",
    "cam cover rib", "crinkle finish cam cover", "brake caliper", "brake rotor",
)
build("berlinetta", "berlinetta_abandoned", ("stripped", "shell"), off=OFF)
