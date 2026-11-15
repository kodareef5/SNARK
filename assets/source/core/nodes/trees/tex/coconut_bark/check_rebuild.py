#!/usr/bin/env python3
"""Rebuild once and verify frozen maps, master, masks and metadata byte-for-byte."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def hashes():
    paths = [*(ROOT/f'{ROOT.name}_{layer}.png' for layer in ('base','height','normal','orm')),
             ROOT/'source'/'composed_master_2304.png', ROOT/'source'/'ridge_extraction.png',
             ROOT/'source'/'construction_masks.npz', ROOT/'material.json']
    return {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


if __name__ == '__main__':
    before = hashes()
    subprocess.run([sys.executable,str(ROOT/'build_material.py')],check=True)
    after = hashes()
    result = dict(revision=2, passes=before==after,
                  files={p:dict(before=before[p],after=after[p],identical=before[p]==after[p]) for p in before})
    (ROOT/'checks'/'rebuild.json').write_text(json.dumps(result,indent=2)+'\n')
    assert result['passes'], 'Non-deterministic rebuild; see checks/rebuild.json'
    print(f'{ROOT.name}: all {len(before)} rebuild artifacts are byte-identical')
