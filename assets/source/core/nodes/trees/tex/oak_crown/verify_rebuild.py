#!/usr/bin/env python3
"""One full offline rebuild, checks, and byte comparison; writes only here."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
def hashes():
    return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.glob('oak_crown_*.png')}

before=hashes();log=[]
for script in ['build_material.py','check_material.py']:
    result=subprocess.run([sys.executable,'-B',str(ROOT/script)],cwd=ROOT,text=True,capture_output=True)
    log.append('$ python3 -B '+script+'\n'+result.stdout+result.stderr)
    if result.returncode:
        (ROOT/'checks/rebuild.log').write_text('\n'.join(log))
        raise SystemExit(result.returncode)
after=hashes();equal=before==after
(ROOT/'checks/rebuild.log').write_text('\n'.join(log))
(ROOT/'checks/rebuild_verification.json').write_text(json.dumps(dict(byte_identical=equal,before=before,after=after),indent=2)+'\n')
print('All four PNGs reproduced byte for byte.' if equal else 'ERROR: output changed during rebuild.')
if not equal:raise SystemExit(1)
