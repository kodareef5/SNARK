#!/usr/bin/env python3
"""Export round-two image-tool paintings to the existing texture contract.

The generated paintings supply all shape, barbs, splits and alpha. This script
fits the padded card, separates painted shaft/tip colors into exact dye IDs,
neutralizes albedo, and builds previews. Flight and tail are read only.
Dependencies: Pillow, NumPy, SciPy. No image API calls on rebuild.
"""
from pathlib import Path
import hashlib
import json

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.interpolate import PchipInterpolator

import build_feathers as old

ROOT = Path(__file__).resolve().parent
UPDATED = ('contour', 'contour_plain', 'down')
BACKGROUNDS = (('MID GREY', '#808080'), ('SAND', '#c9b48a'),
               ('GRASS / LIGHT', '#7f8f70'), ('GRASS / DARK', '#68755c'))
UNCHANGED = {
    'flight.png': 'ce6a65162aa5736e9ed7bda199152c34f517b3fe11cab3eb954bae9489629190',
    'flight_regions.png': '93f646fb540e5ba4cf802dc5bceff950fd40998c9f1a743c71f584d7294980f4',
    'tail.png': '7dd9621505f950faf9ab96c62b290dc207ffd8775f47ba85770536702d8b43d6',
    'tail_regions.png': '4756839a33eb06e8ff558d9c40455c37113a1ceb1d55cf0e72ec634de3296aa7',
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean_alpha(src):
    a = src[..., 3].astype(float)
    labels, _ = ndi.label(a >= 8)
    counts = np.bincount(labels.ravel())
    counts[0] = 0
    attached = counts[labels] >= 80
    near = ndi.distance_transform_edt(~attached) <= 2
    a[(~near) | (a < 4)] = 0
    a = np.minimum(a * 255 / 253, 255)
    a[a >= 250] = 255
    return a


def shaft_mask(name, lum, alpha):
    """Locate the existing painted pale rachis within a guided corridor."""
    h, w = lum.shape
    yy, xx = np.mgrid[:h, :w]
    if name == 'down':
        # Only the actual exposed quill, detected from the narrow bottom rows.
        spans = np.zeros(h)
        for y in range(h * 3 // 4, h):
            xs = np.flatnonzero(alpha[y] >= 24)
            if xs.size:
                spans[y] = xs[-1] - xs[0] + 1
        broad = np.flatnonzero(spans > 32)
        return (yy > broad[-1]) & (alpha > 0)
    guides = {
        'contour': [(135, 741), (200, 705), (300, 656), (400, 627),
                    (500, 599), (600, 589), (700, 588), (800, 591),
                    (1000, 593), (1160, 595)],
        'contour_plain': [(80, 500), (120, 541), (200, 600), (300, 640),
                         (400, 657), (500, 664), (600, 657), (700, 642),
                         (800, 629), (1000, 622), (1160, 625)]
    }
    points = np.array(guides[name], dtype=float)
    points *= h / 1254
    center = PchipInterpolator(points[:, 0], points[:, 1])(np.arange(h))
    contrast = ndi.gaussian_filter(lum, 1) - ndi.gaussian_filter(lum, 13)
    start, end = int(points[0, 0]), int(points[-1, 0])
    for y in range(start, min(end + 1, h)):
        expected = center[y]
        l, r = max(0, int(expected - 16)), min(w, int(expected + 17))
        scores = contrast[y, l:r] - .018 * (np.arange(l, r) - expected) ** 2
        center[y] = l + int(scores.argmax())
    center = ndi.gaussian_filter1d(center, 4)
    distance = abs(xx - center[:, None])
    ridge = (contrast > 5) & (lum > 134) & (distance < 15)
    # Paint-derived width; do not create a separate straight stripe.
    ridge &= yy >= start
    ridge &= yy <= end
    ridge &= alpha > 0
    ridge = ndi.binary_fill_holes(ridge)
    return ridge


def export(name, source):
    src = np.array(Image.open(source).convert('RGBA'))
    alpha = clean_alpha(src)
    colors = src[..., :3].astype(float)
    lum = (colors * np.array([.2126, .7152, .0722])).sum(axis=2)
    nearest = ndi.distance_transform_edt(alpha < 32, return_distances=False,
                                        return_indices=True)
    lum = np.where(alpha >= 32, lum, lum[tuple(nearest)])
    shaft = shaft_mask(name, lum, alpha)
    ids = np.empty(src.shape[:2] + (3,), np.uint8)
    ids[:] = old.MAGENTA if name == 'down' else old.RED
    cream = np.zeros(alpha.shape, bool)
    if name == 'contour':
        # The generated painting contains individual interleaved cream barb
        # tips. Their chroma supplies the boundary, rather than a geometric cap.
        warmth = colors[..., 0] - colors[..., 2]
        cream = (warmth >= 10) & (lum > 132)
        cream &= np.indices(alpha.shape)[0] < alpha.shape[0] * .31
        cream = ndi.binary_fill_holes(cream)
        ids[cream] = old.YELLOW
    ids[shaft] = old.BLACK

    valid_body = (alpha > 220) & (~cream) & (~shaft)
    if not valid_body.any():
        valid_body = alpha > 100
    median = np.median(lum[valid_body])
    broad = ndi.gaussian_filter(lum, 16)
    # Neutral light-grey dyeable albedo with useful local barb contrast.
    gray = np.clip(230 + 1.2 * (lum - broad) + .55 * (broad - median), 173, 248)
    if cream.any():
        gray[cream] = np.clip(234 + .7 * (lum[cream] - np.median(lum[cream])), 196, 248)
    # Undyed rachis is grey, with a restrained painted highlight.
    gray[shaft] = np.clip(161 + .45 * (lum[shaft] - np.median(lum[shaft])), 141, 179)

    ys, xs = np.nonzero(alpha > 0)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    a = alpha[y0:y1, x0:x1] / 255
    g = gray[y0:y1, x0:x1]
    labels = ids[y0:y1, x0:x1]
    scale = 896 / max(a.shape)
    size = (round(a.shape[1] * scale), round(a.shape[0] * scale))

    def resample(values):
        return np.array(Image.fromarray(values.astype(np.float32)).resize(size, Image.Resampling.LANCZOS))

    fitted_a = np.clip(resample(a), 0, 1)
    fitted_g = np.clip(resample(g * a) / np.maximum(fitted_a, 1e-6), 0, 255)
    fitted_ids = np.array(Image.fromarray(labels).resize(size, Image.Resampling.NEAREST))
    base = np.full((1024, 1024, 4), 230, np.uint8)
    base[..., 3] = 0
    regions = base.copy()
    left, top = (1024 - size[0]) // 2, (1024 - size[1]) // 2
    area = np.s_[top:top + size[1], left:left + size[0]]
    base[area][..., :3] = np.rint(fitted_g).astype(np.uint8)[..., None]
    base[area][..., 3] = np.rint(fitted_a * 255).astype(np.uint8)
    base[..., 3][base[..., 3] >= 250] = 255
    regions[area][..., :3] = fitted_ids
    regions[..., 3] = base[..., 3]
    nearest = ndi.distance_transform_edt(base[..., 3] == 0, return_distances=False,
                                        return_indices=True)
    base[..., :3] = base[..., :3][tuple(nearest)]
    regions[..., :3] = regions[..., :3][tuple(nearest)]
    old.save_png(Image.fromarray(base), name + '.png')
    old.save_png(Image.fromarray(regions), name + '_regions.png')
    return base, regions, {'source_bbox': [int(x0), int(y0), int(x1), int(y1)],
                           'source_sha256': sha(source), 'fitted_size': list(size)}


def import_sprite(sprite, size):
    """Emulate the specified 128px import followed by a smaller screen card."""
    at128 = old.resize_rgba(sprite, (128, 128))
    return at128 if size == 128 else old.resize_rgba(at128, (size, size))


def game_preview(dyed):
    sheet = Image.new('RGBA', (1280, 1420), '#20262c')
    d = ImageDraw.Draw(sheet)
    d.text((24, 16), 'DODO / ROUND 2 / GAME-SIZE CHECK', font=old.font(27), fill='#f2f0e9')
    d.text((24, 55), 'Native pixels. 1024 source → 128px import → 32px screen card. Default dyes, unlit.',
           font=old.font(17), fill='#c6c9cb')
    for row, (title, bg) in enumerate(BACKGROUNDS):
        top = 90 + row * 330
        d.rectangle((16, top, 1264, top + 318), fill=bg)
        d.text((28, top + 12), title, font=old.font(17), fill='#161b1c')
        for i, name in enumerate(old.NAMES):
            left = 160 + i * 220
            d.text((left, top + 12), name, font=old.font(17), fill='#161b1c')
            sheet.alpha_composite(import_sprite(dyed[name], 128), (left, top + 40))
            tiny = import_sprite(dyed[name], 32)
            sheet.alpha_composite(tiny, (left + 48, top + 184))
            rotated = tiny.rotate(61, Image.Resampling.BICUBIC, expand=True)
            sheet.alpha_composite(rotated, (left + 5, top + 238))
            flipped = tiny.transpose(Image.Transpose.FLIP_LEFT_RIGHT).rotate(-28, Image.Resampling.BICUBIC, expand=True)
            sheet.alpha_composite(flipped, (left + 80, top + 238))
            sheet.alpha_composite(import_sprite(dyed[name], 8), (left + 158, top + 195))
        for text, y in (('128px', 96), ('32px / 8px', 191), ('32px rotated', 247)):
            d.text((28, top + y), text, font=old.font(14), fill='#161b1c')
    old.save_png(sheet, 'preview_game.png')


def comparison(dyed):
    sheet = Image.new('RGBA', (1060, 630), '#20262c')
    d = ImageDraw.Draw(sheet)
    d.text((20, 16), 'ROUND 1 → ROUND 2 / actual 32px cards', font=old.font(24), fill='white')
    for row, bg in enumerate(('#7f8f70', '#c9b48a')):
        top = 64 + row * 280
        d.rectangle((12, top, 1048, top + 268), fill=bg)
        for i, name in enumerate(UPDATED):
            left = 46 + i * 340
            d.text((left, top + 10), name, font=old.font(20), fill='#171c21')
            previous = old.dye(np.array(Image.open(ROOT / 'sources/round1' / (name + '.png'))),
                               np.array(Image.open(ROOT / 'sources/round1' / (name + '_regions.png'))))
            for col, (label, sprite) in enumerate((('round 1', previous), ('round 2', dyed[name]))):
                x = left + col * 150
                d.text((x, top + 42), label, font=old.font(16), fill='#171c21')
                sheet.alpha_composite(import_sprite(sprite, 128), (x, top + 65))
                tiny = import_sprite(sprite, 32)
                sheet.alpha_composite(tiny, (x + 45, top + 211))
    old.save_png(sheet, 'preview_round2_comparison.png')


def main():
    for filename, digest in UNCHANGED.items():
        assert sha(ROOT / filename) == digest, filename
    manifest = json.loads((ROOT / 'generation_prompts_round2.json').read_text())
    assets, dyed, measurements = {}, {}, {}
    for name in old.NAMES:
        if name in UPDATED:
            base, regions, metrics = export(name, ROOT / manifest[name]['local_source'])
        else:
            base = np.array(Image.open(ROOT / (name + '.png')))
            regions = np.array(Image.open(ROOT / (name + '_regions.png')))
            metrics = {'unchanged_from_round1': True}
        assets[name] = base, regions
        dyed[name] = old.dye(base, regions)
        measurements[name] = {**old.validate(name, base, regions), **metrics}
        print(name, measurements[name]['alpha_bbox'], measurements[name]['opaque_pixels'],
              measurements[name]['partial_coverage_pixels'])
    old.full_preview(dyed)
    game_preview(dyed)
    comparison(dyed)
    old.alternate_preview(assets)
    (ROOT / 'validation.json').write_text(json.dumps(measurements, indent=2) + '\n')
    for filename, digest in UNCHANGED.items():
        assert sha(ROOT / filename) == digest, filename
    print('Wrote six revised textures and four previews; flight/tail hashes unchanged.')


if __name__ == '__main__':
    main()
