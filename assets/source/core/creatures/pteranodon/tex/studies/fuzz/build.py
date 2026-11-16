#!/usr/bin/env python3
"""Rebuild the velvet study. All writes stay beside this script.

The generated source supplies fine flat overlapping strands. Irregular affine
overlap synthesis closes both wraps. Frequency-separated value retains strand
drawing without lock-scale mounds. Mantle IDs interleave within the same pile.
"""
from pathlib import Path
import argparse, json, time
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates
from scipy.special import ndtr, expit

ROOT = Path(__file__).resolve().parent
N = 2048

def linear(x):
    x = np.asarray(x, np.float32)
    return np.where(x <= .04045, x / 12.92, ((x + .055) / 1.055) ** 2.4)

def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= .0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - .055)

def save8(path, a):
    Image.fromarray(np.uint8(np.clip(a * 255 + .5, 0, 255))).save(path)

def cut_path(cost):
    """Minimum-cost vertical seam; adjacent rows may move one column."""
    h, w = cost.shape
    parents = np.zeros((h, w), np.int8)
    prev = cost[0].copy()
    for y in range(1, h):
        candidates = np.stack([np.r_[np.inf, prev[:-1]], prev, np.r_[prev[1:], np.inf]])
        choice = np.argmin(candidates, axis=0)
        parents[y] = choice - 1
        prev = cost[y] + candidates[choice, np.arange(w)]
    p = np.empty(h, np.int32); p[-1] = np.argmin(prev)
    for y in range(h - 1, 0, -1):
        p[y - 1] = p[y] + parents[y, p[y]]
    return p

def seam_mix(old, new, vertical=True):
    a, b = (old, new) if vertical else (old.T, new.T)
    cost = (a - b) ** 2
    # Keep the cut away from the overlap's outer four pixels.
    cost[:, :4] += 10; cost[:, -4:] += 10
    p = cut_path(cost)
    feather = 12 if vertical else 36
    weight = np.clip((np.arange(a.shape[1])[None, :] - p[:, None]) / feather + .5, 0, 1)
    weight = weight.astype(np.float32)
    return weight if vertical else weight.T

def quilt(src, rng):
    # Unequal row heights, independently staggered columns, and unique affine
    # samples avoid the former regular 288-pixel patch lattice and copied flows.
    overlap=100; total=N+192
    out=np.zeros((total,total),np.float32); ledger=[]
    y=0
    while y<total:
        ph=min(int(rng.integers(270,520)),total-y)
        if total-y-ph<overlap: ph=total-y
        x=0
        while x<total:
            pw=min(int(rng.integers(240,510)),total-x)
            if total-x-pw<overlap: pw=total-x
            yy,xx=np.mgrid[:ph,:pw].astype(np.float32)
            old=out[y:y+ph,x:x+pw]; best=None
            for k in range(14):
                sx=float(rng.uniform(210,src.shape[1]-210)); sy=float(rng.uniform(240,src.shape[0]-240))
                # Mirroring opposing lies made chevrons at the joins. Keep
                # one corrected lie, and vary sampling, size and gentle angle.
                ang=float(rng.uniform(-.055,.055)); scale=float(rng.uniform(.83,1.18)); flip=1
                u=(xx-pw/2)*flip/scale; v=(yy-ph/2)/scale
                cx=sx+u*np.cos(ang)-v*np.sin(ang)
                cy=sy+u*np.sin(ang)+v*np.cos(ang)
                candidate=map_coordinates(src,[cy,cx],order=1,mode='reflect')
                error=0
                if x:error+=float(np.mean((candidate[::3,:overlap:3]-old[::3,:overlap:3])**2))
                if y:error+=float(np.mean((candidate[:overlap:3,::3]-old[:overlap:3,::3])**2))
                if best is None or error<best[0]:best=(error,candidate,sx,sy,ang,scale,flip)
            _,candidate,sx,sy,ang,scale,flip=best
            w=np.ones((ph,pw),np.float32)
            if x:w[:,:overlap]=seam_mix(old[:,:overlap],candidate[:,:overlap])
            if y:w[:overlap]=np.minimum(w[:overlap],seam_mix(old[:overlap],candidate[:overlap],False))
            out[y:y+ph,x:x+pw]=old*(1-w)+candidate*w
            ledger.append({'xy':[x,y],'size':[pw,ph],'source_centre':[sx,sy],'angle':ang,'scale':scale,'flip_x':flip})
            if x+pw==total:break
            x+=pw-overlap
        if y+ph==total:break
        y+=ph-overlap
    out = out[:total,:total]
    # At column zero use source column N, which neighbours N-1 exactly.
    o = total-N
    w = seam_mix(out[:,N:N+o],out[:,:o])
    out[:,:o] = out[:,N:N+o]*(1-w) + out[:,:o]*w
    out=out[:,:N]
    w = seam_mix(out[N:N+o],out[:o],False)
    out[:o] = out[N:N+o]*(1-w)+out[:o]*w
    out=out[:N].copy()
    # Shift the seam away from the origin; do not repeat a small source tile.
    return np.roll(out,(719,367),(0,1)),ledger

def normal_from_height(height, span, height_mm):
    millimetres_per_pixel = span * 1000 / height.shape[0]
    h = height * height_mm
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*millimetres_per_pixel)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*millimetres_per_pixel)
    n=np.stack([-dx,dy,np.ones_like(h)],axis=-1)
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    return n

def periodic_field(rng, shape, sigma):
    a=gaussian_filter(rng.standard_normal(shape).astype(np.float32),sigma,mode='wrap')
    return a / max(float(a.std()),1e-6)

def edge_fibres(base,height,rng):
    """Unequal rounded locks, with fine categorical ends from the aligned pile.

    Dark locks reach 10–30 mm beyond a wandering interface. Sparse pale locks
    enter the dark. Their widths, reaches and spacing vary independently; a
    compact rounded profile avoids both pointed teeth and an equal-hair comb.
    """
    x=np.arange(N,dtype=np.float32)
    coarse=gaussian_filter1d(rng.standard_normal(N).astype(np.float32),100,mode='wrap')
    coarse/=max(float(coarse.std()),1e-6)
    finer=gaussian_filter1d(rng.standard_normal(N).astype(np.float32),24,mode='wrap')
    finer/=max(float(finer.std()),1e-6)
    main=N/2+coarse*30+finer*3
    quiet=20+8*np.sin(2*np.pi*x/N+.7)+finer*2
    y=np.arange(N,dtype=np.float32)[:,None]
    strands=gaussian_filter(base,(2,1.2),mode='wrap')-gaussian_filter(base,(18,5),mode='wrap')
    strands/=max(float(strands.std()),1e-6)
    dark_reach=np.zeros(N,np.float32); pale_reach=np.zeros(N,np.float32); locks=[]
    for polarity,count in [(1,24),(-1,11)]:
        for _ in range(count):
            centre=float(rng.uniform(0,N))
            width=float(rng.uniform(25,55))
            length=float(rng.uniform(41,123) if polarity==1 else rng.uniform(25,82))
            dx=(x-centre+N/2)%N-N/2
            # A compact bell has a rounded end and no pointed apex.
            bump=np.exp(-.5*(dx/width)**2)*length
            if polarity==1:dark_reach=np.maximum(dark_reach,bump)
            else:pale_reach=np.maximum(pale_reach,bump)
            locks.append({'centre_px':centre,'width_sigma_px':width,
                          'reach_mm':polarity*length*500/N})
    reach=dark_reach-pale_reach
    threshold=.85*strands+.40*periodic_field(rng,(N,N),(18,1.2))
    # Reach changes coverage of individual shafts, not the whole contour.
    # Long dark locks thin as they pass over the pale, with pale shafts between;
    # sparse pale locks do the same in reverse. No solid centimetre teeth.
    distance=y-main[None,:]
    core=expit(-distance/4)
    dark_cover=.76*np.clip(1-np.maximum(distance,0)/np.maximum(dark_reach,1)[None,:],0,1)**.65
    pale_cover=.68*np.clip(1-np.maximum(-distance,0)/np.maximum(pale_reach,1)[None,:],0,1)**.65
    coverage=core+(1-core)*dark_cover-core*pale_cover
    order=ndtr(threshold/max(float(threshold.std()),1e-6))
    dark_main=order<coverage
    interleave=48*np.tanh(threshold*.8)
    quiet_edge=quiet[None,:]+interleave*.38
    region=((y>=quiet_edge)&dark_main)|(y>=N+quiet_edge)
    profile={'main_profile_px':main.tolist(),'quiet_profile_px':quiet.tolist(),
             'lock_reach_profile_px':reach.tolist(),'locks':locks,
             'interleave_max_half_band_px':48,'quiet_band_factor':.38,
             'method':'Unequal rounded dark and pale reach fields modulate shaft coverage rather than displacing a solid edge; source-correlated categorical strands taper in density along each lock.'}
    return base,height,region,profile

def export(name,base,height,span,range_mm,region):
    # Per-region exact means in linear light; the masks never alter surface relief.
    for label in [False,True]:
        mask=region==label
        if mask.any(): base[mask]+=.5-float(base[mask].mean())
    base=np.clip(base,.18,.84)
    for label in [False,True]:
        mask=region==label
        if mask.any():base[mask]+=.5-float(base[mask].mean())
    g=srgb(base)
    save8(ROOT/f'{name}_base.png',np.repeat(g[...,None],3,axis=-1))
    # Preserve headroom: encoded 0..1 is a physical range, not min/max stretching.
    h16=np.uint16(np.clip(height,0,1)*65535+.5)
    Image.fromarray(h16).save(ROOT/f'{name}_height.png')
    h=h16.astype(np.float32)/65535
    normal=normal_from_height(h,span,range_mm)
    save8(ROOT/f'{name}_normal.png',normal*.5+.5)
    floor=np.maximum(gaussian_filter(h,5,mode='wrap')-h,0)
    ao=np.clip(1-floor*.18,.98,1)
    rough=np.clip(.86+(gaussian_filter(h,1,mode='wrap')-.5)*.07,.83,.90)
    save8(ROOT/f'{name}_packed.png',np.stack([ao,rough,np.zeros_like(h)],axis=-1))
    regions=np.zeros((N,N,3),np.uint8); regions[...,0]=255; regions[...,1]=np.where(region,0,255)
    Image.fromarray(regions).save(ROOT/f'{name}_regions.png')
    print(f'{name}: mean={float(base.mean()):.6f}; actual relief={(float(h.max()-h.min())*range_mm):.3f} mm',flush=True)

def export_elements():
    """A small aligned patch library for later UV painting, with source boxes."""
    folder=ROOT/'elements'; folder.mkdir(exist_ok=True)
    boxes=[(180,300,436,556),(700,500,956,756),(1220,1150,1476,1406),(1580,430,1836,686)]
    meta={}
    for layer in ['base','height','normal','packed','regions']:
        with Image.open(ROOT/f'fuzz_{layer}.png') as pic:
            for i,box in enumerate(boxes,1):
                pic.crop(box).save(folder/f'pile_patch_{i:02d}_{layer}.png')
    for i,box in enumerate(boxes,1):
        meta[f'pile_patch_{i:02d}']={'source_set':'fuzz','box_px':list(box),'span_m':.0625,'height_mm':.8,'tiles':False,'cutout':False,'regions':[5],'note':'A patch of many fine locks, not an isolated filament or a sheet cutout. All five layers are aligned crops.'}
    edge=json.loads((ROOT/'synthesis.json').read_text())['edge_profile']['main_profile_px']
    for i,cx in enumerate([440,1460],1):
        cy=round(edge[cx]);box=(cx-128,cy-128,cx+128,cy+128)
        name=f'mantle_patch_{i:02d}'
        for layer in ['base','height','normal','packed','regions']:
            with Image.open(ROOT/f'mantle_edge_{layer}.png') as pic:
                pic.crop(box).save(folder/f'{name}_{layer}.png')
        meta[name]={'source_set':'mantle_edge','box_px':list(box),'span_m':.0625,'height_mm':.8,'tiles':False,'cutout':False,'regions':[0,5],'note':'Aligned interlocking mantle/body patch; no dye baked into the base.'}
    (folder/'elements.json').write_text(json.dumps(meta,indent=2)+'\n')

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--scale',type=float,default=1,help='Multiply physical strand size before synthesis.')
    p.add_argument('--direction-deg',type=float,default=0,help='0 is top to bottom; rotate source before synthesis.')
    a=p.parse_args(); start=time.time(); rng=np.random.default_rng(281403)
    im=Image.open(ROOT/'source/fuzz_strands_round4.png').convert('L')
    # The tool returned 1254 square; synthesize native detail without enlargement.
    scaled=round(im.width*.78*a.scale)
    if scaled<480: raise ValueError('Scale too small for quilting patches; use >=0.48')
    im=im.resize((scaled,round(im.height*.78*a.scale)),Image.Resampling.LANCZOS)
    # The new source already lies down the image; expose rotation for UV use.
    correction=a.direction_deg
    if correction:
        padded=Image.fromarray(np.pad(np.asarray(im),scaled,mode='reflect'))
        padded=padded.rotate(correction,resample=Image.Resampling.BICUBIC)
        im=padded.crop((scaled,scaled,scaled*2,scaled*2))
    src=linear(np.asarray(im,dtype=np.float32)/255)
    # Remove broad source illumination before synthesis.
    src=src-gaussian_filter(src,110,mode='reflect')+.5
    tile,placements=quilt(src,rng)
    tile-=gaussian_filter(tile,150,mode='wrap')-.5
    # Preserve readable fine strands, with only a weak rounded lock envelope.
    # The old 1.3x whole-field gain made lock-sized bright/dark fleece blotches.
    envelope=gaussian_filter(tile,6,mode='wrap')
    base=.5+(tile-envelope)*2.30+(envelope-.5)*.30
    # Very shallow relief. Most apparent strand definition lives in albedo.
    fine=gaussian_filter(tile,.75,mode='wrap')-gaussian_filter(tile,3,mode='wrap')
    bed=gaussian_filter(tile,3,mode='wrap')-gaussian_filter(tile,36,mode='wrap')
    height=.5+fine*.70+bed*.18
    export('fuzz',base.copy(),height.copy(),.5,.80,np.zeros((N,N),bool))
    # Identical pixel morphology with half the physical span: exactly half length.
    export('fuzz_face',base.copy(),height.copy(),.25,.40,np.zeros((N,N),bool))
    eb,eh,regions,lines=edge_fibres(base.copy(),height.copy(),rng)
    export('mantle_edge',eb,eh,.5,.80,regions)
    form={'form':'ball','radii':[.2,.19,.3]}
    sets={}
    for name,span,mm,reg,f in [('fuzz',.5,.8,[5],form),('fuzz_face',.25,.4,[5],{'form':'ball','radii':[.06,.07,.1]}),('mantle_edge',.5,.8,[0,5],form)]:
        # Flat form properties are required by the actual look.ts contract.
        sets[name]={'span_m':span,'tiles':True,'tile_axes':['x','y'],'cutout':False,'height_mm':mm,'regions':reg,**f,'fibre_length_mm':[6*a.scale,12*a.scale] if span==.5 else [3*a.scale,6*a.scale],'lock_length_mm':[12*a.scale,30*a.scale] if span==.5 else [6*a.scale,15*a.scale],'lie_degrees_from_down':a.direction_deg,'roughness_mean':.86}
    study={'sets':sets,'round':4,'source':'source/fuzz_strands_round4.png','source_native_px':[1254,1254],'elements_manifest':'elements/elements.json','source_scale_before_quilting':.78*a.scale,'build_seed':281403,'method':'Generated straight/gently curved pale tips over darker roots; irregular affine synthesis; strong fine strand value and subdued lock value/relief; unequal rounded mantle locks.','normal_convention':'OpenGL +Y up; central wrapped derivatives of delivered 16-bit height.','height_note':'height_mm is the unchanged physical distance from encoded black to white, not exposed fibre length. Relief remains shallow.','edge_note':'Gently wandering main band near row 1024; dark locks reach 10–30 mm, fewer pale locks overlap them; a quieter second band closes the wrap.','build_seconds':round(time.time()-start,2)}
    study['source_lie_correction_deg']=correction
    study['value_bands']={'strand_gain':2.3,'lock_envelope_gain':.3,'split_sigma_px':6}
    study['relief_bands']={'fine_gain':.70,'bed_gain':.18}
    study['patch_mirroring']=False
    (ROOT/'study.json').write_text(json.dumps(study,indent=2)+'\n')
    (ROOT/'synthesis.json').write_text(json.dumps({'overlap_px':100,'placements':placements,'edge_profile':lines},indent=2)+'\n')
    export_elements()
    print(f'Done in {time.time()-start:.1f}s',flush=True)

if __name__=='__main__': main()
