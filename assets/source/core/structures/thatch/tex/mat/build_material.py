#!/usr/bin/env python3
"""Build an original, periodic 40 x 40 split-reed 2/2 twill at native 2048.

Requires Python 3, NumPy, SciPy and Pillow. No network access. All paths are
relative to this script, and all outputs stay in this material directory.
"""
from pathlib import Path
import hashlib
import json
import time

import numpy as np
from PIL import Image, ImageCms, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parent
N = 2048
STRIPS = 40
TILE_M = 1.5
HEIGHT_MM = 8.0
SEED = 617803
TARGET_RGB = np.array([178., 160., 118.], dtype=np.float32)
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()


def smoothstep(a, b, x):
    t = np.clip((x-a)/(b-a), 0., 1.)
    return t*t*(3.-2.*t)


def blur(a, sigma):
    return gaussian_filter(a, sigma, mode='wrap')


def noise(rng, shape, sigma):
    a = blur(rng.standard_normal(shape, dtype=np.float32), sigma)
    return (a - a.mean()) / max(float(a.std()), 1.e-6)


def save_png(name, a, srgb=False, extra=None):
    info = PngImagePlugin.PngInfo()
    info.add_text('Material', 'Hand-plaited split reed; 2-over / 2-under twill; 40 strips per axis')
    info.add_text('Physical size', '1.5 x 1.5 metres; repeat X and Y')
    info.add_text('Color space', 'sRGB' if srgb else 'linear data; do not decode as sRGB')
    for k, v in (extra or {}).items():
        info.add_text(k, v)
    kwargs = {'icc_profile': SRGB} if srgb else {}
    Image.fromarray(a).save(ROOT / name, pnginfo=info, **kwargs)


def rgb8(a):
    return np.clip(np.rint(a), 0, 255).astype(np.uint8)


def normal_from_height(h16):
    """Central differences of the DELIVERED uint16 height; +Y is image-up."""
    h = h16.astype(np.float32) * (HEIGHT_MM / 65535.)
    px_mm = TILE_M * 1000. / N
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2. * px_mm)
    dy_down = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2. * px_mm)
    normal = np.stack([-dx, dy_down, np.ones_like(h)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return rgb8((normal * .5 + .5) * 255.)


def make_atlas(rng, src):
    """80 independent ribbon surfaces, 64 samples wide, 2048 along the fibre.

    Three native-density source patches are blended around each ribbon's ring.
    Source ribbon edges are excluded. Slow and cross-ribbon illumination is
    removed before the residual is used as low-amplitude pigment detail.
    Native pixel-scale procedural fibres provide independent relief and pigment.
    """
    bounds = np.array([0, 86, 173, 256, 338, 420, 502, 584,
                       667, 749, 829, 909, 986, 1058, 1131, 1199, 1254])
    bounds = bounds * src.shape[0] / 1254.
    cy, ax = np.mgrid[:64, :N].astype(np.float32)
    palettes = rng.normal(0, 4.8, 80)
    palettes -= palettes.mean()
    hue = rng.normal(0, 1.3, (80, 3)).astype(np.float32)
    colour = np.empty((80, 64, N, 3), dtype=np.float32)
    relief = np.empty((80, 64, N), dtype=np.float32)
    fibre_saved = np.empty_like(relief)
    for k in range(80):
        detail = np.zeros((64, N), dtype=np.float32)
        for p in range(3):
            row = int(rng.integers(0, 16))
            margin = 13.
            ys = bounds[row] + margin + (cy+.5)/64.*(bounds[row+1]-bounds[row]-2*margin)
            # Each patch is active only within +/- 683 pixels of its centre.
            # Choose a 900 px periodic source track with a 200 px crossfade.
            phase = rng.uniform(0, 900)
            xs = (ax + phase) % 900
            left = map_coordinates(src.mean(2), [ys, xs+160], order=1, mode='nearest')
            right = map_coordinates(src.mean(2), [ys, xs+1060], order=1, mode='nearest')
            w = smoothstep(0., 190., xs)
            track = left*w + right*(1.-w)
            # The right sample only contributes during the first 190 pixels,
            # where xs+1060 <=1250. Adjacent ring endpoints remain continuous.
            track -= blur(track, (7., 70.))
            track -= track.mean(1, keepdims=True) * .45
            # Raised-cosine partition of unity, periodic across output ends.
            dist = ((ax - (p/3.*N) + N/2.) % N) - N/2.
            weight = (1.+np.cos(np.pi*np.clip(dist/(N/3.), -1., 1.)))/2.
            detail += track * weight
        detail *= .65
        coarse = noise(rng, (64, N), (1.8, 39.))
        fine = noise(rng, (64, N), (.48, 12.))
        fine2 = noise(rng, (64, N), (.85, 3.4))
        drift = 1.4*np.sin(2*np.pi*ax/N*3+rng.uniform(0, 6.28))
        drift += .55*np.sin(2*np.pi*ax/N*11+rng.uniform(0, 6.28))
        fine = map_coordinates(fine, [(cy+drift)%64, ax], order=1, mode='grid-wrap')
        broad = noise(rng, (64, N), (9., 110.))
        local_tone = noise(rng, (64, N), (22., 135.))
        fiber = .040*coarse + .026*fine + .013*fine2
        # Gentle short transverse nodes and small edge splits, unique per ribbon.
        node = np.zeros_like(detail)
        splits = np.zeros_like(detail)
        raised_fibre = np.zeros_like(detail)
        for _ in range(int(rng.integers(1, 4))):
            cx = rng.uniform(0, N)
            distance = ((ax-cx+N/2.)%N)-N/2.
            bend = (cy-32.) * rng.uniform(-.12, .12)
            node += np.exp(-((distance+bend)/rng.uniform(.8, 1.9))**2/2.) * rng.uniform(.025, .065)
        for _ in range(int(rng.integers(0, 4))):
            cx = rng.uniform(0, N)
            distance = ((ax-cx+N/2.)%N)-N/2.
            taper = np.exp(-.5*(distance/rng.uniform(25, 100))**2)
            edge_y = rng.choice([3.3, 59.7]) + 1.1*np.sin(distance/65.)
            width = rng.uniform(.45, .85)
            splits += np.exp(-.5*((cy-edge_y)/width)**2)*taper
            outward = -1.7 if float(edge_y[0,0])<32 else 1.7
            raised_fibre += np.exp(-.5*((cy-edge_y-outward)/.55)**2)*taper
        # Stochastic lines are pigment/relief, not directional edge shading.
        gray = detail + 1.7*coarse + 1.65*fine + .85*fine2 + 2.1*broad + 4.6*local_tone
        gray += 12.*node - 9.*splits + 3.5*raised_fibre
        colour[k] = TARGET_RGB + palettes[k]*np.array([1., .98, .85]) + hue[k]
        colour[k] += gray[..., None] * np.array([1., .98, .85])
        relief[k] = fiber + node - .24*splits + .18*raised_fibre + detail*.003
        fibre_saved[k] = fiber
    return colour.reshape(80*64, N, 3), relief.reshape(80*64, N), fibre_saved.reshape(80*64, N)


def horizon_ao(h):
    """Periodic heightfield horizon integration, twelve azimuths, eight radii."""
    px_mm = TILE_M * 1000./N
    ao = np.zeros_like(h)
    for angle in np.arange(12)*2*np.pi/12:
        slope = np.zeros_like(h)
        seen = set()
        for radius in [1, 2, 3, 5, 9, 16, 30, 58]:
            dx, dy = int(round(np.cos(angle)*radius)), int(round(np.sin(angle)*radius))
            if (dx, dy) in seen or (dx == 0 and dy == 0):
                continue
            seen.add((dx, dy))
            sample = np.roll(h, (dy, dx), axis=(0, 1))
            slope = np.maximum(slope, (sample-h)/(np.hypot(dx,dy)*px_mm))
        ao += 1./(1.+slope*slope)
    return np.clip(ao/12., 0., 1.)


def main():
    started = time.time()
    rng = np.random.default_rng(SEED)
    print('Building eighty native-density ribbon surfaces...', flush=True)
    src = np.asarray(Image.open(ROOT/'source/generated_reed_atlas.png').convert('RGB'), dtype=np.float32)
    atlas, grain_atlas, fine_atlas = make_atlas(rng, src)
    # Retain full-resolution assembled source sheets for inspection and provenance.
    save_png('source/composed_ribbon_surfaces.png', rgb8(atlas), srgb=True)
    yy, xx = np.mgrid[:N, :N].astype(np.float32)
    pitch = N/STRIPS
    u = xx/pitch + .37
    v = yy/pitch + .21
    # Periodic deformations retain the 40-strip winding number on both axes.
    # A broad warp and smaller irregularities avoid a machine-square basket grid.
    u += .105*noise(rng, (N,N), 105.) + .035*noise(rng, (N,N), 23.)
    v += .105*noise(rng, (N,N), 105.) + .035*noise(rng, (N,N), 23.)
    column_offsets = rng.uniform(-.13, .13, 40).astype(np.float32)
    row_offsets = rng.uniform(-.13, .13, 40).astype(np.float32)
    u += map_coordinates(column_offsets, [(xx/pitch).ravel()], order=3, mode='grid-wrap').reshape(N,N)
    v += map_coordinates(row_offsets, [(yy/pitch).ravel()], order=3, mode='grid-wrap').reshape(N,N)
    ui, vi = np.floor(u).astype(np.int32), np.floor(v).astype(np.int32)
    uf, vf = u-ui, v-vi
    hcoords = [(vi%40)*64 + np.clip(vf*64, .51, 63.49), (u/40.*N)%N]
    vcoords = [((ui%40)+40)*64 + np.clip(uf*64, .51, 63.49), (v/40.*N)%N]
    print('Plaiting 40 x 40, with periodic width and alignment variation...', flush=True)
    col_h = np.stack([map_coordinates(atlas[...,c], hcoords, order=1, mode='grid-wrap') for c in range(3)], -1)
    col_v = np.stack([map_coordinates(atlas[...,c], vcoords, order=1, mode='grid-wrap') for c in range(3)], -1)
    relief_h = map_coordinates(grain_atlas, hcoords, order=1, mode='grid-wrap')
    relief_v = map_coordinates(grain_atlas, vcoords, order=1, mode='grid-wrap')
    native_fibre_h = map_coordinates(fine_atlas, hcoords, order=1, mode='grid-wrap')
    native_fibre_v = map_coordinates(fine_atlas, vcoords, order=1, mode='grid-wrap')
    del atlas, grain_atlas, fine_atlas
    wear = smoothstep(-.5, 2.0, .73*noise(rng, (N,N), 108.) + .27*noise(rng, (N,N), 39.))
    # Ragged edges stay below a pixel on average; the weave remains intact.
    edge_h = .25*noise(rng, (N,N), (4., 1.7)) + .23*noise(rng,(N,N), (8.,12.))
    edge_v = .25*noise(rng, (N,N), (1.7,4.)) + .23*noise(rng,(N,N), (12.,8.))
    dh = (np.minimum(vf,1.-vf)*pitch) - .64 + edge_h
    dv = (np.minimum(uf,1.-uf)*pitch) - .64 + edge_v
    cover_h = smoothstep(-.6,.6,dh)
    cover_v = smoothstep(-.6,.6,dv)
    phase_h = np.cos(np.pi/2.*(u-vi-1.))
    phase_v = -np.cos(np.pi/2.*(ui-v))
    arch_h = np.tanh(phase_h*1.7)/np.tanh(1.7)
    arch_v = np.tanh(phase_v*1.7)/np.tanh(1.7)
    thickness_h = rng.uniform(-.10,.10,40)[vi%40]
    thickness_v = rng.uniform(-.10,.10,40)[ui%40]
    # Flat ribbons, a very slight cross-section crown, soft bent exits at crossings.
    base_z = 3.45 + .10*noise(rng,(N,N),52.)
    h_raw = base_z + 1.28*arch_h + thickness_h + .13*np.sin(np.pi*vf)
    v_raw = base_z + 1.28*arch_v + thickness_v + .13*np.sin(np.pi*uf)
    h_raw -= .33*np.exp(-np.maximum(dh,0)/1.25)
    v_raw -= .33*np.exp(-np.maximum(dv,0)/1.25)
    h_raw += relief_h*(1.-.37*wear)
    v_raw += relief_v*(1.-.37*wear)
    ground_z = 1.32 + .035*noise(rng,(N,N),(.8,.8))
    zh = ground_z + cover_h*(h_raw-ground_z)
    zv = ground_z + cover_v*(v_raw-ground_z)
    top_h = smoothstep(-.065,.065,zh-zv).astype(np.float32)
    coverage = np.maximum(cover_h,cover_v)
    height = blur(np.maximum(zh,zv).astype(np.float32), .39)
    print('Computing heightfield cavity occlusion and native fine detail...', flush=True)
    ao = horizon_ao(height)
    cavity = smoothstep(.04,.39,1.-ao)
    grit_rng = rng.random((N,N), dtype=np.float32)
    grit = blur((grit_rng > .987).astype(np.float32),.52)*2.5*cavity
    dust = cavity*(.28+.25*smoothstep(-1.,1.,noise(rng,(N,N),5.)))
    base = col_h*top_h[...,None] + col_v*(1.-top_h[...,None])
    del col_h, col_v
    # Only real deposited dust/grit affects albedo at crossings. AO is separate.
    base = base*coverage[...,None] + np.array([158.,145.,113.])*(1.-coverage[...,None])
    base += wear[...,None]*np.array([3.8,4.1,4.8])
    base = base*(1.-dust[...,None]*.10) + np.array([168.,154.,122.])*dust[...,None]*.10
    base -= grit[...,None]*np.array([12.,11.,8.])
    height += grit*.07
    base += TARGET_RGB - base.mean((0,1))
    roughness = .827 + .017*noise(rng,(N,N),9.) - .115*wear + .041*cavity
    roughness += .010*noise(rng,(N,N),.65)
    roughness = np.clip(roughness,.66,.92)
    h16 = np.rint(np.clip(height/HEIGHT_MM,0,1)*65535).astype(np.uint16)
    # Recompute AO after the tiny grit relief, using the quantized delivered height.
    ao = horizon_ao(h16.astype(np.float32)*HEIGHT_MM/65535.)
    save_png('mat_base.png',rgb8(base),srgb=True)
    save_png('mat_height.png',h16,extra={'Height scale':'0..65535 = 0..8 millimetres; white is high'})
    save_png('mat_normal.png',normal_from_height(h16),extra={'Normal convention':'OpenGL: +X right, +Y image-up, +Z out; central differences with wrap'})
    save_png('mat_orm.png',rgb8(np.stack([ao,roughness,np.zeros_like(ao)],-1)*255),
             extra={'Channels':'R ambient occlusion; G roughness; B metalness (zero)'})
    # These are diagnostic fields, not additional engine textures.
    np.savez_compressed(ROOT/'source/derivation.npz',u=u.astype(np.float32),v=v.astype(np.float32),
        horizontal_top=top_h,wear=wear.astype(np.float32),coverage=coverage.astype(np.float32),
        native_fibre_mm=(native_fibre_h*top_h+native_fibre_v*(1.-top_h)).astype(np.float32))
    meta = {'seed':SEED,'resolution':[N,N],'strips_per_axis':STRIPS,'tile_metres':[TILE_M,TILE_M],
        'pitch_mm':TILE_M*1000/STRIPS,'pixel_mm':TILE_M*1000/N,'height_range_mm':HEIGHT_MM,
        'used_height_mm':[float(h16.min()*HEIGHT_MM/65535),float(h16.max()*HEIGHT_MM/65535)],
        'source_size':list(Image.open(ROOT/'source/generated_reed_atlas.png').size),
        'source_sha256':hashlib.sha256((ROOT/'source/generated_reed_atlas.png').read_bytes()).hexdigest(),
        'normal_method':'wrapped central differences of delivered uint16; encode normalized (-dH/dx,+dH/drow,1)',
        'build_seconds':round(time.time()-started,2)}
    (ROOT/'source/build_metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps(meta,indent=2),flush=True)


if __name__ == '__main__':
    main()
