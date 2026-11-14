"""Independent RGB classification and geometry/seam/zoom acceptance measurements."""
import json,sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from common import ROOT
from reference import grid_at

def boundary(m):
    s=m&~nd.binary_erosion(m,border_value=1)
    s[[0,-1],:]=False;s[:,[0,-1]]=False
    return s

def score(m,t):
    a=boundary(m);b=boundary(t)
    if a.any() and b.any():
        d1=nd.distance_transform_edt(~b)[a];d2=nd.distance_transform_edt(~a)[b]
        d=np.r_[d1,d2]
        distances={'mean_boundary_px':float(d.mean()),'p95_boundary_px':float(np.percentile(d,95)),'max_boundary_px':float(d.max())}
    else:distances={'mean_boundary_px':None,'p95_boundary_px':None,'max_boundary_px':None}
    return {'iou':float((m&t).sum()/max(1,(m|t).sum())),
            'false_positive_pixels':int((m&~t).sum()),'false_negative_pixels':int((t&~m).sum()),**distances}

def main():
    results={}
    for z in range(4):
        dest=ROOT/'tiles'/f'z{z}';p=ROOT/'paintings'/f'z{z}'/'final-master.png'
        if not p.exists():continue
        a=np.asarray(Image.open(p),dtype=np.int16);n=a.shape[0]
        rg=a[...,0]-a[...,1];gb=a[...,1]-a[...,2]
        detected={'surface_water':(rg<-3)&((a[...,2]-a[...,0])>-18),
                  'buildings':(rg>=14)&(rg<=22)&(gb>=18)&(gb<=30),
                  'roads':(rg>=4)&(rg<=10)&(gb>=32)&(gb<=44)}
        ref=ROOT/'references'/f'z{z}'
        b=np.array(Image.open(ref/'buildings.png'))>0
        rd=np.array(Image.open(ref/'roads.png'))>0
        w=np.array(Image.open(ref/'surface_water.png'))>0
        f=(grid_at('flooded_streets',n)>0)&rd&~b
        truth={'surface_water':w|f,'buildings':b,'roads':rd&~b&~f}
        geo={key:score(detected[key],truth[key]) for key in truth}
        # Exact equality after reconstructing PNGs detects missing rows, columns,
        # transposed tiles or cut-coordinate errors independently of master layout.
        stitch=np.empty_like(a,dtype=np.uint8)
        for y in range(2**z):
            for x in range(2**z):
                tile=np.asarray(Image.open(dest/f'{x}_{y}.png'))
                assert tile.shape==(1024,1024,3)
                stitch[y*1024:(y+1)*1024,x*1024:(x+1)*1024]=tile
        seams=[]
        for k in range(1,2**z):
            c=k*1024
            for axis in ['vertical','horizontal']:
                v=a if axis=='vertical' else a.transpose(1,0,2)
                jump=np.abs(v[:,c]-v[:,c-1]).mean()
                # Baseline uses nearby boundaries on both sides, including edges
                # of real geography. It is diagnostic, not a visual-quality proof.
                qs=[q for q in range(c-32,c+33) if q!=c]
                near=np.mean([np.abs(v[:,q]-v[:,q-1]).mean() for q in qs])
                seams.append({'axis':axis,'coordinate':c,'mean_channel_jump':float(jump),
                              'nearby_mean':float(near),'ratio':float(jump/max(near,.001))})
        result={'shape':list(a.shape),'tile_count':(2**z)**2,'geometry':geo,
                'stitch_max_channel_error':int(np.abs(stitch.astype(np.int16)-a).max()),'seams':seams}
        if z>0:
            small=np.asarray(Image.fromarray(stitch).resize((n//2,n//2),Image.Resampling.BOX),dtype=np.float32)
            parent=np.asarray(Image.open(ROOT/'paintings'/f'z{z-1}'/'final-master.png'),dtype=np.float32)
            err=np.abs(small-parent)
            result['parent_agreement']={'mean_abs_rgb_255':float(err.mean()),'p95_abs_channel':float(np.percentile(err,95)),
                'rmse_rgb_255':float(np.sqrt(np.mean((small-parent)**2))),
                'mean_color_shift_rgb':list(map(float,(small-parent).mean((0,1)))),
                'blurred_8px_mae':float(np.abs(nd.gaussian_filter(small,(8,8,0))-nd.gaussian_filter(parent,(8,8,0))).mean())}
        results[f'z{z}']=result
        print(z,geo,result.get('parent_agreement'),flush=True)
    (ROOT/'checks/measurements.json').write_text(json.dumps(results,indent=2))

if __name__=='__main__':main()
