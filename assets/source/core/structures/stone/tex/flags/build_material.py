#!/usr/bin/env python3
"""Rebuild the round-three limestone maps from retained sources and layout.

No external services are required. The only selectable contract is the normal:
detail (default) removes supplied geometry before differentiating the delivered
height; full differentiates the whole delivered height for a flat substitute.
"""
from pathlib import Path
import argparse
import hashlib
import json
import time
import numpy as np
from PIL import Image, ImageCms, ImageDraw
from scipy.ndimage import gaussian_filter, map_coordinates
from geometry import ROOT, N, MM, load_geometry

SEED=314159


def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)


def noise(rng,shape,sigma,mode='reflect'):
    a=gaussian_filter(rng.standard_normal(shape).astype(np.float32),sigma,mode=mode)
    return a/max(float(a.std()),1e-8)


def rgb(path,a,srgb=False):
    im=Image.fromarray(np.clip(np.rint(a),0,255).astype(np.uint8))
    kw={'icc_profile':ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()} if srgb else {}
    im.save(path,**kw)


def normal_from_height(h):
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*MM)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*MM)
    n=np.stack([-dx,dy,np.ones_like(h)],-1)
    return n/np.linalg.norm(n,axis=-1,keepdims=True)


def source_patch(p,atlases):
    i=p['index']; atlas=i%4; quadrant=i//4
    src=atlases[atlas]; ah,aw=src.shape[:2]
    qx,qy=quadrant%2,quadrant//2
    # Never reuse a source quadrant. Discard boundaries between the samples.
    bounds=[qx*(aw//2)+18,qy*(ah//2)+18,(qx+1)*(aw//2)-18,(qy+1)*(ah//2)-18]
    x0,y0,x1,y1=bounds
    a=np.rot90(src[y0:y1,x0:x1],i%4)
    h,w=p['mask'].shape
    sy,sx=np.mgrid[:h,:w].astype(np.float32)
    sx=(sx+.5)/w*(a.shape[1]-1);sy=(sy+.5)/h*(a.shape[0]-1)
    tex=np.stack([map_coordinates(a[:,:,c],[sy,sx],order=3,mode='reflect') for c in range(3)],-1)
    return tex,{'atlas':atlas+1,'quadrant':quadrant,'crop_pixels':bounds,'rotation_ccw':90*(i%4),
                'destination_size':[w,h],'source_size':[x1-x0,y1-y0]}


def make_patch(p,atlases,traffic):
    i=p['index'];rng=np.random.default_rng(SEED+i*2027)
    shape=p['mask'].shape;h,w=shape
    yy,xx=np.mgrid[:h,:w].astype(np.float32)
    d=p['df'];dt=p['dt'];face=p['face'];mask=p['mask']
    tex,source=source_patch(p,atlases)
    lum=.2126*tex[:,:,0]+.7152*tex[:,:,1]+.0722*tex[:,:,2]
    # Remove a fitted illumination plane, not the geological cloud shapes.
    uv=np.stack([np.ones(shape),xx/w-.5,yy/h-.5],-1)
    beta=np.linalg.lstsq(uv[::8,::8].reshape(-1,3),lum[::8,::8].ravel(),rcond=None)[0]
    mineral=lum-(beta[0]+uv[:,:,1]*beta[1]+uv[:,:,2]*beta[2])
    mineral=22*np.tanh(mineral/22)
    # Preserve the distinct source fossils; final-size additions supply actual
    # 1-3 mm pores and grit that upsampling a 591 px crop cannot supply.
    fine=noise(rng,shape,.55);grain=noise(rng,shape,1.7)
    meso=noise(rng,shape,6);cloud=noise(rng,shape,33)
    bedding=noise(rng,shape,(4.8,27))
    field=noise(rng,shape,15)
    mineral_fine=mineral-gaussian_filter(mineral,3)
    mineral_mid=gaussian_filter(mineral,2)-gaussian_filter(mineral,22)
    t=np.clip(traffic[p['sl']]+.15*np.tanh(cloud),0,1)
    # Walking leaves broad connected smooth patches, never a painted path line.
    face_gate=smooth(8,40,dt)*face
    polish=np.clip(.14+.70*t+.08*np.tanh(field),0,1)*smooth(8,28,d)
    shallow_low=np.maximum(-.5*meso-.4*cloud-.25,0)
    shallow_low=np.clip(shallow_low,0,1.6)*(1-.65*polish)*face_gate
    dish=np.exp(-(((xx/w-rng.uniform(.35,.65))/.28)**2+((yy/h-rng.uniform(.30,.7))/.26)**2))
    dish*=face_gate
    pores=gaussian_filter((rng.random(shape)<.005).astype(np.float32),.65)
    pores=np.clip(pores*6,0,1)*(1-.6*polish)
    fossil=np.clip(-mineral_fine/14,0,1)
    # Non-periodic small chips are spaced around the individual polygon, and
    # stay inside its footprint. Large corner breaks already exist in geometry.
    perimeter=p['perimeter'];count=round(perimeter/365)
    spacing=rng.uniform(.73,1.27,count);spacing*=perimeter/spacing.sum()
    centers=(np.cumsum(spacing)+rng.uniform(0,perimeter))%perimeter
    chips=np.zeros(shape,np.float32);chip_records=[]
    for j,c in enumerate(centers):
        length=float(rng.uniform(10,25))
        if i in [0,3,6,9,12] and j==0:length=float(rng.uniform(32,53))
        along=np.abs(p['along']-c);along=np.minimum(along,perimeter-along)
        profile=np.maximum(1-along/(length/2),0)**.7
        # Worn cuts interrupt the arris, not the silhouette. No fictitious
        # fracture across the main face and no extension into the mortar.
        edge=np.exp(-((d-rng.uniform(9,15))/rng.uniform(4,8))**2)*smooth(1.5,5,d)
        chips=np.maximum(chips,profile*edge)
        chip_records.append({'position_mm':float(c),'length_mm':length,'spacing_mm':float(spacing[j])})
    # Five unique, subpixel hairlines, with fading tips; all confined to face.
    crack=np.zeros(shape,np.float32)
    crack_record=None
    if i in [1,4,7,10,13]:
        points=[];cx=rng.uniform(.30,.65)*w;cy=rng.uniform(.30,.65)*h
        theta=rng.uniform(0,np.pi*2);steps=int(rng.integers(13,20))
        for k in range(steps):
            points.append((cx,cy));theta+=rng.uniform(-.28,.28)
            cx+=np.cos(theta)*rng.uniform(4,7);cy+=np.sin(theta)*rng.uniform(4,7)
        canvas=Image.new('L',(w*3,h*3));dr=ImageDraw.Draw(canvas)
        for k,(a,b) in enumerate(zip(points,points[1:])):
            strength=round(255*np.sin(np.pi*(k+.5)/(len(points)-1))**.5)
            dr.line([(a[0]*3,a[1]*3),(b[0]*3,b[1]*3)],fill=strength,width=2)
        crack=np.asarray(canvas.resize((w,h),Image.Resampling.LANCZOS),np.float32)/255
        crack*=smooth(24,42,dt)*face
        crack_record={'points_pixels_local':points,'nominal_width_mm':MM*2/3}
    tones=np.array([-2,2.1,-.5,1,1.4,-1.7,.8,-2.1,1.3,-.5,-1.5,.7,-.8,1.7,.1])
    warmth=np.array([.3,1.7,.2,0,1.3,-.3,.5,-.4,1.1,.1,0,1.8,-.2,.9,.2])
    tint=warmth[i]*np.array([1.6,.25,-1.8])
    # The full bevel uses the same unlit rock reflectance as its face. Only
    # material changes (dirt, fresh chips, polishing) alter its colour.
    value=1.20*mineral+2.0*np.tanh(cloud/1.3)+1.4*bedding+.60*grain+.7*fine
    erosion=smooth(-.3,.7,meso+.35*bedding)*(1-.70*polish)
    value+=4.2*polish-4.0*shallow_low-4.5*pores-15*crack+4.5*chips-1.3*erosion
    grime=(6+3.5*smooth(-1.3,1.3,field))*np.exp(-d/26)*(1-.35*t)
    value-=grime
    color=np.array([137,133,125])+tones[i]+tint+value[:,:,None]
    chroma=tex-lum[:,:,None];chroma-=chroma.mean((0,1))
    color+=.65*chroma
    buff=np.tanh(gaussian_filter(mineral,12)/9)
    color+=buff[:,:,None]*np.array([1.8,.35,-1.7])
    # Near the footprint keep a clear material contrast with mortar. This
    # minimum is reflectance, not simulated edge lighting or AO.
    near=d<5
    color[near]=np.maximum(color[near],np.array([116,112,104]))
    micro_relief=(.085*grain+.022*fine+.025*mineral_fine+.13*bedding)*(1-.66*polish)
    worn=.16+.58*dish+.34*polish
    residual=(.28*np.tanh(cloud)+.22*np.tanh(meso)+.055*mineral_mid-worn-.24*shallow_low-.60*erosion)*face_gate
    residual+=micro_relief-.48*pores-.48*crack-1.35*chips
    # Fade the detail into mortar before the exact footprint boundary. Macro
    # rise and tilt are kept separately, so they can be removed for normal bake.
    residual*=smooth(0,5,d)*mask
    interior=face&(d>45)
    detail_span=float(np.ptp(residual[interior]))
    detail_scale=min(1.,2.95/detail_span)
    residual*=detail_scale
    source['detail_height_scale']=detail_scale
    rough=np.clip(.742-.175*polish+.008*meso+.035*pores+.02*shallow_low,.55,.75)
    edge=1-smooth(6,30,d)
    rough=rough*(1-edge)+(.885+.018*np.tanh(grain))*edge
    rough=np.maximum(rough,.82*(1-face))
    ao=np.clip(1-.07*pores-.09*chips-.085*crack,.78,1)
    return color,residual,rough,ao,polish,crack,source,chip_records,crack_record


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--normal-mode',choices=['detail','full'],default='detail')
    args=parser.parse_args();start=time.monotonic()
    (ROOT/'build').mkdir(exist_ok=True)
    layout,ids,face_ids,geometry,patches=load_geometry()
    atlas_paths=sorted((ROOT/'source').glob('limestone_atlas_*.png'))
    assert len(atlas_paths)==4
    atlases=[np.asarray(Image.open(p).convert('RGB'),np.float32) for p in atlas_paths]
    rng=np.random.default_rng(SEED+909)
    small=noise(rng,(N,N),.55,'wrap');grit=noise(rng,(N,N),1.8,'wrap')
    dirt=noise(rng,(N,N),8,'wrap')
    base=np.array([91.,88.,81.],np.float32)+((2.4*small+2.1*grit+.7*dirt)[:,:,None])
    bed=.45+.045*small+.075*grit
    h=bed+geometry
    rough=np.clip(.957+.014*np.tanh(grit),.92,.99)
    ao=np.clip(.84+.028*np.tanh(dirt),.79,.89)
    polish=np.zeros((N,N),np.float32);cracks=np.zeros_like(polish)
    distance=np.zeros_like(polish)
    traffic=smooth(-1.45,1.25,noise(rng,(N,N),(69,183),'wrap')+.25*noise(rng,(N,N),(36,45),'wrap'))
    records=[]
    for p in patches:
        color,residual,r,a,pol,crack,source,chips,crec=make_patch(p,atlases,traffic)
        sl,mask=p['sl'],p['mask']
        base[sl][mask]=color[mask]
        h[sl][mask]=.45+p['geometry'][mask]+residual[mask]
        rough[sl][mask]=r[mask];ao[sl][mask]=a[mask]
        polish[sl][mask]=pol[mask];cracks[sl][mask]=crack[mask]
        distance[sl][mask]=p['df'][mask]
        records.append({'name':p['stone']['name'],'seed':SEED+p['index']*2027,
                        'source':source,'chips':chips,'crack':crec})
    yy,xx=np.mgrid[:N,:N]
    outer=np.minimum.reduce([xx,yy,N-1-xx,N-1-yy]).astype(np.float32)
    # All four border cores are packed mortar. Match every rotation exactly;
    # the first two rows have no height slope across the join.
    perimeter=noise(rng,(N,),.8)
    perimeter=(perimeter+perimeter[::-1])/2
    perimeter*=smooth(2,8,np.minimum(np.arange(N),np.arange(N)[::-1]))
    coord=np.where((xx<yy)&(xx<N-1-yy)|(N-1-xx<yy)&(N-1-xx<N-1-yy),yy,xx)
    signal=perimeter[coord]
    blend=1-smooth(1,2,outer)
    assert np.all(ids[blend>0]==0),'Border core overlaps a footprint'
    base=base*(1-blend[:,:,None])+(np.array([91,88,81])+2.7*signal[:,:,None])*blend[:,:,None]
    h=h*(1-blend)+.45*blend
    rough=rough*(1-blend)+(.957+.01*np.tanh(signal))*blend
    ao=ao*(1-blend)+(.84+.012*np.tanh(signal))*blend
    correction=np.array([132,128,120])-base.mean((0,1),dtype=np.float64)
    base+=correction
    q=np.clip(np.rint(base),0,255).astype(np.uint8)
    # Exact encoded RGB mean without touching a joint or a border. Only
    # rounding ties/interior errors are changed, by a single 8-bit level.
    eligible=np.flatnonzero((distance>45).ravel())
    for c,target in enumerate([132,128,120]):
        delta=int(target*N*N-q[:,:,c].sum(dtype=np.int64))
        if delta:
            errors=(base[:,:,c]-q[:,:,c]).ravel()[eligible]
            order=np.argpartition(-errors if delta>0 else errors,abs(delta)-1)[:abs(delta)]
            plane=q[:,:,c].astype(np.int16).ravel();plane[eligible[order]]+=(1 if delta>0 else -1)
            q[:,:,c]=plane.reshape(N,N)
    rgb(ROOT/'flags_base.png',q,True)
    assert h.min()>0 and h.max()<16
    Image.fromarray(np.rint(h/16*65535).astype(np.uint16)).save(ROOT/'flags_height.png')
    delivered=np.asarray(Image.open(ROOT/'flags_height.png'),np.float64)*16/65535
    normal_height=delivered-geometry if args.normal_mode=='detail' else delivered
    rgb(ROOT/'flags_normal.png',(normal_from_height(normal_height)+1)*127.5)
    rgb(ROOT/'flags_orm.png',np.stack([ao,rough,np.zeros_like(ao)],-1)*255)
    np.savez_compressed(ROOT/'build/fields.npz',ids=ids,face_ids=face_ids,geometry_mm=geometry,
                        distance_mm=distance.astype(np.float16),polish=polish.astype(np.float16),
                        cracks=cracks.astype(np.float16))
    manifest={'round':3,'tile_metres':3,'pixels':N,'mm_per_pixel':MM,'height_range_mm':16,
              'normal_mode':args.normal_mode,'normal_formula':'normalize(-Dx(H-G), +Dy(H-G), 1)' if args.normal_mode=='detail' else 'normalize(-Dx(H), +Dy(H), 1)',
              'geometry_height':'Triangulated supplied footprint/face rings and corner rises; mortar datum zero',
              'mean_srgb':q.mean((0,1),dtype=np.float64).tolist(),'mean_shift':correction.tolist(),
              'source_files':[{'path':str(p.relative_to(ROOT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'size':list(Image.open(p).size)} for p in atlas_paths],
              'layout_sha256':hashlib.sha256((ROOT/'layout/layout.json').read_bytes()).hexdigest(),
              'stones':records,'build_seconds':time.monotonic()-start}
    (ROOT/'build/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:manifest[k] for k in ['mean_srgb','normal_mode','build_seconds']},indent=2))


if __name__=='__main__':main()
