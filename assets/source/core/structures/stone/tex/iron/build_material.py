#!/usr/bin/env python3
"""Deterministic 3 m wrought iron. Run from any directory; writes beside this script.

The generated source contributes oxidation and non-directional texture energy.
All physical relief is authored at native resolution. There is no shaded-source
luminance in base colour, and every map uses the same surface fields.
"""
from pathlib import Path
import hashlib
import json
import time
import numpy as np
from PIL import Image, ImageCms
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent
N = 2048
TILE_MM = 3000.0
RANGE_MM = 3.0
SEED = 5829


def blur(a, sigma):
    return gaussian_filter(a, sigma, mode='wrap')


def standard(a):
    return (a - a.mean()) / max(float(a.std()), 1e-6)


def smooth(a):
    a = np.clip(a, 0, 1)
    return a * a * (3 - 2 * a)


def noise(rng, sigma):
    return standard(blur(rng.standard_normal((N, N), dtype=np.float32), sigma))


def quilt_source(rng):
    """64 overlapping random source crops, toroidal placement and C1 windows.

    Source fields are scalar oxidation and texture energy, not lit RGB.
    Opposite-edge filtering is used only AFTER the assembled torus exists.
    """
    src = np.asarray(Image.open(ROOT/'source/generated_iron_01.png').convert('RGB'), dtype=np.float32)
    lum = np.sum(src*np.array([.2126, .7152, .0722], dtype=np.float32), axis=2)
    chroma = src[:, :, 0] - .45*src[:, :, 1] - .55*src[:, :, 2]
    chroma = gaussian_filter(chroma, .7, mode='reflect')
    chroma -= gaussian_filter(chroma, 55, mode='reflect')
    band = lum - gaussian_filter(lum, 2.0, mode='reflect')
    # Squared local band energy discards the sign of source relief shading.
    energy = np.sqrt(gaussian_filter(band*band, 1.3, mode='reflect') + .01)
    energy -= gaussian_filter(energy, 40, mode='reflect')
    fields = np.stack([standard(chroma), standard(energy)], -1)
    out = np.zeros((N, N, 2), np.float32)
    weights = np.zeros((N, N), np.float32)
    weights2 = np.zeros_like(weights)
    size, step = 512, 256
    w = np.sin(np.pi*(np.arange(size)+.5)/size)**2
    window = (w[:, None]*w[None, :]).astype(np.float32)
    placements = []
    for cy in range(0, N, step):
        for cx in range(0, N, step):
            sy, sx = rng.integers(24, src.shape[0]-size-24, size=2)
            flipx, flipy = rng.integers(0, 2, size=2)
            patch = fields[sy:sy+size, sx:sx+size]
            if flipx: patch = patch[:, ::-1]
            if flipy: patch = patch[::-1]
            yy = (np.arange(size)+cy-size//2) % N
            xx = (np.arange(size)+cx-size//2) % N
            out[np.ix_(yy, xx)] += patch*window[:, :, None]
            weights[np.ix_(yy, xx)] += window
            weights2[np.ix_(yy, xx)] += window*window
            placements.append([int(cx), int(cy), int(sx), int(sy), int(flipx), int(flipy)])
    # Keep texture variance constant across overlap zones.
    out /= np.sqrt(weights2)[:, :, None]
    return standard(out[:, :, 0]), standard(out[:, :, 1]), placements


def hammer_surface(rng):
    """Overlapping compact elliptical hammer bowls, all widths 5–20 mm.

    Each footprint is orientation-random and subpixel positioned. Later blows
    partly overprint earlier depressions. End points are wrapped, not copied.
    """
    count = 130000
    field = np.zeros((N, N), np.float32)
    accum = np.zeros_like(field)
    diameters = rng.uniform(5, 20, count)
    depths = rng.uniform(.13, .48, count)
    for diameter, depth in zip(diameters, depths):
        cx, cy = rng.uniform(0, N, 2)
        radius = diameter/TILE_MM*N/2
        aspect = rng.uniform(max(.78, 5/diameter), 1.0)
        theta = rng.uniform(0, np.pi)
        reach = int(np.ceil(radius+1))
        x = np.arange(int(cx)-reach, int(cx)+reach+1)
        y = np.arange(int(cy)-reach, int(cy)+reach+1)
        dx, dy = x[None, :]-cx, y[:, None]-cy
        u = (dx*np.cos(theta)+dy*np.sin(theta))/radius
        v = (-dx*np.sin(theta)+dy*np.cos(theta))/(radius*aspect)
        bowl = depth*np.maximum(1-u*u-v*v, 0)**1.55
        ix = np.ix_(y % N, x % N)
        field[ix] = np.maximum(field[ix], bowl)
        accum[ix] += bowl
    h = -.82*field-.18*np.minimum(accum, .65)
    return blur(h, .35), {'count': count, 'major_diameter_mm_min': float(diameters.min()),
                         'major_diameter_mm_max': float(diameters.max()),
                         'depth_mm_min': float(depths.min()), 'depth_mm_max': float(depths.max())}


def export_rgb(name, a, srgb=False):
    im = Image.fromarray(np.rint(np.clip(a, 0, 255)).astype(np.uint8))
    kwargs = {}
    if srgb:
        kwargs['icc_profile'] = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    im.save(ROOT/name, **kwargs)


def main():
    start = time.perf_counter()
    rng = np.random.default_rng(SEED)
    print('Quilting oxidation and source texture energy...', flush=True)
    oxidation, energy, placements = quilt_source(rng)
    print('Authoring 130,000 native-scale hammer impressions...', flush=True)
    hammer, hammer_info = hammer_surface(rng)
    fine = noise(rng, .65)
    grain = noise(rng, (0.65, 11.0))
    longgrain = noise(rng, (1.15, 34.0))
    meso = noise(rng, 8)
    weather = noise(rng, 26)
    polish_field = .65*noise(rng, 17)+.35*noise(rng, 48)
    polish = smooth((polish_field-.4)/1.6)
    # Shared scale flecks: roughly 1–4 mm, thin and irregular.
    scale_score = .7*noise(rng, .95)+.3*energy
    scale = smooth((scale_score-1.1)/1.1)
    # Rust reaches exactly 18% support before the smooth edge threshold.
    # Keep the field local; there are no large distinctive corrosion islands.
    rust_score = .66*oxidation+.23*meso+.11*weather
    rust_score = .78*rust_score+.22*blur(rust_score, 2)
    lo, hi = np.quantile(rust_score, [.82, .9775])
    rust = smooth((rust_score-lo)/(hi-lo)).astype(np.float32)
    # Sparse native pits collect oxide and have real geometric depressions.
    pit_impulses = np.zeros((N, N), np.float32)
    for sigma, count in [(.55, 19000), (1.0, 9500), (1.8, 2500)]:
        impulses = np.zeros((N, N), np.float32)
        yy, xx = rng.integers(0, N, (2, count))
        np.add.at(impulses, (yy, xx), rng.uniform(.4, 1, count))
        pit_impulses += blur(impulses, sigma)*(2*np.pi*sigma*sigma)
    pits = np.clip(pit_impulses, 0, 1)
    rust *= (.9+.1*smooth((fine+1.5)/3))
    orange = smooth((fine+.35*energy-1.05)/1.6)*rust**1.5
    # Millimetres: never auto-normalize the relief to the available 3 mm range.
    h_mm = (1.65 + hammer + .025*meso + .018*weather
            + .009*grain + .004*longgrain + .006*fine
            + .034*scale - pits*(.055+.11*rust)
            - .065*rust + .014*rust*fine)
    h16 = np.rint(np.clip(h_mm/RANGE_MM, 0, 1)*65535).astype(np.uint16)
    Image.fromarray(h16).save(ROOT/'iron_height.png')
    # Read back the delivered, quantized height. +Y in tangent space is image-up.
    h = np.asarray(Image.open(ROOT/'iron_height.png'), dtype=np.float64)*RANGE_MM/65535
    pitch = TILE_MM/N
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))/(2*pitch)
    dy = (np.roll(h, -1, 0)-np.roll(h, 1, 0))/(2*pitch)
    normal = np.stack([-dx, dy, np.ones_like(h)], -1)
    normal /= np.linalg.norm(normal, axis=2)[:, :, None]
    export_rgb('iron_normal.png', (normal*.5+.5)*255)
    # Reflectance from material state. No height-to-light multiplication.
    iron_tone = 1.4*meso+.8*weather+.65*energy+.65*grain+.35*longgrain+.45*fine
    iron_tone += 1.0*polish-2.5*scale-.65*pits
    base = np.array([41.0, 40.5, 40.0], np.float32) + iron_tone[:, :, None]
    dark_rust = np.array([49.0, 31.0, 20.0], np.float32)
    rust_color = dark_rust + (1.7*energy+1.1*fine)[:, :, None]
    rust_color += orange[:, :, None]*np.array([32, 15, 3], np.float32)
    rust_color -= pits[:, :, None]*np.array([8, 5, 2], np.float32)
    base = base*(1-rust[:, :, None])+rust_color*rust[:, :, None]
    base += np.array([44, 41, 39], np.float64)-base.mean((0, 1), dtype=np.float64)
    export_rgb('iron_base.png', base, srgb=True)
    # All rust, polishing and scale signals align exactly with colour and height.
    rough_plain = np.clip(.61+.012*meso+.018*scale+.009*fine, .545, .665)
    rough_polished = np.clip(.42+.010*meso+.010*fine, .38, .455)
    rough_iron = rough_plain*(1-polish)+rough_polished*polish
    rough_rust = np.clip(.87+.035*fine+.02*energy, .80, .98)
    rust_rough_mix = smooth(rust/.8)
    rough = rough_iron*(1-rust_rough_mix)+rough_rust*rust_rough_mix
    metal = 1-.94*rust
    cavity = np.maximum(blur(h_mm, 2.3)-h_mm, 0)
    ao = np.clip(1-.17*cavity-.018*pits-.009*rust, .92, 1)
    export_rgb('iron_orm.png', np.stack([ao, rough, metal], -1)*255)
    np.savez_compressed(ROOT/'surface_fields.npz', rust=rust, polish=polish,
                        scale=scale, pits=pits, hammer_mm=hammer,
                        grain=grain, roughness=rough, metalness=metal, ao=ao)
    info = {'seed': SEED, 'size': N, 'tile_mm': TILE_MM,
            'height_full_range_mm': RANGE_MM, 'pixel_pitch_mm': pitch,
            'source': 'source/generated_iron_01.png', 'source_size': [1254, 1254],
            'source_sha256': hashlib.sha256((ROOT/'source/generated_iron_01.png').read_bytes()).hexdigest(),
            'source_patch_placements': placements, 'hammer': hammer_info,
            'new_detail': '130000 compact hammer bowls, pits, scale, horizontal fibres and fine grain at 2048; source chroma/energy quilted, not enlarged',
            'build_seconds': time.perf_counter()-start}
    (ROOT/'build_info.json').write_text(json.dumps(info, indent=2)+'\n')
    print(f'Built four maps in {info["build_seconds"]:.1f}s.', flush=True)


if __name__ == '__main__':
    main()
