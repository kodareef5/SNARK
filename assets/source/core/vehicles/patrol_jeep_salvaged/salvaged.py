# The patrol jeep as a survivor's salvage leaves it: stripped, and a shell with its bonnet, tailgate and spare, bumper,
# winch, lightbar, lamps and seats gone with its doors and wheels.
# Built from ../patrol_jeep's own model; ../parked_common/salvaged.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from salvaged import build

OFF = (
    "Power dome bonnet", "Bonnet", "Tailgate", "External rear hinge", "Spare wheel pedestal",
    # The spare on the tailgate: the road wheels went with their bones.
    "All-terrain carcass", "Staggered shoulder and crown blocks", "Beaded sidewall", "Steel rim bead and well", "Eight pierced utility spokes",
    "Hubcap medallion", "Wheel nut", "Locking hub", "Brake rotor", "Bearing housing",
    "Folded off-road bumper", "Brush guard", "Winch", "Fairlead", "Recovery", "Cable winding",
    "Lightbar", "Extruded lightbar rail", "Prismatic", "LED collimator", "Central", "Side-facing lens", "Lamp mounting shoe",
    "Round headlamp", "Grille strobe", "Stop lamp", "Tail lamp plinth", "Tail light signature", "High stop lamp", "Fender amber lens",
    "Fender clearance lamp", "Rear reversing optic", "County registration", "Rear registration holder", "Exhaust", "Wiper", "Washer nozzle",
    "Seat", "Cushion bolster", "Upholstered seat back", "Adjustable head restraint", "Headrest stalk", "Belt buckle", "Webbing release",
    "Digital dispatch radio", "Dispatch console", "Gauge cluster",
)
build("patrol_jeep", "patrol_jeep_abandoned", ("stripped", "shell"), off=OFF)
