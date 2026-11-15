"""Check the deliverable contract, rebuild bytes and actual rendered stage zero."""
from pathlib import Path
import hashlib
import json
import site
import subprocess
import sys

site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import cKDTree

HERE=Path(__file__).resolve().parent
TEX=HERE.parent


def hashes():
    return {p.name:hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(TEX.glob('pteranodon*_*.png')) if p.stem.endswith(('_hurt','_decay'))}


def main():
    before=hashes()
    inputs_before=json.loads((HERE/'checks/manifest.json').read_text())['inputs']
    subprocess.run([sys.executable,'-B',str(HERE/'paint.py')],check=True)
    after=hashes()
    assert before==after,'Rebuild changed delivered bytes'
    assert inputs_before==json.loads((HERE/'checks/manifest.json').read_text())['inputs'],'Inputs changed during verification'
    result={'identical_rebuild':True,'outputs':after,'png':{},'overlap':{},'unhurt':{},'membrane':{}}
    for name in before:
        p=TEX/name; im=Image.open(p);raw=p.read_bytes()
        assert im.mode=='RGBA' and im.size==(1024,1024)
        assert raw[24]==8 and raw[25]==6
        assert im.info.get('srgb')==0
        a=np.array(im)[...,3]
        result['png'][name]={'size':list(im.size),'rgba_bits':8,'sRGB':True,'alpha_values':len(np.unique(a))}
    for mat in ['pteranodon','pteranodon_wing']:
        a=np.array(Image.open(TEX/f'{mat}_hurt.png'))[...,3]
        b=np.array(Image.open(TEX/f'{mat}_decay.png'))[...,3]
        n=int(np.count_nonzero((a>0)&(b>0)))
        assert n==0
        result['overlap'][mat]=n
    for p in sorted((HERE/'look/baseline').glob('stages_*.png')):
        q=HERE/'look/close'/p.name
        if not q.exists():continue
        a=np.array(Image.open(p))[:,8:308].astype(int)
        b=np.array(Image.open(q))[:,8:308].astype(int)
        delta=np.abs(a-b)
        result['unhurt'][p.stem]={'changed_pixels':int(np.any(delta>0,axis=-1).sum()),'max_channel_difference':int(delta.max())}
        assert not delta.any(),f'Unhurt differs in {p.name}'
    meta=json.loads((TEX/'paint/pteranodon_wing_pieces.json').read_text())
    box=meta['position_box']
    ids=np.array(Image.open(TEX/'paint/pteranodon_wing_pieces.png').resize((1024,1024),Image.Resampling.NEAREST))[...,0]
    pos=np.stack([np.array(Image.open(TEX/f'paint/pteranodon_wing_position_{axis}.png').resize((1024,1024),Image.Resampling.NEAREST),dtype=float)/65535*(box['max'][i]-box['min'][i])+box['min'][i] for i,axis in [(0,'x'),(2,'z')]],-1)
    for layer in ['hurt','decay']:
        rgba=np.array(Image.open(TEX/f'pteranodon_wing_{layer}.png'))
        alpha=rgba[...,3]
        metrics=[]
        for start,end in [(4,3),(3,4)]:
            a=(ids==start)&(alpha>0);b=(ids==end)&(alpha>0)
            distances,_=cKDTree(pos[b]).query(pos[a],workers=1)
            metrics.append({'from_piece':start,'to_piece':end,'p99_nearest_mark_mm':round(float(np.percentile(distances,99))*1000,3),
                            'max_nearest_mark_mm':round(float(distances.max())*1000,3)})
            # The faces have different UV sampling. One stored-game texel is
            # 14 mm; mismatched isolated marks would greatly exceed this.
            assert distances.max()<.014, 'Unpaired membrane damage'
        result['membrane'][layer]=metrics
    (HERE/'checks/validation.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'identical_rebuild':True,'unhurt_views':len(result['unhurt']),
                      'overlap':result['overlap'],'membrane':result['membrane']},indent=2))


if __name__=='__main__':main()
