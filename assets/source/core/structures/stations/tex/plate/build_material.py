#!/usr/bin/env python3
"""Deterministic native-resolution painted-steel trim. Writes beside this file only.

No photographs or synthesized lighting enter the base. All maps share physical
surface fields. NumPy FFT filters and local stamps use periodic boundaries.
"""
from pathlib import Path
import hashlib
import json
import time
import numpy as np
from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parent
N = 2048
TILE_MM = 1500.0
HEIGHT_RANGE_MM = 8.0
SEED = 2711049
PITCH = TILE_MM / N


def smooth(a, b, v):
    t = np.clip((v-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def blur(a, sy, sx=None):
    if sx is None:
        sx = sy
    fy = np.fft.fftfreq(a.shape[0])[:, None]
    fx = np.fft.rfftfreq(a.shape[1])[None, :]
    kernel = np.exp(-2*np.pi**2*((fy*sy)**2+(fx*sx)**2))
    return np.fft.irfft2(np.fft.rfft2(a)*kernel, s=a.shape).astype(np.float32)


def noise(rng, sy, sx=None):
    a = blur(rng.normal(size=(N,N)).astype(np.float32), sy, sx)
    a -= a.mean()
    return a / max(float(a.std()), 1e-8)


def normal_from_height(height, tile_mm=TILE_MM):
    h = height.astype(np.float64) * (HEIGHT_RANGE_MM/65535)
    step = tile_mm/h.shape[0]
    dx = (np.roll(h,-1,1)-np.roll(h,1,1))/(2*step)
    dy = (np.roll(h,-1,0)-np.roll(h,1,0))/(2*step)
    n = np.stack((-dx,dy,np.ones_like(h)), -1)
    n /= np.linalg.norm(n,axis=-1,keepdims=True)
    return np.clip(np.rint((n+1)*127.5),0,255).astype(np.uint8)


def area_reduce(a):
    h,w = a.shape[:2]
    return np.rint(a.astype(np.float64).reshape(h//2,2,w//2,2,*a.shape[2:]).mean((1,3))).astype(a.dtype)


def save_png(path, a, srgb=False):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
    Image.fromarray(a).save(path,pnginfo=info,compress_level=6)


def main():
    started = time.time()
    (ROOT/'source').mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    shape = (N,N)
    yy = (np.arange(N,dtype=np.float32)+.5)[:,None]*PITCH
    xx = (np.arange(N,dtype=np.float32)+.5)[None,:]*PITCH
    micro = noise(rng,.55)
    fine = noise(rng,1.8)
    meso = noise(rng,7)
    clouds = .72*noise(rng,65)+.28*noise(rng,165)
    hue = noise(rng,110)
    brush = .7*noise(rng,.65,24)+.3*noise(rng,2.0,65)
    filegrain = .7*noise(rng,.5,13)+.3*noise(rng,1.4,35)
    # Bare trim is exactly between 1/12 and 1/6; antialias transitions
    # span 6 mm. The outer wrap joins the same paint, without a colour step.
    bare_band = np.broadcast_to(smooth(122,128,yy)*(1-smooth(247,253,yy)),shape).copy()
    seam_band = np.broadcast_to((yy < 125).astype(np.float32),shape)
    face_band = np.broadcast_to((yy >= 250).astype(np.float32),shape)
    edge_dist = np.minimum(abs(yy-250), np.minimum(yy,1500-yy))
    edge_weight = np.exp(-(edge_dist/65)**2)
    # Soil is physical pigment. It is not AO, shading, or a directional ramp.
    soil = np.clip((noise(rng,29)+.5*noise(rng,70)-.5)*.18,0,.65)
    grime = soil*(.32+.68*edge_weight)
    scratches = np.zeros(shape,np.float32)
    scratch_bare = np.zeros(shape,np.float32)
    chips = np.zeros(shape,np.float32)
    rust = np.zeros(shape,np.float32)
    pits = np.zeros(shape,np.float32)
    records = {'chips':[], 'scratches':[], 'pits':[], 'rivets':[], 'rust_runs':[]}

    def patch(cx,cy,rx,ry,pad=3):
        # mm coordinates; local arrays wrap into the master at both axes.
        ix = np.arange(int(np.floor((cx-rx)/PITCH))-pad,int(np.ceil((cx+rx)/PITCH))+pad+1)
        iy = np.arange(int(np.floor((cy-ry)/PITCH))-pad,int(np.ceil((cy+ry)/PITCH))+pad+1)
        dx = (ix[None,:]+.5)*PITCH-cx
        dy = (iy[:,None]+.5)*PITCH-cy
        return np.ix_(iy%N,ix%N), dx,dy

    def chip(cx,cy,diam,aspect,angle,group):
        radius=diam/2
        ind,dx,dy = patch(cx,cy,radius*1.35,radius*1.35,3)
        u=(dx*np.cos(angle)+dy*np.sin(angle))/radius
        v=(-dx*np.sin(angle)+dy*np.cos(angle))/(radius*aspect)
        theta = np.arctan2(v,u)
        phase = rng.uniform(0,2*np.pi,3)
        contour = 1+.15*np.sin(3*theta+phase[0])+.10*np.sin(7*theta+phase[1])+.07*np.sin(11*theta+phase[2])
        # Multi-scale jaggedness makes chipped flake shapes, not perfect spots.
        dist = (np.sqrt(u*u+v*v)-contour)*radius + .38*fine[ind]+.17*micro[ind]
        a=1-smooth(-.35,.5,dist)
        chips[ind]=np.maximum(chips[ind],a)
        records['chips'].append(dict(x_mm=float(cx%1500), y_mm=float(cy%1500), diameter_mm=float(diam), aspect=float(aspect), angle=float(angle),group=group))
        return ind,a

    # Concentrate wear close to panel ends; keep central paint largely intact.
    chip_seeds=[]
    for i in range(270):
        cx=rng.uniform(0,1500)
        if i < 165:
            cy=(250+rng.exponential(32)) if i%2 else (1500-rng.exponential(32))
            group='face_edge'
        else:
            cy=rng.uniform(295,1455); group='face_middle'
        diam=float(np.clip(rng.lognormal(np.log(6.8),.59),3,29))
        if i in (6,23,104,181): diam=rng.uniform(22,30)
        asp=rng.uniform(.35,.9)
        ind,a=chip(cx,cy,diam,asp,rng.uniform(-.4,.4),group)
        chip_seeds.append((cx,cy,diam,asp))
        # Small adjacent flakes accompany the larger failures of paint.
        for j in range(int(rng.integers(0,4))):
            chip(cx+rng.uniform(-1,1)*diam*.75,cy+rng.uniform(-1,1)*diam*.45,
                 rng.uniform(.8,2.5),rng.uniform(.4,1),rng.uniform(-1,1),'satellite')
        if i in (7,21,39,58,76,112,160,178,209,237):
            oxide = np.clip(.5+.24*meso[ind]+.14*fine[ind],0,.85)*a
            rust[ind]=np.maximum(rust[ind],oxide)
            length=rng.uniform(9,43)
            width=rng.uniform(.65,1.7)
            ry0=cy+diam*asp*.23
            ri,rdx,rdy=patch(cx,ry0+length/2,width*4,length/2+2)
            t=(rdy+length/2)/length
            wander = .4*np.sin(t*7+rng.uniform(0,6))
            width_t=width*(.8-.55*np.clip(t,0,1))
            a_run=np.exp(-.5*((rdx-wander)/width_t)**2)*smooth(-.04,.08,t)*(1-smooth(.6,1,t))
            a_run*=np.clip(.43+.13*fine[ri],.08,.7)
            rust[ri]=np.maximum(rust[ri],a_run)
            records['rust_runs'].append(dict(x_mm=float(cx),start_y_mm=float(ry0),length_mm=float(length),width_mm=float(width)))

    # Partially interrupted chipped lap arris, on the raised side of its edge.
    for i in range(88):
        cx=rng.uniform(0,1500)
        cy=64+rng.normal(0,1.15)
        chip(cx,cy,rng.uniform(2.2,10),rng.uniform(.18,.45),rng.normal(0,.10),'lap')

    for i in range(410):
        cx=rng.uniform(0,1500)
        cy=rng.uniform(133,242) if i<170 else rng.uniform(0,1500)
        length=rng.uniform(6,70)
        width=rng.uniform(.20,.48)
        ind,dx,dy=patch(cx,cy,length/2+1,2.5)
        wav=.14*np.sin(dx/(length*.15)+rng.uniform(0,6))
        a=np.exp(-.5*((dy-wav)/width)**2)*(1-smooth(.32,.5,abs(dx)/length))
        a*=np.clip(.8+.19*meso[ind]+.08*fine[ind],0,1)
        scratches[ind]=np.maximum(scratches[ind],a)
        exposed=i%9==0 and cy>250
        if exposed: scratch_bare[ind]=np.maximum(scratch_bare[ind],a*.78)
        records['scratches'].append(dict(x_mm=float(cx),y_mm=float(cy),length_mm=float(length),width_mm=float(width),exposed=bool(exposed)))
    for i in range(170):
        cx=rng.uniform(0,1500)
        cy=rng.uniform(132,244) if i<115 else rng.uniform(0,1500)
        r=rng.uniform(.35,1.25)
        ind,dx,dy=patch(cx,cy,r*2,r*2)
        a=np.exp(-2*(dx*dx+dy*dy)/(r*r))
        pits[ind]=np.maximum(pits[ind],a*rng.uniform(.035,.10))
        records['pits'].append(dict(x_mm=float(cx),y_mm=float(cy),radius_mm=float(r)))

    # Hand-cut overlap: 0.65 mm plate, a 1.4 mm wide irregular cut shoulder.
    lap_wander=(.45*np.sin(xx/1500*2*np.pi*7)+.23*np.sin(xx/1500*2*np.pi*19))
    lap_signed=yy-(65+lap_wander)
    lap=.65*smooth(4,29,yy)*(1-smooth(-.7,.7,lap_signed))
    lap_ao=.095*np.exp(-((lap_signed-1.0)/1.45)**2)
    lap_soil=np.exp(-((lap_signed-.8)/4.7)**2)*np.clip(.26+.10*meso,0,.5)
    grime=np.maximum(grime,lap_soil)
    dome=np.zeros(shape,np.float32)
    rivet_coverage=np.zeros(shape,np.float32)
    rivet_wear=np.zeros(shape,np.float32)
    rivet_ao=np.zeros(shape,np.float32)
    for i in range(25):
        cx=(i+.5)*60
        cy=48.5+rng.uniform(-1.1,1.1)
        radius=rng.uniform(6.8,7.2)
        proud=rng.uniform(3.90,4.10)
        sphere=(radius*radius+proud*proud)/(2*proud)
        ind,dx,dy=patch(cx,cy,11,11)
        radial=np.sqrt(dx*dx+dy*dy)
        # True spherical cap with a sub-texel blended shoulder.
        cap=np.maximum(np.sqrt(np.maximum(sphere*sphere-radial*radial,0))-(sphere-proud),0)
        cover=1-smooth(radius-.38,radius+.38,radial)
        cap*=cover
        dome[ind]=np.maximum(dome[ind],cap)
        rivet_coverage[ind]=np.maximum(rivet_coverage[ind],cover)
        wear=1-smooth(.46,.75,radial/radius+.055*fine[ind]+.045*meso[ind])
        wear*=cover
        rivet_wear[ind]=np.maximum(rivet_wear[ind],wear)
        ring=np.exp(-((radial-radius-.45)/.85)**2)*.14
        rivet_ao[ind]=np.maximum(rivet_ao[ind],ring)
        dirt=np.exp(-((radial-radius-.8)/1.6)**2)*np.clip(.3+.08*fine[ind],0,.5)
        grime[ind]=np.maximum(grime[ind],dirt)
        records['rivets'].append(dict(x_mm=float(cx),y_mm=float(cy),diameter_mm=float(radius*2),proud_mm=float(proud)))

    # Shared material coverages drive every channel, including metalness.
    chips=np.maximum(chips,scratch_bare)*(1-bare_band)
    bare=np.maximum(bare_band,chips)
    bare=np.maximum(bare,rivet_wear)
    rust*=1-bare_band
    grime=np.clip(grime*(1-rivet_wear*.85)*(1-bare_band*.75),0,.8)
    paint=1-bare
    paint_rgb=np.array([98,110,100],np.float32)[None,None,:]+(
        (clouds*3.0+meso*.75+brush*.7+micro*.28)[...,None])
    paint_rgb+=hue[...,None]*np.array([.2,.65,-.15],np.float32)
    steel_rgb=np.array([150,150,148],np.float32)[None,None,:]+(
        (clouds*1.5+filegrain*1.6+fine*.45+micro*.4-scratches*2.2)[...,None])
    steel_rgb+=rivet_wear[...,None]*np.array([5,5,5],np.float32)
    pit_pigment=np.clip(pits/.09,0,1)*bare
    steel_rgb-=pit_pigment[...,None]*29
    # Deposited umber rust is subdued; only ten short runs on the face.
    rust_rgb=np.array([102,65,39],np.float32)+fine[...,None]*np.array([3,2,1],np.float32)
    def compose(paint_rgb):
        c=paint_rgb*paint[...,None]+steel_rgb*bare[...,None]
        c=c*(1-rust[...,None])+rust_rgb*rust[...,None]
        return c*(1-grime[...,None]*.24)
    base=compose(paint_rgb)
    interior=np.broadcast_to((yy>258)&(yy<1492),shape)
    # Calibrate the complete face, including its actual chips and dirt.
    shift=(np.array([98,110,100])-base[interior].mean(0,dtype=np.float64))/paint[interior].mean(dtype=np.float64)
    paint_rgb+=shift
    base=compose(paint_rgb)

    # 1.5 mm reference steel plane, +0.2 mm paint; rivets 4 mm proud.
    height=1.5+lap+dome+.2*paint
    height+=(.006*meso+.006*fine+.003*micro)*(1-rivet_coverage*.7)
    height+=paint*(.012*brush+.0035*micro)+bare*(.003*filegrain)
    height-=scratches*(.025*paint+.013*bare)
    height-=pits*(.3+.7*bare)
    height+=rust*.035
    rough_paint=np.clip(.672+.017*clouds+.009*brush+.006*fine,.60,.75)
    rough_steel=np.clip(.522+.018*filegrain+.013*clouds-.022*scratches,.45,.60)
    roughness=rough_paint*paint+rough_steel*bare
    roughness=roughness*(1-rivet_wear)+np.clip(.468+.008*fine,.45,.60)*rivet_wear
    roughness=roughness*(1-rust)+.85*rust
    roughness=roughness*(1-grime)+.8*grime
    metalness=(89/255)*bare+(26/255)*rivet_wear
    metalness*=1-.95*rust
    ao=1-np.maximum(lap_ao,rivet_ao)-np.clip(pits,0,.1)*.55
    ao=np.clip(ao,.8,1)
    base8=np.clip(np.rint(base),0,255).astype(np.uint8)
    h16=np.clip(np.rint(height.astype(np.float64)/HEIGHT_RANGE_MM*65535),0,65535).astype(np.uint16)
    orm8=np.clip(np.rint(np.stack((ao,roughness,metalness),-1)*255),0,255).astype(np.uint8)
    for name,a in [('base',base8),('height',h16),('orm',orm8)]:
        save_png(ROOT/f'plate_{name}.png',a,name=='base')
        save_png(ROOT/f'plate_{name}_1024.png',area_reduce(a),name=='base')
    for suffix in ('','_1024'):
        saved=np.asarray(Image.open(ROOT/f'plate_height{suffix}.png'))
        save_png(ROOT/f'plate_normal{suffix}.png',normal_from_height(saved))
    # Full-size authoring fields are retained losslessly for inspection.
    np.savez_compressed(ROOT/'source/construction_fields.npz',
        height_mm=height.astype(np.float32),bare_band=bare_band,
        face_band=face_band,seam_band=seam_band,paint=paint,bare=bare,
        chips=chips,rust=rust,grime=grime,brush=brush,filegrain=filegrain,
        clouds=clouds,scratches=scratches,pits=pits,lap=lap,dome=dome,
        rivet_wear=rivet_wear,rivet_coverage=rivet_coverage,
        roughness=roughness,metalness=metalness,ao=ao,
        base_unquantized=base.astype(np.float32))
    for name,field in [('chips',chips),('rust',rust),('grime',grime),('rivet_wear',rivet_wear)]:
        save_png(ROOT/f'source/{name}.png',np.rint(np.clip(field,0,1)*65535).astype(np.uint16))
    save_png(ROOT/'source/band_masks.png',np.rint(np.stack((seam_band,bare_band,face_band),-1)*255).astype(np.uint8))
    params=dict(seed=SEED,size=N,tile_mm=TILE_MM,height_range_mm=HEIGHT_RANGE_MM,
        height_reference_steel_mm=1.5,paint_thickness_mm=.2,lap_thickness_mm=.65,
        band_boundaries_mm=[0,125,250,1500],transition_width_mm=6,
        paint_palette_correction=shift.tolist(),sources='All fields authored procedurally at 2048; no external images.',features=records)
    (ROOT/'source/construction.json').write_text(json.dumps(params,indent=2)+'\n')
    manifest=dict(seed=SEED,build_seconds=round(time.time()-started,3),tile_metres=1.5,height_range_mm=HEIGHT_RANGE_MM,
        files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('plate_*.png'))})
    (ROOT/'build_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(build_seconds=manifest['build_seconds'],height_extrema_mm=[float(height.min()),float(height.max())],face_mean=base8[interior].mean(0).tolist(),features={k:len(v) for k,v in records.items()}),indent=2))


if __name__=='__main__':
    main()
