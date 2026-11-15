#!/usr/bin/env python3
"""Independent delivery checks and scale-aware material previews.

Reads the actual PNGs. Outputs diagnostics only in checks/. No engine needed.
"""
from pathlib import Path
import hashlib
import json
import math
import struct
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
TILE_MM, HEIGHT_MM = 400.0, 3.0
RESAMPLE = Image.Resampling.LANCZOS


def font(size=18):
    try:
        return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', size)
    except OSError:
        return ImageFont.load_default(size=size)


def rgb(a):
    return Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8)).convert('RGB')


def panel(items, cols, size=(512, 512), titles=None, footer=None):
    w, h = size
    rows = math.ceil(len(items)/cols)
    out = Image.new('RGB', (cols*w, rows*(h+34)+(38 if footer else 0)), (25, 28, 30))
    draw = ImageDraw.Draw(out)
    for i, item in enumerate(items):
        if isinstance(item, np.ndarray):
            item = rgb(item)
        item = ImageOps.contain(item.convert('RGB'), (w, h), RESAMPLE)
        x, y = (i % cols)*w, (i//cols)*(h+34)
        draw.text((x+10, y+7), titles[i] if titles else str(i), fill=(225, 223, 214), font=font(12 if w < 200 else 17))
        out.paste(item, (x+(w-item.width)//2, y+34+(h-item.height)//2))
    if footer:
        fs = 15
        while draw.textbbox((0, 0), footer, font=font(fs))[2] > cols*w-24 and fs > 9:
            fs -= 1
        draw.text((12, rows*(h+34)+8), footer, fill=(220, 220, 210), font=font(fs))
    return out


def save(im, name):
    if name.endswith('.jpg'):
        im.save(OUT/name, quality=94, subsampling=0)
    else:
        im.save(OUT/name)


def to_linear(s):
    s = s.astype(np.float32)/255
    return np.where(s <= .04045, s/12.92, ((s+.055)/1.055)**2.4)


def to_srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= .0031308, a*12.92, 1.055*a**(1/2.4)-.055)*255


def normalize(a):
    return a/np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-9)


def shade(base, normal, orm, light, neutral=False):
    """Linear-light Lambert + dielectric GGX (F0 .04), constant ambient.

    Diagnostic renderer; no geometry displacement or ray traced self shadows.
    """
    n = normalize(normal.astype(np.float32))
    l = normalize(np.array(light, np.float32))
    v = np.array([0, 0, 1], np.float32)
    half = normalize(l+v)
    nl = np.maximum(n@l, 0)
    nv = np.maximum(n[..., 2], .001)
    nh = np.maximum(n@half, 0)
    vh = float(half[2])
    rough = orm[..., 1].astype(np.float32)/255
    ao = orm[..., 0].astype(np.float32)/255
    a2 = rough**4
    d = a2/(np.pi*(nh*nh*(a2-1)+1)**2+.00001)
    k = (rough+1)**2/8
    g = (nl/(nl*(1-k)+k+.0001))*(nv/(nv*(1-k)+k))
    fresnel = .04+.96*(1-vh)**5
    spec = d*g*fresnel/(4*nv*nl+.001)
    albedo = np.full_like(base, .30, np.float32) if neutral else to_linear(base)
    result = albedo*(.24*ao[..., None]+.90*nl[..., None]) + .85*spec[..., None]*nl[..., None]
    return rgb(to_srgb(result))


def sample(a, y, x):
    """Periodic bilinear sampling at texel-centre coordinates."""
    iy, ix = np.floor(y).astype(np.int32), np.floor(x).astype(np.int32)
    wy, wx = y-iy, x-ix
    h, w = a.shape[:2]
    if a.ndim == 3:
        wy, wx = wy[..., None], wx[..., None]
    return ((1-wy)*((1-wx)*a[iy % h, ix % w]+wx*a[iy % h, (ix+1) % w])+
            wy*((1-wx)*a[(iy+1) % h, ix % w]+wx*a[(iy+1) % h, (ix+1) % w]))


def cylinder(base, normal, orm, diameter_mm=30, length_mm=400, ppm=1500,
             start_x_mm=0, rotation=0, light=(-.63, .28, .72), pad=18):
    """Orthographic cylinder. Texture x is physical distance around the surface.

    On a trimmed circumference the two UV strip endpoints are not the texture's
    periodic boundary. Back-side view intentionally exposes that UV discontinuity.
    """
    # Approximate mip selection at the projected surface scale. Prevent native
    # 2K fibres from aliasing into false coarse grain on a 39–66 pixel cylinder.
    resolution = max(32, min(base.shape[0], round(TILE_MM/1000*ppm)))
    if resolution < base.shape[0]:
        base = np.asarray(Image.fromarray(base).resize((resolution, resolution), Image.Resampling.BOX))
        orm = np.asarray(Image.fromarray(orm).resize((resolution, resolution), Image.Resampling.BOX))
        normal = np.stack([np.asarray(Image.fromarray(normal[..., c]).resize((resolution, resolution),
                           Image.Resampling.BOX)) for c in range(3)], -1)
        normal = normalize(normal)
    pxmm = ppm/1000
    h, w = int(round(length_mm*pxmm)), int(round(diameter_mm*pxmm))
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    # The diagnostic silhouette is an ideal cylinder, not an authored tool mesh.
    centre = (w-1)/2
    s = (xx-centre)/(w/2)
    theta = np.arcsin(np.clip(s, -.9999, .9999))
    circumference = np.pi*diameter_mm
    # Local cylinder wraps its selected strip; the explicit seam is on its rear.
    arclength = ((theta+np.pi+rotation)/(2*np.pi)*circumference) % circumference
    u = (start_x_mm+arclength)/TILE_MM*base.shape[1]-.5
    tex_y = (yy+.5)/pxmm/TILE_MM*base.shape[0]-.5
    b = sample(base, tex_y, u)
    nt = normalize(sample(normal, tex_y, u))
    o = sample(orm, tex_y, u)
    st, ct = np.sin(theta), np.cos(theta)
    # Tangent +x around cylinder, +y upwards, normal pointing outwards.
    nw = np.stack((ct*nt[..., 0]+st*nt[..., 2], nt[..., 1],
                   -st*nt[..., 0]+ct*nt[..., 2]), -1)
    im = shade(b, nw, o, light)
    canvas = Image.new('RGB', (w+pad*2, h+pad*2), (39, 43, 45))
    canvas.paste(im, (pad, pad))
    return canvas


def normal_expected(height):
    """Independent implementation; no imports from build_material."""
    h = height.astype(np.float64)*(HEIGHT_MM/65535)
    step = TILE_MM/len(h)
    # np.gradient's axes increase right/down; OpenGL tangent Y increases up.
    padded = np.pad(h, 1, mode='wrap')
    gx = (padded[1:-1, 2:]-padded[1:-1, :-2])/(2*step)
    gy = (padded[2:, 1:-1]-padded[:-2, 1:-1])/(2*step)
    v = normalize(np.stack((-gx, gy, np.ones_like(h)), -1))
    return np.rint((v+1)*127.5).astype(np.uint8), v


def chunks(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, found = 8, []
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos+4])[0]
        kind = data[pos+4:pos+8].decode('ascii')
        found.append(kind)
        if kind == 'IHDR':
            width, height, depth, typ = struct.unpack('>IIBB', data[pos+8:pos+18])
        pos += 12+length
    return dict(width=width, height=height, bit_depth=depth, colour_type=typ, chunks=found)


def down(a):
    n = a.shape[0]//2
    shape = (n, 2, n, 2, a.shape[2]) if a.ndim == 3 else (n, 2, n, 2)
    return a.astype(np.float64).reshape(shape).mean((1, 3))


def seam(a, axis):
    a = a.astype(np.float64)
    edge = np.abs(np.take(a, 0, axis=axis)-np.take(a, -1, axis=axis))
    diff = np.abs(np.diff(a, axis=axis))
    axes = tuple(i for i in range(a.ndim) if i != axis)
    lines = diff.mean(axis=axes)
    result = dict(wrap_mean=float(edge.mean()), interior_mean=float(diff.mean()),
                  interior_line_p95=float(np.percentile(lines, 95)),
                  wrap_p99=float(np.percentile(edge, 99)))
    result['ratio_to_interior_p95'] = result['wrap_mean']/max(result['interior_line_p95'], 1e-8)
    return result


def main():
    OUT.mkdir(exist_ok=True)
    metrics = dict(scale=dict(metres_per_tile=.4, full_encoded_height_mm=HEIGHT_MM,
                              mm_per_2048_texel=TILE_MM/2048), files={}, normals={},
                   seams={}, downsample={}, provenance={})
    sets = {}
    failures = []
    for n, suffix in [(2048, ''), (1024, '_1024')]:
        maps = {}
        for name in ['base', 'height', 'normal', 'orm']:
            path = ROOT/f'wood_{name}{suffix}.png'
            info = chunks(path)
            a = np.asarray(Image.open(path))
            maps[name] = a
            info['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            info['bytes'] = path.stat().st_size
            metrics['files'][path.name] = info
            assert info['width'] == info['height'] == n
            assert info['bit_depth'] == (16 if name == 'height' else 8)
            assert info['colour_type'] == (0 if name == 'height' else 2)
            if name == 'base':
                assert 'iCCP' in info['chunks']
            else:
                assert not set(info['chunks']) & {'iCCP', 'sRGB', 'gAMA'}
            metrics['seams'][path.name] = {label: seam(a, axis) for label, axis in [('x', 1), ('y', 0)]}
            for axis, result in metrics['seams'][path.name].items():
                if result['ratio_to_interior_p95'] > 1.5:
                    failures.append(f'{path.name} {axis} wrap exceeds 1.5 x interior line p95')
        expected, true_normals = normal_expected(maps['height'])
        actual = maps['normal']
        error = np.abs(actual.astype(int)-expected.astype(int))
        decoded = normalize(actual.astype(np.float64)/127.5-1)
        angle = np.degrees(np.arccos(np.clip(np.sum(decoded*true_normals, axis=-1), -1, 1)))
        tilt = np.degrees(np.arccos(np.clip(true_normals[..., 2], -1, 1)))
        metrics['normals'][str(n)] = dict(mismatched_channels=int(np.count_nonzero(error)),
                  max_byte_error=int(error.max()), mean_angle_degrees=float(angle.mean()),
                  max_angle_degrees=float(angle.max()), tilt_percentiles_degrees=np.percentile(tilt, [50, 95, 99, 100]).tolist())
        assert error.max() == 0
        assert np.all(maps['orm'][..., 2] == 0)
        sets[n] = maps

    maps = sets[2048]
    b, h, nm, o = [maps[x] for x in ['base', 'height', 'normal', 'orm']]
    n = normalize(nm.astype(np.float32)/127.5-1)
    for name in maps:
        expected = down(maps[name])
        actual = sets[1024][name].astype(np.float64)
        e = expected-actual
        peak = 65535 if name == 'height' else 255
        mse = float(np.mean(e**2))
        psnr = 10*np.log10(peak*peak/max(mse, 1e-20))
        metrics['downsample'][name] = dict(filter='2x2 box, encoded values', psnr_db=float(psnr),
                                         mean_abs_error=float(np.abs(e).mean()), max_error=float(np.abs(e).max()))
        assert psnr >= 30
        if name != 'normal':
            assert np.array_equal(np.rint(expected).astype(actual.dtype), actual)

    metrics['colour'] = dict(mean_srgb=b.mean((0, 1)).tolist(), std_srgb=b.std((0, 1)).tolist(),
                             min_rgb=b.min((0, 1)).tolist(), max_rgb=b.max((0, 1)).tolist())
    metrics['height_mm'] = dict(min=float(h.min()/65535*HEIGHT_MM), max=float(h.max()/65535*HEIGHT_MM),
                                percentiles=np.percentile(h/65535*HEIGHT_MM, [1, 50, 99]).tolist())
    metrics['orm'] = dict(ao_min=float(o[..., 0].min()/255), ao_mean=float(o[..., 0].mean()/255),
                          ao_p50=float(np.median(o[..., 0])/255), roughness_percentiles=np.percentile(o[..., 1]/255, [0, 1, 50, 99, 100]).tolist(),
                          metalness_nonzero=int(np.count_nonzero(o[..., 2])))
    construction = np.load(ROOT/'source/construction_fields.npz')
    mask = construction['cavity_support']
    metrics['orm']['ao_outside_authored_cavities_nonwhite'] = int(np.count_nonzero((mask < 1e-6) & (o[..., 0] != 255)))
    assert metrics['orm']['ao_outside_authored_cavities_nonwhite'] == 0
    gx = np.diff(b.astype(float), axis=1)
    gy = np.diff(b.astype(float), axis=0)
    metrics['grain'] = dict(cross_to_along_gradient_energy_ratio=float(np.mean(gx**2)/np.mean(gy**2)),
                           native_residual_std_bytes=float((b.astype(float)-np.repeat(np.repeat(down(b), 2, 0), 2, 1)).std()))
    # Actual physical widths, sampled from several arbitrary starting points.
    strip_metrics, strips = [], []
    for start, width in [(0, 80), (66, 94.25), (144, 88), (226, 81.68), (309, 95)]:
        xs = np.arange(round(width/TILE_MM*2048))+round(start/TILE_MM*2048)
        s = b[:, xs % 2048]
        strip_metrics.append(dict(start_mm=start, width_mm=width, mean_srgb=s.mean((0, 1)).tolist()))
        strips.append(Image.fromarray(s).resize((round(width*1.5), 600), RESAMPLE))
    metrics['haft_strips'] = strip_metrics
    colmeans = b.astype(float).mean(0)
    rowmeans = b.astype(float).mean(1)
    ramp = np.linspace(-.5, .5, 2048)
    metrics['colour']['linear_ramp_x_srgb'] = (ramp@colmeans/(ramp@ramp)).tolist()
    metrics['colour']['linear_ramp_y_srgb'] = (ramp@rowmeans/(ramp@ramp)).tolist()

    # Full-tile views, offsets, and large/small 3x3 repeats.
    height_view = rgb((h.astype(np.float32)/65535*HEIGHT_MM-1.15)/.90*255)
    layers = panel([Image.fromarray(b), height_view, Image.fromarray(nm), Image.fromarray(o)], 4,
                   titles=['sRGB base / flat reflectance', 'Height / display 1.15–2.05 mm', 'OpenGL normal / physical scale', 'ORM / linear R AO, G rough, B 0'])
    save(layers, 'layers.jpg')
    offsets = panel([Image.fromarray(np.roll(a, (1024, 1024), (0, 1))) for a in [b, np.asarray(height_view), nm, o]], 2,
                    titles=['Base / half offset in x + y', 'Height / half offset', 'Normal / half offset', 'ORM / half offset'])
    save(offsets, 'offsets.jpg')
    save(Image.fromarray(np.roll(b, (1024, 1024), (0, 1))), 'offset_base_native.png')
    save(Image.fromarray(np.roll(nm, (1024, 1024), (0, 1))), 'offset_normal_native.png')
    for size, name in [(384, 'tile_3x3_small.jpg'), (1024, 'tile_3x3_large.jpg')]:
        unit = np.asarray(Image.fromarray(b).resize((size, size), RESAMPLE))
        save(Image.fromarray(np.tile(unit, (3, 3, 1))), name)
    # 6K repeat preserves all native texels for close inspection.
    save(Image.fromarray(np.tile(b, (3, 3, 1))), 'tile_3x3_native.jpg')
    seam_items = []
    for a in (b, nm, o):
        rolled = np.roll(a, (1024, 1024), (0, 1))
        seam_items += [Image.fromarray(rolled[768:1280, 896:1152]),
                       Image.fromarray(rolled[896:1152, 768:1280]).transpose(Image.Transpose.ROTATE_90)]
    save(panel(seam_items, 6, (256, 512),
               titles=['Base X seam', 'Base Y rotated', 'Normal X', 'Normal Y rotated', 'ORM X', 'ORM Y rotated']), 'native_wrap_strips.png')

    left = shade(b, n, o, (-.68, .22, .70))
    right = shade(b, n, o, (.68, -.22, .70))
    neutral_left = shade(b, n, o, (-.90, .16, .40), True)
    neutral_right = shade(b, n, o, (.90, -.16, .40), True)
    save(left, 'lit_left.png')
    save(right, 'lit_right.png')
    save(neutral_left, 'neutral_rake_left.png')
    save(neutral_right, 'neutral_rake_right.png')
    relit = panel([left, right, neutral_left, neutral_right], 2,
                  titles=['Warm wood / left key light', 'Warm wood / opposite key light',
                          'Neutral relief / left raking light', 'Neutral relief / right raking light'])
    save(relit, 'relighting.jpg')
    ao = rgb(o[..., 0])
    rough = rgb(o[..., 1])
    save(panel([ao, rough], 2, titles=['AO / only true cavity support', 'Roughness / linear grayscale']), 'orm_channels.jpg')

    # Four feature crops, each at native size and without resizing.
    centres = [(int(.417*2048), int(.758*2048)), (int(.272*2048), int(.623*2048)),
               (int(.494*2048), int(.184*2048)), (1400, 1300)]
    feature_images, feature_titles = [], []
    for label, (cx, cy) in zip(['Twig knot', 'Fine check', 'Cambium sliver', 'Grain + scrapes'], centres):
        for name, a in [('base', b), ('height', np.asarray(height_view)), ('normal', nm), ('lit', np.asarray(left))]:
            ys, xs = (np.arange(256)+cy-128) % 2048, (np.arange(256)+cx-128) % 2048
            feature_images.append(Image.fromarray(a[ys[:, None], xs[None, :]]))
            feature_titles.append(label+' / '+name)
    native = panel(feature_images, 4, (256, 256), titles=feature_titles)
    save(native, 'native_features.png')
    strip_sheet = panel(strips, 5, (164, 600), titles=[f'{m["width_mm"]:g} mm at x {m["start_mm"]}' for m in strip_metrics],
                        footer='400 mm long, 1500 pixels/metre; five unrolled haft circumferences')
    save(strip_sheet, 'haft_strips.png')

    # Honest 1500 px/m views, and enlarged diagnostic cylinders on several strips.
    cylinders, cylinder_titles = [], []
    for diameter, start in [(30, 0), (30, 66), (26, 144), (26, 226)]:
        for rotation in [0, np.pi]:
            cylinders.append(cylinder(b, n, o, diameter_mm=diameter, start_x_mm=start, rotation=rotation))
            cylinder_titles.append(f'{diameter} mm / '+('front' if rotation == 0 else 'UV seam'))
    cylinder_sheet = panel(cylinders, 8, (115, 636), titles=cylinder_titles,
                            footer='1500 px/m: diameters 39 / 45 px. Back views expose the selected strip seam.')
    save(cylinder_sheet, 'cylinders_actual_scale.png')
    # Real lengths expose the spear's 4.75 repeats. Keep this tall file unscaled.
    full_hafts = Image.new('RGB', (480, 2920), (25, 28, 30))
    fd = ImageDraw.Draw(full_hafts)
    for i, (diameter, length, start, rotation, title) in enumerate([
            (30, 500, 0, 0, '500 mm / 30 mm'), (30, 500, 66, 0, '500 mm / 30 mm'),
            (26, 1900, 144, 0, '1900 mm / 26 mm'), (26, 1900, 144, np.pi, 'Spear / UV seam')]):
        im = cylinder(b, n, o, diameter_mm=diameter, length_mm=length, ppm=1500,
                      start_x_mm=start, rotation=rotation)
        fd.text((i*120+6, 8), title, font=font(12), fill='white')
        full_hafts.paste(im, (i*120+(120-im.width)//2, 34))
    save(full_hafts, 'full_length_hafts.png')
    closeups = []
    for start, light in [(0, (-.65, .25, .72)), (0, (.65, -.25, .72)),
                         (144, (-.65, .25, .72)), (309, (.65, -.25, .72))]:
        closeups.append(cylinder(b, n, o, diameter_mm=30, length_mm=180, ppm=5000,
                                start_x_mm=start, light=light))
    save(panel(closeups, 4, (230, 936), titles=['Left key / strip 1', 'Right key / strip 1',
                                                'Left key / strip 3', 'Right key / strip 5']), 'cylinders_close.png')
    # User's 50–80 pixel on-screen width, explicitly distinguished from 1500 px/m.
    fp = [cylinder(b, n, o, diameter_mm=30, length_mm=250, ppm=2200, start_x_mm=s,
                   light=l) for s, l in [(0, (-.68, .25, .7)), (66, (.68, .25, .7)),
                                         (144, (-.68, .25, .7)), (226, (.68, .25, .7))]]
    save(panel(fp, 4, (150, 586), titles=['66 px / left light', '66 px / right light', '66 px / left light', '66 px / right light'],
               footer='30 mm haft at 2200 px/m, 250 mm visible. Texture is sampled in physical metres.'), 'first_person.png')

    inventory = Image.new('RGB', (480, 130), (25, 28, 30))
    d = ImageDraw.Draw(inventory)
    swatch = Image.fromarray(b).resize((64, 64), Image.Resampling.BOX)
    inventory.paste(swatch, (15, 42))
    d.text((15, 12), '64 px wood', font=font(15), fill='white')
    icon = cylinder(b, n, o, diameter_mm=30, length_mm=350, ppm=160, pad=0)
    icon_canvas = Image.new('RGB', (64, 64), (39, 43, 45))
    icon_canvas.paste(icon, ((64-icon.width)//2, (64-icon.height)//2))
    inventory.paste(icon_canvas, (145, 42))
    d.text((125, 12), '64 px haft', font=font(15), fill='white')
    mean = tuple(np.rint(b.mean((0, 1))).astype(int))
    d.rectangle((270, 42, 334, 106), fill=mean)
    d.text((252, 12), 'Mean sRGB', font=font(15), fill='white')
    d.text((350, 66), '164,120,76', font=font(15), fill='white')
    save(inventory, 'inventory_64.png')

    # Show downsample comparison and magnified residual (normal only differs).
    comparisons, labels = [], []
    for name in ['base', 'height', 'normal', 'orm']:
        a = sets[1024][name]
        expected = down(maps[name])
        if name == 'height':
            comparisons += [rgb(a/65535*255), rgb(expected/65535*255)]
        else:
            comparisons += [rgb(a), rgb(expected)]
        labels += [f'{name}: delivered 1K', f'{name}: area-reduced 2K']
    save(panel(comparisons, 4, (320, 320), titles=labels), 'downsample_comparison.jpg')
    metrics['failures'] = failures
    metrics['passed'] = not failures
    (OUT/'metrics.json').write_text(json.dumps(metrics, indent=2)+'\n')
    summary = Image.new('RGB', (640, 400), (30, 34, 36))
    d = ImageDraw.Draw(summary)
    lines = ['WOOD / 0.40 m repeat / 3 mm encoded range', '',
             'Mean sRGB: '+', '.join(f'{x:.3f}' for x in b.mean((0, 1))),
             'Height: '+f'{h.min()/65535*3:.3f} to {h.max()/65535*3:.3f} mm',
             'Normal reconstruction: exact bytes at 2K and 1K',
             '1K PSNR: '+', '.join(f'{key} {value["psnr_db"]:.1f}' for key, value in metrics['downsample'].items()),
             'Metalness: zero. AO restricted to true cavities.',
             'Roughness median: '+f'{np.median(o[..., 1])/255:.3f}',
             'Native source quilting + authored 2048 detail',
             'Numeric checks: '+('PASS' if not failures else 'REVIEW')]
    for i, line in enumerate(lines):
        d.text((14, 20+i*33), line, font=font(16), fill=(224, 225, 216))
    save(summary, 'summary.png')
    contact = panel([layers, offsets, Image.open(OUT/'tile_3x3_small.jpg'), relit, native,
                     strip_sheet, cylinder_sheet, Image.open(OUT/'cylinders_close.png'),
                     Image.open(OUT/'first_person.png'), inventory,
                     Image.open(OUT/'downsample_comparison.jpg'), summary], 3, (560, 430),
                    titles=['01 / Aligned layers', '02 / Half offsets', '03 / 3 x 3 repeat',
                            '04 / Opposite light + neutral relief', '05 / Native feature detail',
                            '06 / Circumference strips', '07 / Actual-scale cylinder wraps',
                            '08 / Cylinder close views', '09 / First-person 66 px haft',
                            '10 / 64 px inventory', '11 / 2K to 1K', '12 / Checks'])
    save(contact, 'contact_sheet.jpg')
    print(json.dumps({k: metrics[k] for k in ['colour', 'height_mm', 'orm', 'normals', 'downsample', 'grain', 'failures']}, indent=2))
    assert not failures, failures


if __name__ == '__main__':
    if '--verify-rebuild' in sys.argv:
        paths = sorted(ROOT.glob('wood_*.png'))
        before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        subprocess.run([sys.executable, str(ROOT/'build_material.py')], cwd=ROOT, check=True)
        after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        result = dict(all_eight_byte_identical=(len(paths) == 8 and before == after),
                      before=before, after=after)
        OUT.mkdir(exist_ok=True)
        (OUT/'rebuild_verification.json').write_text(json.dumps(result, indent=2)+'\n')
        assert result['all_eight_byte_identical'], 'Rebuild changed a delivery PNG'
    main()
