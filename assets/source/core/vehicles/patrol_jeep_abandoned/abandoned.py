# The patrol jeep as years in a ruined street leave it, where it stopped. A static of the street
# (content/vehicles/wrecks.ts), built from ../patrol_jeep's own model; ../parked_common/parked.py says how.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parked_common"))
from parked import build

build("patrol_jeep", "patrol_jeep_abandoned", ("abandoned",))
