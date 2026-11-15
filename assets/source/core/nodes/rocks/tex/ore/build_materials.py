#!/usr/bin/env python3
"""Rebuild the ore skins from retained source art. Only writes beside this file.

Python 3 + Pillow, NumPy, SciPy. All procedural fields and derivatives wrap.
No geometry larger than the skin is encoded; height units are millimetres.
"""
from pathlib import Path
import hashlib
import json
import time
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.fft import rfft2, irfft2, fftfreq, rfftfreq
from scipy.spatial import Delaunay

ROOT = Path(__file__).resolve().parent
N = 2048
SPAN_MM = 1500.0
HEIGHT_MM = 20.0
SEED = 141126
# Freeze the ICC profile too: generating it on each run embeds a new timestamp.
SRGB = (ROOT/'source'/'sRGB.icc').read_bytes()


def blur(a, s):
    if s >= 8 and min(a.shape[:2]) >= 1024:
        fy = fftfreq(a.shape[0])[:, None]
        fx = rfftfreq(a.shape[1])[None, :]
        kernel = np.exp(-2*np.pi**2*s*s*(fx*fx+fy*fy)).astype('f')
        if a.ndim == 3:
            return np.stack([irfft2(rfft2(a[..., c])*kernel, s=a.shape[:2]) for c in range(a.shape[2])], 2)
        return irfft2(rfft2(a)*kernel, s=a.shape)
    return ndi.gaussian_filter(a, (s, s, 0) if a.ndim == 3 else s, mode='wrap')


def unit(a):
    return (a - a.mean()) / max(float(a.std()), 1e-6)


def noise(rng, s, shape=(N, N)):
    return unit(blur(rng.standard_normal(shape).astype('f'), s))


def smoothstep(a, b, v):
    t = np.clip((v-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def rgb_save(path, a):
    Image.fromarray(np.uint8(np.clip(np.rint(a), 0, 255))).save(path, icc_profile=SRGB)


def scalar_save(path, a):
    Image.fromarray(np.uint8(np.clip(np.rint(a*255), 0, 255))).save(path)


def mean_grade(a, target):
    a = a.astype('f')
    for _ in range(3):
        a += np.array(target, dtype='f') - a.mean(axis=(0, 1), dtype=np.float64)
        a = np.clip(a, 1, 254)
    return a


def min_path(cost):
    """Minimum-error cut through a vertical overlap, no external quilt library."""
    h, w = cost.shape
    v = cost[0].copy()
    back = np.empty((h, w), np.int8)
    for y in range(1, h):
        choices = np.stack((np.r_[np.inf, v[:-1]], v, np.r_[v[1:], np.inf]))
        idx = np.argmin(choices, axis=0)
        back[y] = idx - 1
        v = cost[y] + choices[idx, np.arange(w)]
    path = np.empty(h, np.int32)
    path[-1] = np.argmin(v)
    for y in range(h-1, 0, -1):
        path[y-1] = path[y] + back[y, path[y]]
    return path


def quilt(filename, seed, count=6, patch=512, overlap=62, source_sizes=(650, 860), source_array=None, feather=.55):
    """Toroidal four-sided minimum-error patch synthesis.

    Every patch interior overwrites the previous image; the grid of interiors
    covers the torus. All four overlaps use data-dependent cuts, feathered by
    the specified subpixel width. Rotated/flipped crops are downsampled, not enlarged.
    """
    rng = np.random.default_rng(seed)
    source = np.asarray(Image.open(ROOT/'source'/filename).convert('RGB'), dtype='f') if source_array is None else source_array
    def resize_source(side):
        return np.stack([np.asarray(Image.fromarray(source[..., c]).resize((side, side), Image.Resampling.BILINEAR), dtype='f') for c in range(source.shape[2])], 2)
    canvas = resize_source(N)
    records = []
    positions = [(round(y*N/count), round(x*N/count)) for y in range(count) for x in range(count)]
    rng.shuffle(positions)
    yy, xx = np.mgrid[:patch, :patch]
    for cy, cx in positions:
        side = int(rng.integers(*source_sizes))
        src = resize_source(side)
        rot = int(rng.integers(4))
        flip = bool(rng.integers(2))
        src = np.rot90(src, rot)
        if flip:
            src = src[:, ::-1]
        sy, sx = rng.integers(0, side-patch+1, size=2)
        candidate = src[sy:sy+patch, sx:sx+patch].copy()
        # Keep uneven illumination from any crop out of the assembled tile.
        lum = candidate[..., :3].mean(axis=2)
        broad = ndi.gaussian_filter(lum, 44, mode='reflect')
        candidate[..., :3] -= (broad-broad.mean())[..., None] * .85
        ys = (np.arange(patch) + cy-patch//2) % N
        xs = (np.arange(patch) + cx-patch//2) % N
        old = canvas[ys[:, None], xs[None, :]]
        cost = np.mean((old[..., :3]-candidate[..., :3])**2, axis=2) + .1
        left = min_path(cost[:, :overlap])
        right = patch-1-min_path(cost[:, ::-1][:, :overlap])
        top = min_path(cost[:overlap].T)
        bottom = patch-1-min_path(cost[::-1][:overlap].T)
        inside = (xx >= left[:, None]) & (xx <= right[:, None]) & (yy >= top[None, :]) & (yy <= bottom[None, :])
        mask = ndi.gaussian_filter(inside.astype('f'), feather, mode='constant')[..., None]
        canvas[ys[:, None], xs[None, :]] = old*(1-mask)+candidate*mask
        records.append(dict(center=[cy, cx], source_size=side, crop=[int(sy), int(sx)], quarter_turns=rot, mirror=flip))
    return canvas, records


def fracture_lines(rng, count=950):
    """Sparse sub-30 mm hairline fractures, rasterized continuously on a torus."""
    im = Image.new('L', (N, N))
    draw = ImageDraw.Draw(im)
    for _ in range(count):
        start = rng.uniform(0, N, 2)
        theta = rng.uniform(0, 2*np.pi)
        length = rng.uniform(8, 38)
        points = [start]
        for k in range(1, 6):
            along = length*k/5
            cross = rng.uniform(-1.9, 1.9)
            points.append(start + [np.cos(theta)*along-np.sin(theta)*cross, np.sin(theta)*along+np.cos(theta)*cross])
        # Consume the same random sequence as the first build; every wrapped
        # copy must use one shared intensity to keep edge-crossing lines exact.
        intensity = int(rng.integers(125, 255, size=9)[4])
        for oy in (-N, 0, N):
            for ox in (-N, 0, N):
                draw.line([(float(p[0]+ox), float(p[1]+oy)) for p in points], fill=intensity, width=1)
    return blur(np.asarray(im, dtype='f')/255, .5)


def save_surface(name, base, h_mm, rough):
    rgb_save(ROOT/f'{name}_base.png', base)
    # Quantize first: the normals are differentiated from the DELIVERED height.
    encoded = np.uint16(np.rint(np.clip(h_mm/HEIGHT_MM, 0, 1)*65535))
    Image.fromarray(encoded).save(ROOT/f'{name}_height.png')
    saved_h = np.asarray(Image.open(ROOT/f'{name}_height.png'), dtype='f')*HEIGHT_MM/65535
    dx = (np.roll(saved_h, -1, 1)-np.roll(saved_h, 1, 1))/(2*SPAN_MM/N)
    dy = (np.roll(saved_h, -1, 0)-np.roll(saved_h, 1, 0))/(2*SPAN_MM/N)
    normal = np.stack((-dx, dy, np.ones_like(dx)), axis=2)
    normal /= np.linalg.norm(normal, axis=2)[..., None]
    Image.fromarray(np.uint8(np.rint((normal*.5+.5)*255))).save(ROOT/f'{name}_normal.png')
    scalar_save(ROOT/f'{name}_rough.png', rough)


def relief_span(a, span):
    """Set the central 98% span, preserving actual sharp steps and grain."""
    lo, hi = np.percentile(a, [1, 99])
    return (a-a.mean())*(span/(hi-lo))


def fracture_planes():
    """Periodic piecewise-planar microfracture, in native pixel coordinates.

    Shared vertex elevations make connected rock, small face offsets add sharp
    steps. Ghost vertices carry identical IDs/heights across the tile boundary.
    Planes have no preferred light direction and contain no boulder-scale form.
    """
    rng = np.random.default_rng(SEED+33)
    count = 14000
    points = rng.uniform(0, N, (count, 2))
    elevations = rng.normal(0, .8, count)
    cloud, identities = [], []
    for oy in (-N, 0, N):
        for ox in (-N, 0, N):
            p = points+[ox, oy]
            use = (p[:, 0] > -80) & (p[:, 0] < N+80) & (p[:, 1] > -80) & (p[:, 1] < N+80)
            cloud.append(p[use]);identities.append(np.flatnonzero(use))
    cloud = np.concatenate(cloud);identities = np.concatenate(identities)
    tri = Delaunay(cloud)
    ids = identities[tri.simplices]
    heights = elevations[ids]
    gradients = np.einsum('ni,nij->nj', heights[:, :2]-heights[:, 2:3], tri.transform[:, :2, :])
    # A commutative ID hash gives a shared offset to every periodic copy.
    sorted_ids = np.sort(ids, axis=1).astype('uint64')
    hashed = (sorted_ids[:, 0]*73856093) ^ (sorted_ids[:, 1]*19349663) ^ (sorted_ids[:, 2]*83492791)
    steps = ((hashed % 65536)/65535-.5)*.8
    h = np.empty((N, N), dtype='f')
    for y in range(0, N, 128):
        yy, xx = np.mgrid[y:y+128, :N]
        coords = np.column_stack((xx.ravel(), yy.ravel()))
        index = tri.find_simplex(coords)
        assert np.all(index >= 0)
        delta = coords-tri.transform[index, 2, :]
        values = np.sum(gradients[index]*delta, axis=1)+heights[index, 2]+steps[index]
        h[y:y+128] = values.reshape(128, N)
    return h, count


def make_rocks():
    print('Building hard-rock fracture skin and visible native mineral grains...', flush=True)
    pigment, qp = quilt('P01_stone_pigment.png', SEED)
    planes, count = fracture_planes()
    fracture, qf = quilt('P05_hackly_height.png', SEED+31, count=12, patch=256,
                         overlap=30, source_sizes=(300, 390), feather=.4)
    rng = np.random.default_rng(SEED+32)
    pig_lum = pigment.mean(axis=2)
    mineral = np.clip(unit(blur(pig_lum, .6)-blur(pig_lum, 23)), -2.7, 2.7)
    # 5–30 cm non-directional colour variation. Native mineral grains are
    # independent of elevation, so the base does not contain face lighting.
    mottle = .7*noise(rng, 45)+.3*noise(rng, 110)
    mottle = unit(mottle-blur(mottle, 170))
    chroma = pigment-pig_lum[..., None]
    chroma -= blur(chroma, 42)
    residual = fracture.mean(axis=2)
    residual = unit(residual-blur(residual, 12))
    relief = unit(planes-blur(planes, 22)) + .28*residual
    fine = np.tanh(noise(rng, .48)*.85)
    grain = np.tanh(noise(rng, .95)*1.05)
    speck = np.clip(noise(rng, .7)-1.3, 0, 1.7)
    dark_grain = np.clip(-grain-.42, 0, .58)/.58
    cracks = fracture_lines(rng)
    fresh_h = relief_span(relief+.10*residual+.065*fine+.075*grain-.65*cracks, 6.4)
    stone_h = relief_span(blur(relief, .38)+.045*fine+.075*grain-.55*cracks, 4.7)
    valley = np.clip(-relief-1.5, 0, 2)/2
    # Keep the brief's means while exposing dark grains near 35 and light
    # grains near 120. Local extrema are mineral colour, not baked lighting.
    v = 5.5*mineral + 6.0*mottle + 10.5*fine + 7*grain + 12*speck - 5*dark_grain - 3*cracks
    base = np.array([74, 76, 70], dtype='f')+v[..., None]
    base += chroma*.42 + mottle[..., None]*np.array([2.6, .2, -2.4], dtype='f')
    base = mean_grade(np.clip(base, 32, 126), (74, 76, 70))
    rough = np.clip(.68+.026*mineral+.030*noise(rng, 9)+.055*valley-.06*speck+.03*cracks, .55, .80)
    save_surface('stone', base, 10+stone_h, rough)
    fv = 4.5*mineral+4.5*mottle+12*fine+8.5*grain+14*speck-3*cracks
    fresh = np.array([98, 100, 96], dtype='f')+fv[..., None]
    fresh += chroma*.24 + mottle[..., None]*np.array([1.2, .1, -1.1], dtype='f')
    fresh = mean_grade(np.clip(fresh, 48, 158), (98, 100, 96))
    fresh_r = np.clip(.625+.022*mineral+.040*valley-.065*speck+.02*cracks, .55, .80)
    save_surface('fresh', fresh, 10+fresh_h, fresh_r)
    return {'pigment': qp, 'fracture': qf, 'native_fracture_vertices': count}


def crystal_source():
    """Watershed the retained mineral artwork, then give each region an
    independent elevation, planar slope and optical identity. There is NO
    luminance-to-height conversion in the ore material.
    """
    rng = np.random.default_rng(SEED+40)
    a = np.asarray(Image.open(ROOT/'source/P06_crystal_pigment.png'), dtype='f')
    a = a[..., :3]
    sm = ndi.gaussian_filter(a, (3.0, 3.0, 0))
    lum = sm.mean(axis=2)
    gx = ndi.sobel(sm, axis=1)/8
    gy = ndi.sobel(sm, axis=0)/8
    g = np.sqrt(np.mean(gx*gx+gy*gy, axis=2))
    edge = (g > np.percentile(g, 71)) | (lum < 68)
    distance = ndi.distance_transform_edt(~edge)
    peaks = (distance == ndi.maximum_filter(distance, size=29)) & (distance > 3)
    markers, count = ndi.label(peaks)
    # The physical boundaries in the source constrain the watershed basins.
    cost = np.uint8(np.clip(g/np.percentile(g, 98)*210+(lum < 62)*35, 0, 255))
    labels = ndi.watershed_ift(cost, markers.astype('int32'))
    ids = np.arange(1, count+1)
    means = np.zeros((count+1, 3), dtype='f')
    for c in range(3):
        means[1:, c] = ndi.mean(a[..., c], labels, ids)
    centres = np.zeros((count+1, 2), dtype='f')
    centres[1:] = ndi.center_of_mass(np.ones(lum.shape, dtype='f'), labels, ids)
    yy, xx = np.indices(lum.shape, dtype='f')
    cx, cy = centres[labels, 1], centres[labels, 0]
    # Random face values are independent of source brightness and orientation.
    elevation = rng.uniform(-1.4, 1.4, count+1).astype('f')
    angles = rng.uniform(0, 2*np.pi, count+1)
    slope = rng.uniform(.012, .045, count+1)
    h = elevation[labels] + (xx-cx)*(np.cos(angles)*slope)[labels] + (yy-cy)*(np.sin(angles)*slope)[labels]
    h = np.clip(h, -2.6, 2.6).astype('f')
    # Retain source mineral arrangement and sparse tarnish, reducing intra-face
    # contrast so a face reflects as a plane, not as metallic pepper.
    pigment = means[labels]*.78 + a*.22
    rough = rng.uniform(.30, .46, count+1).astype('f')[labels]
    return np.concatenate((pigment, h[..., None], rough[..., None]), 2), count


def make_vein():
    print('Building packed crystal planes and aligned mineral phases...', flush=True)
    source, count = crystal_source()
    packed, recipe = quilt('P06_crystal_pigment.png', SEED+41, count=14,
                           patch=224, overlap=24, source_sizes=(245, 300),
                           source_array=source, feather=.30)
    rng = np.random.default_rng(SEED+42)
    pigment = packed[..., :3]
    lum = pigment.mean(axis=2)
    chroma = (pigment[..., 0]-pigment[..., 2])/np.maximum(lum, 1)
    # Quartz is classified from normalized chroma in the actual source artwork.
    quartz = chroma < .235
    # Thin dark grain boundaries and occasional bronze/purple oxide patches.
    face = packed[..., 3]
    edge = np.maximum(np.abs(face-np.roll(face, 1, 0)), np.abs(face-np.roll(face, 1, 1)))
    tarnish = ((lum < np.percentile(lum, 3.5)) | ((edge > 1.05) & (noise(rng, 5) > .90))) & ~quartz
    # Bring quartz to the intended subordinate fraction using its source rank.
    if not .07 < quartz.mean() < .16:
        quartz = chroma < np.percentile(chroma, 10.5)
        tarnish &= ~quartz
    sulphide = ~(quartz | tarnish)
    tone = np.clip((lum-127)*.50, -30, 26)
    bronze = np.clip((pigment[..., 0]-pigment[..., 1]-24)/24, 0, 1)
    brass = np.array([166, 137, 72], dtype='f')+tone[..., None]*[1, .85, .45]
    brass += bronze[..., None]*np.array([0, -4, -6], dtype='f')
    base = brass.astype('f')
    qv = np.clip((lum-128)*.3, -16, 17)
    qbase = np.array([177, 177, 166], dtype='f')+qv[..., None]
    tbase = np.array([79, 58, 32], dtype='f')+np.clip(tone, -12, 14)[..., None]*[1, .8, .55]
    purple = (chroma < .40) & tarnish
    tbase[purple] = np.array([78, 59, 71], dtype='f')
    base[quartz] = qbase[quartz]
    base[tarnish] = tbase[tarnish]
    # Flat face interiors and fine parallel growth grooves; shared height and
    # roughness are transformed with pigment through the same quilt cuts.
    micro = noise(rng, .6)
    h = blur(face, .27) + .015*micro - .10*tarnish
    h = 10+relief_span(h, 3.8)
    rough = np.clip(packed[..., 4]+.008*micro, .29, .49)
    rough[quartz] = np.clip(.46+.012*micro[quartz], .40, .50)
    rough[tarnish] = .50
    save_surface('vein', base, h, rough)
    scalar_save(ROOT/'vein_metal.png', sulphide)
    phase_meta = {name: {'fraction': float(mask.mean()), 'sha256': hashlib.sha256(mask.tobytes()).hexdigest()}
                  for name, mask in [('quartz', quartz), ('tarnish', tarnish), ('sulphide', sulphide)]}
    return {'source_regions': count, 'patches': recipe, 'phases': phase_meta}


def make_rust():
    print('Building broad branching runoff tongues, halos and pooled deposits...', flush=True)
    rng = np.random.default_rng(SEED+50)
    pigment = np.zeros((N, N), dtype='f')
    cores = np.zeros_like(pigment)
    # Only 19 main tongues. Width 2–10 cm, length 15–75 cm. Their broad
    # irregular heads feed two or three unequal soft lobes and dark drip cores.
    records = []
    for i in range(19):
        x = rng.uniform(0, N)
        start = int(rng.integers(N))
        length = int(rng.uniform(270, 1030))
        width = rng.uniform(23, 68)
        strength = rng.uniform(.70, .96)
        along = np.arange(length, dtype='f')
        u = along/length
        rows = (start+along.astype(int)) % N
        phase = rng.uniform(0, 2*np.pi)
        path = x+7*np.sin(u*7+phase)+rng.uniform(-24, 24)*u
        w = width*(1-.78*u)*(1+.17*np.sin(u*14+phase))
        # Broad root deposit, slight ledge pool partway down, asymmetrical fork.
        pool_y = rng.uniform(.22, .60)
        for j in range(-550, 551):
            cols = (np.rint(path).astype(int)+j) % N
            d = j+np.rint(path)-path
            head_offset = 10*(np.abs(d)/width)**1.2 + 8*np.sin(d/width*2+phase)
            envelope = smoothstep(0, .065, (along-head_offset)/length)*(1-smoothstep(.55, 1, u))
            main = np.exp(-.5*(d/w)**2)
            halo = .20*np.exp(-.5*(d/(w*1.9))**2)
            fork = .42*np.exp(-.5*((d-width*.7*smoothstep(.22, .70, u))/(w*.45))**2)*smoothstep(.17, .35, u)
            pool = .24*np.exp(-.5*((u-pool_y)/.024)**2)*np.exp(-.5*(d/(width*1.05))**2)
            value = np.clip(strength*(.83*main+halo+fork+pool)*envelope, 0, .995)
            pigment[rows, cols] = 1-(1-pigment[rows, cols])*(1-value)
            core = np.exp(-.5*((d-width*.14*np.sin(u*10))/(2.5+width*.09*(1-u)))**2)*envelope
            cores[rows, cols] = np.maximum(cores[rows, cols], core)
        records.append({'start_xy': [round(float(x), 2), start], 'length_px': length, 'head_sigma_px': round(float(width), 2)})
    grain = noise(rng, 1.1)
    weather = noise(rng, 13)
    yy, xx = np.indices((N, N), dtype='f')
    coords = [yy+5*noise(rng, 12), xx+4*noise(rng, 9)]
    pigment = ndi.map_coordinates(pigment, coords, order=1, mode='grid-wrap')
    cores = ndi.map_coordinates(cores, coords, order=1, mode='grid-wrap')
    cover = np.clip(pigment*(.84+.045*grain+.14*weather)+.08*cores, 0, 1)
    cover[cover < .012] = 0
    tone = np.clip(.72+.10*weather+.035*grain-.18*cover-.36*cores, 0, 1)
    umber = np.array([72, 39, 22], dtype='f')
    oxide = np.array([166, 92, 40], dtype='f')
    base = umber+(oxide-umber)*tone[..., None]
    rgb_save(ROOT/'rust_base.png', base)
    scalar_save(ROOT/'rust_cover.png', cover)
    return records


def main():
    started = time.time()
    recipe = {'rocks': make_rocks(), 'vein': make_vein(), 'rust_tongues': make_rust()}
    meta = {
        'round': 2, 'seed': SEED, 'size': N, 'tile_mm': SPAN_MM, 'height_encoding_mm': HEIGHT_MM,
        'normal_convention': 'OpenGL: normalize(-dH/dx, +dH/dy_image, 1); periodic central differences of delivered height',
        'sources': {p.name: {'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'size': list(Image.open(p).size)} for p in sorted((ROOT/'source').glob('*.png'))},
        'srgb_profile_sha256': hashlib.sha256(SRGB).hexdigest(), 'recipe': recipe,
        'runtime_seconds': round(time.time()-started, 2),
    }
    (ROOT/'build_metadata.json').write_text(json.dumps(meta, indent=2)+'\n')
    print(f'Built 15 delivery maps in {time.time()-started:.1f}s.', flush=True)


if __name__ == '__main__':
    main()
