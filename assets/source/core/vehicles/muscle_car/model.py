import sys
from pathlib import Path

folder = Path(__file__).resolve().parent
sys.path.insert(0, str(folder.parent / "heavy_road"))
from export_model import export

export(folder)
