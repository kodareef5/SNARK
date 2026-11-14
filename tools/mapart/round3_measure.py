"""Audit exported RGB, every join, retained world data, and native brush detail.

The visual review remains separate. No drawing-support identity is presented
as an independent visible-geometry measurement.
"""
import hashlib, json
from datetime import datetime, timezone
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from scipy.stats import spearmanr
from common import ROOT
from audit import png_info
from round3_bathy import depth_at

R=ROOT/'reports/round3'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def blur(a,s):return cv2.GaussianBlur(a,(0,0),s,borderType=cv2.BORDER_REFLECT)

def main():
    report={'time_utc':datetime.now(timezone.utc).isoformat(),'zooms':{},'joins':[],
        'interpretation':'Visible RGB diagnostics and complete delivery audit. Pigment is not a semantic map; artistic quality is assessed in REPORT.md.'}
    hashes={}
    for z in range(4):
        n=1024*2**z;master=ROOT/f'paintings/z{z}/final-master.png'
        a=np.array(Image.open(master));stitch=np.empty_like(a)
        expected={f'{x}_{y}.png' for x in range(2**z) for y in range(2**z)}
        assert expected=={p.name for p in (ROOT/f'tiles/z{z}').glob('*.png')}
        for y in range(2**z):
            for x in range(2**z):
                p=ROOT/f'tiles/z{z}/{x}_{y}.png';im=Image.open(p)
                assert im.mode=='RGB' and im.size==(1024,1024)
                stitch[y*1024:(y+1)*1024,x*1024:(x+1)*1024]=im
                hashes[str(p.relative_to(ROOT))]=sha(p)
                for ext in ['raw.png','prompt.txt']:assert (ROOT/f'paintings/z{z}/{x}_{y}.{ext}').exists()
        item=dict(tiles=4**z,pixels=n,reconstruction_max=int(np.abs(a.astype(np.int16)-stitch).max()))
        assert item['reconstruction_max']==0
        for axis in ['vertical','horizontal']:
            v=a if axis=='vertical' else a.transpose(1,0,2)
            for k in range(1,2**z):
                c=k*1024
                for j in range(2**z):
                    s=v[j*1024:(j+1)*1024,c-33:c+34].astype(np.int16)
                    jumps=np.abs(np.diff(s,axis=1)).mean((0,2))
                    cross=float(jumps[32]);adjacent=float((jumps[31]+jumps[33])/2)
                    near=float(np.delete(jumps,32).mean())
                    report['joins'].append(dict(z=z,axis=axis,coordinate=c,segment=j,jump=cross,immediate_neighbours=adjacent,
                        ratio_immediate=cross/max(adjacent,.0001),nearby_66_boundaries=near,ratio_nearby=cross/max(near,.0001)))
        if z:
            p=np.array(Image.open(ROOT/f'paintings/z{z-1}/final-master.png'),np.float32)
            small=np.array(Image.fromarray(a).resize((n//2,n//2),Image.Resampling.BOX),np.float32)
            delta=small-p
            item['parent_rgb_mae_255']={'raw':float(np.abs(delta).mean()),'blur4':float(np.abs(blur(delta,4)).mean()),'blur8':float(np.abs(blur(delta,8)).mean()),
                                      'blur16':float(np.abs(blur(delta,16)).mean()),'mean_shift':delta.mean((0,1)).tolist()}
        w=np.array(Image.open(ROOT/f'references/z{z}/surface_water.png'))>0
        af=a.astype(np.float32)
        observed=(af[...,1]-af[...,0]>3)&(af[...,2]-af[...,0]>-18)
        item['water_pigment']={'fixed_round2_classifier_iou':float((observed&w).sum()/(observed|w).sum()),
            'source_water_fraction_classified':float(observed[w].mean()),'source_land_fraction_classified_as_teal':float(observed[~w].mean())}
        edge=w&~nd.binary_erosion(w,border_value=1);edge[[0,-1]]=False;edge[:,[0,-1]]=False
        oe=observed&~nd.binary_erosion(observed,border_value=1)
        dist=nd.distance_transform_edt(~oe)[edge]
        item['shore_pigment_proximity']={'mean_px':float(dist.mean()),'p95_px':float(np.percentile(dist,95)),
            'max_px':float(dist.max()),'within_2_px':float((dist<=2).mean()),'limit':'One-way proximity to teal pigment, not a proof of survey accuracy.'}
        # Retained z3 water and building drawing: inspect local contrast, rather
        # than treating changed broad depth colour as lost native illustration.
        if z>=2:
            old=np.array(Image.open(ROOT/f'paintings/z{z}/retained-paint.png'),np.float32)
            gray=af.mean(2);og=old.mean(2)
            hp=gray-blur(gray,2);ohp=og-blur(og,2)
            b=np.array(Image.open(ROOT/f'references/z{z}/buildings.png'))>0
            safe=nd.binary_erosion(w,iterations=8)
            item['retained_native_drawing']={}
            for label,mask in [('buildings',b),('water',safe)]:
                x=hp[mask][::8];y=ohp[mask][::8]
                item['retained_native_drawing'][label]=dict(highpass_correlation=float(np.corrcoef(x,y)[0,1]),
                    highpass_std_ratio=float(x.std()/max(y.std(),.001)))
            del old,hp,ohp
        # An overview statistic for depth relationships; this is not navigation.
        overview=np.array(Image.fromarray(a).resize((1024,1024),Image.Resampling.BOX),np.float32)
        ow=np.array(Image.open(ROOT/'references/z0/surface_water.png'))>0
        safe=nd.binary_erosion(ow,iterations=6)
        lum=blur(overview.mean(2),8);dep=depth_at(1024)
        item['depth_vs_darkness_rank_correlation']=float(spearmanr(dep[safe][::8],-lum[safe][::8]).statistic)
        report['zooms'][str(z)]=item
        print(z,'parent',item.get('parent_rgb_mae_255'),'water',item['water_pigment'],flush=True)
    assert len(report['joins'])==140
    report['join_count']=len(report['joins'])
    report['join_max_immediate']=max(x['ratio_immediate'] for x in report['joins'])
    report['join_max_nearby']=max(x['ratio_nearby'] for x in report['joins'])
    prior=json.loads((R/'prior-sha256.json').read_text())
    preserved={}
    for key,h in prior.items():
        if key.startswith('base/') and key!='base/VALUES.md':
            preserved[key]=sha(ROOT/key)==h;assert preserved[key],key
    report['existing_base_unchanged']=preserved
    for z in range(4):
        originals=list((ROOT/f'paintings/z{z}').glob('*.raw.png'))
        assert len(originals)==4**z
        for p in originals:hashes[str(p.relative_to(ROOT))]=sha(p)
    report['originals_changed']=[k for k,h in hashes.items() if k.endswith('.raw.png') and prior.get(k)!=h]
    report['z3_originals_unchanged']=all(hashes[k]==h for k,h in prior.items() if k.startswith('paintings/z3/') and k.endswith('.raw.png'))
    assert report['z3_originals_unchanged']
    for p in (ROOT/'base').glob('*.png'):
        info=png_info(p);n=8192 if p.stem.endswith('_fine') else 4065
        assert info['width']==info['height']==n and info['color_type']==0
        assert info['bit_depth']==(16 if p.name=='height.png' else 8)
    report['engine_corners']={name:[4064-e,4064+n] for name,e,n in [('NW',-4064,4064),('NE',4064,4064),('SE',4064,-4064),('SW',-4064,-4064)]}
    for folder in ['base','style']:
        for p in (ROOT/folder).rglob('*'):
            if p.is_file():hashes[str(p.relative_to(ROOT))]=sha(p)
    for p in (ROOT/'paintings').rglob('*'):
        if p.is_file() and (p.name.endswith('.prompt.txt') or p.name in ['retained-paint.png','water-parent.png']):hashes[str(p.relative_to(ROOT))]=sha(p)
    (R/'measurements.json').write_text(json.dumps(report,indent=2))
    (R/'sha256.json').write_text(json.dumps(hashes,indent=2))
    print('PASS: 85 tiles, 85 originals, 140 joins, zero cut error, original world layers unchanged.',flush=True)
    print('worst immediate / neighborhood',report['join_max_immediate'],report['join_max_nearby'],flush=True)

if __name__=='__main__':main()
