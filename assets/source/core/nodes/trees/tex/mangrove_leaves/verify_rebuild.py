#!/usr/bin/env python3
"""Re-run the material build and checks, then assert byte-identical delivery."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import numpy
import PIL
import scipy

ROOT=Path(__file__).resolve().parent
FILES=[f'mangrove_leaves_{part}.png' for part in ('base','height','normal','orm')]


def sha(name):return hashlib.sha256((ROOT/name).read_bytes()).hexdigest()


def main():
    before={name:sha(name) for name in FILES}
    subprocess.run([sys.executable,'-B',str(ROOT/'build_material.py')],cwd=ROOT,check=True)
    subprocess.run([sys.executable,'-B',str(ROOT/'check_material.py')],cwd=ROOT,check=True)
    after={name:sha(name) for name in FILES}
    record=dict(byte_identical=before==after,before=before,after=after,
                versions=dict(python=sys.version.split()[0],numpy=numpy.__version__,pillow=PIL.__version__,scipy=scipy.__version__),
                input_hashes={name:sha(name) for name in ['build_material.py','check_material.py',
                  'verify_rebuild.py','BRIEF_ROUND2.md','source/set2/leaves_generated.png',
                  'source/set2/generation_prompt.txt','source/set2/round2_preservation.json',
                  'guide/LAYOUT.json','requirements.txt','../../ref/concept/broadleaf/mangrove_lineup.png']})
    (ROOT/'checks/rebuild_verification.json').write_text(json.dumps(record,indent=2)+'\n')
    assert before==after,'Delivered maps changed on a clean repeat build'
    print('PASS: all four delivered PNGs reproduce byte for byte.')


if __name__=='__main__':main()
