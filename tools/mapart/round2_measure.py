"""Delivery checks for generalized artwork; never label symbolic buildings as masks.

Measures every tile-edge segment independently (140 joins), exported RGB colour
agreement, true continuous-canvas cutting and source-drawn geometric support.
Visual findings and the limitations of these measurements belong in REPORT.md.
"""
import hashlib,json
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from common import ROOT
from reference import grid_at
from round2 import major_roads


def main():
    report={'method':'Round-two visible-RGB and support audit; generalized symbols are not footprint masks.','zooms':{}}
    hashes={};totaljoins=0
    for z in range(4):
        n=1024*2**z;master=ROOT/f'paintings/z{z}/final-master.png'
        a=np.array(Image.open(master));stitch=np.empty_like(a)
        for y in range(2**z):
            for x in range(2**z):
                p=ROOT/f'tiles/z{z}/{x}_{y}.png';im=Image.open(p)
                assert im.mode=='RGB' and im.size==(1024,1024)
                stitch[y*1024:(y+1)*1024,x*1024:(x+1)*1024]=im
                hashes[str(p.relative_to(ROOT))]=hashlib.sha256(p.read_bytes()).hexdigest()
        seams=[]
        for axis in ['vertical','horizontal']:
            v=a if axis=='vertical' else a.transpose(1,0,2)
            for k in range(1,2**z):
                c=k*1024
                for j in range(2**z):
                    s=v[j*1024:(j+1)*1024,c-33:c+34].astype(np.int16)
                    jumps=np.abs(np.diff(s,axis=1)).mean((0,2))
                    jump=float(jumps[32]);near=float(np.delete(jumps,32).mean())
                    seams.append({'axis':axis,'coordinate':c,'segment':j,'jump':jump,'nearby':near,'ratio':jump/max(near,.001)})
        totaljoins+=len(seams)
        result={'pixels':n,'tiles':4**z,'stitch_max_rgb_error':int(np.abs(a.astype(np.int16)-stitch).max()),'seams':seams}
        if z:
            small=np.asarray(Image.fromarray(a).resize((n//2,n//2),Image.Resampling.BOX),np.float32)
            par=np.asarray(Image.open(ROOT/f'paintings/z{z-1}/final-master.png'),np.float32)
            delta=small-par
            result['parent']={'raw_mae_255':float(np.abs(delta).mean()),'blur8_mae_255':float(np.abs(nd.gaussian_filter(delta,(8,8,0))).mean()),'mean_rgb_shift':delta.mean((0,1)).tolist(),'p95_channel_difference':float(np.percentile(np.abs(delta),95))}
        # Independent pigment classification of open water. Do not count distant
        # teal flood-wash inside symbolic districts as an invented ocean coast.
        ref=ROOT/f'references/z{z}'
        w=np.array(Image.open(ref/'surface_water.png'))>0
        af=a.astype(np.float32)
        observed=(af[...,1]-af[...,0]>3)&(af[...,2]-af[...,0]>-18)
        edge=w&~nd.binary_erosion(w,border_value=1)
        edge[[0,-1]]=False;edge[:,[0,-1]]=False
        obsedge=observed&~nd.binary_erosion(observed,border_value=1)
        dist=nd.distance_transform_edt(~obsedge)
        ds=dist[edge]
        # Ink can be dark-brown, so semantic pigment edges need not equal ink.
        result['water_pigment_boundary']={'mean_px':float(ds.mean()),'p95_px':float(np.percentile(ds,95)),'max_px':float(ds.max()),'fraction_within_2px':float(np.mean(ds<=2)), 'interpretation':'One-way proximity of source shore to teal pigment boundary; not a full coast IoU or proof of accuracy.'}
        rd=major_roads(z,n)
        saved=np.array(Image.open(ref/'drawn_roads.png'))>0
        result['road_render_support']={'differing_pixels':int((rd!=saved).sum()),'drawn_pixels':int(rd.sum()),'interpretation':'Exact selected vector corridors supplied to the painter, before illustrative occlusion, not RGB inference.'}
        land=~w
        paper=(af[...,0]>218)&(af[...,1]>205)&(af[...,2]>173)&land
        result['paper_fraction_of_land']=float(paper.sum()/land.sum())
        report['zooms'][f'z{z}']=result
        print(z,'joins',len(seams),'range',min([s['ratio'] for s in seams] or [0]),max([s['ratio'] for s in seams] or [0]),'parent',result.get('parent'),'shore',result['water_pigment_boundary'],flush=True)
    report['join_count']=totaljoins
    assert totaljoins==140
    (ROOT/'reports/round2-measurements.json').write_text(json.dumps(report,indent=2))
    for p in sorted((ROOT/'paintings').glob('z*/*.raw.png')):
        hashes[str(p.relative_to(ROOT))]=hashlib.sha256(p.read_bytes()).hexdigest()
    for p in sorted((ROOT/'base').glob('*')):
        if p.is_file():hashes[str(p.relative_to(ROOT))]=hashlib.sha256(p.read_bytes()).hexdigest()
    (ROOT/'reports/round2-sha256.json').write_text(json.dumps(hashes,indent=2))

if __name__=='__main__':main()
