#!/usr/bin/env python3
"""Rebuild and recheck once; record byte equality and all build inputs."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
MAPS = [ROOT / f'oak_leaves_{name}.png' for name in ('base', 'height', 'normal', 'orm')]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    before = {p.name: digest(p) for p in MAPS}
    subprocess.run([sys.executable, '-B', str(ROOT / 'build_material.py')], cwd=ROOT, check=True)
    subprocess.run([sys.executable, '-B', str(ROOT / 'check_material.py')], cwd=ROOT, check=True)
    after = {p.name: digest(p) for p in MAPS}
    inputs = [ROOT / name for name in ('build_material.py', 'check_material.py', 'verify_rebuild.py', 'requirements.txt')]
    inputs += sorted((ROOT / 'source').glob('*generated.png'))
    inputs += [ROOT / 'guide/LAYOUT.json', ROOT / 'source/round3_generation_prompt.txt',
               ROOT / 'source/round3_preservation_reference.json',
               ROOT / 'source/round4_preservation_reference.json',
               ROOT / 'source/round2_accessory_reference.json', ROOT / 'source/reused_generation_prompts.json',
               ROOT / 'feedback/concept_crown_detail.png']
    metrics = json.loads((ROOT / 'checks/metrics.json').read_text())
    result = dict(before=before, after=after, byte_identical=before == after,
                  checks_passed=metrics['passed'],
                  inputs={str(p.relative_to(ROOT)): digest(p) for p in inputs})
    (ROOT / 'checks/rebuild_verification.json').write_text(json.dumps(result, indent=2) + '\n')
    assert result['byte_identical'], 'Rebuild changed a delivered PNG'
    print('Independent rebuild: all four PNGs are byte-identical; all checks passed.')


if __name__ == '__main__':
    main()
