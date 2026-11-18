from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "power_cats"))
from catamaran import build

build("lagoon")
