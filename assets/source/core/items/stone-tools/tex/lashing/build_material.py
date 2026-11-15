#!/usr/bin/env python3
"""Native, periodic, two-ply plant cord. Run in this folder; no external inputs."""
from pathlib import Path
import json
import time
import hashlib
import numpy as np
from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parent
N = 2048
TURNS = 56
TILE_MM = 200.0
HEIGHT_MM = 4.0
SEED = 561115
TAU = 2 * np.pi


def gaussian_filter(a, sigma, mode='wrap'):
    """Periodic Gaussian in Fourier space; NumPy/Pillow are sufficient to rebuild."""
    fy = np.fft.fftfreq(a.shape[0])[:,None]
    fx = np.fft.rfftfreq(a.shape[1])[None,:]
    kernel = np.exp(-2*np.pi**2*((fy*sigma[0])**2+(fx*sigma[1])**2))
    return np.fft.irfft2(np.fft.rfft2(a)*kernel,s=a.shape).astype(np.float32)


def map_coordinates(a, coords, order=1, mode='grid-wrap'):
    y,x = np.broadcast_arrays(*coords)
    iy,ix = np.floor(y).astype(int),np.floor(x).astype(int)
    fy,fx = y-iy,x-ix
    return ((1-fy)*((1-fx)*a[iy%a.shape[0],ix%a.shape[1]]
                   +fx*a[iy%a.shape[0],(ix+1)%a.shape[1]])
            +fy*((1-fx)*a[(iy+1)%a.shape[0],ix%a.shape[1]]
                 +fx*a[(iy+1)%a.shape[0],(ix+1)%a.shape[1]]))


def save_png(path, a, srgb=False):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
        info.add(b'gAMA', (45455).to_bytes(4, 'big'))
    Image.fromarray(a).save(path, pnginfo=info, compress_level=6)


def area_half(a):
    return a.astype(np.float64).reshape(a.shape[0]//2, 2, a.shape[1]//2, 2, *a.shape[2:]).mean(axis=(1, 3))


def normals(h16):
    h = h16.astype(np.float64) * (HEIGHT_MM / 65535.0)
    step = TILE_MM / h.shape[0]
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1)) / (2*step)
    dy = (np.roll(h, -1, 0)-np.roll(h, 1, 0)) / (2*step)
    v = np.stack((-dx, dy, np.ones_like(h)), -1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    return np.rint((v*.5+.5)*255).astype(np.uint8)


def standard(a):
    return (a-a.mean()) / max(a.std(), 1e-7)


def wave(x, rng, freqs, scale=1.):
    a = np.zeros_like(x)
    weights = np.array([1 / np.sqrt(k) for k in freqs])
    weights *= scale / np.sqrt(np.sum(weights**2)*.5)
    for k, w in zip(freqs, weights):
        a += w*np.sin(TAU*k*x + rng.uniform(0, TAU))
    return a


def build():
    t0 = time.perf_counter()
    (ROOT/'source').mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    x = (np.arange(N, dtype=np.float64)+.5)/N
    yy = (np.arange(N, dtype=np.float64)+.5)*TURNS/N
    rows = np.floor(yy).astype(int)
    local_y = yy-rows-.5
    height_body = np.zeros((N,N), np.float32)
    ply_relief = np.zeros_like(height_body)
    fibre_relief = np.zeros_like(height_body)
    bleach = np.zeros_like(height_body)
    fibre_colour = np.zeros_like(height_body)
    freshness = np.zeros_like(height_body)
    row_pigment = np.zeros_like(height_body)
    records = []

    for turn in range(TURNS):
        iy = np.flatnonzero(rows == turn)
        d = local_y[iy, None]
        twists = int(rng.integers(21, 28))
        phase0 = rng.uniform(0,TAU)
        # Integral winding plus periodic jitter: the helix closes exactly at x=1.
        theta = (TAU*twists*x + phase0 + wave(x,rng,[2,3,5,8],.20)
                 + wave(x,rng,[13,19,31,47,73],.13))
        halfwidth = .482 + .009*np.cos(2*theta) + wave(x,rng,[3,7,11,19],.005)
        halfwidth = np.clip(halfwidth,.463,.498)
        radius = d/halfwidth
        profile = (.5+.5*np.cos(np.pi*np.clip(radius,-1,1)))**.58
        top = 2.58 + rng.uniform(-.11,.11) + wave(x,rng,[2,5,9,15],.085)
        if turn in (6,23,42): top += .13
        if turn in (15,37): top -= .13
        body = .19 + profile*top
        phi = np.arcsin(np.clip(radius*.98,-.999,.999))
        phase = theta[None,:] + phi
        seam = np.exp(-(np.sin(phase)/.20)**2)
        ply = (-.32*np.cos(2*phase)-.29*seam)*profile**.48

        # Fibres are sampled in a helical chart, not drawn diagonally over a photo.
        # Both chart axes wrap. Individual thin filaments wander, split, and fade.
        # Reverse-twisted fibre bundles inside the two larger plies. The local
        # angle goes from -pi/2 to +pi/2 across a ply; its chart endpoints wrap.
        # This prevents the cord from reading as uniformly combed synthetic yarn.
        ply_angle = np.arcsin(np.clip(2*np.remainder(phase/np.pi,1)-1,-1,1))
        chart_y = ((ply_angle-theta[None,:])/np.pi*128
                   + 1.0*np.sin(TAU*9*x[None,:]+phase*.0+phase0)
                   + .7*np.sin(phase*2 + TAU*5*x[None,:])) % 128
        chart_x = np.broadcast_to(x[None,:]*N-.5, chart_y.shape)
        noise = gaussian_filter(rng.normal(size=(128,N)).astype(np.float32),(1.25,19),mode='wrap')
        noise = standard(noise)
        thread = map_coordinates(noise,[chart_y,chart_x],order=1,mode='grid-wrap')
        coarse = gaussian_filter(rng.normal(size=(128,N)).astype(np.float32),(4.5,65),mode='wrap')
        coarse = standard(coarse)
        bundles = map_coordinates(coarse,[chart_y,chart_x],order=1,mode='grid-wrap')
        micro = gaussian_filter(rng.normal(size=(128,N)).astype(np.float32),(.65,3.5),mode='wrap')
        micro = standard(micro)
        fine = map_coordinates(micro,[chart_y,chart_x],order=1,mode='grid-wrap')
        fibre = (.029*thread + .021*bundles + .010*fine)*profile**.30
        # Pigment carries dry, bleached surfaces and retained chlorophyll only.
        # No light vector, normal, height-derived AO or cast shadow is used here.
        fresh = (wave(x,rng,[4,7,12,17],.65)[None,:]
                 + .24*bundles)
        height_body[iy] = body
        ply_relief[iy] = ply
        fibre_relief[iy] = fibre
        bleach[iy] = profile**.8
        fibre_colour[iy] = 6.5*thread + 4.2*bundles + 1.6*fine
        freshness[iy] = fresh
        row_pigment[iy] = rng.normal(0,1.5)
        records.append(dict(turn=turn,center_fraction=(turn+.5)/TURNS,
                            center_mm=(turn+.5)*TILE_MM/TURNS,
                            full_twists=twists,phase_radians=phase0,
                            halfwidth_fraction_min=float(halfwidth.min()),
                            halfwidth_fraction_max=float(halfwidth.max()),
                            crest_body_mm_mean=float(top.mean()+.19)))

    # Sparse lifted tips, rasterized at native size by analytic Gaussian coverage.
    # Small raised ends remain a single-valued surface; there are no fake alpha hairs.
    hairs = np.zeros((N,N),np.float32)
    hair_height = np.zeros_like(hairs)
    hair_records = []
    for turn in range(TURNS):
        for _ in range(19):
            x0 = rng.uniform(0,N)
            y0 = (turn+.5+rng.uniform(-.42,.42))*N/TURNS
            length = rng.uniform(7,37)
            direction = rng.choice([-1,1])
            bend = rng.uniform(-5,5)
            slope = rng.uniform(-.45,.55)
            width = rng.uniform(.35,.80)
            lift = rng.uniform(.045,.115)
            xx = np.arange(int(np.floor(min(x0,x0+direction*length)))-3,
                           int(np.ceil(max(x0,x0+direction*length)))+4)
            q = (xx-x0)/(direction*length)
            valid = (q>=0)&(q<=1)
            curve_y = y0+slope*(xx-x0)+bend*np.sin(np.pi*np.clip(q,0,1))
            ys = np.arange(int(np.floor(curve_y.min()))-3,int(np.ceil(curve_y.max()))+4)
            coverage = np.exp(-.5*((ys[:,None]-curve_y[None,:])/width)**2)
            coverage *= np.sin(np.pi*np.clip(q,0,1))[None,:]**.45 * valid[None,:]
            ix = np.ix_(ys%N,xx%N)
            hairs[ix] = np.maximum(hairs[ix], coverage)
            hair_height[ix] = np.maximum(hair_height[ix], coverage*lift)
            hair_records.append([turn,x0,y0,length,int(direction),bend,slope,width,lift])

    height = height_body + ply_relief + fibre_relief + hair_height
    if height.min()<=0 or height.max()>=HEIGHT_MM:
        raise ValueError('Height range clips')
    h16 = np.rint(height/HEIGHT_MM*65535).astype(np.uint16)
    save_png(ROOT/'lashing_height.png',h16)
    # Derive normals and occlusion from the delivered, quantized height.
    h16 = np.array(Image.open(ROOT/'lashing_height.png'))
    save_png(ROOT/'lashing_normal.png',normals(h16))

    colour = np.empty((N,N,3), np.float32)
    for c, (bleach_weight, fresh_weight, fibre_weight, retained_green) in enumerate(
            [(11.0,-3.0,1.0,-5.0),(10.5,-.3,.93,0.0),(9.5,-4.0,.72,-3.0)]):
        colour[:,:,c] = (bleach*bleach_weight + freshness*fresh_weight
                          + fibre_colour*fibre_weight + row_pigment
                          + retained_green*(1-bleach)**2
                          + hairs*(24.0-c*.7))
    target = np.array([176,152,92],np.float32)
    colour += target-colour.mean(axis=(0,1),dtype=np.float64)
    base = np.rint(np.clip(colour,0,255)).astype(np.uint8)
    save_png(ROOT/'lashing_base.png',base,True)

    h = h16.astype(np.float32)*(HEIGHT_MM/65535)
    # Eight-direction, six-radius horizon visibility. Grooves occlude sky;
    # pigments stay completely independent of this calculation.
    visibility = np.zeros_like(h)
    for dy,dx in [(0,1),(1,1),(1,0),(1,-1),(0,-1),(-1,-1),(-1,0),(-1,1)]:
        horizon = np.zeros_like(h)
        for radius in [1,2,4,7,12,20]:
            delta = np.roll(h,(dy*radius,dx*radius),(0,1))-h
            dist = (TILE_MM/N)*radius*np.hypot(dy,dx)
            horizon = np.maximum(horizon,delta/dist)
        visibility += 1/(1+horizon*horizon)
    ao = .10 + .90*(visibility/8)**1.55
    rough = .845 + .027*np.tanh(fibre_colour/5) + .037*(1-bleach) + .018*hairs
    rough = np.clip(rough,.75,.95)
    orm = np.stack((np.rint(ao*255),np.rint(rough*255),np.zeros_like(ao)),-1).astype(np.uint8)
    save_png(ROOT/'lashing_orm.png',orm)

    for name,a in [('base',base),('height',h16),('orm',orm)]:
        reduced = np.rint(area_half(a)).astype(a.dtype)
        save_png(ROOT/f'lashing_{name}_1024.png',reduced,name=='base')
    low_height = np.array(Image.open(ROOT/'lashing_height_1024.png'))
    # A true physical derivative at the low resolution, checked against shrinking
    # the master normal. Do not copy normals with the wrong derivative scale.
    save_png(ROOT/'lashing_normal_1024.png',normals(low_height))

    np.savez_compressed(ROOT/'source/construction_fields.npz',
                        body_mm=height_body,ply_mm=ply_relief,fibre_mm=fibre_relief,
                        hair_mm=hair_height,hair_coverage=hairs,bleach=bleach,
                        fibre_pigment=fibre_colour,freshness=freshness,
                        turn_pigment=row_pigment)
    save_png(ROOT/'source/fibre_pigment.png',np.rint(np.clip(128+fibre_colour*7,0,255)).astype(np.uint8))
    save_png(ROOT/'source/fibre_relief.png',np.rint(np.clip(.5+fibre_relief/.30,0,1)*65535).astype(np.uint16))
    save_png(ROOT/'source/stray_fibres.png',np.rint(hairs*255).astype(np.uint8))
    construction = dict(seed=SEED,size=N,turns=TURNS,tile_metres=TILE_MM/1000,
                        encoded_height_range_mm=[0,HEIGHT_MM],
                        method='Analytic two-ply helical cord, native periodic fibre charts, analytic stray tips. No photographs or AI image sources.',
                        rows=records,hairs=hair_records)
    (ROOT/'source/construction.json').write_text(json.dumps(construction,indent=2)+'\n')
    manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('lashing*.png'))}
    (ROOT/'source/delivery_sha256.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(seconds=round(time.perf_counter()-t0,2),
                         base_mean=base.mean(axis=(0,1)).tolist(),
                         height_mm=[float(h.min()),float(h.max())],
                         ao_range=[float(ao.min()),float(ao.max())],
                         roughness_range=[float(rough.min()),float(rough.max())]),indent=2))


if __name__=='__main__':
    build()
