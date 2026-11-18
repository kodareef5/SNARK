from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "marine"))
from wreck import wreck

wreck("lagoon", "sunk")
