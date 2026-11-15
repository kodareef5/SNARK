#!/usr/bin/env python3
"""Rebuild once, compare delivery hashes, then run independent checks."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
NAMES=[f'fig_leaves_{part}.png' for part in ['base','height','normal','orm']]


def hashes(names):
    return {n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in names}


before=hashes(NAMES)
env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1')
subprocess.run([sys.executable,str(ROOT/'build_material.py')],cwd=ROOT,env=env,check=True)
after=hashes(NAMES)
subprocess.run([sys.executable,str(ROOT/'check_material.py')],cwd=ROOT,env=env,check=True)
checks=json.loads((ROOT/'checks/metrics.json').read_text())
record=dict(byte_identical=before==after,before=before,after=after,
            checks_passed=checks['passed'],assertion_count=checks['assertion_count'],
            inputs=hashes(['build_material.py','check_material.py','verify_rebuild.py','requirements.txt',
                          'guide/LAYOUT.json','guide/layout.png',
                          'source/fig_specimens_set2_generated.png','source/generated_aerial_roots.png',
                          'source/concept_fig_crop.png','source/concept_registration.json',
                          'source/round1_preservation_reference.json','source/round2_preservation_reference.json']))
(ROOT/'checks/rebuild_verification.json').write_text(json.dumps(record,indent=2)+'\n')
if before!=after:raise AssertionError('A delivered PNG changed on rebuilding')
print('PASS: all four delivered maps reproduced byte for byte.')
