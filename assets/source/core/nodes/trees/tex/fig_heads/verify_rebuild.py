#!/usr/bin/env python3
"""Offline rebuild verification. All writes remain inside this folder."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT=Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    maps=[ROOT/f'fig_heads_{name}.png' for name in ['base','normal','height','orm']]
    before={p.name:digest(p) for p in maps}
    inputs=list((ROOT/'source').glob('*_generated.png'))+[ROOT/'build_material.py',ROOT/'check_material.py',ROOT/'BRIEF.md']
    original={p.relative_to(ROOT).as_posix():digest(p) for p in inputs}
    logs=[];codes=[]
    for name in ['build_material.py','check_material.py']:
        p=subprocess.run([sys.executable,'-B',str(ROOT/name)],cwd=ROOT,capture_output=True,text=True)
        logs.append(name+'\n'+p.stdout+p.stderr);codes.append(p.returncode)
    after={p.name:digest(p) for p in maps}
    unchanged=all(digest(ROOT/p)==sha for p,sha in original.items())
    result=dict(byte_identical=before==after,inputs_unchanged=unchanged,exit_codes=codes,
        before=before,after=after,input_hashes=original)
    (ROOT/'checks/rebuild.log').write_text('\n'.join(logs))
    (ROOT/'checks/rebuild_verification.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(byte_identical=result['byte_identical'],inputs_unchanged=unchanged,exit_codes=codes)))
    if before!=after or not unchanged or any(codes):raise SystemExit(1)


if __name__=='__main__':main()
