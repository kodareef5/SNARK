"""Rebuild the current material and require byte-identical delivery PNGs."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
NAMES = [f'timber_{name}.png' for name in ('base','height','normal','orm')]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run():
    before = {name:digest(ROOT/name) for name in NAMES}
    subprocess.run([sys.executable,str(ROOT/'build_material.py')],cwd=ROOT,check=True)
    after = {name:digest(ROOT/name) for name in NAMES}
    baseline = json.loads((ROOT/'checks'/'pass3'/'baseline.json').read_text())
    unchanged = {name:after[name]==baseline['files'][name]
                 for name in NAMES if name!='timber_base.png'}
    result = dict(revision=4,byte_identical_rebuild=before==after,sha256=after,
                  data_maps_byte_identical_to_pass3=unchanged,
                  build_script_sha256=digest(ROOT/'build_material.py'),
                  source_sha256={p.name:digest(p) for p in sorted((ROOT/'source').glob('generated_*.png'))},
                  srgb_profile_sha256=digest(ROOT/'source'/'srgb.icc'))
    (ROOT/'checks'/'rebuild_verification.json').write_text(json.dumps(result,indent=2)+'\n')
    assert before==after, 'Delivery maps changed during deterministic rebuild'
    assert all(unchanged.values()), 'A protected data map changed from pass three'
    print('PASS: all four PNGs are byte-identical after an actual rebuild.')
    print('PASS: height, normal and ORM remain byte-identical to pass three.')


if __name__=='__main__':
    run()
