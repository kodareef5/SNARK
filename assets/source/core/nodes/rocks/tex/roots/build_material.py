#!/usr/bin/env python3
"""Rebuild the fig-root material from its archived image-tool source.

No network, external tools or model calls. Requires Pillow, NumPy, SciPy.
All spatial filters and authored details use a toroidal domain.
"""
from pathlib import Path
import hashlib
import json
import struct
import time

import numpy as np
from PIL import Image, ImageCms, PngImagePlugin
from scipy.ndimage import gaussian_filter, grey_closing

ROOT = Path(__file__).resolve().parent
N = 2048
TILE_MM = 750.0
HEIGHT_MM = 10.0
SEED = 231114
TARGET = np.array([146., 134., 116.], dtype=np.float32)


def blur(a, s):
    return gaussian_filter(a, s if a.ndim == 2 else (s, s, 0), mode='wrap')


def noise(rng, sigma):
    a = blur(rng.standard_normal((N, N), dtype=np.float32), sigma)
    return (a / max(float(a.std()), 1e-8)).astype(np.float32)


def cut_path(cost):
    """Minimum-error top-to-bottom seam, with small curvature penalty."""
    h, w = cost.shape
    acc = cost[0].copy()
    steps = np.zeros((h, w), np.int8)
    cols = np.arange(w)
    for y in range(1, h):
        opts = np.stack([np.r_[np.inf, acc[:-1]] + .12,
                         acc, np.r_[acc[1:], np.inf] + .12])
        k = opts.argmin(axis=0)
        steps[y] = k - 1
        acc = cost[y] + opts[k, cols]
    path = np.zeros(h, np.int32)
    path[-1] = int(acc.argmin())
    for y in range(h - 1, 0, -1):
        path[y-1] = path[y] + steps[y, path[y]]
    return path


def quilt(source, rng):
    """Full-resolution rotated patches; four minimum-error seams per patch.

    Patches wrap over the output boundary. Their 576-pixel guaranteed cores
    overlap on a 512-pixel grid, replacing every initialization pixel.
    """
    p, rim = 864, 144
    # Initialization is completely replaced; use a quiet source-coloured field.
    canvas = np.broadcast_to(source.mean((0, 1)), (N, N, 3)).copy()
    covered = np.zeros((N, N), bool)
    transforms = []
    order = [(j, i) for j in range(4) for i in range(4)]
    yy, xx = np.mgrid[:p, :p]
    perimeter = (xx < rim) | (xx >= p-rim) | (yy < rim) | (yy >= p-rim)
    for j, i in order:
        k = (i + j*3) % 4
        src = np.rot90(source, k)
        oy, ox = j*512 - p//2, i*512 - p//2
        yi, xi = (np.arange(p)+oy) % N, (np.arange(p)+ox) % N
        old = canvas[yi[:, None], xi[None, :]]
        known = covered[yi[:, None], xi[None, :]]
        best = None
        for _ in range(14):
            sy, sx = rng.integers(0, N-p, 2)
            patch = src[sy:sy+p, sx:sx+p]
            # Smooth colour match guides patch selection; the cut uses detail too.
            delta = ((patch[::8, ::8] - old[::8, ::8])**2).mean(2)
            valid = (known & perimeter)[::8, ::8]
            score = float(delta[valid].mean()) if valid.any() else 0.
            if best is None or score < best[0]:
                best = (score, int(sy), int(sx), patch.copy())
        _, sy, sx, patch = best
        cost = blur(((patch-old)**2).mean(2), 1.0) + 0.1
        cost[~known] *= .02
        left = cut_path(cost[:, :rim])
        right = p-rim + cut_path(cost[:, p-rim:])
        top = cut_path(cost[:rim, :].T)
        bottom = p-rim + cut_path(cost[p-rim:, :].T)
        mask = ((xx >= left[:, None]) & (xx <= right[:, None]) &
                (yy >= top[None, :]) & (yy <= bottom[None, :]))
        # Narrow feather, not a broad crossfade of doubled bark features.
        alpha = gaussian_filter(mask.astype(np.float32), 2.0, mode='constant')
        canvas[yi[:, None], xi[None, :]] = old*(1-alpha[..., None]) + patch*alpha[..., None]
        covered[yi[:, None], xi[None, :]] |= mask
        transforms.append(dict(grid=[i, j], rotation_degrees=k*90,
                               source_xy=[sx, sy], size=p, seam_band=rim))
    assert covered.all(), 'Quilt left initialization uncovered'
    return canvas, transforms


def stamp_ellipse(field, cx, cy, length, width, angle, strength):
    r = int(np.ceil(length*2 + width*2 + 4))
    x0, y0 = int(cx)-r, int(cy)-r
    y, x = np.mgrid[y0:y0+2*r+1, x0:x0+2*r+1]
    dx, dy = x-cx, y-cy
    u = dx*np.cos(angle) + dy*np.sin(angle)
    v = -dx*np.sin(angle) + dy*np.cos(angle)
    a = strength*np.exp(-.5*((u/length)**4 + (v/width)**2))
    field[y % N, x % N] += a.astype(np.float32)


def hairline(field, rng, cx, cy, angle):
    """A short, tapered, bent superficial split, sampled on the periodic tile."""
    length = rng.uniform(28, 75)
    half = int(length*.7+10)
    y, x = np.mgrid[-half:half+1, -half:half+1]
    u = x*np.cos(angle)+y*np.sin(angle)
    v = -x*np.sin(angle)+y*np.cos(angle)
    bend = 1.7*np.sin(u/length*6) + .8*np.sin(u/length*17)
    taper = np.maximum(1-(u/(length*.5))**2, 0)**.7
    cut = rng.uniform(.15, .29)*np.exp(-.5*((v-bend)/.8)**2)*taper
    field[(y+int(cy)) % N, (x+int(cx)) % N] += cut.astype(np.float32)


def png(path, a, role, srgb=False):
    meta = PngImagePlugin.PngInfo()
    meta.add_text('Description', role)
    meta.add_text('TileSizeMetres', '0.75 x 0.75')
    if srgb:
        # iCCP identifies sRGB; PNG should not carry a second sRGB chunk too.
        profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
        profile[24:36] = struct.pack('>6H', 2026, 1, 1, 0, 0, 0)
        profile = bytes(profile)  # Stable creation date makes rebuilds byte-identical.
        Image.fromarray(a).save(path, pnginfo=meta, icc_profile=profile)
    else:
        # gAMA=1 explicitly declares data channels linear.
        meta.add(b'gAMA', (100000).to_bytes(4, 'big'))
        Image.fromarray(a).save(path, pnginfo=meta)


def main():
    start = time.time()
    rng = np.random.default_rng(SEED)
    original = Image.open(ROOT/'source/P01_fig_bark.png').convert('RGB')
    src = np.asarray(original.resize((N, N), Image.Resampling.LANCZOS), dtype=np.float32)
    # Remove all source gradients above about 7 cm before patch matching.
    src = src - gaussian_filter(src, (180, 180, 0), mode='reflect') + TARGET
    sample, transforms = quilt(src, rng)
    lum = sample[..., 0]*.2126 + sample[..., 1]*.7152 + sample[..., 2]*.0722
    # Dark narrow valleys are shape; broad scuff/lichen pigmentation is not.
    smooth = blur(lum, 1.05)
    valleys = np.maximum(grey_closing(smooth, size=(19, 19), mode='wrap') - smooth - 2.0, 0)
    valleys = blur(valleys, .85)
    crease = np.clip(valleys / 22., 0, 1.5)
    gx = (np.roll(smooth, -1, 1)-np.roll(smooth, 1, 1))*.5
    gy = (np.roll(smooth, -1, 0)-np.roll(smooth, 1, 0))*.5
    jxx, jyy, jxy = blur(gx*gx, 9), blur(gy*gy, 9), blur(gx*gy, 9)
    coherence = np.sqrt((jxx-jyy)**2 + 4*jxy*jxy)/(jxx+jyy+1e-5)
    crease *= .38 + .62*np.clip(coherence*1.7, 0, 1)
    transverse = .5*np.arctan2(2*jxy, jxx-jyy)
    scuff = blur(lum, 9) - blur(lum, 85)
    scuff = np.tanh(scuff/8.)
    pale = np.clip((blur(lum, 3.5)-blur(lum, 38)-.75)/9., 0, 1)
    pale = blur(pale, 1.2)
    mottling = np.tanh((blur(lum, 30)-blur(lum, 145))/7.)
    # Faint, slightly raised lichen is sparse and irregular, never a stone pit.
    colony = .75*noise(rng, 22) + .25*noise(rng, 5)
    lichen = np.clip((colony - 1.65)/1.0, 0, 1)
    lichen *= np.clip(.65 + .25*noise(rng, 1.2), .05, 1.)
    lichen = blur(lichen, .65)

    # Native 2048 relief: submillimetre skin, pores, and short lenticel dashes.
    fine = .010*noise(rng, .65) + .017*noise(rng, 1.6) + .016*noise(rng, 3.3)
    lenticel = np.zeros((N, N), np.float32)
    lenticel_core = np.zeros_like(lenticel)
    for _ in range(460):
        cx, cy = rng.uniform(0, N, 2)
        random_angle = rng.uniform(0, 2*np.pi)
        angle = float(transverse[int(cy), int(cx)]) + rng.uniform(-.28, .28)
        if coherence[int(cy), int(cx)] < .12:
            angle = random_angle
        length, width = rng.uniform(2.2, 8.5), rng.uniform(.65, 1.4)
        amp = rng.uniform(.055, .15)
        stamp_ellipse(lenticel, cx, cy, length, width, angle, amp)
        stamp_ellipse(lenticel_core, cx, cy, length*.72, width*.4, angle, amp*.7)
    pores = np.maximum(noise(rng, .65) - 2.0, 0)
    pores = blur(pores, .45)
    cracks = np.zeros_like(lenticel)
    for _ in range(11):
        cx, cy = rng.uniform(0, N, 2)
        angle = float(transverse[int(cy), int(cx)]) + np.pi*.5
        hairline(cracks, rng, cx, cy, angle)
    # Wrinkle volume is intentionally shallow: smooth living fig skin.
    height = 5.0 - .43*crease + .07*np.tanh((blur(lum, 5)-blur(lum, 22))/9.)
    height += fine + lenticel - lenticel_core - .025*pores + .045*lichen - cracks
    height = blur(height, .48).astype(np.float32)
    height16 = np.rint(np.clip(height/HEIGHT_MM, 0, 1)*65535).astype(np.uint16)
    png(ROOT/'bark_height.png', height16,
        'Linear height; white high; 10 mm black-to-white; neutral surface near 5 mm.')

    # Albedo uses pigment and symmetric crease grime, never slopes or lighting.
    chroma = sample - lum[..., None]
    chroma -= blur(chroma, 110)
    colour = np.broadcast_to(TARGET, (N, N, 3)).copy()
    colour += .5*blur(chroma, 4)
    colour += (12.0*scuff + 4.2*mottling - 12.*crease)[..., None]
    colour += pale[..., None]*np.array([10., 11., 13.], np.float32)
    colour += lichen[..., None]*np.array([-11., -1., -5.], np.float32)
    colour += (lenticel/0.15)[..., None]*np.array([14., 14., 13.], np.float32)
    colour -= (lenticel_core/.105)[..., None]*7.0
    colour -= cracks[..., None]*24.
    colour += (fine/.03)[..., None]*.65
    colour -= pores[..., None]*1.2
    # Keep the delivered mean on the authored swatch, not the lit reference.
    colour += TARGET - colour.mean((0, 1), dtype=np.float64)
    base = np.rint(np.clip(colour, 0, 255)).astype(np.uint8)
    png(ROOT/'bark_base.png', base, 'Unlit fig-root bark albedo, sRGB.', srgb=True)

    rough = .687 + .028*scuff + .030*crease + .07*lichen
    rough += .007*noise(rng, 2.2) - .020*lenticel/.15 + .008*pores + cracks*.12
    rough = np.clip(rough, .55, .85)
    png(ROOT/'bark_rough.png', np.rint(rough*255).astype(np.uint8),
        'Linear perceptual roughness, grayscale; no metallic component.')

    # Re-open the delivered uint16 file. Normal derives from those exact samples.
    h = np.asarray(Image.open(ROOT/'bark_height.png'), dtype=np.float64)*(HEIGHT_MM/65535)
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))/(2*TILE_MM/N)
    dy = (np.roll(h, -1, 0)-np.roll(h, 1, 0))/(2*TILE_MM/N)
    normal = np.stack([-dx, dy, np.ones_like(h)], -1)
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    png(ROOT/'bark_normal.png', np.rint((normal*.5+.5)*255).astype(np.uint8),
        'Linear OpenGL tangent normal: +X right, +Y up, +Z out. From saved height.')

    metadata = dict(seed=SEED, size=[N, N], tile_mm=TILE_MM, height_range_mm=HEIGHT_MM,
                    pixel_pitch_mm=TILE_MM/N, source_size=list(original.size),
                    source_sha256=hashlib.sha256((ROOT/'source/P01_fig_bark.png').read_bytes()).hexdigest(),
                    patches=transforms, lichen_coverage_gt_0_1=float((lichen>.1).mean()),
                    native_lenticel_count=460, native_shallow_crack_count=11,
                    native_skin_relief_rms_mm=float(fine.std()),
                    build_seconds=round(time.time()-start, 2))
    (ROOT/'build_metadata.json').write_text(json.dumps(metadata, indent=2)+'\n')
    print(f'Built four maps in {time.time()-start:.1f}s; mean RGB {base.mean((0,1))}.')


if __name__ == '__main__':
    main()
