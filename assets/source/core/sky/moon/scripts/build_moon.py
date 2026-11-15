#!/usr/bin/env python3
"""Rebuild the 512px sprite and native-size check from preserved generator PNGs.

Run from this folder: python3 scripts/build_moon.py
Only Pillow, NumPy and SciPy are required. No downloads or generation at build time.
"""
from pathlib import Path
import argparse
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageCms
from scipy import ndimage, optimize

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
NIGHT = (9, 23, 46)


def circle_fit(alpha, radius_retained=0.97):
    """Robust fit to the opaque main disc, excluding disconnected paint flecks."""
    labels, _ = ndimage.label(alpha > 220)
    counts = np.bincount(labels.ravel())
    counts[0] = 0
    mask = ndimage.binary_fill_holes(labels == counts.argmax())
    boundary = mask & ~ndimage.binary_erosion(mask)
    by, bx = np.where(boundary)
    bx, by = bx[::2].astype(float), by[::2].astype(float)
    cx, cy = (bx.min()+bx.max())/2, (by.min()+by.max())/2
    radius = ((bx.max()-bx.min())+(by.max()-by.min()))/4
    fit = optimize.least_squares(
        lambda p: np.hypot(bx-p[0], by-p[1])-p[2],
        (cx, cy, radius), loss='soft_l1', f_scale=1.5)
    # Trim only the irregular painted fringe. No elliptical stretch or feature warp.
    cx, cy, radius = fit.x
    return float(cx), float(cy), float(radius*radius_retained)


def coverage(size=512, samples=8):
    """Area-sampled radius-256 disc. Tangent to all four edges of the image."""
    y, x = np.mgrid[:size, :size].astype(np.float32)
    alpha = np.zeros((size, size), dtype=np.float32)
    for dy in (np.arange(samples)+0.5)/samples:
        for dx in (np.arange(samples)+0.5)/samples:
            alpha += ((x+dx-size/2)**2+(y+dy-size/2)**2 <= (size/2)**2)
    return np.rint(alpha*255/(samples*samples)).astype(np.uint8)


def paint(source, neutralize=True, mean_lightness=194.0, contrast=0.95,
          radius_retained=0.97):
    raw = np.asarray(Image.open(source).convert('RGBA'), dtype=np.float32)
    cx, cy, radius = circle_fit(raw[:, :, 3], radius_retained)
    # Render at 2x and downsample premultiplied by source alpha to avoid dark fringes.
    size = 1024
    y, x = np.mgrid[:size, :size].astype(np.float32)
    nx, ny = (x+0.5-size/2)/(size/2), (y+0.5-size/2)/(size/2)
    radial = np.maximum(1, np.hypot(nx, ny))
    sx, sy = cx+nx/radial*radius, cy+ny/radial*radius
    source_alpha = raw[:, :, 3]/255
    weight = ndimage.map_coordinates(source_alpha, [sy, sx], order=1, mode='nearest')
    rgb = np.stack([
        ndimage.map_coordinates(raw[:, :, c]*source_alpha, [sy, sx], order=1,
                                mode='nearest')/np.maximum(weight, 0.001)
        for c in range(3)], axis=-1)
    if weight.min() < 0.95:
        raise ValueError('Fitted disc includes transparent paint: inspect source and fit.')
    if neutralize:
        luminance = (rgb*np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).sum(axis=-1)
        # One global tone adjustment: no radial gradient, local light or noise added.
        disc_mean = float(luminance[np.hypot(nx, ny) <= 1].mean())
        toned = mean_lightness+contrast*(luminance-disc_mean)
        rgb = toned[..., None]+0.45*(rgb-luminance[..., None])
    rgb = np.rint(np.clip(rgb, 0, 255)).astype(np.uint8)
    out = Image.fromarray(rgb).resize((512, 512), Image.Resampling.LANCZOS).convert('RGBA')
    out.putalpha(Image.fromarray(coverage()))
    return out, {'source': str(source.relative_to(ROOT)), 'source_size': list(raw.shape[1::-1]),
                 'crop_circle_xy_radius': [cx, cy, radius],
                 'min_sampled_source_alpha': float(weight.min()),
                 'neutralized': neutralize, 'target_mean_lightness': mean_lightness,
                 'luminance_contrast': contrast, 'chroma_multiplier': 0.45 if neutralize else 1.0,
                 'fitted_radius_retained': radius_retained}


def font(size):
    try:
        return ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)
    except OSError:
        try:
            return ImageFont.truetype('DejaVuSans.ttf', size)
        except OSError:
            return ImageFont.load_default(size=size)


def check_sheet(moon, title='THE MOON / NATIVE-SIZE CHECK'):
    sheet = Image.new('RGB', (1080, 664), NIGHT)
    draw = ImageDraw.Draw(sheet)
    draw.text((32, 24), title, font=font(22), fill=(221, 229, 238))
    draw.text((32, 59), 'Deep night blue #09172E  ·  Untinted sprite  ·  No added glow',
              font=font(14), fill=(131, 151, 175))
    # Every disc is physically this many pixels wide in this file.
    for center, size in [(82, 32), (202, 48), (334, 64)]:
        small = moon.resize((size, size), Image.Resampling.LANCZOS)
        sheet.paste(small, (center-size//2, 352-size//2), small)
        draw.text((center, 414), f'{size} px', anchor='mt', font=font(16), fill=(186, 200, 217))
    sheet.paste(moon, (536, 96), moon)
    draw.text((792, 624), '512 px / source resolution', anchor='mt', font=font(16),
              fill=(186, 200, 217))
    draw.text((32, 570), 'View this file at 100% for the actual pixel sizes.',
              font=font(14), fill=(131, 151, 175))
    return sheet


def statistics(image, build):
    a = np.asarray(image, dtype=np.float64)
    rgb, alpha = a[:, :, :3], a[:, :, 3]/255
    mean = (rgb*alpha[..., None]).sum((0, 1))/alpha.sum()
    lum = (rgb*np.array([0.2126, 0.7152, 0.0722])).sum(axis=-1)
    y, x = np.mgrid[:512, :512]
    r = np.hypot(x+0.5-256, y+0.5-256)/256
    mask = alpha == 1
    srgb = rgb/255
    linear = np.where(srgb <= 0.04045, srgb/12.92, ((srgb+0.055)/1.055)**2.4)
    bands = {}
    for lo, hi in [(0, 0.5), (0.5, 0.8), (0.8, 0.95), (0.95, 0.995)]:
        m = (r >= lo) & (r < hi) & mask
        bands[f'{lo:.3f}-{hi:.3f}'] = round(float(lum[m].mean()), 3)
    build.update({
        'size': [512, 512], 'mode': 'RGBA', 'color_space': 'sRGB, embedded ICC profile',
        'alpha_weighted_mean_srgb_255': mean.tolist(),
        'rounded_mean_hex': '#'+''.join(f'{int(round(v)):02X}' for v in mean),
        'alpha_weighted_mean_linear_rgb': ((linear*alpha[..., None]).sum((0, 1))/alpha.sum()).tolist(),
        'opaque_luminance_percentiles_1_5_50_95_99': np.percentile(lum[mask], [1, 5, 50, 95, 99]).tolist(),
        'annular_mean_srgb_luminance': bands,
        'partial_alpha_pixels': int(((alpha > 0) & (alpha < 1)).sum()),
        'fully_opaque_interior': bool(np.all(alpha[r < 0.99] == 1)),
        'zero_alpha_corners': bool(np.all(alpha[[0, 0, -1, -1], [0, -1, 0, -1]] == 0)),
        'alpha_touches_all_four_edges': bool(all([alpha[0].max()>0, alpha[-1].max()>0,
                                                  alpha[:, 0].max()>0, alpha[:, -1].max()>0])),
        'night_blue_srgb': list(NIGHT),
    })
    return build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', help='Optional single-source build; default is the round-five local retouch.')
    parser.add_argument('--prefix', default='')
    parser.add_argument('--native-color', action='store_true')
    parser.add_argument('--mean', type=float, default=194.0)
    parser.add_argument('--contrast', type=float, default=0.95)
    parser.add_argument('--radius-retained', type=float, default=0.97)
    args = parser.parse_args()
    prefix = ROOT/args.prefix
    prefix.mkdir(parents=True, exist_ok=True)
    if args.source:
        moon, build = paint(ROOT/args.source, neutralize=not args.native_color,
                           mean_lightness=args.mean, contrast=args.contrast,
                           radius_retained=args.radius_retained)
    else:
        from retouch_round5 import build as local_retouch
        moon, build, _ = local_retouch('rays')
    moon.save(prefix/'moon.png', icc_profile=PROFILE)
    check_sheet(moon).save(prefix/'check.png', icc_profile=PROFILE)
    stats = statistics(moon, build)
    (prefix/'metrics.json').write_text(json.dumps(stats, indent=2)+'\n')
    print(json.dumps(stats, indent=2))


if __name__ == '__main__':
    main()
