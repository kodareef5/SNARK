#!/usr/bin/env python3
"""Check the delivered sprite, reproducibility and fixed contrast samples.

These measurements support, but do not replace, native-size visual inspection.
Run after build_moon.py. Writes iterations/round-19-local-rays/validation.json.
"""
import hashlib
import io
import json

import numpy as np
from PIL import Image, ImageCms
from build_moon import ROOT, coverage, paint, check_sheet
from retouch_round5 import build, baseline


def patch_stats(image):
    rgb = np.asarray(image, dtype=float)[:, :, :3]
    size = image.width
    y, x = np.mgrid[:size, :size]
    luma = (rgb * [0.2126, 0.7152, 0.0722]).sum(axis=-1)
    srgb = rgb/255
    linear = np.where(srgb <= 0.04045, srgb/12.92, ((srgb+0.055)/1.055)**2.4)
    linear_luma = (linear * [0.2126, 0.7152, 0.0722]).sum(axis=-1)
    coordinates = {
        'Imbrium': (0.34, 0.24), 'Procellarum': (0.20, 0.48),
        'Serenitatis': (0.65, 0.28), 'Tranquillitatis': (0.72, 0.44),
        'Crisium': (0.90, 0.35), 'southern_highlands': (0.56, 0.76),
        'southeastern_highlands': (0.76, 0.76),
    }
    patches = {}
    for name, (cx, cy) in coordinates.items():
        mask = np.hypot((x+0.5)/size-cx, (y+0.5)/size-cy) <= 0.025
        patches[name] = {
            'center_disc_fraction': [cx, cy], 'radius_disc_fraction': 0.025,
            'srgb_luma': float(luma[mask].mean()),
            'srgb_luma_std': float(luma[mask].std()),
            'linear_luminance': float(linear_luma[mask].mean()),
        }
    names = list(coordinates)
    groups = {}
    for group, selected in [('mare', names[:5]), ('highland', names[5:])]:
        groups[group] = {key: float(np.mean([patches[n][key] for n in selected]))
                         for key in ['srgb_luma', 'linear_luminance']}
    return {'patches': patches, 'groups': groups,
            'mare_to_highland_linear_ratio':
                groups['mare']['linear_luminance']/groups['highland']['linear_luminance']}


def main():
    moon = Image.open(ROOT/'moon.png')
    a = np.asarray(moon)
    alpha = a[:, :, 3]
    y, x = np.mgrid[:512, :512]
    r = np.hypot(x+0.5-256, y+0.5-256)/256
    metrics = json.loads((ROOT/'metrics.json').read_text())
    rebuilt, _, masks = build('rays')
    base,_ = baseline()
    base_pixels = np.asarray(base)
    union = np.maximum.reduce(list(masks.values()))
    unchanged = union == 0
    profile = ImageCms.ImageCmsProfile(io.BytesIO(moon.info['icc_profile']))
    profile_description = ImageCms.getProfileDescription(profile).strip()
    manifest = json.loads((ROOT/'originals/manifest.json').read_text())
    checks = {
        'mode_rgba_512': moon.mode == 'RGBA' and moon.size == (512, 512),
        'embedded_srgb': 'srgb' in profile_description.lower(),
        'rebuild_matches_reviewed_pixels': np.array_equal(a, np.asarray(rebuilt)),
        'final_matches_last_review': np.array_equal(a, np.asarray(Image.open(
            ROOT/'iterations/round-19-local-rays/moon.png'))),
        'check_sheet_matches_sprite': np.array_equal(np.asarray(check_sheet(moon)),
                                                     np.asarray(Image.open(ROOT/'check.png'))),
        'alpha_matches_8x8_circle_coverage': np.array_equal(alpha, coverage()),
        'alpha_symmetric': np.array_equal(alpha, alpha[::-1]) and np.array_equal(alpha, alpha[:, ::-1]),
        'interior_opaque': bool(np.all(alpha[r < 0.99] == 255)),
        'no_alpha_beyond_edge_coverage': bool(np.all(alpha[coverage() == 0] == 0)),
        'touches_all_four_edges': all(v.max() > 0 for v in [alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]]),
        'original_hashes_match': all(hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == v['sha256']
                                     for name, v in manifest.items()),
        'near_grey_mean': np.ptp(metrics['alpha_weighted_mean_srgb_255']) < 3,
        'bright_outer_band': metrics['annular_mean_srgb_luminance']['0.950-0.995'] > 220,
        'round_three_base_reproduces_exactly': np.array_equal(base_pixels,np.asarray(Image.open(
            ROOT/'iterations/round-4-baseline/moon.png'))),
        'outside_local_masks_unchanged': np.array_equal(a[unchanged],base_pixels[unchanged]),
        'alpha_identical_to_round_three': np.array_equal(alpha,base_pixels[...,3]),
        'tycho_and_51px_surround_unchanged': np.array_equal(
            a[np.hypot(x-208,y-437)<=51],base_pixels[np.hypot(x-208,y-437)<=51]),
        'serenitatis_heart_unchanged': np.array_equal(
            a[np.hypot(x-322,y-135)<26],base_pixels[np.hypot(x-322,y-135)<26]),
    }
    checks = {k: bool(v) for k, v in checks.items()}
    before = Image.open(ROOT/'iterations/round-4-baseline/moon.png')
    comparison = {}
    for size in [32, 48, 64, 512]:
        comparison[str(size)] = {
            'before': patch_stats(before.resize((size, size), Image.Resampling.LANCZOS)),
            'after': patch_stats(moon.resize((size, size), Image.Resampling.LANCZOS)),
        }
    result = {'checks': checks, 'profile_description': profile_description,
              'changed_visible_pixel_percent': float(100*np.count_nonzero(
                  np.any(a[...,:3]!=base_pixels[...,:3],axis=-1)&(alpha>0))/np.count_nonzero(alpha>0)),
              'visible_pixel_percent_changed_over_3_levels': float(100*np.count_nonzero(
                  (np.abs(a[...,:3].astype(float)-base_pixels[...,:3]).max(axis=-1)>3)&(alpha>0))/np.count_nonzero(alpha>0)),
              'full_rgb_white_pixels': int(np.all(a[:, :, :3] == 255, axis=-1)[alpha == 255].sum()),
              'contrast_patch_comparison_by_size': comparison,
              'note': 'Fixed painted patches, not measured lunar reflectance. Small patches have few pixels.'}
    (ROOT/'iterations/round-19-local-rays/validation.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'checks': checks, '512px_samples': comparison['512']}, indent=2))
    assert all(checks.values()), 'A delivery check failed; see validation.json.'


if __name__ == '__main__':
    main()
