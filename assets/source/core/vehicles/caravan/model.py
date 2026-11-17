from pathlib import Path
import sys

here = Path(__file__).resolve().parent
sys.path.insert(0, str(here.parent / "van_common"))
from coachbuilder import build

build(here.name)
