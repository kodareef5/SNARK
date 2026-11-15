#!/usr/bin/env python3
"""Prepare generated painted feather masters, dye masks, and review sheets.

Run in any directory: python3 /path/to/build_feathers.py
Dependencies: Pillow, NumPy, SciPy. No API calls or generation on rebuild.
The original painted masters and exact generation prompts are kept locally.
"""
from pathlib import Path
import hashlib
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
NAMES = ('contour', 'contour_plain', 'down', 'flight', 'tail')
SIZE = 1024
PAD = 64
RED, MAGENTA, YELLOW, BLACK = (255, 0, 0), (255, 0, 255), (255, 255, 0), (0, 0, 0)
DEFAULT = {RED: '#6b737a', MAGENTA: '#433324', YELLOW: '#e6e2d6', BLACK: '#ffffff'}
BACKGROUNDS = (('MID GREY', '#808080'), ('SAND', '#c9b48a'))


def rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def font(size):
    for path in ('/System/Library/Fonts/Supplemental/Arial.ttf',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def save_png(image, path):
    image.save(ROOT / path, optimize=True)


def resize_rgba(image, size):
    """Resize color in premultiplied space, return straight-alpha RGBA."""
    return image.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')


def prepare_base(source):
    src = np.array(Image.open(source).convert('RGBA'))
    alpha = src[..., 3].astype(np.float32)
    # All useful filaments are attached to one component. Retain the very faint
    # pixels immediately around it; discard remote generator alpha dust.
    components, _ = ndi.label(alpha >= 4)
    counts = np.bincount(components.ravel())
    counts[0] = 0
    main = components == int(counts.argmax())
    near = ndi.distance_transform_edt(~main) <= 2.0
    alpha[(~near) | (alpha < 2)] = 0
    # The generated masters top out at alpha 253, even in the solid vane.
    alpha = np.clip(alpha * (255.0 / 253.0), 0, 255)
    alpha[alpha >= 250] = 255
    covered = alpha > 0
    y, x = np.nonzero(covered)
    bounds = (x.min(), y.min(), x.max() + 1, y.max() + 1)
    x0, y0, x1, y1 = bounds

    lum = (src[..., :3].astype(np.float32) * np.array([.2126, .7152, .0722])).sum(axis=2)
    # Extend the actual painted color into transparent pixels before filtering.
    nearest = ndi.distance_transform_edt(~(alpha >= 128), return_distances=False,
                                         return_indices=True)
    extended = lum[tuple(nearest)]
    lum = np.where(alpha >= 128, lum, extended)
    broad = ndi.gaussian_filter(lum, 28)
    median = float(np.median(lum[alpha == 255]))
    # Preserve fine painted barb structure; reduce broad illumination in albedo.
    gray = np.clip(232.0 + 1.20 * (lum - broad) + .55 * (broad - median), 192, 252)
    gray = gray[y0:y1, x0:x1]
    alpha = alpha[y0:y1, x0:x1] / 255.0
    scale = (SIZE - 2 * PAD) / max(gray.shape)
    width, height = round(gray.shape[1] * scale), round(gray.shape[0] * scale)

    def resize_float(a):
        return np.array(Image.fromarray(a.astype(np.float32)).resize(
            (width, height), Image.Resampling.LANCZOS))

    a = np.clip(resize_float(alpha), 0, 1)
    premul = resize_float(gray * alpha)
    g = np.clip(premul / np.maximum(a, 1e-6), 192, 252)
    a8 = np.rint(a * 255).astype(np.uint8)
    a8[a8 >= 250] = 255
    g8 = np.rint(g).astype(np.uint8)
    output = np.full((SIZE, SIZE, 4), 232, np.uint8)
    output[..., 3] = 0
    left, top = (SIZE - width) // 2, (SIZE - height) // 2
    output[top:top + height, left:left + width, :3] = g8[..., None]
    output[top:top + height, left:left + width, 3] = a8
    # Hidden RGB is edge-dilated, not black, to avoid filtering dark fringes.
    nearest = ndi.distance_transform_edt(output[..., 3] == 0, return_distances=False,
                                         return_indices=True)
    output[..., :3] = output[..., :3][tuple(nearest)]
    return output, {'source_bbox': [int(v) for v in bounds],
                    'source_gray_median': round(median, 2),
                    'fitted_size': [width, height]}


def region_map(name, base):
    y, x = np.mgrid[:SIZE, :SIZE].astype(float)
    mask = np.empty((SIZE, SIZE, 4), dtype=np.uint8)
    mask[..., :3] = MAGENTA if name == 'down' else YELLOW if name == 'flight' else RED
    gray = base[..., 0].astype(float)
    painted_fibers = ndi.gaussian_filter(gray, .7) - ndi.gaussian_filter(gray, 3.5)
    rng = np.random.default_rng(147)
    irregularity = ndi.gaussian_filter1d(rng.normal(0, 1, SIZE), 1.7)
    irregularity /= max(float(irregularity.std()), 1e-8)
    fiber = np.clip(.4 * painted_fibers + .9 * irregularity[None, :], -2.8, 2.8)
    if name == 'contour':
        # Curved cream tipping follows the crown. Small edge irregularities
        # continue the direction of the painted barbs, without blended IDs.
        boundary = 159 + .00078 * (x - 517) ** 2
        mask[..., :3][y < boundary + fiber] = YELLOW
    elif name == 'tail':
        # Two separate narrow arcs around the curling crown, with a dark cap.
        tip_coordinate = y - (.00123 * (x - 450) ** 2 - .065 * (x - 450))
        q = tip_coordinate + fiber
        cream = ((q >= 110) & (q < 138)) | ((q >= 175) & (q < 205))
        mask[..., :3][cream] = YELLOW

    # Keep only the exposed quill undyed. Find the last row where the plume is
    # wider than 38px; there is no artificial white stripe along the vane.
    a = base[..., 3]
    widths = np.zeros(SIZE, int)
    for row in range(int(SIZE * .75), SIZE):
        xs = np.flatnonzero(a[row] >= 32)
        if len(xs):
            widths[row] = xs[-1] - xs[0] + 1
    broad_rows = np.flatnonzero(widths > 38)
    quill_start = int(broad_rows[-1] + 2) if len(broad_rows) else 930
    mask[quill_start:, :, :3] = BLACK
    mask[..., 3] = a
    # Extrapolate ID colors into the transparent padding for filtering safety.
    nearest = ndi.distance_transform_edt(a == 0, return_distances=False, return_indices=True)
    mask[..., :3] = mask[..., :3][tuple(nearest)]
    return mask, quill_start


def dye(base, regions, palette=DEFAULT):
    multiplier = np.ones(base.shape[:2] + (3,), np.float32)
    for key, value in palette.items():
        multiplier[np.all(regions[..., :3] == key, axis=2)] = np.array(rgb(value)) / 255.0
    result = base.copy()
    result[..., :3] = np.rint(base[..., :3].astype(float) * multiplier).astype(np.uint8)
    return Image.fromarray(result)


def paste(sheet, sprite, pos):
    sheet.alpha_composite(sprite, pos)


def full_preview(dyed):
    # Each 1024 square is pasted at exactly 1:1; no crop, enlargement, or fit.
    col, row, margin, header = 1056, 1300, 24, 120
    sheet = Image.new('RGBA', (margin * 2 + col * 5, header + row * 2 + 52), '#20262c')
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 20), 'DODO / LOOSE FEATHERS', font=font(34), fill='#f2f0e9')
    draw.text((24, 68), 'Default dyes   /   full 1024px card + native 128px and 32px cards   /   unlit color × dye',
              font=font(22), fill='#c6c9cb')
    for row_index, (bg_name, color) in enumerate(BACKGROUNDS):
        top = header + row * row_index
        for index, name in enumerate(NAMES):
            left = margin + col * index
            draw.rectangle((left, top, left + col - 12, top + row - 12), fill=color)
            ink = '#171c21'
            draw.text((left + 20, top + 15), f'{name}  /  {bg_name}', font=font(25), fill=ink)
            paste(sheet, dyed[name], (left + 10, top + 58))
            draw.text((left + 24, top + 1112), '128px', font=font(21), fill=ink)
            paste(sheet, resize_rgba(dyed[name], (128, 128)), (left + 112, top + 1090))
            draw.text((left + 290, top + 1112), '32px', font=font(21), fill=ink)
            paste(sheet, resize_rgba(dyed[name], (32, 32)), (left + 365, top + 1110))
            draw.text((left + 24, top + 1244), '1024px above, shown 1:1 at 100% zoom', font=font(19), fill=ink)
    draw.text((24, sheet.height - 36), 'Body #6b737a  ·  Hood #433324  ·  Cream #e6e2d6  ·  Quill undyed  ·  Open at 100% to judge native sizes',
              font=font(20), fill='#c6c9cb')
    save_png(sheet, 'preview.png')


def game_preview(dyed):
    width, height = 1280, 960
    sheet = Image.new('RGBA', (width, height), '#20262c')
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 18), 'DODO / GAME-SIZE CHECK', font=font(28), fill='#f2f0e9')
    draw.text((24, 59), 'Native pixel sizes. 32px = near-view check; 8px and 4px = distant flecks.',
              font=font(17), fill='#c6c9cb')
    for row_index, (bg_name, color) in enumerate(BACKGROUNDS):
        top = 100 + row_index * 426
        draw.rectangle((16, top, width - 16, top + 414), fill=color)
        draw.text((30, top + 12), bg_name, font=font(17), fill='#191e22')
        for i, name in enumerate(NAMES):
            left = 124 + i * 228
            draw.text((left + 8, top + 40), name, font=font(17), fill='#191e22')
            for size, y in ((128, 72), (32, 230), (8, 292), (4, 326)):
                paste(sheet, resize_rgba(dyed[name], (size, size)), (left + (128-size)//2, top + y))
            flat = resize_rgba(dyed[name], (96, 96)).resize((96, 42), Image.Resampling.LANCZOS)
            flat = flat.rotate(24 if i % 2 == 0 else -24, Image.Resampling.BICUBIC, expand=True)
            if i % 2:
                flat = flat.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            paste(sheet, flat, (left + 9, top + 345))
        for label, y in (('128px', 126), ('32px', 232), ('8px', 286), ('4px', 320), ('flat / flipped', 370)):
            draw.text((30, top + y), label, font=font(14), fill='#191e22')
    save_png(sheet, 'preview_game.png')


def alternate_preview(assets):
    bodies = ('#874833', '#bba27b', '#403b37')
    creams = ('#ddc69c', '#9d553a')
    sheet = Image.new('RGBA', (1376, 1510), '#20262c')
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 18), 'DODO / ALTERNATE DYES', font=font(28), fill='#f2f0e9')
    draw.text((24, 59), 'All six requested body / cream combinations. Hood stays #433324. Native 128px cards.',
              font=font(17), fill='#c6c9cb')
    for r, (body, cream) in enumerate((b, c) for b in bodies for c in creams):
        top = 104 + r * 230
        draw.rectangle((16, top, 1360, top + 216), fill='#c9b48a' if r % 2 else '#808080')
        draw.text((30, top + 12), f'Body {body}   Cream {cream}', font=font(18), fill='#171c21')
        palette = dict(DEFAULT)
        palette[RED], palette[YELLOW] = body, cream
        for i, name in enumerate(NAMES):
            left = 64 + i * 260
            draw.text((left, top + 48), name, font=font(17), fill='#171c21')
            paste(sheet, resize_rgba(dye(*assets[name], palette), (128, 128)), (left, top + 76))
    save_png(sheet, 'preview_alternate_dyes.png')


def validate(name, base, regions):
    assert base.shape == regions.shape == (1024, 1024, 4)
    assert np.array_equal(base[..., 0], base[..., 1]) and np.array_equal(base[..., 1], base[..., 2])
    a = base[..., 3]
    assert np.array_equal(a, regions[..., 3])
    assert a[:PAD].max() == a[-PAD:].max() == a[:, :PAD].max() == a[:, -PAD:].max() == 0
    codes = {tuple(int(c) for c in v) for v in np.unique(regions[..., :3][a > 0], axis=0)}
    assert codes <= {RED, MAGENTA, YELLOW, BLACK}
    assert len(codes - {BLACK}) <= 2
    assert a.max() == 255 and np.any((a > 0) & (a < 255))
    ys, xs = np.nonzero(a)
    bbox = [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)]
    assert bbox[3] - bbox[1] >= 880
    opaque = a == 255
    metrics = {'size': [SIZE, SIZE], 'mode': 'RGBA', 'alpha_bbox': bbox,
               'clear_margins_ltrb_px': [bbox[0], bbox[1], SIZE-bbox[2], SIZE-bbox[3]],
               'neutral_rgb': True, 'alpha_matches_regions': True,
               'region_rgb_codes': [list(v) for v in sorted(codes)],
               'opaque_pixels': int(opaque.sum()),
               'partial_coverage_pixels': int(((a > 0) & (a < 255)).sum()),
               'opaque_gray_p01_p50_p99': [round(float(v), 1) for v in np.percentile(base[..., 0][opaque], (1, 50, 99))]}
    return metrics


def main():
    manifest = json.loads((ROOT / 'generation_prompts.json').read_text())
    assets, dyed, measurements = {}, {}, {}
    for name in NAMES:
        source = ROOT / manifest[name]['local_source']
        base, preparation = prepare_base(source)
        regions, quill_start = region_map(name, base)
        measurements[name] = {**validate(name, base, regions), **preparation,
                              'undyed_quill_starts_at_y': quill_start,
                              'master_sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
        save_png(Image.fromarray(base), name + '.png')
        save_png(Image.fromarray(regions), name + '_regions.png')
        assets[name] = (base, regions)
        dyed[name] = dye(base, regions)
        print(name, measurements[name]['alpha_bbox'], measurements[name]['region_rgb_codes'])
    full_preview(dyed)
    game_preview(dyed)
    alternate_preview(assets)
    (ROOT / 'validation.json').write_text(json.dumps(measurements, indent=2) + '\n')
    print('Wrote ten textures, three review sheets, and validation.json.')


if __name__ == '__main__':
    main()
