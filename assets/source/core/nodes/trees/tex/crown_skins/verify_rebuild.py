#!/usr/bin/env python3
"""Cold offline rebuild in a temporary folder, using only retained inputs.

No existing PNG, composition, structure cache or manifest is copied as input.
Both builder and full independent checker run there. The temporary folder is
removed afterwards; only the compact verification record and log remain.
"""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import numpy
import scipy
import PIL

ROOT=Path(__file__).resolve().parent

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def hashes(root):return {p.name:digest(p) for p in sorted(root.glob('*_skin_*.png'))}

def main():
    before=hashes(ROOT)
    assert len(before)==18,'Build all eighteen delivered PNGs first.'
    inputs=[ROOT/x for x in ['build_skins.py','check_skins.py','requirements.txt','.gitignore']]
    inputs += sorted(p for p in (ROOT/'source').iterdir() if p.name!='build_manifest.json' and p.is_file())
    assert not any(p.suffix=='.npz' or p.name.endswith('_composition.json') for p in inputs)
    input_hashes={str(p.relative_to(ROOT)):digest(p) for p in inputs}
    (ROOT/'checks').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='crown-skins-cold-') as tmp:
        cold=Path(tmp)
        for p in inputs:
            target=cold/p.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(p,target)
        with (ROOT/'checks/rebuild_run.log').open('w') as log:
            for script in ['build_skins.py','check_skins.py']:
                print('Cold rebuild:',script,flush=True)
                result=subprocess.run([sys.executable,'-B',str(cold/script)],cwd=cold,stdout=log,stderr=subprocess.STDOUT)
                if result.returncode:raise SystemExit(f'{script} failed; see checks/rebuild_run.log')
        after=hashes(cold)
        audit=json.loads((cold/'checks/metrics.json').read_text())
    record=dict(all_eighteen_byte_identical=before==after,method='Isolated temporary folder, retained sources only, no cache or delivered maps as inputs.',
        checked_pngs=len(after),cold_checks_passed=audit['passed'],cold_checks_total=audit['total'],
        input_sha256=input_hashes,versions=dict(python=sys.version,numpy=numpy.__version__,scipy=scipy.__version__,Pillow=PIL.__version__),
        before=before,after=after)
    (ROOT/'checks/rebuild_verification.json').write_text(json.dumps(record,indent=2)+'\n')
    assert before==after,'A cold rebuilt PNG differs.'
    print(f'All 18 PNGs reproduced byte for byte; {audit["passed"]}/{audit["total"]} cold checks passed.')

if __name__=='__main__':main()
