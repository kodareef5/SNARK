from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sports"))
from coachwork import build

build("zephyr")
