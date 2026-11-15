"""Fit the accepted eye and lid to their three pieces; no writes outside this folder.

    python3 -I tex/paint/eye/paint.py

All coordinates and feature sizes are in metres on the bird. The atlas is only
the destination. Supersampling is in each destination texel's physical footprint.
"""
from pathlib import Path
import hashlib
import json
import site

site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parent
PAINT = ROOT.parent
DODO = PAINT.parent.parent
STUDY = DODO / 'tex/studies/eye'
CENTRE = np.array([.043, .583, .177])
LOOK = np.array([.70, 0., .71]); LOOK /= np.linalg.norm(LOOK)
ACROSS = np.cross(LOOK, [0., 1., 0.])
EDGE_ANGLE = np.deg2rad(10.)
EDGE_FRONT = np.array([0., np.sin(EDGE_ANGLE), np.cos(EDGE_ANGLE)])
EDGE_UP = np.array([0., np.cos(EDGE_ANGLE), -np.sin(EDGE_ANGLE)])
LID_RADIUS = .0171
FOLD_SPAN = .018  # fit the folds to the exposed hood, independently of cell size
HEIGHT_MM = 1.6
NAMES = ('eye_l', 'lid_l_out', 'lid_l_in')
SAMPLES = 4


def lin(a):
    return np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)


def srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= .0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - .055)


def smooth(lo, hi, a):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def dot(a, b):
    return np.sum(a * b, axis=-1)


def sample(a, u, v, mode='nearest'):
    c = [v * a.shape[0] - .5, u * a.shape[1] - .5]
    if a.ndim == 3:
        return np.stack([map_coordinates(a[..., k], c, order=1, mode=mode)
                         for k in range(a.shape[-1])], -1)
    return map_coordinates(a, c, order=1, mode=mode)


def load_geometry():
    meta = json.loads((PAINT / 'pieces.json').read_text())
    piece = np.asarray(Image.open(PAINT / 'pieces.png'))[..., 0]
    lo, hi = np.array(meta['position_box']['min']), np.array(meta['position_box']['max'])
    pos = np.stack([np.asarray(Image.open(PAINT / f'position_{a}.png'), dtype=float)
                    / 65535 * (hi[k] - lo[k]) + lo[k] for k, a in enumerate('xyz')], -1)
    # Corrected shared maps already describe the canonical +X half. Decode
    # their current position_box directly, without reflecting either frame.
    ids = {p['name']: p['number'] for p in meta['pieces']}
    return meta, piece, pos, ids


def derivative(a, piece, axis):
    plus, minus = np.roll(a, -1, axis), np.roll(a, 1, axis)
    okp, okm = piece == np.roll(piece, -1, axis), piece == np.roll(piece, 1, axis)
    extra = (None,) * (a.ndim - 2)
    return np.where((okp & okm)[(...,) + extra], (plus - minus) * .5,
                    np.where(okp[(...,) + extra], plus - a,
                             np.where(okm[(...,) + extra], a - minus, 0)))


def sources():
    """Same separation and relief strengths as the accepted round-3 builder.

    Recompute from the kept original, never depend on ignored NPZ caches.
    Keep cells independent of the anatomical fit so they stay 0.5–1 mm.
    """
    cfg = json.loads((STUDY / 'config.json').read_text())
    c = cfg['lid']; n = cfg['size_px']
    g = np.asarray(Image.open(STUDY / 'source' / c['source_file']).convert('L')
                   .resize((n, n), Image.Resampling.LANCZOS), dtype=float) / 255
    y, x = np.mgrid[:n, :n].astype(float)
    macro = gaussian_filter(g, 7 * n / 1024) - gaussian_filter(g, 100 * n / 1024)
    macro /= np.percentile(macro, 99) - np.percentile(macro, 1)
    cell_source = g - gaussian_filter(g, 6 * n / 1024)
    cells = map_coordinates(cell_source, [(y - n / 2) / c['cell_scale'] + n / 2,
                            (x - n / 2) / c['cell_scale'] + n / 2], order=3, mode='reflect')
    cells = gaussian_filter(cells, 1.2 * n / 1024)
    cells /= np.percentile(cells, 95) - np.percentile(cells, 5)
    u, v = (x + .5) / n, (y + .5) / n
    border = (c['flat_border_px'] + 2) / 1024
    guard = smooth(border, .055, u) * (1 - smooth(.945, 1 - border, u))
    guard *= smooth(border, .05, v) * (1 - smooth(.975, 1 - border, v))
    macro *= guard * (1 - smooth(.89, .945, v))
    pebbles = gaussian_filter(cells * c['cell_relief_mm'], c['cell_rounding_mm'] / 30 * n)
    eye = lin(np.asarray(Image.open(STUDY / 'eye_base.png'), dtype=float) / 255)
    return {'eye': eye, 'macro': macro, 'cells': cells, 'pebbles': pebbles, 'cfg': cfg}


def eye_at(pos, src):
    q = pos - CENTRE
    u, v = .5 + dot(q, ACROSS) / .026, .5 - q[..., 1] / .026
    rgb = sample(src['eye'], u, v)
    # A front projection must never put another pupil on the back of the ball.
    rgb = np.where((dot(q, LOOK) > 0)[..., None], rgb, lin(np.array([128, 124, 79]) / 255))
    return rgb, np.full(len(q), .8), np.full(len(q), 19 / 255)


def lid_coordinates(pos):
    q = pos - CENTRE
    f, up = dot(q, EDGE_FRONT), dot(q, EDGE_UP)
    elevation = np.arctan2(up, np.hypot(q[..., 0], f))
    beta = np.arctan2(f, q[..., 0])
    centre_beta = np.arctan2(dot(LOOK, EDGE_FRONT), LOOK[0])
    delta = (beta - centre_beta + np.pi) % (2 * np.pi) - np.pi
    # Sinusoidal chart: distance along each parallel stays physical; the
    # accepted single fold panel fades well before the chart's rear seam.
    along = delta * LID_RADIUS * np.cos(elevation)
    distance = np.maximum(elevation * LID_RADIUS, 0)
    return .5 - along / .030, distance, elevation, delta, q


def lid_at(pos, src, inside=False):
    u, distance, elevation, delta, q = lid_coordinates(pos)
    c = src['cfg']['lid']
    # Quieten the far attachment and polar convergence, where the hood meets
    # the other skin. This is anatomical placement, not directional shading.
    psi = np.arctan2(np.hypot(q[..., 1], q[..., 2]), q[..., 0])
    attachment = 1 - smooth(np.deg2rad(104), np.deg2rad(115), psi)
    chart = 1 - smooth(np.deg2rad(68), np.deg2rad(83), elevation)
    chart *= 1 - smooth(2.6, 3., np.abs(delta))
    skin = smooth(.0006, .0018, distance) * attachment * chart
    # The same 1 mm rounded lip on both faces of their shared physical edge.
    rim = np.exp(-.5 * (distance / .00045) ** 2) * attachment
    if inside:
        # The inner island averages 1.13 mm/texel: sub-mm grain would alias.
        # Smooth mucosal skin with a restrained continuous pigment variation.
        pigment = .005 * rim
        h = .8 + c['rim_lift_mm'] * rim
        rough = .32 * (1 - rim) + c['rim_roughness'] * rim
    else:
        macro = sample(src['macro'], u, .963 - distance / FOLD_SPAN) * attachment * chart
        cells = sample(src['cells'], u, .963 - distance / .030, mode='reflect') * skin
        pebbles = sample(src['pebbles'], u, .963 - distance / .030, mode='reflect') * skin
        fold_pigment = .15 * np.maximum(macro, 0) ** 3 / .3 ** 2
        fold_pigment += .15 * np.minimum(macro, 0) ** 3 / .7 ** 2
        pigment = .075 * np.tanh(2 * cells) + fold_pigment + .005 * rim
        h = .8 + macro * c['fold_relief_mm'] + pebbles + c['rim_lift_mm'] * rim
        rough = c['skin_roughness'] + .016 * np.tanh(-cells) - .025 * np.maximum(macro, 0)
        rough = rough * (1 - rim) + c['rim_roughness'] * rim
    return np.repeat((.5 + pigment)[..., None], 3, axis=-1), h, rough


def fine_occlusion(height, piece, mm, own):
    """Local height horizons only. The composer owns the model's form AO."""
    result = np.ones_like(height)
    ys, xs = np.nonzero(own)
    centre = height[ys, xs]
    occ = np.zeros(len(ys))
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1)):
        horizon = np.zeros_like(centre)
        for radius in (1, 2, 4, 8):
            xx, yy = np.clip(xs + dx * radius, 0, height.shape[1] - 1), np.clip(ys + dy * radius, 0, height.shape[0] - 1)
            same = piece[yy, xx] == piece[ys, xs]
            span = .5 * (mm[ys, xs] + mm[yy, xx]) * radius * np.hypot(dx, dy)
            slope = np.where(same, np.maximum(height[yy, xx] - centre, 0) / np.maximum(span, .01), 0)
            horizon = np.maximum(horizon, slope)
        occ += horizon / np.sqrt(1 + horizon * horizon) / 8
    result[ys, xs] = np.clip(1 - .75 * occ, .68, 1)
    return result


def save(path, a, colour=False, height=False):
    info = PngImagePlugin.PngInfo()
    info.add(b'gAMA', (45455 if colour else 100000).to_bytes(4, 'big'))
    if colour:
        info.add(b'sRGB', b'\x00')
    v = np.rint(np.clip(a, 0, 1) * (65535 if height else 255)).astype(np.uint16 if height else np.uint8)
    Image.fromarray(v).save(path, pnginfo=info)


def paint():
    meta, piece, pos, ids = load_geometry()
    own = np.isin(piece, [ids[n] for n in NAMES])
    ys, xs = np.nonzero(own)
    p, index = pos[ys, xs], piece[ys, xs]
    dx, dy = derivative(pos, piece, 1)[ys, xs], derivative(pos, piece, 0)[ys, xs]
    src = sources()
    rgb, height, rough = np.zeros((len(p), 3)), np.zeros(len(p)), np.zeros(len(p))
    offsets = (np.arange(SAMPLES) + .5) / SAMPLES - .5
    for sy in offsets:
        for sx in offsets:
            q = p + sx * dx + sy * dy
            for name in NAMES:
                m = index == ids[name]
                values = eye_at(q[m], src) if name == 'eye_l' else lid_at(q[m], src, name == 'lid_l_in')
                rgb[m] += values[0] / SAMPLES ** 2
                height[m] += values[1] / SAMPLES ** 2
                rough[m] += values[2] / SAMPLES ** 2
    skin = index != ids['eye_l']
    # Shared correction preserves the pigment agreement across the lid seam.
    rgb[skin] += .5 - rgb[skin].mean()
    assert rgb.min() >= 0 and rgb.max() <= 1
    assert height.min() > 0 and height.max() < HEIGHT_MM
    n = meta['size']; rgba = np.zeros((n, n, 4)); h = np.zeros((n, n)); ro = np.zeros((n, n))
    rgba[ys, xs, :3], rgba[ys, xs, 3] = srgb(rgb), 1
    h[ys, xs], ro[ys, xs] = height, rough
    mm = np.asarray(Image.open(PAINT / 'texel_mm.png'), dtype=float) / 1000
    oc = fine_occlusion(h, piece, mm, own)
    oc[~own] = 0
    # The eye's surface is a smooth wet cornea, with no pigment-derived relief.
    oc[piece == ids['eye_l']] = 1
    reg = np.zeros((n, n, 3), np.uint8)
    baked = np.asarray(Image.open(DODO / 'ref/bakes/dodo_regions.png').convert('RGB'))
    reg[own] = baked[own]
    out = ROOT / 'layers'; out.mkdir(exist_ok=True)
    save(out / 'dodo_base.png', rgba, colour=True)
    save(out / 'dodo_height.png', h / HEIGHT_MM, height=True)
    save(out / 'dodo_rough.png', ro)
    save(out / 'dodo_occlusion.png', oc)
    save(out / 'dodo_regions.png', reg / 255)
    inputs = [STUDY / 'eye_base.png', STUDY / 'config.json',
              STUDY / 'source' / src['cfg']['lid']['source_file'],
              PAINT / 'pieces.json', PAINT / 'pieces.png', PAINT / 'texel_mm.png',
              DODO / 'ref/bakes/dodo_regions.png']
    inputs += [PAINT / f'position_{a}.png' for a in 'xyz']
    info = {'height_mm': HEIGHT_MM, 'pieces': list(NAMES),
            'projection': 'Front planar iris; physical arc coordinates along the lid free edge',
            'eye_centre_m': CENTRE.tolist(), 'eye_look': LOOK.tolist(),
            'iris_diameter_mm': 22, 'pupil_diameter_mm': 3,
            'lid_cell_panel_mm': 30, 'lid_fold_panel_mm': [30, FOLD_SPAN * 1000],
            'rim_width_mm': 1, 'samples_per_texel': SAMPLES ** 2,
            'inputs_sha256': {str(p.relative_to(DODO)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}}
    (out / 'layers.json').write_text(json.dumps(info, indent=2) + '\n')
    print(json.dumps({'painted_texels': len(p), 'face_mean_linear_before_quantization': float(rgb[skin].mean()),
                      'height_mm_range': [float(height.min()), float(height.max())]}))


if __name__ == '__main__':
    paint()
