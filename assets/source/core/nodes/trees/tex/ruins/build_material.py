#!/usr/bin/env python3
"""Build the non-repeating Ruins atlas from the five retained generated paintings.

Python 3 + numpy, scipy, Pillow. All paths are relative to this script.
No network, model calls, external assets, or files outside this folder are needed.
Height is in millimetres internally; quantize BEFORE differentiating the normal.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, distance_transform_edt, map_coordinates, label, binary_fill_holes

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
CHECKS = ROOT / 'checks'
LAYOUT = json.loads((ROOT / 'guide/LAYOUT.json').read_text())
SIZE = 2048
HEIGHT_RANGE_MM = 48.0
DATUM_MM = 24.0
SEED = 752019
WRAPS = {'pole', 'post', 'car'}
# A newly generated ICC profile embeds a clock timestamp. Freeze the standard
# profile once, so PNG bytes as well as pixels are reproducible across runs.
SRGB = (SOURCE/'srgb.icc').read_bytes()
# IDs are diagnostic, not an extra runtime texture requirement.
IDS = {'concrete': 1, 'rust': 2, 'steel': 3, 'paint': 4,
       'lichen': 5, 'rubber': 6, 'glass': 7, 'void': 8, 'zinc': 9}


def smoothstep(a, b, v):
    t = np.clip((v-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def blur(a, sigma, wrap=False):
    mode = ('reflect', 'wrap' if wrap else 'reflect')
    if a.ndim == 3:
        return np.stack([gaussian_filter(a[..., c], sigma, mode=mode) for c in range(a.shape[2])], -1)
    return gaussian_filter(a, sigma, mode=mode)


def resize(a, w, h):
    if a.ndim == 2:
        return np.asarray(Image.fromarray(a.astype(np.float32)).resize((w, h), Image.Resampling.LANCZOS))
    return np.stack([resize(a[..., c], w, h) for c in range(a.shape[2])], -1)


def read(name):
    return np.array(Image.open(SOURCE / (name + '_generated.png')).convert('RGB'), dtype=np.float32)


def tall_panels(name, width):
    """Register upper/lower source halves, feather 128 px of distinct shaft.

    The column capital's last moulding lands at row 273 (0.6 / 4.5 * 2048).
    Source halves have more native pixels than their eventual atlas footprints.
    """
    a = read(name)
    left, right = a[:, 2:625], a[:, 630:-2]
    if name == 'column':
        yy, xx = np.meshgrid(np.interp(np.arange(1088), [0, 273, 1087], [0, 286, 1253]),
                             np.linspace(0, left.shape[1]-1, width), indexing='ij')
        upper = np.stack([map_coordinates(left[..., c], [yy, xx], order=1, mode='nearest') for c in range(3)], -1)
    else:
        upper = resize(left, width, 1088)
    lower = resize(right, width, 1088)
    # Subtle per-channel offset reconciles the two independent exposure baselines.
    correction = np.median(upper[-128:], axis=(0, 1))-np.median(lower[:128], axis=(0, 1))
    lower += np.clip(correction, -10, 10)[None, None] * np.linspace(1, 0, 1088)[:, None, None]
    out = np.zeros((2048, width, 3), dtype=np.float32)
    out[:1088], out[960:] = upper, lower
    yy, xx = np.mgrid[:128, :width]
    # An irregular transition avoids a horizontal construction line.
    offset = 10*np.sin(xx/87)+5*np.sin(xx/23)
    t = smoothstep(4, 124, yy+offset)[..., None]
    out[960:1088] = upper[960:]*(1-t)+lower[:128]*t
    return out


def close_wrap(a, radius, centre):
    """Replace the circumference join with adjacent samples from one interior strip.

    No mirrored pixels, duplicated endpoint, or forced flat normal. Both sides of
    the join sample consecutive source columns. C2 fade to the original away from
    the join. Feature geometry is preserved outside the narrow repair corridor.
    """
    out = a.copy()
    w = a.shape[1]
    for x in list(range(radius))+list(range(w-radius, w)):
        d = x if x < radius else x-w
        u = abs((d+.5)/radius)
        weight = 1-(6*u**5-15*u**4+10*u**3)
        out[:, x] = a[:, x]*(1-weight)+a[:, centre+d]*weight
    return out


def save_png(path, array, kind):
    info = PngImagePlugin.PngInfo()
    info.add_text('Material', 'Ruins / swallowed city / original authored atlas')
    info.add_text('Color space', 'sRGB' if kind == 'base' else 'linear data; disable sRGB decoding')
    if kind == 'height':
        info.add_text('Height range', '0..65535 = 0..48 millimetres; white high; nominal surface 24 mm')
    if kind == 'normal':
        info.add_text('Normal convention', 'OpenGL tangent space; +X image-right, +Y image-up, +Z out')
        info.add_text('Derivation', 'Central difference of delivered quantized 16-bit height, physical per-island texel pitch')
    if kind == 'orm':
        info.add_text('Channels', 'R ambient occlusion; G roughness; B metalness; linear')
    extra = {'icc_profile': SRGB} if kind == 'base' else {}
    Image.fromarray(array).save(path, pnginfo=info, **extra)


def mm_noise(shape, pitch, rng, wrap, amplitude):
    noise = rng.normal(0, 1, shape).astype(np.float32)
    fine = blur(noise, (.55, .55), wrap)
    fine /= max(float(fine.std()), .001)
    medium = blur(noise, (max(.6, 1.7/pitch[1]), max(.6, 1.7/pitch[0])), wrap)
    medium /= max(float(medium.std()), .001)
    return (fine*.65+medium*.35)*amplitude


def metal_fields(a, pitch, rng, wrap):
    grey = np.sum(a * np.array([.2126, .7152, .0722]), axis=2)
    r, g, b = a.transpose(2, 0, 1)
    chroma = r-g
    # The sources separate brown oxide from grey surviving coating and metal.
    paint = (chroma < 19) & (grey > 91)
    # Classify surviving steel by coherent patches, not each dark rust pit.
    # Rust has dark pits too; pixelwise thresholds cause metallic glitter.
    classified = blur(a, 1.35, wrap)
    cr, cg, cb = classified.transpose(2, 0, 1)
    cl = np.sum(classified*np.array([.2126, .7152, .0722]), axis=2)
    steel = ((cr-cg) < 16) & (cl > 37) & (cl < 87) & ((cg-cb) < 17) & ~paint
    fine = np.clip((grey-blur(grey, 2.2, wrap))/32, -1.5, 1.5)
    scales = np.clip((blur(grey, .7, wrap)-blur(grey, 10, wrap))/42, -1, 1)
    pits = smoothstep(6, 30, blur(grey, 2.0, wrap)-grey)
    flakes = smoothstep(6, 28, grey-blur(grey, 4, wrap))
    h = DATUM_MM+.34*scales+.18*fine-.38*pits+.22*flakes
    h += mm_noise(grey.shape, pitch, rng, wrap, .045)
    h[paint] = DATUM_MM+.13+.08*fine[paint]
    h[steel] = DATUM_MM-.28+.10*fine[steel]
    rough = np.clip(.80+.065*pits-.025*flakes+.025*scales, .72, .9)
    rough[paint] = .73+.025*fine[paint]
    rough[steel] = .50+.035*fine[steel]
    metal = np.zeros_like(grey)
    metal[steel] = .55
    ids = np.full(grey.shape, IDS['rust'], np.uint8)
    ids[paint], ids[steel] = IDS['paint'], IDS['steel']
    return h, rough, metal, ids, fine


def concrete(a, name, pitch, rng):
    wrap = name in WRAPS
    hh, ww = a.shape[:2]
    y, x = np.mgrid[:hh, :ww]
    grey = np.sum(a * np.array([.2126, .7152, .0722]), axis=2)
    r, g, b = a.transpose(2, 0, 1)
    local = blur(grey, 12, wrap)
    fine = np.clip((grey-blur(grey, 2, wrap))/20, -1.5, 1.5)
    valley = np.maximum(blur(grey, 2.4, wrap)-grey, 0)
    crack = smoothstep(4, 22, valley)
    edge = np.exp(-np.minimum(x, ww-1-x)/35) if name == 'column' else np.ones_like(grey)*.5
    # Local depression evidence, not broad brightness: dark damp is not a trench.
    chip = smoothstep(5, 32, local-grey)*(0.45+.55*edge)
    chip = blur(chip, .65, wrap)
    rust = smoothstep(13, 33, r-g) * smoothstep(9, 24, g-b)
    if name == 'column':
        rust *= np.clip(edge*2.3, 0, 1)
    lichen = (grey > local+12) & ((r-g) < 19) & (grey > 140)
    h = DATUM_MM + .16*fine - 6.0*chip - 1.1*crack
    h += mm_noise(grey.shape, pitch, rng, wrap, .055)
    h += lichen*.12
    # Exposed steel sits below the former plaster surface, above its chipped bed.
    if name == 'column':
        h -= rust*2.4
        profile_y = [0, 64, 72, 96, 106, 178, 185, 199, 210, 251, 261, 269, 277, 289, 2047]
        profile_h = [5.5, 5.5, 7, 7, 2.0, 2.0, 6.0, 6.0, 1.0, 1.0, 4.0, 4.0, 0, 0, 0]
        profile = np.interp(np.arange(hh), profile_y, profile_h)
        profile = gaussian_filter(profile, 1.0)
        h += profile[:, None]*(1-.85*chip)
        # Loss of the upper corner, also present in the source painting.
        corner = smoothstep(405, 497, x)* (1-smoothstep(42, 99, y))
        damage = corner*smoothstep(4, 27, blur(grey, 28)-grey+8)
        h -= damage*9
    else:
        # Source registration: actual generated bolt holes and broken step stub.
        for cx, cy, rx, ry in [(112, 194, 6.8, 5.5), (103, 872, 5.8, 5.1)]:
            rr = np.sqrt(((x-cx)/rx)**2+((y-cy)/ry)**2)
            hole = 1-smoothstep(.58, 1.12, rr)
            h = h*(1-hole)+(DATUM_MM-10)*hole
            a = a*(1-hole[..., None]*.65)+np.array([53, 48, 36])*hole[..., None]*.65
        step_area = (x>358)&(x<430)&(y>790)&(y<824)
        step = blur((step_area & ((r-g)>16)).astype(float), .7, wrap)
        h += 3.2*step
    rough = np.clip(.85+.025*chip+.025*crack+.012*fine, .81, .93)
    rough[lichen] = .93
    rough = rough*(1-rust*.4)+.82*rust*.4
    ids = np.full(grey.shape, IDS['concrete'], np.uint8)
    ids[lichen] = IDS['lichen']
    ids[rust>.58] = IDS['rust']
    metal = np.zeros_like(grey)
    # No directional macro-light; retain mineral colour and attenuate source microshading.
    a = .84*a+.16*blur(a, .65, wrap)
    a += np.array([2.0, 4.5, 7.0])
    a += mm_noise(grey.shape, pitch, rng, wrap, .7)[..., None]
    return a, h, rough, metal, ids


def build_post(a, pitch, rng):
    h, rough, metal, ids, fine = metal_fields(a, pitch, rng, True)
    y, x = np.mgrid[:a.shape[0], :a.shape[1]]
    grey = a.mean(2)
    zinc = (y>170)&(y<320)&((a[..., 0]-a[..., 1])<23)&(grey>88)
    ids[zinc], metal[zinc], rough[zinc] = IDS['zinc'], .58, .52
    h[zinc] = DATUM_MM+.1+.05*fine[zinc]
    # The lower olive film is biological residue, not surviving metal.
    damp = (y>1560)&((a[..., 1]-a[..., 2])>12)&((a[..., 0]-a[..., 1])<22)
    ids[damp], metal[damp], rough[damp] = IDS['lichen'], 0, .91
    a = .82*a+.18*blur(a, .6, True)
    a += np.array([4, 2, 1])+mm_noise(grey.shape, pitch, rng, True, .9)[..., None]
    return a, h, rough, metal, ids


def build_sign(a, pitch, rng, back):
    h, rough, metal, ids, fine = metal_fields(a, pitch, rng, False)
    hh, ww = a.shape[:2]
    y, x = np.mgrid[:hh, :ww]
    # Bending is physical deformation; it never modifies base colour shading.
    for cx, cy, rx, ry, depth in ([(210, 235, 80, 90, 1.1), (310, 615, 70, 130, 1.8)] if back
                                 else [(240, 510, 62, 90, 2.2), (60, 172, 80, 120, 1.2)]):
        h -= depth*np.exp(-.5*(((x-cx)/rx)**2+((y-cy)/ry)**2))
    grey = a.mean(2)
    # Exactly two existing holes in each face. Preserve ragged generated contours.
    holes = np.zeros_like(grey, bool)
    for cx in [23, 360]:
        region = ((x-cx)/7)**2+((y-365)/17)**2 < 1
        components, count = label(region & (grey<45))
        if count:
            sizes = np.bincount(components.ravel())
            sizes[0] = 0
            holes |= binary_fill_holes(components == sizes.argmax())
    if not holes.any():
        raise RuntimeError('Sign mounting hole segmentation failed')
    h[holes] = DATUM_MM-7
    ids[holes], rough[holes], metal[holes] = IDS['void'], 1, 0
    a[holes] = [25, 23, 19]
    a = .86*a+.14*blur(a, .65)
    a += mm_noise(grey.shape, pitch, rng, False, .65)[..., None]
    return a, h, rough, metal, ids


def build_car(a, pitch, rng):
    h, rough, metal, ids, fine = metal_fields(a, pitch, rng, True)
    hh, ww = a.shape[:2]
    y, x = np.mgrid[:hh, :ww]
    grey = np.sum(a * np.array([.2126, .7152, .0722]), axis=2)
    # Texture topology from guide: two window bands, divided by the painted pillars.
    win_envelope = (((x>242)&(x<351))|((x>416)&(x<525))) & (y>349)&(y<1008)
    void = win_envelope & (grey<34)
    # Thin isolated glass teeth keep their generated silhouette and have low roughness.
    glass = win_envelope & ~void & (grey<102) & ((a[..., 0]-a[..., 1])<17)
    distance = distance_transform_edt(~void, sampling=(pitch[1], pitch[0]))
    frame_drop = np.exp(-distance/7)*12.5
    h -= frame_drop
    h[void] = 9.0
    ids[void], rough[void], metal[void] = IDS['void'], 1, 0
    ids[glass], rough[glass], metal[glass] = IDS['glass'], .34, 0
    h[glass] = DATUM_MM-2.0+.08*fine[glass]
    # Replace the source aperture's residual gradients with unlit absorptive interiors.
    dark_noise = mm_noise(grey.shape, pitch, rng, True, .65)
    a[void] = np.array([20, 22, 19])+dark_noise[void, None]
    rubber = np.zeros(grey.shape, bool)
    for cx in [84, 684]:
        for cy in [282, 973]:
            envelope = ((x-cx)/53)**2+((y-cy)/143)**2 < 1
            rubber |= envelope & (grey<72)&((a[..., 0]-a[..., 1])<18)
    ids[rubber], rough[rubber], metal[rubber] = IDS['rubber'], .95, 0
    h[rubber] = DATUM_MM-2.4+.42*fine[rubber]
    a[rubber] = a[rubber]*.60+np.array([30, 31, 27])*.40
    # The two outer strips are corroded/undersealed chassis, not polished steel.
    # Dark protective residue must not acquire metalness from its dark colour.
    underside = (x<48)|(x>=720)
    coated = underside & (ids==IDS['steel'])
    ids[coated] = IDS['paint']
    metal[underside] = 0
    rough[underside] = .87+.025*fine[underside]
    # Pressed and buckled body, including long diagonal root-pressure scars.
    body = ~void & ~rubber & ~glass
    dents = np.zeros_like(grey)
    for cx, cy, rx, ry, depth in [(365, 280, 60, 45, 4.4), (387, 580, 29, 110, 6.2),
                                 (391, 840, 24, 50, 3.5), (203, 1080, 66, 58, 4.6),
                                 (581, 568, 55, 80, 3.6), (313, 1110, 60, 50, 3.0)]:
        dents += depth*np.exp(-.5*(((x-cx)/rx)**2+((y-cy)/ry)**2))
    for cy, slope, depth in [(300, -.47, 1.6), (1120, .30, 1.2)]:
        scar = np.exp(-((y-(cy+slope*(x-384)))/6)**2)
        scar *= np.exp(-((x-384)/205)**4)
        dents += depth*scar
    h[body] -= dents[body]
    # Generated panel gaps are shallow recesses, not huge luminance displacements.
    gap = smoothstep(9, 34, blur(grey, 2.4, True)-grey)*body
    h -= gap*1.3
    a = .88*a+.12*blur(a, .55, True)
    a += mm_noise(grey.shape, pitch, rng, True, .75)[..., None]*body[..., None]
    return a, h, rough, metal, ids


def normal_from_height(h_mm, width_mm, height_mm, wrap):
    ph, pw = h_mm.shape
    dx = width_mm/pw
    dy = height_mm/ph
    if wrap:
        gx = (np.roll(h_mm, -1, 1)-np.roll(h_mm, 1, 1))/(2*dx)
    else:
        p = np.pad(h_mm, ((0, 0), (1, 1)), mode='edge')
        gx = (p[:, 2:]-p[:, :-2])/(2*dx)
    p = np.pad(h_mm, ((1, 1), (0, 0)), mode='edge')
    gy = (p[2:]-p[:-2])/(2*dy)
    # Image y increases downward; tangent Y points upward. Hence POSITIVE gy.
    n = np.stack([-gx, gy, np.ones_like(gx)], -1)
    return n/np.linalg.norm(n, axis=-1, keepdims=True)


def ao_from_height(h, ids, pitch, wrap):
    ao = np.ones_like(h)*.993
    for radius, strength in [(1.5, .13), (5, .06), (16, .028)]:
        surroundings = blur(h, (max(.45, radius/pitch[1]), max(.45, radius/pitch[0])), wrap)
        ao -= strength*np.maximum(surroundings-h, 0)
    ao = np.clip(ao, .25, 1)
    ao[ids == IDS['void']] = .22
    return ao


def main():
    CHECKS.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    assembly = {}
    assembly['column'] = tall_panels('column', 512)
    assembly['pole'] = close_wrap(tall_panels('pole', 512), 48, 270)
    assembly['post'] = close_wrap(tall_panels('post', 256), 30, 125)
    sign = read('sign')
    # Crop away the generated outer/background 3px and central separator.
    assembly['sign_front'] = resize(sign[4:622, 4:1250], 384, 768)
    assembly['sign_back'] = resize(sign[633:1250, 4:1250], 384, 768)
    assembly['car'] = close_wrap(resize(read('car'), 768, 1280), 24, 28)
    # Treat front/back sign as distinct UV islands, each physically 0.75m wide.
    islands = {}
    for name, spec in LAYOUT['regions'].items():
        if name == 'sign':
            islands['sign_front'] = {'box': [1280, 0, 1664, 768], 'metres_across': .75, 'metres_down': .45}
            islands['sign_back'] = {'box': [1664, 0, 2048, 768], 'metres_across': .75, 'metres_down': .45}
        else:
            islands[name] = spec
    master = np.zeros((SIZE, SIZE, 3), np.uint8)
    base = master.copy()
    height = np.zeros((SIZE, SIZE), np.uint16)
    normal = master.copy()
    orm = master.copy()
    ids_out = np.zeros((SIZE, SIZE), np.uint8)
    construction = {'height_range_mm': HEIGHT_RANGE_MM, 'nominal_datum_mm': DATUM_MM,
                    'seed': SEED, 'normal_convention': 'OpenGL +Y image-up',
                    'material_ids': IDS, 'islands': {}, 'sources': {}}
    for name, spec in islands.items():
        x0, y0, x1, y1 = spec['box']
        a = assembly[name]
        master[y0:y1, x0:x1] = np.clip(np.rint(a), 0, 255).astype(np.uint8)
        width_mm, height_mm = spec['metres_across']*1000, spec['metres_down']*1000
        pitch = (width_mm/(x1-x0), height_mm/(y1-y0))
        if name in ('column', 'pole'):
            a, h, rough, metal, ids = concrete(a, name, pitch, rng)
        elif name == 'post':
            a, h, rough, metal, ids = build_post(a, pitch, rng)
        elif name.startswith('sign_'):
            a, h, rough, metal, ids = build_sign(a, pitch, rng, name.endswith('back'))
        else:
            a, h, rough, metal, ids = build_car(a, pitch, rng)
        if h.min()<0 or h.max()>HEIGHT_RANGE_MM:
            raise ValueError(f'{name} height outside range: {h.min()}, {h.max()}')
        qh = np.rint(h/HEIGHT_RANGE_MM*65535).astype(np.uint16)
        # Required dependency: normal and AO consume the actual delivered u16 samples.
        decoded = qh.astype(float)/65535*HEIGHT_RANGE_MM
        n = normal_from_height(decoded, width_mm, height_mm, name in WRAPS)
        ao = ao_from_height(decoded, ids, pitch, name in WRAPS)
        base[y0:y1, x0:x1] = np.clip(np.rint(a), 0, 255).astype(np.uint8)
        height[y0:y1, x0:x1] = qh
        normal[y0:y1, x0:x1] = np.clip(np.rint((n*.5+.5)*255), 0, 255).astype(np.uint8)
        orm[y0:y1, x0:x1] = np.clip(np.rint(np.stack([ao, rough, metal], -1)*255), 0, 255).astype(np.uint8)
        ids_out[y0:y1, x0:x1] = ids
        construction['islands'][name] = {**spec, 'wrap_x': name in WRAPS, 'mm_per_pixel_xy': list(pitch),
                                        'height_min_max_mm': [float(decoded.min()), float(decoded.max())]}
    for name, a in [('base', base), ('height', height), ('normal', normal), ('orm', orm)]:
        save_png(ROOT / ('ruins_'+name+'.png'), a, name)
    save_png(SOURCE/'assembled_master.png', master, 'base')
    Image.fromarray(ids_out).save(CHECKS/'material_ids.png')
    for p in sorted(SOURCE.glob('*_generated.png')):
        construction['sources'][p.name] = {'native_size': list(Image.open(p).size),
                                           'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
    (CHECKS/'construction.json').write_text(json.dumps(construction, indent=2)+'\n')
    print('Built four 2048x2048 layers; full height range 48 mm; six independently differentiated UV islands.')


if __name__ == '__main__':
    main()
