#!/usr/bin/env python3
"""Rebuild offline and compare the four deliverables byte for byte."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT=Path(__file__).resolve().parent


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    maps=[ROOT/f'mangrove_heads_{kind}.png' for kind in ['base','normal','height','orm']]
    before={p.name:digest(p) for p in maps}
    inputs=[ROOT/'source'/a['file'] for a in json.loads((ROOT/'source/originals.json').read_text())]
    inputs+=[ROOT/p for p in ['build_material.py','leaf_library.py','diagnostic_renderer.py','check_material.py','BRIEF.md','requirements.txt']]
    frozen={p.relative_to(ROOT).as_posix():digest(p) for p in inputs}
    logs=[];codes=[]
    for name in ['build_material.py','check_material.py']:
        result=subprocess.run([sys.executable,'-B',str(ROOT/name)],cwd=ROOT,capture_output=True,text=True)
        logs.append(name+'\n'+result.stdout+result.stderr);codes.append(result.returncode)
    after={p.name:digest(p) for p in maps}
    unchanged=all(digest(ROOT/p)==h for p,h in frozen.items())
    result=dict(byte_identical=before==after,inputs_unchanged=unchanged,exit_codes=codes,
        before=before,after=after,input_hashes=frozen)
    (ROOT/'checks/rebuild.log').write_text('\n'.join(logs))
    (ROOT/'checks/rebuild_verification.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['byte_identical','inputs_unchanged','exit_codes']}))
    if before!=after or not unchanged or any(codes):raise SystemExit(1)


if __name__=='__main__':main()
