#!/usr/bin/env python3
"""Independent disk-based format, physical-normal, material and seam checks.

Run `python3 check_material.py --rebuild` to also prove deterministic rebuilding.
All visual evidence and machine-readable measurements go to checks/.
"""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import label

ROOT = Path(__file__).resolve().parent
CHECK = ROOT/'checks'
NAMES = ['base', 'height', 'normal', 'orm']
HEIGHT_MM = 48.0  # Independent published calibration, NOT imported from the builder.


def normalize(v):
    return v/np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


def stats(a):
    return {'mean': float(np.mean(a)), 'p95': float(np.quantile(a, .95)),
            'p99': float(np.quantile(a, .99)), 'max': float(np.max(a))}


def font(size=19):
    for p in ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def display(a):
    if a.ndim == 2:
        return Image.fromarray(np.uint8(np.clip(a.astype(float)/65535*255, 0, 255))).convert('RGB')
    return Image.fromarray(a.astype(np.uint8)).convert('RGB')


def sheet(items, target, cols=2, cell=(768, 768)):
    cw, ch = cell
    rows = (len(items)+cols-1)//cols
    canvas = Image.new('RGB', (cols*cw, rows*(ch+40)), (25, 28, 26))
    d = ImageDraw.Draw(canvas)
    for i, (title, im) in enumerate(items):
        x, y = (i%cols)*cw, (i//cols)*(ch+40)
        d.text((x+14, y+10), title, font=font(18), fill=(220, 219, 206))
        tile = im.copy()
        tile.thumbnail((cw, ch), Image.Resampling.LANCZOS)
        canvas.paste(tile, (x+(cw-tile.width)//2, y+40+(ch-tile.height)//2))
    canvas.save(CHECK/target, quality=94)


def independent_normal(h, width_m, height_m, periodic):
    """Metres and explicit neighbours; independent of build_material.py."""
    z = h.astype(np.float64)*(HEIGHT_MM/1000)/65535
    down = np.concatenate([z[1:], z[-1:]], axis=0)
    up = np.concatenate([z[:1], z[:-1]], axis=0)
    if periodic:
        right = np.concatenate([z[:, 1:], z[:, :1]], axis=1)
        left = np.concatenate([z[:, -1:], z[:, :-1]], axis=1)
    else:
        right = np.concatenate([z[:, 1:], z[:, -1:]], axis=1)
        left = np.concatenate([z[:, :1], z[:, :-1]], axis=1)
    slope_x = (right-left)/(2*width_m/z.shape[1])
    slope_down = (down-up)/(2*height_m/z.shape[0])
    return normalize(np.stack([-slope_x, slope_down, np.ones_like(z)], -1))


def seam_metrics(a):
    # Height is reported in 8-bit-equivalent units for cross-layer comparability.
    if a.ndim == 2:
        a = a.astype(float)[..., None]/257
    else:
        a = a.astype(float)
    seam = np.abs(a[:, 0]-a[:, -1])
    internal = np.abs(a[:, 1:]-a[:, :-1])
    line_means = internal.mean(axis=(0, 2))
    band = np.concatenate([internal[:, :20], internal[:, -20:]], axis=1)
    result = {'units': '8-bit code values; height divided by 257',
              'seam': stats(seam), 'interior': stats(internal),
              'seam_mean_over_interior_mean': float(seam.mean()/max(internal.mean(), 1e-12)),
              'interior_column_mean_p95': float(np.quantile(line_means, .95)),
              'interior_column_mean_p99': float(np.quantile(line_means, .99)),
              'seam_mean_in_interior_column_percentile': float(np.mean(line_means<=seam.mean())*100),
              'adjacent_20px_band_mean': float(band.mean()),
              'seam_mean_over_adjacent_band': float(seam.mean()/max(band.mean(), 1e-12)),
              'per_channel_seam_mean': seam.mean(0).tolist(),
              'per_channel_interior_mean': internal.mean((0, 1)).tolist()}
    # A detailed underside can be rougher than a quiet roof, so the nearby strip
    # supplies an additional honest reference. Neither comparison is hidden.
    result['pass'] = bool(result['seam_mean_over_adjacent_band']<1.5 and
                          seam.mean()<max(1.5*internal.mean(), 1.15*np.quantile(line_means, .99)))
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rebuild', action='store_true')
    args = ap.parse_args()
    CHECK.mkdir(exist_ok=True)
    before = {n: hashlib.sha256((ROOT/('ruins_'+n+'.png')).read_bytes()).hexdigest() for n in NAMES}
    if args.rebuild:
        subprocess.run([sys.executable, str(ROOT/'build_material.py')], check=True, cwd=ROOT)
    arrays = {n: np.array(Image.open(ROOT/('ruins_'+n+'.png'))) for n in NAMES}
    result = {'height_full_range_mm': HEIGHT_MM, 'normal_convention': 'OpenGL +Y image-up',
              'files': {}, 'islands': {}, 'wrapping': {}, 'features': {}, 'material_classes': {}}
    failures = []
    construction = json.loads((CHECK/'construction.json').read_text())
    layout = json.loads((ROOT/'guide/LAYOUT.json').read_text())['regions']
    # Check the builder's actual regions against the user's layout.
    for name, spec in layout.items():
        if name != 'sign':
            assert construction['islands'][name]['box'] == spec['box']
            assert construction['islands'][name]['metres_across'] == spec['metres_across']
            assert construction['islands'][name]['metres_down'] == spec['metres_down']
    expected_islands = {k: v.copy() for k, v in layout.items() if k!='sign'}
    expected_islands['sign_front'] = {'box': [1280, 0, 1664, 768], 'metres_across': .75, 'metres_down': .45}
    expected_islands['sign_back'] = {'box': [1664, 0, 2048, 768], 'metres_across': .75, 'metres_down': .45}
    cover = np.zeros((2048, 2048), np.uint8)
    for name, a in arrays.items():
        p = ROOT/('ruins_'+name+'.png')
        data = p.read_bytes()
        width, height, depth, color_type = struct.unpack('>IIBB', data[16:26])
        im = Image.open(p)
        sha = hashlib.sha256(data).hexdigest()
        result['files'][name] = {'size': [width, height], 'png_bit_depth': depth,
                                 'png_color_type': color_type, 'pil_mode': im.mode,
                                 'dtype': str(a.dtype), 'sha256': sha,
                                 'has_icc': 'icc_profile' in im.info,
                                 'has_gamma': 'gamma' in im.info,
                                 'has_srgb_chunk': 'srgb' in im.info,
                                 'rebuild_identical': sha == before[name] if args.rebuild else None}
        assert (width, height) == (2048, 2048)
        assert (depth, color_type) == ((16, 0) if name=='height' else (8, 2))
        assert np.isfinite(a).all()
        assert (name=='base') == ('icc_profile' in im.info)
        if name != 'base':
            assert 'gamma' not in im.info and 'srgb' not in im.info
        if args.rebuild:
            assert sha == before[name], f'Non-deterministic rebuild: {name}'
    all_angles = []
    raw_n = arrays['normal'].astype(float)/127.5-1
    n = normalize(raw_n)
    for name, spec in expected_islands.items():
        x0, y0, x1, y1 = spec['box']
        cover[y0:y1, x0:x1] += 1
        h = arrays['height'][y0:y1, x0:x1]
        expected = independent_normal(h, spec['metres_across'], spec['metres_down'], name in ('pole', 'post', 'car'))
        got = n[y0:y1, x0:x1]
        err = np.degrees(np.arccos(np.clip(np.sum(expected*got, axis=-1), -1, 1)))
        all_angles.append(err.ravel())
        result['islands'][name] = {**spec, 'mm_per_pixel_xy': [1000*spec['metres_across']/(x1-x0), 1000*spec['metres_down']/(y1-y0)],
                                  'normal_error_degrees': stats(err),
                                  'height_min_max_mm': [float(h.min()/65535*HEIGHT_MM), float(h.max()/65535*HEIGHT_MM)]}
        assert err.max()<.40, f'Height/normal disagreement: {name}'
    assert np.all(cover==1)
    result['atlas_coverage'] = {'pixels': int(cover.size), 'uncovered': int(np.sum(cover==0)), 'overlapped': int(np.sum(cover>1))}
    result['normal_error_degrees'] = stats(np.concatenate(all_angles))
    result['normal_decoded_length'] = {'min': float(np.linalg.norm(raw_n, axis=-1).min()), 'max': float(np.linalg.norm(raw_n, axis=-1).max())}
    assert np.all(arrays['normal'][..., 2]>=128)
    assert result['normal_decoded_length']['min']>.993
    assert result['normal_decoded_length']['max']<1.007
    # Explicit sign checks with an analytic ramp, so a shared green-channel bug cannot pass.
    ramp = np.tile(np.arange(24, dtype=float)[:, None]*200, (1, 24))
    ramp_n = independent_normal(ramp, 1, 1, False)
    assert np.all(ramp_n[1:-1, :, 1]>0)
    assert np.all(independent_normal(ramp.T, 1, 1, False)[:, 1:-1, 0]<0)
    result['analytic_ramp_convention'] = {'height_increases_image_down_green_above_half': True,
                                         'height_increases_image_right_red_below_half': True}
    for region in ['pole', 'post', 'car']:
        x0, y0, x1, y1 = layout[region]['box']
        result['wrapping'][region] = {}
        tiles = []
        for name, a in arrays.items():
            crop = a[y0:y1, x0:x1]
            measures = seam_metrics(crop)
            result['wrapping'][region][name] = measures
            if not measures['pass']:
                failures.append(f'{region}/{name}: wrapping jump')
            tile = display(np.concatenate([crop, crop], axis=1))
            tiles.append((region+' / '+name+' / two circumferences', tile))
            if name=='base':
                tile.save(CHECK/(region+'_tile2x.png'))
        sheet(tiles, region+'_wrap_layers.jpg', 4, (512, 1024 if region!='car' else 640))
    ids = np.array(Image.open(CHECK/'material_ids.png'))
    orm = arrays['orm']/255
    for name, code in construction['material_ids'].items():
        selection = ids==code
        count = int(selection.sum())
        if count:
            result['material_classes'][name] = {'pixels': count,
                'roughness_mean': float(orm[..., 1][selection].mean()),
                'roughness_min_max': [float(orm[..., 1][selection].min()), float(orm[..., 1][selection].max())],
                'metalness_min_max': [float(orm[..., 2][selection].min()), float(orm[..., 2][selection].max())]}
        if name not in ('steel', 'zinc'):
            assert np.all(arrays['orm'][..., 2][selection]==0), f'Metalness leakage into {name}'
    assert arrays['orm'][..., 2].max()<=153
    result['height_unique_values'] = int(np.unique(arrays['height']).size)
    assert result['height_unique_values']>10000
    # Window and wheel test boxes are independently transcribed from the supplied guide.
    for side, box in [('right', (1533, 1126, 1626, 1767)), ('left', (1702, 1126, 1795, 1767))]:
        x0, y0, x1, y1 = box
        selected = ids[y0:y1, x0:x1]
        ratio = float(np.mean(selected==8))
        glass_count = int(np.sum(selected==7))
        result['features'][side+'_window_band'] = {'guide_box': list(box), 'dark_opening_fraction': ratio, 'glass_pixels': glass_count}
        assert ratio>.65 and glass_count>50
    for i, (cx, cy) in enumerate([(1364, 1050), (1963, 1050), (1364, 1741), (1963, 1741)]):
        sub = ids[cy-103:cy+103, cx-24:cx+24]
        tyre = float(np.mean(sub==6))
        result['features']['wheel_'+str(i+1)] = {'guide_center': [cx, cy], 'rubber_fraction': tyre}
        assert tyre>.06
    for face, (x0, x1) in [('front', (1280, 1664)), ('back', (1664, 2048))]:
        count = label(ids[:768, x0:x1]==8)[1]
        result['features']['sign_'+face+'_bolt_holes'] = count
        assert count==2
    for name, expected in construction['sources'].items():
        assert hashlib.sha256((ROOT/'source'/name).read_bytes()).hexdigest()==expected['sha256']
    # Requested visual evidence.
    sheet([('BASE / sRGB unlit', display(arrays['base'])), ('HEIGHT / 16-bit / 48 mm range', display(arrays['height'])),
           ('NORMAL / OpenGL / physical island scale', display(arrays['normal'])), ('ORM / AO, roughness, metalness', display(arrays['orm']))], 'layers.jpg')
    guide = np.array(Image.open(ROOT/'guide/layout.png').convert('RGB'))
    annotations = (guide.max(2)-guide.min(2)>27) | (guide.mean(2)>130)
    overlay = arrays['base'].astype(float)*.88
    overlay[annotations] = overlay[annotations]*.12+guide[annotations]*.88
    Image.fromarray(np.uint8(np.clip(overlay, 0, 255))).save(CHECK/'base_over_layout.png')
    details = []
    for title, box in [('capital', (0, 0, 512, 360)), ('rebar and damp', (0, 1580, 512, 2048)),
                       ('pole step', (760, 700, 1000, 940)), ('post zinc', (1024, 130, 1280, 390)),
                       ('car glass and door', (1460, 1090, 1800, 1460))]:
        for n0 in NAMES:
            details.append((title+' / '+n0, display(arrays[n0]).crop(box)))
    sheet(details, 'details.jpg', 4, (384, 384))
    # Aspect-correct sign review (the atlas intentionally compresses each face).
    sign_views = [(side+' / 0.75 x 0.45 m', display(arrays['base']).crop(box).resize((1000, 600), Image.Resampling.LANCZOS))
                  for side, box in [('sign front', (1280, 0, 1664, 768)), ('sign back', (1664, 0, 2048, 768))]]
    sheet(sign_views, 'sign_physical_aspect.jpg', 1, (1000, 600))
    # Diagnostic relighting of the actual layers; these lights are not in albedo.
    b = arrays['base']/255
    linear = np.where(b<=.04045, b/12.92, ((b+.055)/1.055)**2.4)
    relights = []
    for title, light in [('light upper left', [-.65, .55, .75]), ('light lower right', [.65, -.55, .75])]:
        light = normalize(np.array(light, dtype=float))
        diffuse = np.maximum(np.sum(n*light, axis=2), 0)
        c = linear*(.27+.73*diffuse[..., None])*(.8+.2*orm[..., :1])
        c = np.where(c<=.0031308, c*12.92, 1.055*np.maximum(c, 0)**(1/2.4)-.055)
        relights.append((title+' / diagnostic only', Image.fromarray(np.uint8(np.clip(c*255, 0, 255)))))
    sheet(relights, 'relighting.jpg', 2)
    result['failures'] = failures
    result['pass'] = not failures
    (CHECK/'metrics.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'pass': result['pass'], 'normal_error_degrees': result['normal_error_degrees'],
                      'seam_mean_over_interior_mean': {reg: {n: round(m['seam_mean_over_interior_mean'], 3) for n, m in v.items()} for reg, v in result['wrapping'].items()},
                      'features': result['features'], 'failures': failures}, indent=2))
    if failures:
        raise SystemExit(1)


if __name__=='__main__':
    main()
