#!/usr/bin/env python3
"""Rebuild and independently check the delivered maps, recording their hashes."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
MAPS = [f'royal_frond_{kind}.png' for kind in ['base', 'height', 'normal', 'orm']]


def hashes(names):
    return {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in names}


def main():
    before = hashes(MAPS)
    inputs = ['build_material.py', 'check_material.py', 'verify_rebuild.py',
              'guide/LAYOUT.json', 'outline.json', 'source/sRGB.icc',
              'source/generation_prompt_round2.txt',
              'source/leaflets_living_generated.png',
              'source/leaflets_aging_generated.png',
              'source/leaflets_fold_detail_generated.png',
              'source/round1/royal_frond_base.png',
              'source/round1/royal_frond_height.png',
              'source/round1/royal_frond_normal.png',
              'source/round1/leaflet_ids.png',
              'source/round1/composition.json', 'source/round1/outline.json']
    source_hashes = hashes(inputs)
    subprocess.run([sys.executable, str(ROOT/'build_material.py')], cwd=ROOT, check=True)
    after = hashes(MAPS)
    result = dict(revision=2, byte_identical=before == after,
                  before_sha256=before, after_sha256=after,
                  input_sha256=source_hashes)
    (ROOT/'checks/rebuild_verification.json').write_text(json.dumps(result, indent=2)+'\n')
    assert before == after, 'A delivered map changed during deterministic rebuild'
    assert source_hashes == hashes(inputs), 'An input changed during verification'
    subprocess.run([sys.executable, str(ROOT/'check_material.py')], cwd=ROOT, check=True)
    print('All four maps rebuilt byte for byte; all saved-image checks passed.')


if __name__ == '__main__':
    main()
