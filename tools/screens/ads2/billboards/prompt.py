"""Print the exact ImageGen brief for one billboard."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
campaigns = json.loads((HERE / "campaigns.json").read_text())
template = (HERE / "prompt.txt").read_text()
for campaign in campaigns:
    if campaign["name"] == sys.argv[1]:
        print(template.format(**campaign), end="")
        break
else:
    raise SystemExit(f"Unknown billboard: {sys.argv[1]}")
