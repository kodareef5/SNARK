#!/usr/bin/env python3
"""Deterministic native 2K smithy-steel trim. All writes stay beside this script.

No source photographs, generated lighting, or external texture dependencies.
Python 3 + NumPy + Pillow; Gaussian filtering uses periodic Fourier convolution.
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
HEIGHT_MM = 0.5
BASELINE_MM = 0.275
SEED = 741936
TRANSITION_MM = 3.6


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def gauss(a, sy, sx):
    fy = np.fft.fftfreq(a.shape[0])[:, None]
    fx = np.fft.rfftfreq(a.shape[1])[None, :]
    kernel = np.exp(-2 * np.pi**2 * (sy**2 * fy**2 + sx**2 * fx**2))
    return np.fft.irfft2(np.fft.rfft2(a) * kernel, s=a.shape).astype(np.float32)


def noise(rng, sy, sx):
    a = gauss(rng.standard_normal((N, N), dtype=np.float32), sy, sx)
    a -= a.mean()
    a /= a.std()
    # Bound isolated extrema without clipping/flat spots.
    return (2.4 * np.tanh(a / 2.4)).astype(np.float32)


def save(a, path, srgb=False):
    im = Image.fromarray(a)
    meta = PngImagePlugin.PngInfo()
    if srgb:
        meta.add(b'sRGB', b'\x00')
    im.save(path, pnginfo=meta, compress_level=6)


def rounded(a, peak=255):
    return np.floor(np.clip(a, 0, peak) + .5).astype(np.uint16 if peak == 65535 else np.uint8)


def reduce2(a):
    a = a.astype(np.float64)
    return .25 * (a[::2, ::2] + a[1::2, ::2] + a[::2, 1::2] + a[1::2, 1::2])


def normal_from_saved(path):
    h = np.asarray(Image.open(path), dtype=np.float64) * (HEIGHT_MM / 65535)
    pitch = TILE_MM / h.shape[0]
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * pitch)
    dr = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * pitch)
    v = np.stack((-dx, dr, np.ones_like(h)), axis=-1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    return rounded((v * .5 + .5) * 255)


def local_grid(cx, cy, rx, ry):
    xx = np.arange(int(np.floor(cx - rx)), int(np.ceil(cx + rx)) + 1)
    yy = np.arange(int(np.floor(cy - ry)), int(np.ceil(cy + ry)) + 1)
    return yy % N, xx % N, (xx - cx)[None, :], (yy - cy)[:, None]


def make():
    start = time.perf_counter()
    source = ROOT / 'source'
    source.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    ppmm = N / TILE_MM
    fields = {}
    records = {'seed': SEED, 'native_size': N, 'metres_per_tile': .2,
               'height_encoding_mm': HEIGHT_MM, 'neutral_height_mm': BASELINE_MM,
               'transition_mm': TRANSITION_MM, 'hammer': [], 'pits': [], 'scratches': []}

    print('Periodic bands and native file grain', flush=True)
    y = (np.arange(N, dtype=np.float32)[:, None] + .5) / ppmm
    # Shared irregularity is <0.18 mm; nominal row boundaries remain exact.
    boundary = noise(rng, 12, 125)[0:1] * .075
    wrapped_y = (y - boundary + TILE_MM) % TILE_MM
    d0 = (wrapped_y + TILE_MM / 2) % TILE_MM - TILE_MM / 2
    half = TRANSITION_MM / 2
    enter_brass = smooth(-half, half, d0)
    enter_edge = smooth(25-half, 25+half, wrapped_y)
    enter_face = smooth(50-half, 50+half, wrapped_y)
    brass = enter_brass * (1-enter_edge)
    # d0 is negative just above the repeat join: the brass transition continues there.
    brass += np.where(wrapped_y > 150, enter_brass, 0)
    edge = enter_edge * (1-enter_face)
    face = 1-brass-edge
    # Keep the original palette-calibration support so this local repair cannot
    # shift any colour in the band interiors.
    palette_masks = {name: mask > .99999 for name, mask in
                     (('brass', brass), ('edge', edge), ('face', face))}
    # The ordinary smoothstep is steepest at the repeat boundary. Blend two
    # half-width smoothsteps with it to ease that central slope, retaining the
    # same 3.6 mm support, midpoint, and zero slopes at both ends. Shared masks
    # carry the tarnished/warmed colour blend through height and roughness too.
    wrap_blend = (.4*enter_brass + .3*smooth(-half, 0, d0)
                  + .3*smooth(0, half, d0))
    join = np.abs(d0) < half
    brass[join] = wrap_blend[join]
    face[join] = 1-brass[join]
    records['wrap_blend'] = {'full_smoothstep_weight': .4,
                             'half_smoothstep_weights': [.3, .3],
                             'palette_calibration': 'original interior masks'}
    fields.update(brass=brass.astype(np.float32), edge=edge.astype(np.float32), face=face.astype(np.float32))
    cloud = noise(rng, 78, 150)
    oxidation = noise(rng, 60, 200)
    oil = noise(rng, 22, 85)
    file_long = noise(rng, 1.15, 115)
    file_medium = noise(rng, .85, 31)
    file_fine = noise(rng, .48, 9)
    grain = noise(rng, .52, .7)
    fields.update(cloud=cloud, oxidation=oxidation, oil=oil,
                  file_long=file_long, file_medium=file_medium, file_fine=file_fine, grain=grain)

    print('Shallow hammer hollows, pits, and hand-drawn scratches', flush=True)
    hammer = np.zeros((N, N), np.float32)
    pit = np.zeros_like(hammer)
    cavity = np.zeros_like(hammer)
    rust = np.zeros_like(hammer)
    scratches = np.zeros_like(hammer)
    scratch_support = np.zeros_like(hammer)
    polish = np.zeros_like(hammer)
    # Soft, overlapping peen impressions; none get AO or a painted shadow.
    for i in range(105):
        cx, cy = rng.uniform(0, N, 2)
        rx, ry = rng.uniform(1.2, 4.5, 2) * ppmm
        depth = rng.uniform(.020, .055)
        yy, xx, u, v = local_grid(cx, cy, rx*2.6, ry*2.6)
        theta = rng.uniform(-.6, .6)
        a = u*np.cos(theta)+v*np.sin(theta)
        b = -u*np.sin(theta)+v*np.cos(theta)
        q = (a/rx)**2+(b/ry)**2
        # A peen leaves a broad shallow bed and a soft, slightly irregular shoulder.
        q *= 1+.09*np.sin(a/rx*2.6+b/ry*1.8)
        body = np.exp(-1.6*q**1.35) * (1-smooth(3.7, 5.8, q))
        hammer[np.ix_(yy, xx)] -= depth * body
        records['hammer'].append({'xy_px': [float(cx), float(cy)], 'radius_mm': [float(rx/ppmm),float(ry/ppmm)], 'depth_mm': float(depth)})
    # Small irregular pores; a minority have oxide confined to their deep cores.
    for i in range(340):
        cx, cy = rng.uniform(0, N, 2)
        rx = rng.uniform(.14, .60) * ppmm
        ry = rx * rng.uniform(.55, 1.1)
        depth = rng.uniform(.018, .082)
        rusty = bool(i % 7 == 0 and cy > N/4+30 and cy < N-30)
        yy, xx, u, v = local_grid(cx, cy, rx*2, ry*2)
        a = np.arctan2(v/ry, u/rx)
        phase = rng.uniform(0, 2*np.pi)
        q = ((u/rx)**2+(v/ry)**2) * (1+.12*np.sin(3*a+phase)+.08*np.cos(5*a-phase))
        shape = np.exp(-q*2.2) * (1-smooth(1.2, 3.6, q))
        pit[np.ix_(yy, xx)] += depth * shape
        cavity[np.ix_(yy, xx)] = np.maximum(cavity[np.ix_(yy, xx)], shape)
        if rusty:
            core = smooth(.42, .88, shape) * rng.uniform(.55, .92)
            rust[np.ix_(yy, xx)] = np.maximum(rust[np.ix_(yy, xx)], core)
        records['pits'].append({'xy_px':[float(cx),float(cy)], 'radius_mm':[float(rx/ppmm),float(ry/ppmm)], 'depth_mm':float(depth), 'rust':rusty})
    for i in range(520):
        cx, cy = rng.uniform(0, N, 2)
        length = rng.uniform(4, 57) * ppmm
        width = rng.uniform(.070, .19) * ppmm
        depth = rng.uniform(.003, .018) * (1.6 if i%13 == 0 else 1)
        yy, xx, u, v = local_grid(cx, cy, length/2, width*4+1.4)
        t = u / (length/2)
        phase = rng.uniform(0, 2*np.pi)
        # Slight wandering <0.1 mm; every stroke still follows image x.
        path = .65*np.sin(t*2+phase) + .28*np.sin(t*7+phase)
        across = np.exp(-.5*((v-path)/width)**2)
        ends = (np.maximum(0, 1-t*t))**1.6
        uneven = .77+.23*np.sin(t*rng.uniform(5, 12)+phase)**2
        shape = across*ends*uneven
        scratches[np.ix_(yy, xx)] += depth*shape
        if depth > .018:
            scratch_support[np.ix_(yy, xx)] = np.maximum(scratch_support[np.ix_(yy, xx)], shape)
        polish[np.ix_(yy, xx)] += shape*rng.uniform(.25, .7)
        records['scratches'].append({'xy_px':[float(cx),float(cy)],'length_mm':float(length/ppmm),'sigma_width_mm':float(width/ppmm),'depth_mm':float(depth)})

    # Handling flattens the same steel structure; no height steps at trim boundaries.
    strength = .83*brass+.37*edge+face
    filed = .0053*file_long+.0032*file_medium+.00145*file_fine
    h = BASELINE_MM + strength*(filed+hammer-pit-scratches)+grain*(.0008*face+.0003*edge+.0006*brass)
    fields.update(hammer_mm=hammer, pit_mm=pit, cavity=cavity, rust=rust,
                  scratches_mm=scratches, deep_scratch=scratch_support, polish=polish,
                  height_mm=h.astype(np.float32), strength=strength.astype(np.float32))

    print('Unlit reflectance and linear packed material channels', flush=True)
    # Pigment and worn finish only: no normals, illumination, or AO enter colour.
    micro = .9*file_long+.7*file_medium+.55*file_fine+.32*grain
    steel = np.empty((N,N,3), np.float32)
    for c, target in enumerate((64,64,68)):
        steel[...,c] = target+1.55*cloud+micro+np.array([-1.0,-.20,1.35])[c]*oxidation
    steel += (np.clip(polish,0,1.4)*2.7)[...,None]
    steel = steel*(1-rust[...,None])+np.array([87,50,27],np.float32)*rust[...,None]
    brass_color = np.array([168,136,74],np.float32)[None,None,:]+(3.3*cloud+micro*.8)[...,None]
    tarnish = smooth(.2,1.8,oxidation)
    brass_color -= tarnish[...,None]*np.array([11.5,10.0,6.8],np.float32)
    bright_color = np.array([150,150,150],np.float32)[None,None,:]+(.65*cloud+.50*micro+1.0*polish)[...,None]
    for color,name,target in ((steel,'face',(64,64,68)),(brass_color,'brass',(168,136,74)),(bright_color,'edge',(150,150,150))):
        use = palette_masks[name]
        color += np.array(target,np.float32)-color[use].mean(axis=0,dtype=np.float64)
    base = brass_color*brass[...,None]+bright_color*edge[...,None]+steel*face[...,None]
    rough = (.431+.020*cloud+.012*oil+.010*file_long+.025*tarnish)*brass
    rough += (.301+.012*cloud+.008*oil+.006*file_medium)*edge
    rough += (.494+.024*cloud+.018*oil+.016*file_long+.010*file_medium)*face
    rough -= np.clip(polish,0,1.5)*(.026*face+.014*brass+.012*edge)
    rough += .045*cavity*strength+.24*rust
    rough = np.clip(rough,.25,.79)
    ao = 1-np.clip(.17*cavity+.048*scratch_support,0,.22)
    metal = 1-rust*.91
    fields.update(roughness=rough.astype(np.float32), ao=ao.astype(np.float32))
    orm = np.stack((ao,rough,metal),axis=-1)*255
    base = rounded(base)
    height = rounded(h/HEIGHT_MM*65535,65535)
    orm = rounded(orm)
    assert height.min()>0 and height.max()<65535
    for name,a in (('base',base),('height',height),('orm',orm)):
        save(a, ROOT/f'steel_{name}.png', name=='base')
        save(rounded(reduce2(a),65535 if name=='height' else 255), ROOT/f'steel_{name}_1024.png', name=='base')
    for suffix in ('','_1024'):
        save(normal_from_saved(ROOT/f'steel_height{suffix}.png'), ROOT/f'steel_normal{suffix}.png')
    print('Retaining full-resolution source fields', flush=True)
    np.savez_compressed(source/'construction_fields.npz', **fields)
    save(rounded(np.stack((brass,edge,face),-1)*255),source/'band_masks.png')
    save(rounded(rust*65535,65535), source/'rust_mask.png')
    (source/'construction.json').write_text(json.dumps(records,indent=2)+'\n')
    names = [f'steel_{n}{s}.png' for n in ('base','height','normal','orm') for s in ('','_1024')]
    manifest = {'seed':SEED,'seconds':round(time.perf_counter()-start,3),
                'sha256': {n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in names}}
    (ROOT/'build_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2), flush=True)


if __name__ == '__main__':
    make()
