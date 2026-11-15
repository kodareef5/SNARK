#!/usr/bin/env python3
"""Finish the generated artwork into deterministic, tintable RGBA VFX sprites.

Requirements: Python 3, Pillow, NumPy, SciPy. Run from any directory.
The untouched built-in imagegen output and full prompts are retained locally.
"""
from pathlib import Path
import json
import math
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, label, find_objects

ROOT = Path(__file__).resolve().parent
N = 1024
Y, X = np.mgrid[:N, :N].astype(np.float32)
X = (X - (N - 1) / 2) / (N / 2)
Y = (Y - (N - 1) / 2) / (N / 2)
R = np.hypot(X, Y)


def smoothstep(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def noise(rng, cells):
    """Bicubic value noise; normalized, reproducible, no repeating tiles."""
    a = rng.normal(size=(cells, cells)).astype(np.float32)
    a = np.asarray(Image.fromarray(a).resize((N, N), Image.Resampling.BICUBIC))
    a = (a - a.mean()) / max(a.std(), 1e-6)
    return np.clip(a, -2.5, 2.5)


def source(name):
    return Image.open(ROOT / 'source_art' / f'{name}.png').convert('RGBA')


def luminance(a):
    return np.dot(a[..., :3], [0.2126, 0.7152, 0.0722]) / 255


def save(name, gray, alpha):
    """Straight alpha, neutral RGB including invisible texels (no black fringe)."""
    gray = np.broadcast_to(gray, (N, N))
    alpha = np.clip(np.rint(alpha * 255), 0, 255).astype(np.uint8)
    rgb = np.clip(np.rint(gray * 255), 0, 255).astype(np.uint8)
    rgba = np.empty((N, N, 4), dtype=np.uint8)
    rgba[..., :3] = rgb[..., None]
    rgba[..., 3] = alpha
    Image.fromarray(rgba).save(ROOT / f'{name}.png', optimize=True)


def dust(index):
    rng = np.random.default_rng(6400 + index * 197)
    im = source(f'dust_{index}').resize((N, N), Image.Resampling.LANCZOS)
    src = np.asarray(im).astype(np.float32)
    src_alpha = src[..., 3] / 255
    src_lum = luminance(src)
    # Generated broad folds inform the opacity, without retaining an opaque shell.
    den = gaussian_filter(src_alpha, 3)
    lit = gaussian_filter(src_lum * src_alpha, 3) / np.maximum(den, 1e-4)
    lit = np.where(den > .05, lit, .85)
    art_detail = np.clip((lit - gaussian_filter(lit, 32)) * 4, -.4, .4)
    art_detail *= smoothstep(.65, .95, den)
    art_detail = gaussian_filter(art_detail, 3)

    coarse = noise(rng, 7)
    medium = noise(rng, 15)
    fine = noise(rng, 38)
    micro = noise(rng, 92)
    wx = X + .075 * noise(rng, 9) + .015 * noise(rng, 27)
    wy = Y + .075 * noise(rng, 9) + .015 * noise(rng, 27)
    # Several shallow asymmetric density lobes, not a sphere or uniform blur.
    angles = np.linspace(0, 2 * np.pi, 6, endpoint=False) + rng.uniform(-.35, .35, 6)
    lobes = [(0, 0, .34, .31, .77)]
    for angle in angles:
        radius = rng.uniform(.24, .39)
        lobes.append((radius * np.cos(angle), radius * np.sin(angle),
                      rng.uniform(.18, .29), rng.uniform(.18, .29), rng.uniform(.43, .8)))
    mass = np.zeros_like(X)
    for cx, cy, sx, sy, amp in lobes:
        mass += amp * np.exp(-1.7 * (((wx - cx) / sx)**2 + ((wy - cy) / sy)**2))
    mass *= np.exp(.26 * coarse + .23 * medium + .095 * fine + .026 * micro)
    mass *= np.clip(1 + art_detail * .5, .65, 1.3)
    # Torn, non-circular outer wisps fade out before a generous guaranteed margin.
    radius = np.hypot(wx, wy)
    envelope = 1 - smoothstep(.55, .87, radius)
    margin = 1 - smoothstep(.74, .84, R)
    mass *= envelope * margin
    strengths = [1.22, 1.13, 1.28, .96]
    alpha = .84 * (1 - np.exp(-mass * strengths[index - 1]))
    alpha = gaussian_filter(alpha, .75)
    alpha *= 1 - smoothstep(.81, .85, R)
    alpha[alpha < .5 / 255] = 0
    # Light, neutral albedo: tiny fold modulation and restrained top lighting.
    gray = np.clip(.899 - .025 * Y + .020 * art_detail + .008 * fine, .84, .965)
    save(f'dust_{index}', gray, alpha)


def grit():
    rng = np.random.default_rng(3814)
    im = source('grit')
    a = np.asarray(im)
    labels, count = label(a[..., 3] > 145)
    pieces = []
    for k, slices in enumerate(find_objects(labels), start=1):
        if slices is None:
            continue
        yy, xx = slices
        w, h = xx.stop - xx.start, yy.stop - yy.start
        area = np.sum(labels[slices] == k)
        if 30 <= area <= 2800 and 5 <= w <= 75 and 5 <= h <= 75:
            crop = a[yy.start:yy.stop, xx.start:xx.stop].copy()
            own = labels[slices] == k
            # Suppress transparent haze between grains; retain their actual shapes.
            mask = gaussian_filter(own.astype(float), .45)
            lum = luminance(crop)
            gray = np.clip(.76 + .22 * lum, .76, .98)
            out = np.empty_like(crop)
            out[..., :3] = np.rint(gray[..., None] * 255).astype(np.uint8)
            out[..., 3] = np.rint(mask * 255).astype(np.uint8)
            pieces.append(Image.fromarray(out))
    if len(pieces) < 10:
        raise RuntimeError('Source grain extraction did not produce enough pieces')
    canvas = Image.new('RGBA', (N, N), (230, 230, 230, 0))
    positions = []
    for i in range(145):
        # Isotropic Gaussian concentration, bounded well inside the image.
        for _ in range(1000):
            point = rng.normal(0, 138 if i < 117 else 206, size=2)
            if np.linalg.norm(point) < 375 and all(np.linalg.norm(point-q) > 8 for q in positions):
                break
        positions.append(point)
        size = int(rng.integers(5, 12) if i < 103 else rng.integers(12, 21))
        piece = pieces[int(rng.integers(len(pieces)))].copy()
        piece.thumbnail((size, size), Image.Resampling.LANCZOS)
        piece = piece.rotate(float(rng.uniform(0, 360)), Image.Resampling.BICUBIC, expand=True)
        canvas.alpha_composite(piece, (round(512 + point[0] - piece.width / 2),
                                       round(512 + point[1] - piece.height / 2)))
    a = np.asarray(canvas)
    save('grit', luminance(a), a[..., 3] / 255)


def drop():
    a = np.asarray(source('drop'))
    components, _ = label(a[..., 3] > 190)
    counts = np.bincount(components.ravel())
    counts[0] = 0
    yy, xx = np.where(components == np.argmax(counts))
    box = (xx.min(), yy.min(), xx.max() + 1, yy.max() + 1)
    patch = source('drop').crop(box).resize((686, 686), Image.Resampling.LANCZOS)
    lum = luminance(np.asarray(patch))
    # Keep the painted optical highlight and shading, enforce achromatic pixels.
    gray = np.full((N, N), .90, dtype=np.float32)
    gray[169:855, 169:855] = np.clip(lum, .64, 1)
    alpha = 1 - smoothstep(332, 338, R * 512)
    save('drop', gray, alpha)


def ripple():
    # The generated concept had an unwanted halo. Author only the wave crest.
    theta = np.arctan2(Y, X)
    radius = 377 + .65 * np.sin(3 * theta + .9) + .40 * np.sin(7 * theta)
    d = R * 512 - radius
    width = 3.1 + .22 * np.sin(5 * theta - .4)
    alpha = .79 * np.exp(-.5 * (d / width)**2)
    alpha *= .92 + .06 * np.cos(theta + .9) + .02 * np.sin(3 * theta)
    alpha[np.abs(d) > 12] = 0
    gray = .953 + .015 * np.cos(theta + .8)
    save('ripple', gray, alpha)


def validate():
    names = [f'dust_{i}' for i in range(1, 5)] + ['grit', 'drop', 'ripple']
    report = {}
    for name in names:
        im = Image.open(ROOT / f'{name}.png')
        a = np.asarray(im)
        assert im.mode == 'RGBA' and im.size == (N, N), name
        assert np.array_equal(a[..., 0], a[..., 1]) and np.array_equal(a[..., 1], a[..., 2]), name
        alpha = a[..., 3]
        yy, xx = np.where(alpha > 0)
        margins = [int(xx.min()), int(yy.min()), int(N - 1 - xx.max()), int(N - 1 - yy.max())]
        assert min(margins) >= math.ceil(N * .06), (name, margins)
        cy, cx = [(alpha * v).sum() / alpha.sum() for v in np.mgrid[:N, :N]]
        assert abs(cx - 511.5) < N * .07 and abs(cy - 511.5) < N * .07, (name, cx, cy)
        if name.startswith('dust'):
            assert alpha.max() < 245
        report[name + '.png'] = {
            'size': list(im.size), 'mode': im.mode, 'neutral_rgb': True,
            'clear_margin_px_LTRB': margins,
            'alpha_max': int(alpha.max()),
            'alpha_centroid_xy': [round(float(cx), 2), round(float(cy), 2)],
            'occupied_percent': round(float((alpha > 0).mean() * 100), 2),
            'nonzero_alpha_levels': len(np.unique(alpha[alpha > 0])),
        }
    a = np.asarray(Image.open(ROOT / 'ripple.png'))[..., 3]
    assert not a[R < .70].any() and not a[R > .77].any(), 'Ripple must contain only its crest'
    report['ripple_checks'] = {'interior_clear': True, 'exterior_clear': True, 'single_crest': True}
    (ROOT / 'checks.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    for i in range(1, 5):
        dust(i)
    grit()
    drop()
    ripple()
    validate()
