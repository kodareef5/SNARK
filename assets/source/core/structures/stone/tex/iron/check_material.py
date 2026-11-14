#!/usr/bin/env python3
"""Check delivered PNGs independently and make the inspection sheets.

Relighting uses linear-light Cook–Torrance/GGX, Schlick Fresnel, Smith masking,
material metalness, AO and roughness, a finite softbox and constant environment.
The strap sheet adds bevel geometry only in the diagnostic renderer.
"""
from pathlib import Path
import hashlib
import json
import struct
import time
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import correlate1d, gaussian_filter, distance_transform_edt

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
OUT.mkdir(exist_ok=True)
N = 2048
PITCH = 3000/N
FONT_PATH = '/System/Library/Fonts/Supplemental/Arial.ttf'


def font(size):
    try: return ImageFont.truetype(FONT_PATH, size)
    except OSError: return ImageFont.load_default(size=size)


def rgb(a):
    return Image.fromarray(np.rint(np.clip(a, 0, 255)).astype(np.uint8))


def label(im, pos, text, size=18, color=(215, 215, 215)):
    ImageDraw.Draw(im).text(pos, text, font=font(size), fill=color)


def srgb_to_linear(c):
    return np.where(c <= .04045, c/12.92, ((c+.055)/1.055)**2.4)


def linear_to_srgb(c):
    c = np.maximum(c, 0)
    return np.where(c <= .0031308, c*12.92, 1.055*c**(1/2.4)-.055)


def normalized(a):
    return a/np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-8)


def shade(base, normal, orm, azimuth=30, elevation=48, strength=10, view=None):
    """Common exposure and neutral white lighting for every preview."""
    b = srgb_to_linear(base.astype(np.float32)/255)
    n = normalized(normal.astype(np.float32))
    ao, rough, metal = [orm[:, :, c].astype(np.float32)/255 for c in range(3)]
    v = normalized(np.array(view if view is not None else [0, -.25, 1.0], np.float32))
    ndv = np.clip(np.sum(n*v, axis=-1), .001, 1)
    f0 = .04*(1-metal[:, :, None])+b*metal[:, :, None]
    # Constant neutral environment approximation; no hand-painted highlights.
    radiance = (b*(1-metal[:, :, None])*.20+f0*.65)*ao[:, :, None]
    a2 = np.maximum(rough**4, .001)
    def smith(nd):
        return 2*nd/(nd+np.sqrt(a2+(1-a2)*nd*nd)+1e-6)
    gv = smith(ndv)
    # 3x3 solid-angle softbox approximation, normalized total radiance.
    for da in [-8, 0, 8]:
        for de in [-7, 0, 7]:
            az, el = np.deg2rad([azimuth+da, elevation+de])
            light = np.array([np.cos(el)*np.cos(az), np.cos(el)*np.sin(az), np.sin(el)], np.float32)
            half = normalized(light+v)
            ndl = np.clip(np.sum(n*light, axis=-1), .001, 1)
            ndh = np.clip(np.sum(n*half, axis=-1), .001, 1)
            vdh = float(np.clip(v @ half, 0, 1))
            fresnel = f0+(1-f0)*(1-vdh)**5
            distribution = a2/(np.pi*(ndh*ndh*(a2-1)+1)**2)
            spec = fresnel*(distribution*gv*smith(ndl)/(4*ndv*ndl+1e-6))[:, :, None]
            diffuse = (1-fresnel)*(1-metal[:, :, None])*b/np.pi
            radiance += (diffuse+spec)*(ndl*strength/9)[:, :, None]
    return np.clip(linear_to_srgb(radiance)*255, 0, 255)


def seam_statistics(a):
    a = np.asarray(a, dtype=np.float64)
    if a.ndim == 2: a = a[:, :, None]
    result = {}
    for axis, name in [(1, 'u'), (0, 'v')]:
        inside = np.abs(np.diff(a, axis=axis))
        means = inside.mean(axis=(0, 2) if axis == 1 else (1, 2))
        wrap = np.abs(np.take(a, 0, axis)-np.take(a, -1, axis))
        result[name] = {'wrap_mean': float(wrap.mean()),
                        'interior_mean': float(inside.mean()),
                        'interior_line_p95': float(np.percentile(means, 95)),
                        'ratio_to_interior_p95': float(wrap.mean()/np.percentile(means, 95))}
    return result


def make_sheet(ims, names, path, side=512, columns=None, footer=None):
    columns = columns or len(ims)
    rows = (len(ims)+columns-1)//columns
    sheet = Image.new('RGB', (columns*side, rows*(side+43)+(42 if footer else 0)), (24, 25, 27))
    for i, (im, name) in enumerate(zip(ims, names)):
        x, y = (i % columns)*side, (i//columns)*(side+43)
        label(sheet, (x+12, y+12), name, 18)
        sheet.paste(im.convert('RGB').resize((side, side), Image.Resampling.LANCZOS), (x, y+43))
    if footer: label(sheet, (12, rows*(side+43)+10), footer, 17)
    sheet.save(path, quality=95, subsampling=0)


def main():
    started = time.perf_counter()
    names = ['iron_base', 'iron_height', 'iron_normal', 'iron_orm']
    ims = [Image.open(ROOT/(s+'.png')) for s in names]
    base = np.asarray(ims[0]).copy()
    h16 = np.asarray(ims[1]).astype(np.float64)
    encoded = np.asarray(ims[2]).copy()
    orm = np.asarray(ims[3]).copy()
    n = normalized(encoded.astype(np.float64)/127.5-1)
    h_mm = h16*3/65535
    fields = np.load(ROOT/'surface_fields.npz')
    rust, polish = fields['rust'], fields['polish']
    metrics = {}
    info = {}
    for name, im in zip(names, ims):
        header = (ROOT/(name+'.png')).read_bytes()
        width, height, bitdepth, colortype = struct.unpack('>IIBB', header[16:26])
        info[name] = {'size': [width, height], 'mode': im.mode,
                      'bit_depth': bitdepth, 'png_color_type': colortype,
                      'icc_profile': bool(im.info.get('icc_profile')),
                      'sha256': hashlib.sha256(header).hexdigest()}
        assert (width, height) == (N, N)
        assert bitdepth == (16 if name == 'iron_height' else 8)
        assert colortype == (0 if name == 'iron_height' else 2)
        assert bool(im.info.get('icc_profile')) == (name == 'iron_base')
    metrics['files'] = info
    mean = base.mean((0, 1), dtype=np.float64)
    metrics['base_mean_srgb'] = mean.tolist()
    metrics['base_std_srgb'] = base.std((0, 1), dtype=np.float64).tolist()
    assert np.all(np.abs(mean-[44, 41, 39]) <= 10)
    # Independent finite-difference implementation, including wrapped edges.
    dx = correlate1d(h_mm, [-.5, 0, .5], axis=1, mode='wrap')/PITCH
    dy_down = correlate1d(h_mm, [-.5, 0, .5], axis=0, mode='wrap')/PITCH
    truth = normalized(np.stack([-dx, dy_down, np.ones_like(h_mm)], -1))
    angles = np.rad2deg(np.arccos(np.clip(np.sum(n*truth, axis=-1), -1, 1)))
    expected = np.rint((truth*.5+.5)*255).astype(np.uint8)
    metrics['normal'] = {'angle_degrees_mean': float(angles.mean()),
                         'angle_degrees_p99': float(np.percentile(angles, 99)),
                         'angle_degrees_max': float(angles.max()),
                         'byte_mismatches': int(np.count_nonzero(expected != encoded)),
                         'slope_degrees_p99': float(np.percentile(np.rad2deg(np.arctan(np.hypot(dx, dy_down))), 99)),
                         'slope_degrees_max': float(np.rad2deg(np.arctan(np.hypot(dx, dy_down))).max())}
    assert metrics['normal']['byte_mismatches'] == 0
    assert angles.max() < .5
    metrics['height_mm'] = {'min': float(h_mm.min()), 'max': float(h_mm.max()),
                            'mean': float(h_mm.mean()), 'std': float(h_mm.std()),
                            'full_code_range_mm': 3, 'pixel_pitch_mm': PITCH}
    metrics['seams'] = {name: seam_statistics(np.asarray(im)) for name, im in zip(names, ims)}
    assert all(s['ratio_to_interior_p95'] < 1.1 for m in metrics['seams'].values() for s in m.values())
    bare = rust == 0
    thick = rust >= .9
    polished = bare & (polish > .8)
    plain = bare & (polish < .05)
    rough = orm[:, :, 1]/255
    metal = orm[:, :, 2]/255
    metrics['material'] = {'rust_support_percent': float((rust > 0).mean()*100),
                            'rust_visible_percent': float((rust > .05).mean()*100),
                            'thick_rust_percent': float(thick.mean()*100),
                            'bare_metalness_range': [float(metal[bare].min()), float(metal[bare].max())],
                            'thick_rust_metalness_max': float(metal[thick].max()),
                            'polished_roughness_range': [float(rough[polished].min()), float(rough[polished].max())],
                            'plain_roughness_range': [float(rough[plain].min()), float(rough[plain].max())],
                            'thick_rust_roughness_range': [float(rough[thick].min()), float(rough[thick].max())],
                            'AO_range': [float(orm[:, :, 0].min()/255), float(orm[:, :, 0].max()/255)],
                            'AO_mean': float(orm[:, :, 0].mean()/255)}
    assert (rust > 0).mean() <= .20
    assert np.all(metal[bare] == 1)
    assert metal[thick].max() <= .2
    assert rough[polished].max() <= .51 and rough[polished].min() >= .35
    assert rough[plain].min() >= .5 and rough[plain].max() <= .71
    assert rough[thick].min() >= .8 and rough[thick].max() <= 1
    # Alignment: re-encode the stored shared material states and compare every pixel.
    metrics['alignment'] = {}
    for c, field in enumerate(['ao', 'roughness', 'metalness']):
        expected_channel = np.rint(fields[field]*255).astype(np.uint8)
        mismatches = int(np.count_nonzero(expected_channel != orm[:, :, c]))
        metrics['alignment'][field+'_byte_mismatches'] = mismatches
        assert mismatches == 0
    chroma = base[:, :, 0].astype(float)-base[:, :, 2].astype(float)
    metrics['alignment']['thick_rust_without_brown_albedo_pixels'] = int(np.count_nonzero(thick & (chroma < 17)))
    assert metrics['alignment']['thick_rust_without_brown_albedo_pixels'] == 0
    # Measure low-frequency drift and residual directional correlation in albedo.
    lum = np.sum(base.astype(np.float64)*np.array([.2126, .7152, .0722]), axis=2)
    coord = np.linspace(-.5, .5, N)
    slopes = [float(np.dot(coord, lum.mean(axis=k)-lum.mean())/np.dot(coord, coord)) for k in [0, 1]]
    metrics['flatness'] = {'fitted_plane_end_to_end_srgb_u_v': slopes,
                           'luma_slope_correlation_x_y': [float(np.corrcoef(lum.ravel(), d.ravel())[0, 1]) for d in [dx, dy_down]],
                           'quadrant_means': [float(lum[y:y+N//2, x:x+N//2].mean()) for y in [0, N//2] for x in [0, N//2]]}
    # Full-frame diagnostic sheets are downsampled only for display.
    displays = [ims[0], rgb(h16/257), ims[2], ims[3]]
    captions = ['BASE  /  sRGB', 'HEIGHT  /  16-bit, 0–3 mm', 'NORMAL  /  OpenGL, true scale', 'ORM  /  AO · roughness · metal']
    make_sheet(displays, captions, OUT/'layers.jpg', footer='3 × 3 metres  |  2048 × 2048 per map  |  height displayed without contrast stretching')
    offsets = [Image.fromarray(np.roll(np.roll(np.asarray(im), N//2, 0), N//2, 1)) for im in displays]
    make_sheet(offsets, captions, OUT/'offset.jpg', footer='Half-tile wrap on both axes. Original boundary runs through the middle of every panel.')
    # Inspect the actual wrap intersection at native texel density as well.
    indices = (np.arange(-192, 192) % N)
    cross = np.ix_(indices, indices)
    seam_images = [rgb(base[cross]), rgb(shade(base[cross], n[cross], orm[cross], azimuth=35)),
                   rgb(encoded[cross]), rgb(orm[cross])]
    make_sheet(seam_images, ['WRAP  /  unlit base', 'WRAP  /  physical relighting',
                            'WRAP  /  raw normal', 'WRAP  /  packed ORM'], OUT/'seam_detail.jpg',
               side=384, columns=2, footer='Native-resolution intersection of all four tile corners; wrap is at the centre of each panel.')
    tile = ims[0].resize((600, 600), Image.Resampling.LANCZOS)
    tiled = Image.new('RGB', (1800, 1850), (24, 25, 27))
    label(tiled, (16, 15), 'IRON  /  3 × 3 repeats  /  9 × 9 metres  /  unlit base colour', 22)
    for y in range(3):
        for x in range(3): tiled.paste(tile, (x*600, 50+y*600))
    tiled.save(OUT/'tiled3x3.jpg', quality=96, subsampling=0)
    # Four lights on the same full-resolution crop, with unchanged exposure.
    crop_y, crop_x, size = 611, 433, 640
    sl = np.s_[crop_y:crop_y+size, crop_x:crop_x+size]
    lights = [25, 115, 205, 295]
    relit = [rgb(shade(base[sl], n[sl], orm[sl], azimuth=az)) for az in lights]
    make_sheet(relit, [f'LIGHT {az}°  /  elevation 48°' for az in lights], OUT/'relit.jpg',
               side=640, columns=2, footer='Same 0.938 m crop, normal strength 1.0. Linear GGX, 3×3 softbox, neutral environment; fixed exposure.')
    # Native-scale unlit vs independently relit detail, with material channels.
    det = np.s_[902:1414, 1231:1743]
    detail_images = [rgb(base[det]), rgb(shade(base[det], n[det], orm[det], azimuth=35)),
                     rgb(np.repeat(((h_mm[det]-1.0)/.75*255)[:, :, None], 3, -1)),
                     rgb(encoded[det]), rgb(np.repeat(orm[det][:, :, 1, None], 3, -1)),
                     rgb(np.repeat(orm[det][:, :, 2, None], 3, -1))]
    make_sheet(detail_images, ['BASE  /  unlit, native pixels', 'RELIT  /  physical normals',
               'HEIGHT  /  inspection contrast 1–1.75 mm', 'NORMAL  /  raw', 'ROUGHNESS  /  raw', 'METALNESS  /  raw'],
               OUT/'detail.jpg', side=512, columns=3)
    # Dozen independent random strips. All use source UV coordinates with wrapping.
    rng = np.random.default_rng(9471)
    straps = Image.new('RGB', (1740, 1650), (26, 28, 31))
    label(straps, (30, 18), 'TWELVE RANDOM STRAPS  /  actual texture scale  /  bevels added only by preview geometry', 24)
    label(straps, (30, 52), 'Material sampled at 1.46484 mm per texel. Each crop shown at 1.6×. Same neutral metallic lighting.', 18)
    records = []
    for i in range(12):
        width_mm = float(rng.uniform(30, 80))
        length_mm = float(rng.uniform(500, 1400))
        w, length = int(round(width_mm/PITCH)), int(round(length_mm/PITCH))
        sx, sy = rng.integers(0, N, 2)
        vertical = i in [3, 7, 11]
        yys = (np.arange(w)[:, None]+sy) % N
        xxs = (np.arange(length)[None, :]+sx) % N
        if vertical:
            idx = ((np.arange(length)[None, :]+sy) % N, (np.arange(w)[:, None]+sx) % N)
        else:
            idx = (yys, xxs)
        b, o, ns = base[idx].copy(), orm[idx].copy(), n[idx].copy()
        if vertical:
            # Rotate tangent basis with the crop: new +u is old image-down.
            ns = np.stack([-ns[:, :, 1], -ns[:, :, 0], ns[:, :, 2]], -1)
        # Geometric rounded corners and shallow 2 mm bevel; never written to maps.
        mask = Image.new('L', (length, w), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, length-1, w-1), radius=max(2, w//8), fill=255)
        m = np.asarray(mask)>0
        padded = np.pad(m, 1)
        distance = distance_transform_edt(padded)[1:-1, 1:-1]*PITCH
        bevel_h = np.clip(distance/2.7, 0, 1)*1.5
        gy, gx = np.gradient(bevel_h, PITCH)
        ns = normalized(np.stack([ns[:, :, 0]-gx, ns[:, :, 1]+gy, ns[:, :, 2]], -1))
        color = rgb(shade(b, ns, o, azimuth=70, elevation=53, strength=10))
        display_size = (int(length*1.6), int(w*1.6))
        color = color.resize(display_size, Image.Resampling.LANCZOS)
        alpha = mask.resize(display_size, Image.Resampling.LANCZOS)
        y = 121+i*124
        shadow = Image.new('RGB', display_size, (14, 15, 17))
        straps.paste(shadow, (160, y+5), alpha)
        straps.paste(color, (155, y), alpha)
        label(straps, (24, y), f'{i+1:02d}  {width_mm:.0f} mm', 19)
        label(straps, (24, y+27), f'{length_mm/1000:.2f} m', 17)
        records.append({'index': i+1, 'width_mm': width_mm, 'length_mm': length_mm,
                        'pixel_width': w, 'pixel_length': length, 'x': int(sx), 'y': int(sy),
                        'direction': 'v' if vertical else 'u',
                        'rust_percent': float((rust[idx]>.05).mean()*100)})
    straps.save(OUT/'straps.jpg', quality=96, subsampling=0)
    (OUT/'strap_samples.json').write_text(json.dumps(records, indent=2)+'\n')
    metrics['all_checks_passed'] = True
    metrics['check_seconds'] = time.perf_counter()-started
    (OUT/'metrics.json').write_text(json.dumps(metrics, indent=2)+'\n')
    print(json.dumps({k: v for k, v in metrics.items() if k not in ['files', 'seams']}, indent=2))


if __name__ == '__main__':
    main()
