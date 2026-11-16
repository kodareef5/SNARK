#!/usr/bin/env python3
"""Audit round 4 against its pre-edit delivery; optionally rebuild twice cleanly.

python3 tex/paint/body/review_foot.py --baseline tex/paint/body/checks/round4_before --rebuild
The baseline is review evidence only. paint.py never reads it or any old output.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

HERE=Path(__file__).resolve().parent


def hashes(folder):
    return {p.name:hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.iterdir()) if p.is_file()}


def read(path):
    return np.asarray(Image.open(path))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--rebuild',action='store_true')
    args=parser.parse_args()
    layers=HERE/'layers';out=HERE/'checks';out.mkdir(exist_ok=True)
    meta=json.loads((HERE.parent/'pteranodon_pieces.json').read_text())
    ids={p['name']:p['number'] for p in meta['pieces']}
    pieces=read(HERE.parent/'pteranodon_pieces.png')[...,0]
    old_regions=read(args.baseline/'pteranodon_regions.png')
    band=(pieces==ids['leg'])&np.all(old_regions==[0,0,255],axis=-1)
    facts={'allowed_texels':int(band.sum()),'layers':{},'baseline_sha256':{},
           'outside_band_changed_texels':0}
    for name in ['base','height','rough','occlusion','regions']:
        filename=f'pteranodon_{name}.png'
        before=read(args.baseline/filename);after=read(layers/filename)
        changed=before!=after
        if changed.ndim==3:changed=np.any(changed,axis=-1)
        outside=int(np.count_nonzero(changed&~band))
        facts['layers'][name]={'changed_texels':int(changed.sum()),'outside_band':outside}
        facts['baseline_sha256'][filename]=hashlib.sha256((args.baseline/filename).read_bytes()).hexdigest()
        facts['outside_band_changed_texels']+=outside
        assert outside==0,(name,'changed outside foot band')
        if name=='regions':assert not changed.any(),'Changed a categorical ankle-fringe texel'
    assert (layers/'layers.json').read_bytes()==(args.baseline/'layers.json').read_bytes()
    facts['height_encoding_mm']=json.loads((layers/'layers.json').read_text())['pteranodon_height_mm']
    facts['output_sha256']=hashes(layers)
    if args.rebuild:
        facts['clean_rebuilds']=[]
        for i in range(2):
            saved=out/f'round4_clean_build_{i+1}'
            if saved.exists():shutil.rmtree(saved)
            layers.rename(saved)
            started=time.monotonic()
            with (out/f'round4_clean_build_{i+1}.log').open('w') as log:
                subprocess.run([sys.executable,str(HERE/'paint.py')],stdout=log,stderr=subprocess.STDOUT,check=True)
            current=hashes(layers)
            assert current==facts['output_sha256'],'Clean rebuild changed delivery bytes'
            facts['clean_rebuilds'].append({'seconds':round(time.monotonic()-started,2),
                                           'all_six_files_byte_identical':True,'sha256':current})
    filename='round4_verification.json' if args.rebuild else 'round4_scope.json'
    (out/filename).write_text(json.dumps(facts,indent=2)+'\n')
    # Actual renderer pictures, merely juxtaposed; no relighting or retouching.
    before=args.baseline/'look/feet_design.png'
    after=out/'round4_look/feet_design.png'
    if before.exists() and after.exists():
        sheet=Image.new('RGB',(1200,500),(40,40,40));draw=ImageDraw.Draw(sheet)
        for i,(path,label) in enumerate([(before,'Before'),(after,'Round 4 — same game camera / 1024 maps')]):
            im=Image.open(path).crop((445,405,735,630)).resize((580,450))
            sheet.paste(im,(i*600,30));draw.text((i*600+8,10),label,fill='white')
        sheet.save(out/'round4_feet_comparison.png')
    print(json.dumps(facts,indent=2))


if __name__=='__main__':main()
