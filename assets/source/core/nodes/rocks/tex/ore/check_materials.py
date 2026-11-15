#!/usr/bin/env python3
"""Independent validation and diagnostic rendering of the delivered PNG files.

Does not import the builder. Run after build_materials.py. Previews are CPU
height-field/BRDF diagnostics, not claims about the game's rendering pipeline.
"""
from pathlib import Path
import hashlib
import json
import struct
import time
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
N = 2048
MM_PER_PIXEL = 1500/2048


def read(name):
    return np.asarray(Image.open(ROOT/name)).astype('f')


def to_linear(x):
    return np.where(x <= .04045, x/12.92, ((x+.055)/1.055)**2.4)


def to_srgb(x):
    return np.where(x <= .0031308, 12.92*x, 1.055*np.maximum(x, 0)**(1/2.4)-.055)


def normal_decode(a):
    v = a/127.5-1
    return v/np.maximum(np.linalg.norm(v, axis=2)[..., None], 1e-9)


def normal_from_height(h):
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))/(2*MM_PER_PIXEL)
    dy = (np.roll(h, -1, 0)-np.roll(h, 1, 0))/(2*MM_PER_PIXEL)
    v = np.stack((-dx, dy, np.ones_like(h)), 2)
    return v/np.linalg.norm(v, axis=2)[..., None]


def light(base, normal, rough, metal, direction=(.65, .55, .85), energy=2.5):
    """Linear-light Cook–Torrance GGX + Schlick Fresnel, correlated Smith masking.

    Perceptual roughness squared gives alpha. Metal uses tinted F0 and has no
    Lambertian diffuse; dielectric F0 is .04. Four small area-source samples
    prevent point-light spikes from masquerading as glitter.
    """
    c = to_linear(base/255)
    m = metal[..., None]
    f0 = .04*(1-m) + c*m
    # Broad ambient hemisphere approximation, subdued on metals.
    result = c*(1-m)*.38 + f0*(.14+.035*(1-rough[..., None]))
    nv = np.clip(normal[..., 2:3], .001, 1)
    a2 = (rough[..., None]**2)**2
    V = np.array([0, 0, 1], dtype='f')
    for ox, oy in ((-.055, -.055), (.055, -.055), (-.055, .055), (.055, .055)):
        L = np.array(direction, dtype='f') + [ox, oy, 0]
        L /= np.linalg.norm(L)
        H = L+V
        H /= np.linalg.norm(H)
        nl = np.clip(np.sum(normal*L, axis=2, keepdims=True), .001, 1)
        nh = np.clip(np.sum(normal*H, axis=2, keepdims=True), 0, 1)
        vh = max(float(H[2]), .001)
        D = a2 / (np.pi*(nh*nh*(a2-1)+1)**2 + 1e-9)
        gv = 2*nv/(nv+np.sqrt(a2+(1-a2)*nv*nv))
        gl = 2*nl/(nl+np.sqrt(a2+(1-a2)*nl*nl))
        F = f0+(1-f0)*(1-vh)**5
        specular = D*gv*gl*F/(4*nv*nl+1e-8)
        diffuse = (1-F)*(1-m)*c/np.pi
        result += (diffuse+specular)*nl*(energy/4)
    return np.clip(to_srgb(result)*255, 0, 255).astype('uint8')


def pil(a):
    if a.ndim == 2:
        a = np.repeat(a[..., None], 3, axis=2)
    return Image.fromarray(np.uint8(np.clip(a, 0, 255)))


def thumb(a, size):
    return pil(a).resize((size, size), Image.Resampling.LANCZOS)


def font(size):
    for p in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size=size)


def strip(panels, size=512, heading=None, crop=None):
    top = 64 if heading else 0
    im = Image.new('RGB', (size*len(panels), size+48+top), (25, 28, 30))
    draw = ImageDraw.Draw(im)
    if heading:
        draw.text((18, 16), heading, fill=(230, 233, 229), font=font(23))
    for i, (title, a) in enumerate(panels):
        draw.text((i*size+14, top+13), title, fill=(217, 222, 217), font=font(20))
        if crop is not None:
            a = a[crop]
        im.paste(thumb(a, size), (i*size, top+48))
    return im


def save(im, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, quality=88, subsampling=0, optimize=True)


def wrap_metrics(a):
    ax = np.abs(np.diff(a, axis=1))
    ay = np.abs(np.diff(a, axis=0))
    # A seam is an adjacent sample pair, not a duplicated row/column.
    ex = np.abs(a[:, 0]-a[:, -1])
    ey = np.abs(a[0]-a[-1])
    dims_x = (0, 2) if a.ndim == 3 else (0,)
    dims_y = (1, 2) if a.ndim == 3 else (1,)
    rx = np.mean(ax, axis=dims_x)
    ry = np.mean(ay, axis=dims_y)
    return {
        'wrap_mean_x': float(ex.mean()), 'wrap_mean_y': float(ey.mean()),
        'interior_mean_x': float(ax.mean()), 'interior_mean_y': float(ay.mean()),
        'interior_scanline_p95_x': float(np.percentile(rx, 95)),
        'interior_scanline_p95_y': float(np.percentile(ry, 95)),
        'wrap_p95_x': float(np.percentile(ex, 95)), 'wrap_p95_y': float(np.percentile(ey, 95)),
    }


def spectral_metrics(base):
    lum = base.mean(axis=2)
    # Plane fit reports broad directional drift in 8-bit levels over one tile.
    axis = np.linspace(-.5, .5, N)
    slope_x = float(np.dot(lum.mean(axis=0), axis)/np.dot(axis, axis))
    slope_y = float(np.dot(lum.mean(axis=1), axis)/np.dot(axis, axis))
    # Symmetric differences: forward dx/dy share a sample and falsely report
    # diagonal correlation on perfectly isotropic high-frequency texture.
    dx = (np.roll(lum, -1, 1)-np.roll(lum, 1, 1))*.5
    dy = (np.roll(lum, -1, 0)-np.roll(lum, 1, 0))*.5
    C = np.array([[np.mean(dx*dx), np.mean(dx*dy)], [np.mean(dx*dy), np.mean(dy*dy)]])
    ev = np.linalg.eigvalsh(C)
    low = ndi.gaussian_filter(lum, 12, mode='wrap')
    low -= low.mean()
    peak = 0.
    for shift in (256, 341, 512, 683, 1024):
        for axis_id in (0, 1):
            corr = float(np.mean(low*np.roll(low, shift, axis_id))/(np.mean(low*low)+1e-8))
            peak = max(peak, corr)
    return {'plane_drift_x_levels': slope_x, 'plane_drift_y_levels': slope_y,
            'gradient_anisotropy_ratio': float(ev[1]/max(ev[0], 1e-8)),
            'max_tested_subtile_correlation': peak}


def checks():
    OUT.mkdir(exist_ok=True)
    metrics = {'materials': {}, 'files': {}, 'assertions': []}
    failures = []
    def verify(ok, message):
        metrics['assertions'].append({'pass': bool(ok), 'check': message})
        if not ok:
            failures.append(message)
    metadata = json.loads((ROOT/'build_metadata.json').read_text())
    # Infer physical phases independently from delivered pigment; compare
    # these masks to the build's hashes, without retaining rebuildable arrays.
    vb = read('vein_base.png')
    vl = vb.mean(axis=2)
    fields = {'quartz': ((vb[..., 0]-vb[..., 2])/np.maximum(vl, 1) < .20) & (vl > 120),
              'tarnish': vl < 85}
    fields['sulphide'] = ~(fields['quartz'] | fields['tarnish'])
    mats = {}
    preview_rows = []
    offset_rows = []
    relit_rows = []
    dirs = ((.65, .55, .85), (-.65, .55, .85), (-.65, -.55, .85), (.65, -.55, .85))
    dir_names = ('North-east light', 'North-west light', 'South-west light', 'South-east light')
    for name in ('stone', 'fresh', 'vein', 'rust'):
        print(f'Checking and rendering {name}...', flush=True)
        folder = OUT/name
        folder.mkdir(exist_ok=True)
        layers = ['base', 'cover'] if name == 'rust' else ['base', 'height', 'normal', 'rough'] + (['metal'] if name == 'vein' else [])
        data = {}
        panels = []
        for layer in layers:
            filename = f'{name}_{layer}.png'
            path = ROOT/filename
            im = Image.open(path)
            a = np.asarray(im).astype('f')
            data[layer] = a
            # IHDR checks actual PNG channel type/depth, independently of Pillow mode.
            w, h, depth, color = struct.unpack('>IIBB', path.read_bytes()[16:26])
            expected_color = 2 if layer in ('base', 'normal') else 0
            expected_depth = 16 if layer == 'height' else 8
            verify((w, h, depth, color) == (N, N, expected_depth, expected_color), f'{filename}: size and PNG channel encoding')
            verify(bool(im.info.get('icc_profile')) == (layer == 'base'), f'{filename}: sRGB profile only on base colour')
            units = a*20/65535 if layer == 'height' else a
            wm = wrap_metrics(units)
            for axis in ('x', 'y'):
                verify(wm[f'wrap_mean_{axis}'] < wm[f'interior_scanline_p95_{axis}']*1.4+.002, f'{filename}: {axis} wrap is within natural interior variation')
            metrics['files'][filename] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'mean': a.mean(axis=(0, 1), dtype=np.float64).tolist(), 'min': float(a.min()), 'max': float(a.max()), 'wrap': wm}
            vis = a/257 if layer == 'height' else a
            panels.append((layer.upper(), vis))
            shifted = np.roll(vis, (N//2, N//2), (0, 1))
        mats[name] = data
        base = data['base']
        tile = thumb(base, 512)
        sheet = Image.new('RGB', (1536, 1536))
        for y in range(3):
            for x in range(3):
                sheet.paste(tile, (x*512, y*512))
        save(sheet, folder/'tiled3x3.jpg')
        row = strip(panels, 448, name.upper()+' | 1.5 m tile | base sRGB; other maps linear')
        save(row, folder/'layers.jpg')
        preview_rows.append(row)
        row2 = strip([(t, np.roll(v, (1024, 1024), (0, 1))) for t, v in panels], 448, name.upper()+' | half-tile wrap offset')
        save(row2, folder/'offset.jpg')
        offset_rows.append(row2)
        sm = spectral_metrics(base)
        metrics['materials'][name] = sm
        if name in ('stone', 'fresh'):
            target = (74, 76, 70) if name == 'stone' else (98, 100, 96)
            verify(np.max(np.abs(base.mean(axis=(0, 1), dtype=np.float64)-target)) < .03, f'{name}: mean colour within .03 levels of target')
        if name != 'rust':
            normal = normal_decode(data['normal'])
            height = data['height']*20/65535
            expected = normal_from_height(height)
            dots = np.clip(np.sum(normal*expected, axis=2), -1, 1)
            errors = np.degrees(np.arccos(dots))
            metrics['materials'][name].update({
                'height_mm_min': float(height.min()), 'height_mm_max': float(height.max()),
                'height_mm_p01_p99': np.percentile(height, [1, 99]).tolist(),
                'normal_mean_error_degrees': float(errors.mean()), 'normal_max_error_degrees': float(errors.max()),
                'roughness_mean': float((data['rough']/255).mean()),
                'roughness_min_max': [float(data['rough'].min()/255), float(data['rough'].max()/255)],
            })
            verify(errors.max() < .45, f'{name}: saved normal matches true-scale derivative of saved height within RGB8 quantization')
            verify(height.min() > 0 and height.max() < 20, f'{name}: relief does not clip height encoding')
            span = float(np.diff(np.percentile(height, [1, 99]))[0])
            expected_span = (3, 6) if name == 'stone' else ((5, 8) if name == 'fresh' else (2, 5))
            verify(expected_span[0] <= span <= expected_span[1], f'{name}: central 98% relief span meets round-two target')
            local_spans = []
            for y in range(0, N, 256):
                for x in range(0, N, 256):
                    local_spans.append(float(np.diff(np.percentile(height[y:y+256, x:x+256], [1, 99]))[0]))
            metrics['materials'][name]['local_relief_18cm_span_min_median_max'] = [min(local_spans), float(np.median(local_spans)), max(local_spans)]
            if name == 'stone':
                verify(np.mean(np.array(local_spans) >= 3) > .95, 'stone: at least 3 mm relief in over 95% of 18 cm patches')
                grey = base.mean(axis=2)
                metrics['materials'][name]['pigment_luminance_percentiles'] = np.percentile(grey, [.1, 1, 50, 99, 99.9]).tolist()
                verify(grey.min() < 40 and grey.max() > 118, 'stone: mineral pigment reaches dark grains and light specks')
            verify(data['normal'][..., 2].min() > 127, f'{name}: all normal vectors face outward')
            low, high = (.25, .5) if name == 'vein' else (.55, .80)
            verify(data['rough'].min()/255 >= low-1/255 and data['rough'].max()/255 <= high+1/255, f'{name}: roughness in requested range')
            verify(sm['gradient_anisotropy_ratio'] < 1.40, f'{name}: no strong preferred texture orientation')
            verify(abs(sm['plane_drift_x_levels']) < 2 and abs(sm['plane_drift_y_levels']) < 2, f'{name}: no broad colour gradient')
            verify(sm['max_tested_subtile_correlation'] < .35, f'{name}: no strong sub-tile copy repetition')
            rough = data['rough']/255
            metal = data.get('metal', np.zeros((N, N), dtype='f'))/255
            # All directions rendered at native texture resolution before reduction.
            rendered = [(dn, light(base, normal, rough, metal, d)) for dn, d in zip(dir_names, dirs)]
            metrics['materials'][name]['relit_white_clip_fraction'] = [float((v.min(axis=2) >= 250).mean()) for _, v in rendered]
            row3 = strip(rendered, 640, name.upper()+' | same surface, four opposing area lights | GGX + metalness')
            save(row3, folder/'relit.jpg')
            relit_rows.append(row3)
            # Native-size crop: 37.5 cm square, shows the texture's actual detail.
            crop = np.s_[640:1152, 640:1152]
            save(strip([(t, v[crop]) for t, v in panels], 512, name.upper()+' | 37.5 cm detail | native pixels'), folder/'detail.jpg')
            save(strip([(t, v[crop]) for t, v in rendered], 512, name.upper()+' | native detail relighting'), folder/'detail_relit.jpg')
            lo, hi = np.percentile(height, [.5, 99.5])
            enhanced = np.clip((height-lo)/(hi-lo)*255, 0, 255)
            if name == 'vein':
                verify(max(metrics['materials'][name]['relit_white_clip_fraction']) < .002, 'vein: no field of clipped white glitter in the four-light preview')
                region = np.s_[640:1152, 640:1152]
                bc, nn, rr, mm = base[region], normal[region], rough[region], metal[region]
                save(strip([('Delivered roughness + metalness', light(bc, nn, rr, mm)),
                            ('Diagnostic: metalness forced to zero', light(bc, nn, rr, np.zeros_like(mm))),
                            ('Diagnostic: uniformly rough (0.8)', light(bc, nn, np.full_like(rr, .8), mm))],
                           512, 'ORE RESPONSE | same pigment, normal, light and exposure'), folder/'brdf_comparison.jpg')
        else:
            # Rust is pigment only: show the same stain over a stone substrate.
            b = mats['stone']['base']
            a = data['cover']/255
            comp = to_srgb(to_linear(b/255)*(1-a[..., None])+to_linear(base/255)*a[..., None])*255
            rn = normal_decode(mats['stone']['normal'])
            rr = mats['stone']['rough']/255*(1-a)+.79*a
            row3 = strip([(dn, light(comp, rn, rr, np.zeros_like(a), d)) for dn, d in zip(dir_names, dirs)], 640,
                         'RUST | coverage over stone | stone relief retained')
            save(row3, folder/'relit.jpg')
            relit_rows.append(row3)
            save(thumb(comp, 1024), folder/'over_stone.jpg')
            cover = data['cover']
            metrics['materials'][name].update({'coverage_mean': float(cover.mean()/255),
                'zero_coverage_fraction': float((cover == 0).mean()), 'full_coverage_fraction': float((cover >= 250).mean()),
                'coverage_p50_p90_p99': (np.percentile(cover, [50, 90, 99])/255).tolist()})
            verify((cover == 0).mean() > .20, 'rust: substantial clean holes')
            verify(cover.max() >= 245, 'rust: some nearly full pigment coverage')
            ex = np.mean(np.abs(np.diff(cover, axis=1)))
            ey = np.mean(np.abs(np.diff(cover, axis=0)))
            metrics['materials'][name]['coverage_direction_ratio_x_over_y'] = float(ex/ey)
            coarse = ndi.gaussian_filter(cover, 12, mode='wrap')
            cx = np.mean(np.abs(np.diff(coarse, axis=1)))
            cy = np.mean(np.abs(np.diff(coarse, axis=0)))
            metrics['materials'][name]['stain_scale_direction_ratio_x_over_y'] = float(cx/cy)
            verify(cx/cy > 2, 'rust: downward elongated structure measured at stain scale, excluding isotropic pigment grain')
            runs = []
            for y in range(0, N, 32):
                row = cover[y] > 100
                delta = np.diff(np.r_[False, row, False].astype('int8'))
                runs.extend((np.flatnonzero(delta == -1)-np.flatnonzero(delta == 1)).tolist())
            metrics['materials'][name]['dense_horizontal_run_width_median_mm'] = float(np.median(runs)*MM_PER_PIXEL)
            verify(np.median(runs)*MM_PER_PIXEL > 12, 'rust: dense tongues are broad stains, median width over 12 mm')
    # Exact mineral identity checks against retained authoring fields.
    m = mats['vein']['metal']
    for phase, expected in (('quartz', 0), ('tarnish', 0), ('sulphide', 255)):
        mask = fields[phase]
        verify(np.all(m[mask] == expected), f'vein: {phase} metalness equals {expected} on every pixel')
        metrics['materials']['vein'][phase+'_fraction'] = float(mask.mean())
        verify(hashlib.sha256(mask.tobytes()).hexdigest() == metadata['recipe']['vein']['phases'][phase]['sha256'], f'vein: {phase} pigment classification agrees with authoring mask hash')
    verify(.06 < fields['quartz'].mean() < .20, 'vein: meaningful but subordinate quartz content')
    verify(.02 < fields['tarnish'].mean() < .12, 'vein: restrained tarnish content')
    verify(np.all(fields['quartz'] | fields['tarnish'] | fields['sulphide']), 'vein: phase masks cover every pixel')
    # Source hashes are validated against the build record.
    for file, record in metadata['sources'].items():
        verify(hashlib.sha256((ROOT/'source'/file).read_bytes()).hexdigest() == record['sha256'], f'source/{file}: original source hash retained')
    for filename, rows in (('layers.jpg', preview_rows), ('offset.jpg', offset_rows), ('relit.jpg', relit_rows)):
        width = max(im.width for im in rows)
        sheet = Image.new('RGB', (width, sum(im.height for im in rows)), (25, 28, 30))
        y = 0
        for row in rows:
            sheet.paste(row, (0, y))
            y += row.height
        save(sheet, OUT/filename)
    # Compact four-material tiling contact sheet, plus individual full sheets above.
    tiled_sheet = Image.new('RGB', (1800, 1880), (25, 28, 30))
    d = ImageDraw.Draw(tiled_sheet)
    for i, name in enumerate(mats):
        x, y = (i % 2)*900, (i//2)*940
        d.text((x+14, y+10), name.upper()+' | 3 x 3 tiles', fill=(235, 235, 229), font=font(22))
        tile = thumb(mats[name]['base'], 300)
        for ty in range(3):
            for tx in range(3):
                tiled_sheet.paste(tile, (x+tx*300, y+40+ty*300))
    save(tiled_sheet, OUT/'tiled3x3.jpg')
    phase_image = np.zeros((N, N, 3), dtype='f')
    for phase, c in (('sulphide', [183, 156, 92]), ('quartz', [180, 190, 201]), ('tarnish', [85, 49, 27])):
        phase_image[fields[phase]] = c
    save(strip([('Base colour', mats['vein']['base']), ('Phase identities', phase_image), ('Metalness', m), ('Roughness', mats['vein']['rough'])],
               640, 'ORE REGISTRATION | brass = metal, blue-grey = quartz, brown = tarnish'), OUT/'mineral_registration.jpg')
    together(mats)
    metrics['passed'] = not failures
    (OUT/'metrics.json').write_text(json.dumps(metrics, indent=2)+'\n')
    (OUT/'manifest.json').write_text(json.dumps({k: v['sha256'] for k, v in metrics['files'].items()}, indent=2)+'\n')
    lines = ['PASS' if not failures else 'FAIL', f'{len(metrics["assertions"])} assertions; {len(failures)} failures.']
    lines += [('PASS ' if a['pass'] else 'FAIL ')+a['check'] for a in metrics['assertions']]
    (OUT/'validation.txt').write_text('\n'.join(lines)+'\n')
    print('\n'.join(lines[:2]+failures), flush=True)
    return not failures


def together(mats):
    """One square metre, explicit authored seam mask and gravity-directed runoff."""
    print('Rendering one-square-metre combined rock...', flush=True)
    s = round(1000/MM_PER_PIXEL)
    yy, xx = np.indices((s, s), dtype='f')
    u = np.arange(s, dtype='f')/s
    path = s*(.23+.22*u)+7*np.sin(u*19)+3*np.sin(u*61)
    width = 4.0+3.0*np.sin(u*16)**2+6*np.exp(-((u-.20)/.055)**2)+9*np.exp(-((u-.73)/.04)**2)
    dist = yy-path[None, :]
    veinmask = np.clip(width[None, :]+.5-np.abs(dist), 0, 1)
    # Thin dark fracture immediately around ore, a simple baked cavity proxy.
    edge = np.exp(-np.maximum(np.abs(dist)-width[None, :], 0)/1.8)*(1-veinmask)
    rng = np.random.default_rng(9914)
    stain = np.zeros((s, s), dtype='f')
    for x0 in np.linspace(45, s-45, 10)+rng.uniform(-30, 30, 10):
        ix = int(np.clip(x0, 0, s-1))
        length = rng.uniform(180, 650)
        spread = rng.uniform(15, 44)
        fall = yy-path[ix]
        t = np.clip(fall/length, 0, 1)
        center = x0+8*np.sin(t*5)+rng.uniform(-20, 20)*t
        width_t = spread*(1-.78*t)*(1+.13*np.sin(t*12))
        trail = np.exp(-.5*((xx-center)/width_t)**2)
        trail += .22*np.exp(-.5*((xx-center)/(width_t*2.1))**2)
        trail += .32*np.exp(-.5*((xx-center-spread*.8*t)/(width_t*.5))**2)
        trail *= (fall > width[ix])*(fall < length)*(1-t)**.5
        trail *= rng.uniform(.65, .98)
        stain = 1-(1-stain)*(1-np.clip(trail, 0, .97))
    crop = np.s_[180:180+s, 240:240+s]
    st, ve, ru = mats['stone'], mats['vein'], mats['rust']
    # Delivered coverage modulates the rock-specific runoff mask.
    coverage = np.clip(stain*(.72+.28*ru['cover'][crop]/255), 0, .85)*(1-veinmask)
    base = to_linear(st['base'][crop]/255)
    base = base*(1-coverage[..., None])+to_linear(ru['base'][crop]/255)*coverage[..., None]
    base *= (1-.08*edge[..., None])
    base = base*(1-veinmask[..., None])+to_linear(ve['base'][crop]/255)*veinmask[..., None]
    color = to_srgb(base)*255
    h = st['height'][crop]*20/65535
    vh = ve['height'][crop]*20/65535
    # For this illustration only: a 0.6 mm seam rise and 0.35 mm recess.
    h = h*(1-veinmask)+(vh+.6)*veinmask-.35*edge
    normal = normal_from_height(h)
    # Avoid unrelated wrap derivatives at the cropped image's outermost pixel.
    normal[[0, -1]] = normal[[1, -2]]
    normal[:, [0, -1]] = normal[:, [1, -2]]
    r = st['rough'][crop]/255*(1-coverage)+.79*coverage
    r = r*(1-veinmask)+ve['rough'][crop]/255*veinmask
    m = ve['metal'][crop]/255*veinmask
    rendered = light(color, normal, r, m, (.8, .6, .85), 2.6)
    save(pil(rendered), OUT/'together.jpg')
    save(pil(color), OUT/'together_flat.jpg')
    save(strip([('Unlit colour', color), ('Sun from upper left', rendered), ('Sun from lower right', light(color, normal, r, m, (-.5, -.35, .95), 2.6))],
               800, 'ONE SQUARE METRE | skin + masked ore seam + downward rust'), OUT/'together_comparison.jpg')
    masks = np.stack((coverage, veinmask, edge), 2)*255
    save(thumb(masks, 768), OUT/'together_masks.jpg')


if __name__ == '__main__':
    start = time.time()
    ok = checks()
    print(f'Checks and previews: {time.time()-start:.1f}s')
    raise SystemExit(0 if ok else 1)
