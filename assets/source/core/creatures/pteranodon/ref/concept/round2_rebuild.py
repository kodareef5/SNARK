"""Rebuild round 2 from saved generated sources; no new generation or network."""
from pathlib import Path
import subprocess,sys
R=Path(__file__).resolve().parent
for script in ['round2_finish.py','round2_sheets.py','round2_validate.py']:
    subprocess.run([sys.executable,str(R/script)],cwd=R,check=True)
