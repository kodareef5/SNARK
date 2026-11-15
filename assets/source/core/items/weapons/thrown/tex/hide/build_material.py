#!/usr/bin/env python3
"""Deterministic native-resolution leather. All lengths internally are millimetres.

No image inputs, network access, or third-party pixels. Run from any directory;
all writes are confined to the directory containing this script.
"""
from pathlib import Path
import hashlib
import json
import time
import numpy as np
from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parent
N = 2048
TILE_MM = 200.0
HEIGHT_MM = 1.0
SEED = 161115
PITCH = TILE_MM / N


def blur(a, sigma):
    """Periodic Gaussian; FFT avoids requiring scipy."""
    fy = np.fft.fftfreq(a.shape[0])[:, None]
    fx = np.fft.rfftfreq(a.shape[1])[None, :]
    kernel = np.exp(-2 * np.pi**2 * sigma**2 * (fx*fx + fy*fy))
    return np.fft.irfft2(np.fft.rfft2(a) * kernel, s=a.shape).astype(np.float32)


def noise(rng, sigma, remove_broad=None):
    a = blur(rng.standard_normal((N, N), dtype=np.float32), sigma)
    if remove_broad:
        a -= blur(a, remove_broad)
    return (a / a.std()).astype(np.float32)


def sample(a, x, y):
    h, w = a.shape[:2]
    xi, yi = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32)
    tx, ty = x-xi, y-yi
    if a.ndim == 3:
        tx, ty = tx[..., None], ty[..., None]
    return (a[yi % h, xi % w]*(1-tx)*(1-ty)
            + a[yi % h, (xi+1) % w]*tx*(1-ty)
            + a[(yi+1) % h, xi % w]*(1-tx)*ty
            + a[(yi+1) % h, (xi+1) % w]*tx*ty)


def cells(rng, x, y, count=186):
    """Warped periodic jittered cells; continuous edge distance and cell pigment."""
    u, v = x*count/N, y*count/N
    ix, iy = np.floor(u).astype(np.int32), np.floor(v).astype(np.int32)
    dx, dy = rng.uniform(.06, .94, (2, count, count)).astype(np.float32)
    pigments = rng.normal(0, 1, (count, count)).astype(np.float32)
    first = np.full((N, N), 1e6, np.float32)
    second = first.copy()
    pigment = np.zeros_like(first)
    for j in range(-2, 3):
        for i in range(-2, 3):
            cx, cy = (ix+i) % count, (iy+j) % count
            d = (u-(ix+i+dx[cy,cx]))**2 + (v-(iy+j+dy[cy,cx]))**2
            win = d < first
            second = np.minimum(second, np.where(win, first, d))
            first = np.minimum(first, d)
            pigment = np.where(win, pigments[cy,cx], pigment)
    edge = (np.sqrt(second)-np.sqrt(first)) * (N/count) * .5
    return edge.astype(np.float32), blur(pigment, .8)


def stroke(fields, record):
    """Analytic tapered curved mark rasterized at native pitch, across any border."""
    x, y = record['center_px']
    length = record['length_mm']/PITCH
    width = record['width_mm']/PITCH
    ang, bend, phase = record['angle_rad'], record['bend_px'], record['phase']
    radius = int(np.ceil(length*.57 + abs(bend) + 5*width + 5))
    xs = np.arange(int(x)-radius, int(x)+radius+1)
    ys = np.arange(int(y)-radius, int(y)+radius+1)
    xx, yy = np.meshgrid(xs-x, ys-y)
    u = xx*np.cos(ang)+yy*np.sin(ang)
    v = -xx*np.sin(ang)+yy*np.cos(ang)
    t = u/(length*.5)
    taper = np.maximum(0, 1-t*t)**1.3
    curve = bend*(np.sin(t*2.1+phase)-np.sin(phase))
    curve += .35*np.sin(t*9+phase*2)
    dist = v-curve
    w = width*(.78+.2*np.sin(t*4+phase))*(.25+.75*np.sqrt(taper))
    core = np.exp(-.5*(dist/np.maximum(w,.2))**2)*taper
    shoulder = np.exp(-.5*(dist/(w*2.7+.5))**2)*taper
    yy, xx = np.ix_(ys % N, xs % N)
    depth = record['depth_mm']
    kind = record['kind']
    if kind == 'crease':
        fields['creases_mm'][yy,xx] += depth*(-core+.16*shoulder)
        fields['crease_mask'][yy,xx] = np.maximum(fields['crease_mask'][yy,xx],core)
    elif kind == 'scratch':
        fields['scars_mm'][yy,xx] += depth*(-.55*core+.28*shoulder)
        fields['scar_pigment'][yy,xx] += .65*core
        fields['scar_mask'][yy,xx] = np.maximum(fields['scar_mask'][yy,xx],core)
    else:
        fields['scars_mm'][yy,xx] += depth*(.62*core-.20*shoulder)
        fields['scar_pigment'][yy,xx] += .9*core-.2*shoulder
        fields['scar_mask'][yy,xx] = np.maximum(fields['scar_mask'][yy,xx],shoulder)


def area2(a):
    h,w = a.shape[:2]
    return a.astype(np.float64).reshape(h//2,2,w//2,2,*a.shape[2:]).mean(axis=(1,3))


def normal_from_height(h):
    z = h.astype(np.float64)*HEIGHT_MM/65535
    pitch = TILE_MM/h.shape[0]
    # Image y increases downward. World tangent +Y is up the image.
    nx = -(np.roll(z,-1,1)-np.roll(z,1,1))/(2*pitch)
    ny = +(np.roll(z,-1,0)-np.roll(z,1,0))/(2*pitch)
    a = np.stack((nx,ny,np.ones_like(z)),axis=-1)
    a /= np.linalg.norm(a,axis=-1,keepdims=True)
    return np.rint((a*.5+.5)*255).clip(0,255).astype(np.uint8)


def save_rgb(path, a, srgb=False):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB',b'\x00')
        info.add(b'gAMA',(45455).to_bytes(4,'big'))
    Image.fromarray(a.astype(np.uint8)).save(path,pnginfo=info,compress_level=9)


def main():
    start = time.perf_counter()
    source = ROOT/'source'
    source.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    yy,xx = np.mgrid[:N,:N].astype(np.float32)
    print('Building periodic skin grain at 2048...',flush=True)
    middle = noise(rng,19,85)
    smoke = noise(rng,49,95)*.75 + noise(rng,13,65)*.25
    fine = noise(rng,.65)
    grain_noise = noise(rng,2.2)
    wax = np.clip(.40+.20*noise(rng,35,90)+.07*middle,0,1)
    wx = 6*noise(rng,20,70)+2*noise(rng,5)
    wy = 6*noise(rng,20,70)+2*noise(rng,5)
    edge, cell_pigment = cells(rng,xx+wx,yy+wy)
    grain_grooves = np.exp(-.5*(edge/(.68+.18*np.tanh(middle)))**2)
    grain_mm = (.040*(1-grain_grooves)+.005*grain_noise)*(1-.35*wax)
    grain_mm += .0045*fine
    # Small, rounded collagen undulations, with no broad billows.
    grain_mm += .011*noise(rng,6,22)+.015*noise(rng,16,55)
    fields = dict(grain_mm=grain_mm.astype(np.float32),
                  grain_grooves=grain_grooves, smoke=smoke, burnish=wax,
                  cell_pigment=cell_pigment, micro_pigment=fine)
    for key in ['creases_mm','crease_mask','scars_mm','scar_mask','scar_pigment','pores_mm','pore_mask']:
        fields[key] = np.zeros((N,N),np.float32)
    records=[]
    # Evenly distributed families, with independently rotated faint sibling folds.
    for gy in range(14):
        for gx in range(14):
            center = np.array([(gx+rng.uniform(.1,.9))*N/14,(gy+rng.uniform(.1,.9))*N/14])
            ang = rng.uniform(0,2*np.pi)
            length = rng.uniform(5,21)
            for sibling in range(int(rng.choice([1,1,1,2,2,3]))):
                delta = (sibling-.7)*rng.uniform(7,18)
                pos = center+delta*np.array([-np.sin(ang),np.cos(ang)])
                rec = dict(kind='crease',center_px=pos.tolist(),length_mm=length*rng.uniform(.65,1.1),
                           width_mm=rng.uniform(.23,.50),angle_rad=ang+rng.uniform(-.27,.27),
                           bend_px=rng.uniform(-12,12),phase=rng.uniform(0,6.28),depth_mm=rng.uniform(.035,.105))
                records.append(rec); stroke(fields,rec)
    for i in range(550):
        rec = dict(kind='crease',center_px=rng.uniform(0,N,2).tolist(),length_mm=rng.uniform(1.5,7.5),
                   width_mm=rng.uniform(.10,.20),angle_rad=rng.uniform(0,2*np.pi),
                   bend_px=rng.uniform(-2.5,2.5),phase=rng.uniform(0,6.28),depth_mm=rng.uniform(.014,.047))
        records.append(rec); stroke(fields,rec)
    for i in range(11):
        # Healed hairline scrapes, gently pale, with shallow closed relief.
        rec = dict(kind='scratch',center_px=rng.uniform(0,N,2).tolist(),length_mm=rng.uniform(3,11),
                   width_mm=rng.uniform(.09,.18),angle_rad=rng.uniform(0,2*np.pi),
                   bend_px=rng.uniform(-5,5),phase=rng.uniform(0,6.28),depth_mm=rng.uniform(.018,.04))
        records.append(rec); stroke(fields,rec)
    for center,ang,length in [([630,781],.8,10.8),([1745,1490],2.7,7.5)]:
        rec=dict(kind='scar',center_px=center,length_mm=length,width_mm=.28,angle_rad=ang,
                 bend_px=3.2,phase=1.2,depth_mm=.065)
        records.append(rec); stroke(fields,rec)
    print('Adding follicle pores and matching material response...',flush=True)
    # Submillimetre elliptical pores, rasterized analytically (not blurred dots).
    # Hair follicles vary in size and occur singly and in small irregular groups.
    pore_count=38000
    pcenters=rng.uniform(0,N,(pore_count,2))
    radii=rng.uniform(.48,1.05,pore_count)
    aspect=rng.uniform(1,1.7,pore_count)
    angles=rng.uniform(0,2*np.pi,pore_count)
    depths=rng.uniform(.018,.047,pore_count)
    for k in range(pore_count):
        x,y=pcenters[k]
        xs=np.arange(int(x)-5,int(x)+7)
        ys=np.arange(int(y)-5,int(y)+7)
        dx,dy=np.meshgrid(xs-x,ys-y)
        u=dx*np.cos(angles[k])+dy*np.sin(angles[k])
        v=-dx*np.sin(angles[k])+dy*np.cos(angles[k])
        g=np.exp(-.5*((u/(radii[k]*aspect[k]))**2+(v/radii[k])**2))
        ix=np.ix_(ys%N,xs%N)
        fields['pores_mm'][ix] -= (depths[k]*g).astype(np.float32)
        fields['pore_mask'][ix] = np.maximum(fields['pore_mask'][ix],g)
    # Hand rubbing compresses the grain and closes some shallow pores.
    fields['pores_mm'] *= 1-.26*wax
    fields['creases_mm'] *= 1-.15*wax
    h_mm=.50+fields['grain_mm']+fields['creases_mm']+fields['pores_mm']+fields['scars_mm']
    assert h_mm.min()>0 and h_mm.max()<HEIGHT_MM
    h16=np.rint(h_mm/HEIGHT_MM*65535).astype(np.uint16)
    # Pigment is authored independently of illumination, height slopes and AO.
    # Fine cell-to-cell tanning differences, sparse follicles, smoke and oil stain.
    tonal=2.4*smoke+1.9*cell_pigment+1.15*grain_noise+1.55*fine
    tonal-=1.5*fields['pore_mask']+1.0*wax
    tonal+=3.0*fields['scar_pigment']
    # Eliminate very long pigment wavelengths while retaining local smoke changes.
    tonal-=blur(tonal,82)
    base=np.stack([122+tonal*1.02+.65*smoke,
                   86+tonal*.87-.15*smoke,
                   56+tonal*.68-.30*smoke],axis=-1)
    base += np.array([122,86,56])-base.mean(axis=(0,1),dtype=np.float64)
    base=np.rint(base).clip(0,255).astype(np.uint8)
    # Shallow, geometry-derived cavity response, only on pores/creases/grain furrows.
    saved=h16.astype(np.float32)/65535*HEIGHT_MM
    horizon=np.zeros_like(saved)
    for dy,dx in [(0,1),(1,1),(1,0),(1,-1),(0,-1),(-1,-1),(-1,0),(-1,1)]:
        maximum=np.zeros_like(saved)
        for dist in [1,2,4,8,16]:
            slope=np.maximum(0,(np.roll(saved,(dy*dist,dx*dist),(0,1))-saved)/(dist*PITCH*np.hypot(dx,dy)))
            maximum=np.maximum(maximum,slope)
        horizon+=maximum**2/(1+maximum**2)/8
    cavity=np.maximum(fields['pore_mask'],fields['crease_mask'])
    cavity=np.maximum(cavity,grain_grooves*.65)
    ao=1-np.minimum(.16,horizon*.85)*cavity
    rough=np.clip(.703-.145*wax+.012*middle+.015*grain_grooves+.017*fields['pore_mask']
                  +.015*fields['crease_mask']-.025*fields['scar_mask'],.55,.75)
    orm=np.rint(np.stack([ao,rough,np.zeros_like(ao)],-1)*255).astype(np.uint8)
    fields['cavity_support']=cavity
    fields['roughness']=rough
    print('Saving masters, reductions and construction sources...',flush=True)
    for size in [2048,1024]:
        suffix='' if size==2048 else '_1024'
        b=base if size==N else np.rint(area2(base)).astype(np.uint8)
        h=h16 if size==N else np.rint(area2(h16)).astype(np.uint16)
        o=orm if size==N else np.rint(area2(orm)).astype(np.uint8)
        save_rgb(ROOT/f'hide_base{suffix}.png',b,True)
        Image.fromarray(h).save(ROOT/f'hide_height{suffix}.png',compress_level=9)
        # The quantized saved height, not its higher precision source, is authoritative.
        h=np.array(Image.open(ROOT/f'hide_height{suffix}.png'))
        save_rgb(ROOT/f'hide_normal{suffix}.png',normal_from_height(h))
        save_rgb(ROOT/f'hide_orm{suffix}.png',o)
    np.savez_compressed(source/'construction_fields.npz',**fields)
    np.savez_compressed(source/'follicles.npz',centers_px=pcenters,radii_px=radii,aspect=aspect,angles_rad=angles,depths_mm=depths)
    for name,field,lo,hi in [('grain_relief',fields['grain_mm'],-.10,.15),
                              ('crease_relief',fields['creases_mm'],-.30,.03),
                              ('pores',fields['pore_mask'],0,1),('burnish',wax,0,1),
                              ('smoke',smoke,-4,4),('scar_mask',fields['scar_mask'],0,1)]:
        image=np.rint(np.clip((field-lo)/(hi-lo),0,1)*65535).astype(np.uint16)
        Image.fromarray(image).save(source/f'{name}.png',compress_level=9)
    manifest=dict(seed=SEED,size=N,tile_metres=.20,height_encoding_mm=[0,HEIGHT_MM],
                  height_baseline_mm=.50,pore_count=pore_count,cell_count_per_axis=186,
                  construction='Native periodic scalar surface; no external image sources',
                  marks=records,source_diagnostic_ranges={'grain_relief':[-.10,.15],
                  'crease_relief':[-.30,.03],'pores':[0,1],'burnish':[0,1],'smoke':[-4,4],'scar_mask':[0,1]})
    (source/'construction.json').write_text(json.dumps(manifest,indent=2)+'\n')
    paths=sorted(ROOT.glob('hide_*.png'))
    hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    (source/'delivery_sha256.json').write_text(json.dumps(hashes,indent=2)+'\n')
    stats=dict(build_seconds=time.perf_counter()-start,mean_srgb=base.mean(axis=(0,1)).tolist(),
               occupied_height_mm=[float(h_mm.min()),float(h_mm.max())],mark_count=len(records),
               roughness_percentiles=np.percentile(orm[...,1]/255,[0,1,50,99,100]).tolist(),
               ao_percentiles=np.percentile(orm[...,0]/255,[0,1,50,99,100]).tolist())
    (source/'build_stats.json').write_text(json.dumps(stats,indent=2)+'\n')
    print(json.dumps(stats,indent=2),flush=True)


if __name__=='__main__':
    main()
