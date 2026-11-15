#!/usr/bin/env python3
"""Independent validation and previews of the delivered PNGs; does not rebuild."""
from pathlib import Path
import hashlib
import io
import json
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageCms
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
OUT.mkdir(exist_ok=True)
N, PITCH_MM = 2048, 750./2048
METRICS, RESULTS = {}, []


def require(name, ok, detail=''):
    RESULTS.append((bool(ok), name, detail))


def read(name):
    p = ROOT/name
    data = p.read_bytes()
    width, height, bits, channels = struct.unpack('>IIBB', data[16:26])
    im = Image.open(p)
    require(name+' dimensions', (width, height) == (N, N))
    expected = (16, 0) if 'height' in name else ((8, 0) if 'rough' in name else (8, 2))
    require(name+' PNG bit depth/type', (bits, channels) == expected, str((bits, channels)))
    if 'base' in name:
        profile = im.info.get('icc_profile')
        label = ImageCms.getProfileName(ImageCms.ImageCmsProfile(io.BytesIO(profile))).strip() if profile else ''
        require('Albedo has sRGB profile', 'srgb' in label.lower(), label)
    else:
        require(name+' linear metadata', im.info.get('gamma') == 1.0 and not im.info.get('icc_profile'))
    return np.asarray(im).astype(np.float64)


def normalized(a):
    return a/np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-12)


def corr(a, b):
    a, b = a-a.mean(), b-b.mean()
    return float(np.mean(a*b)/max(np.sqrt(np.mean(a*a)*np.mean(b*b)), 1e-12))


def seam(a, name):
    # A periodic raster's first and last samples are neighbours, not duplicates.
    dx, dy = np.abs(np.diff(a, axis=1)), np.abs(np.diff(a, axis=0))
    sx, sy = np.abs(a[:, 0]-a[:, -1]), np.abs(a[0]-a[-1])
    xmeans = dx.mean(axis=tuple(k for k in range(dx.ndim) if k != 1))
    ymeans = dy.mean(axis=tuple(k for k in range(dy.ndim) if k != 0))
    p95x, p95y = np.percentile(xmeans, 95), np.percentile(ymeans, 95)
    values = dict(wrap_x_mean=float(sx.mean()), wrap_y_mean=float(sy.mean()),
                  interior_line_p95_x=float(p95x), interior_line_p95_y=float(p95y),
                  wrap_x_p99=float(np.percentile(sx, 99)), wrap_y_p99=float(np.percentile(sy, 99)))
    METRICS.setdefault('seams', {})[name] = values
    require(name+' wrap continuity', sx.mean() < 1.7*p95x and sy.mean() < 1.7*p95y, str(values))


def srgb_decode(a):
    return np.where(a <= .04045, a/12.92, ((a+.055)/1.055)**2.4)


def srgb_encode(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= .0031308, 12.92*a, 1.055*a**(1/2.4)-.055)


def image8(a):
    return Image.fromarray(np.rint(np.clip(a, 0, 255)).astype(np.uint8)).convert('RGB')


def sheet(items, name, size=768):
    im = Image.new('RGB', (size*2, (size+42)*2), (27, 29, 29))
    draw = ImageDraw.Draw(im)
    for k, (label, arr) in enumerate(items):
        x, y = (k%2)*size, (k//2)*(size+42)
        pic = arr if isinstance(arr, Image.Image) else image8(arr)
        im.paste(pic.resize((size, size), Image.Resampling.LANCZOS), (x, y+42))
        draw.text((x+16, y+13), label, fill=(230, 230, 225))
    im.save(OUT/name, quality=94, subsampling=0)


def relight(base, normal, rough, light, clay=False):
    l = normalized(np.array(light))
    view = np.array([0., 0., 1.])
    half = normalized(l+view)
    nl = np.maximum((normal*l).sum(2), 0)
    nv = np.maximum(normal[..., 2], .001)
    nh = np.maximum((normal*half).sum(2), 0)
    vh = max(float(half[2]), .001)
    alpha = rough**2
    d = alpha**2/(np.pi*(nh**2*(alpha**2-1)+1)**2)
    k = (rough+1)**2/8
    g = (nl/(nl*(1-k)+k))*(nv/(nv*(1-k)+k))
    f = .04 + .96*(1-vh)**5
    spec = d*g*f/(4*np.maximum(nl*nv, .001))
    albedo = np.full_like(base, .30) if clay else srgb_decode(base/255)
    lit = albedo*(.24+.88*nl[..., None]) + .6*spec[..., None]*nl[..., None]
    return srgb_encode(lit)*255


def main():
    base = read('bark_base.png')
    h = read('bark_height.png')*(10./65535)
    raw_normal = read('bark_normal.png')
    rough = read('bark_rough.png')/255
    require('Finite pixel values', all(np.isfinite(a).all() for a in (base, h, raw_normal, rough)))
    mean = base.mean((0, 1))
    METRICS['mean_srgb'] = mean.tolist()
    METRICS['height_mm'] = dict(min=float(h.min()), max=float(h.max()), mean=float(h.mean()),
                               p01=float(np.percentile(h, 1)), p99=float(np.percentile(h, 99)))
    METRICS['roughness'] = dict(min=float(rough.min()), max=float(rough.max()), mean=float(rough.mean()))
    require('Mean sRGB within 1 level', np.max(np.abs(mean-[146, 134, 116])) < 1, str(mean))
    require('Height does not clip', h.min() > 0 and h.max() < 10)
    require('Smooth skin relief, 99% range below 2 mm', np.percentile(h, 99.5)-np.percentile(h, .5) < 2)
    require('Roughness in requested range', rough.min() >= .55-1/255 and rough.max() <= .85+1/255)

    # Independently reconstruct the OpenGL sign convention from saved height.
    x = (np.roll(h, -1, 1)-np.roll(h, 1, 1))/(2*PITCH_MM)
    y = (np.roll(h, -1, 0)-np.roll(h, 1, 0))/(2*PITCH_MM)
    expected = normalized(np.stack((-x, y, np.ones_like(h)), 2))
    decoded = raw_normal/127.5-1
    actual = normalized(decoded)
    angle = np.degrees(np.arccos(np.clip((expected*actual).sum(2), -1, 1)))
    METRICS['normal'] = dict(mean_error_deg=float(angle.mean()), max_error_deg=float(angle.max()),
                            max_unit_length_error=float(np.max(np.abs(np.linalg.norm(decoded, axis=2)-1))),
                            rms_slope=float(np.sqrt(np.mean(x*x+y*y))))
    require('Normal agrees with saved height at real scale', angle.max() < .4, str(METRICS['normal']))
    require('Normal has outward Z', actual[..., 2].min() > 0)
    for name, a in [('base', base), ('height_mm', h), ('normal', raw_normal), ('roughness', rough)]:
        seam(a, name)

    lum = base[..., 0]*.2126 + base[..., 1]*.7152 + base[..., 2]*.0722
    direction = {}
    for sigma in (2, 8, 24):
        smooth = gaussian_filter(lum, sigma, mode='wrap')
        gx = (np.roll(smooth, -1, 1)-np.roll(smooth, 1, 1))*.5
        gy = (np.roll(smooth, -1, 0)-np.roll(smooth, 1, 0))*.5
        eig = np.linalg.eigvalsh([[np.mean(gx*gx), np.mean(gx*gy)], [np.mean(gx*gy), np.mean(gy*gy)]])
        direction[str(sigma)] = float(eig[-1]/max(eig[0], 1e-12))
    METRICS['directional_energy_ratio'] = direction
    require('No dominant texture axis', max(direction.values()) < 1.8, str(direction))
    coord = np.linspace(-.5, .5, N)
    slope_x = float(np.mean(coord*lum.mean(0))/np.mean(coord**2))
    slope_y = float(np.mean(coord*lum.mean(1))/np.mean(coord**2))
    slope_correlations = [corr(lum, x), corr(lum, y)]
    METRICS['albedo_flatness'] = dict(fitted_edge_to_edge_gradient=[slope_x, slope_y],
                                    correlation_with_height_slopes=slope_correlations)
    require('No broad albedo illumination gradient', max(abs(slope_x), abs(slope_y)) < 3.0)
    require('Albedo is not directional relief lighting', max(abs(c) for c in slope_correlations) < .12)
    hp = lambda a: a-gaussian_filter(a, 5, mode='wrap')
    METRICS['registration'] = dict(base_height_highpass_correlation=corr(hp(lum), hp(h)),
                                   rough_height_highpass_correlation=corr(hp(rough), hp(h)))
    require('Pigment follows shallow creases', METRICS['registration']['base_height_highpass_correlation'] > .3)
    require('Creases rougher than smooth skin', METRICS['registration']['rough_height_highpass_correlation'] < -.1)
    # Power beyond the source's native axial Nyquist: enhancement is measurable.
    f = np.fft.fftfreq(N)
    fy, fx = np.meshgrid(f, f, indexing='ij')
    power = np.abs(np.fft.fft2(h-h.mean()))**2
    high = ((abs(fx) > 1254/(2*N)) | (abs(fy) > 1254/(2*N)))
    METRICS['native_detail_height_power_fraction'] = float(power[high].sum()/power.sum())
    require('Native resolution microdetail present', METRICS['native_detail_height_power_fraction'] > .00005)
    manifest = json.loads((ROOT/'source/manifest.json').read_text())
    for entry in manifest:
        require('Archived source bytes unchanged', hashlib.sha256((ROOT/entry['file']).read_bytes()).hexdigest() == entry['sha256'])

    # Height displayed with the literal 0-10 mm range, not auto-contrasted.
    panels = [('Base colour / sRGB', base), ('Height / 0-10 mm, white high', h*25.5),
              ('OpenGL normal / linear', raw_normal), ('Roughness / linear', rough*255)]
    sheet(panels, 'layers.jpg')
    sheet([(s+' / half-tile offset', np.roll(a, (N//2, N//2), (0, 1))) for s, a in panels], 'offset.jpg')
    tile = image8(base).resize((768, 768), Image.Resampling.LANCZOS)
    repeat = Image.new('RGB', (2304, 2304))
    for j in range(3):
        for i in range(3):
            repeat.paste(tile, (i*768, j*768))
    repeat.save(OUT/'tiled3x3.jpg', quality=94, subsampling=0)
    lights = [(1, .3, 1), (-1, -.3, 1), (.3, 1, 1), (-.3, -1, 1)]
    names = ['Light from right', 'Light from left', 'Light from above', 'Light from below']
    sheet([(name, relight(base, actual, rough, light)) for name, light in zip(names, lights)], 'relit.jpg')
    sheet([(name+' / neutral clay', relight(base, actual, rough, light, True)) for name, light in zip(names, lights)], 'relit_clay.jpg')
    crop = (slice(650, 1418), slice(650, 1418))
    sheet([(s+' / 1:1 detail', a[crop]) for s, a in panels], 'detail.jpg')
    sheet([(f'{k*90} degrees / same unlit material', np.rot90(base, k)) for k in range(4)], 'rotations.jpg')
    METRICS['passed'] = all(v[0] for v in RESULTS)
    (OUT/'metrics.json').write_text(json.dumps(METRICS, indent=2)+'\n')
    lines = [('PASS' if ok else 'FAIL')+'  '+name+('  '+info if info else '') for ok, name, info in RESULTS]
    lines.append(f'{sum(ok for ok, _, _ in RESULTS)}/{len(RESULTS)} checks passed.')
    (OUT/'validation.txt').write_text('\n'.join(lines)+'\n')
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('bark_*.png'))}
    (OUT/'manifest.json').write_text(json.dumps(hashes, indent=2)+'\n')
    print('\n'.join(lines))
    sys.exit(0 if METRICS['passed'] else 1)


if __name__ == '__main__':
    main()
