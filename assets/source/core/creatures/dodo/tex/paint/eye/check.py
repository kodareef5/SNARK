"""Checks and Python position-map previews of the painted eye group.

Run paint.py, then compose.py --out tex/paint/eye/checks/composed, then this file.
These are point-sampled baked surfaces, not an invented eye/lid review shell.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import site
import sys

site.addsitedir(site.getusersitepackages())
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.interpolate import LinearNDInterpolator

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('eye_paint', ROOT / 'paint.py')
paint = importlib.util.module_from_spec(spec); spec.loader.exec_module(paint)
QA = ROOT / 'checks'
PALETTE = ['6B737A', 'D1A292', '8B9166', 'C29533', '312D2A', 'E6E2D6']
REGIONS = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (0, 255, 255), (255, 0, 255), (255, 255, 0)]


def norm(a):
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-12)


def colour(code):
    return paint.lin(np.array([int(code[i:i + 2], 16) for i in (0, 2, 4)]) / 255)


def font(size):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def image(a):
    return Image.fromarray(np.rint(np.clip(a, 0, 1) * 255).astype(np.uint8))


def board(items, columns=3, w=420, h=350):
    out = Image.new('RGB', (columns * w, ((len(items) + columns - 1) // columns) * (h + 38)), (29, 31, 32))
    d = ImageDraw.Draw(out)
    for i, (title, im) in enumerate(items):
        x, y = i % columns * w, i // columns * (h + 38)
        im = im.copy(); im.thumbnail((w - 12, h - 6), Image.Resampling.LANCZOS)
        out.paste(im, (x + (w - im.width) // 2, y + 36 + (h - im.height) // 2))
        d.text((x + 8, y + 9), title, fill=(235, 232, 222), font=font(16))
    return out


def validate():
    meta, piece, pos, ids = paint.load_geometry()
    own = np.isin(piece, [ids[n] for n in paint.NAMES])
    assert np.all(pos[own, 0] > 0), 'Eye pieces must be on the canonical left side'
    layers = ROOT / 'layers'
    rgba = np.asarray(Image.open(layers / 'dodo_base.png'))
    assert rgba.shape == (2048, 2048, 4)
    assert np.array_equal(rgba[..., 3] == 255, own)
    assert not rgba[~own].any()
    b = paint.lin(rgba[..., :3] / 255)
    h = np.asarray(Image.open(layers / 'dodo_height.png'))
    ro = np.asarray(Image.open(layers / 'dodo_rough.png'))
    ao = np.asarray(Image.open(layers / 'dodo_occlusion.png'))
    rg = np.asarray(Image.open(layers / 'dodo_regions.png'))
    baked = np.asarray(Image.open(paint.DODO / 'ref/bakes/dodo_regions.png'))
    assert h.dtype == np.uint16
    assert np.array_equal(rg[own], baked[own])
    for a in (h, ro, ao, rg):
        assert a.shape[:2] == (2048, 2048)
        assert not a[~own].any()
    skin = own & (piece != ids['eye_l'])
    assert np.max(np.ptp(rgba[skin, :3], axis=1)) == 0
    mean = float(b[skin].mean()); assert abs(mean - .5) < .002
    eye = piece == ids['eye_l']
    assert len(np.unique(h[eye])) == 1 and np.all(ro[eye] == 19) and np.all(ao[eye] == 255)
    q = pos[eye] - paint.CENTRE
    object_n = np.asarray(Image.open(paint.DODO / 'ref/bakes/dodo_normal_object.png'), dtype=float)[eye] / 255 * 2 - 1
    normal_agreement = float(np.median(paint.dot(norm(object_n), norm(q))))
    assert normal_agreement > .98, normal_agreement
    black = (b[eye].max(-1) < .015)
    assert np.all(paint.dot(q[black], paint.LOOK) > 0)
    xy = np.stack([paint.dot(q, paint.ACROSS), q[:, 1]], -1) * 1000
    diameter = np.ptp(xy[black], axis=0)
    # Pixel centres bound the fully dark core, excluding antialiased boundary
    # texels; this must be a small bead, not an estimate of the full contour.
    assert np.all((diameter > 2.4) & (diameter < 3.2)), diameter
    # Resolve the antialiased edge at half the nearby iris luminance, rather
    # than treating the bounding box of fully black pixel centres as diameter.
    lum = paint.dot(b[eye], [.2126, .7152, .0722])
    central = (np.linalg.norm(xy, axis=-1) < 4) & (paint.dot(q, paint.LOOK) > 0)
    interpolate = LinearNDInterpolator(xy[central], lum[central])
    axis_samples = np.linspace(-2.5, 2.5, 2001)
    half_diameters = []
    for axis in (0, 1):
        line = np.zeros((len(axis_samples), 2)); line[:, axis] = axis_samples
        value = interpolate(line)
        outside = (np.abs(axis_samples) > 1.9) & (np.abs(axis_samples) < 2.1)
        half = np.mean(value[outside]) * .5
        half_diameters.append(float(np.ptp(axis_samples[value < half])))
    assert all(2.85 < x < 3.15 for x in half_diameters), half_diameters
    # Trace the outer limbal ring from delivered pigments in physical space.
    radius = np.linalg.norm(xy, axis=-1)
    ring = (radius > 10.55) & (radius < 10.85) & (paint.dot(q, paint.LOOK) > .001)
    iris = (radius > 9.0) & (radius < 10.) & (paint.dot(q, paint.LOOK) > .001)
    assert b[eye][ring].mean() < b[eye][iris].mean()
    stats = {'owned_texels': int(own.sum()), 'alpha_exact_ownership': True,
             'regions_match_bake': True, 'face_mean_linear': mean,
             'pupil_dark_core_bounds_mm': diameter.tolist(),
             'pupil_half_luminance_diameter_mm': half_diameters,
             'iris_nominal_mm': 22, 'eye_height_constant': True,
             'eye_object_normal_radial_median_cosine': normal_agreement,
             'eye_roughness': 19 / 255, 'cell_size_from_study_mm': [.5, 1.0],
             'pieces': {}}
    for name in paint.NAMES:
        k = piece == ids[name]
        stats['pieces'][name] = {'texels': int(k.sum()), 'mean_linear_rgb': b[k].mean(0).tolist(),
                                 'height_range_mm': (np.array([h[k].min(), h[k].max()]) / 65535 * paint.HEIGHT_MM).tolist(),
                                 'roughness_range': (np.array([ro[k].min(), ro[k].max()]) / 255).tolist(),
                                 'ao_range': (np.array([ao[k].min(), ao[k].max()]) / 255).tolist()}
    # Both lid faces evaluate exactly the same rim at the shared mesh edge.
    beta = np.linspace(-1.7, 1.7, 128)
    edge = paint.CENTRE + paint.LID_RADIUS * (np.cos(beta)[:, None] * [1, 0, 0] + np.sin(beta)[:, None] * paint.EDGE_FRONT)
    source = paint.sources()
    outside, inside = paint.lid_at(edge, source), paint.lid_at(edge, source, True)
    stats['analytical_rim_max_difference'] = [float(np.max(np.abs(a - b))) for a, b in zip(outside, inside)]
    assert max(stats['analytical_rim_max_difference']) < 1e-10
    stats['sha256'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(layers.iterdir()) if p.is_file()}
    (QA / 'metrics.json').write_text(json.dumps(stats, indent=2) + '\n')
    return stats, meta, piece, pos, ids


def prepare(piece, pos):
    """Lift the composer's tangent normals onto the actual baked surface."""
    folder = QA / 'composed'
    valid = (piece > 0) & (pos[..., 1] > .535)
    pts = pos[valid]
    n = np.asarray(Image.open(paint.DODO / 'ref/bakes/dodo_normal_object.png'), dtype=float)[valid] / 255 * 2 - 1
    # Position and object-normal bakes both describe the canonical +X half.
    n = norm(n)
    dx, dy = paint.derivative(pos, piece, 1)[valid], paint.derivative(pos, piece, 0)[valid]
    t = norm(dx - n * paint.dot(dx, n)[:, None])
    bt = norm(np.cross(n, t))
    bt *= np.where(paint.dot(bt, -dy) < 0, -1, 1)[:, None]
    ts = np.asarray(Image.open(folder / 'dodo_normal.png'), dtype=float)[valid] / 255 * 2 - 1
    nn = norm(t * ts[:, :1] + bt * ts[:, 1:2] + n * ts[:, 2:])
    base = paint.lin(np.asarray(Image.open(folder / 'dodo_base.png'), dtype=float)[valid] / 255)
    reg = np.asarray(Image.open(folder / 'dodo_regions.png'))[valid]
    packed = np.asarray(Image.open(folder / 'dodo_packed.png'), dtype=float)[valid] / 255
    default = base.copy()
    for c, code in zip(REGIONS, PALETTE):
        m = (reg == c).all(-1); default[m] *= colour(code) / .5
    return {'p': pts, 'n': nn, 'geo_n': n, 'base': default, 'neutral': base,
            'region': reg, 'ao': packed[:, 0], 'rough': packed[:, 1], 'piece': piece[valid],
            'dx': dx, 'dy': dy}


def lighting(base, n, view, rough, ao, light):
    light = norm(np.array(light, float)); half = norm(light + view)
    nl, nv = np.maximum(paint.dot(n, light), 0), np.maximum(paint.dot(n, view), .04)
    nh, vh = np.maximum(paint.dot(n, half), 0), paint.dot(view, half)
    alpha2 = np.maximum(rough ** 4, .0015)
    D = alpha2 / (np.pi * (nh * nh * (alpha2 - 1) + 1) ** 2)
    k = (rough + 1) ** 2 / 8
    G = nl / (nl * (1 - k) + k) * nv / (nv * (1 - k) + k)
    F = .035 + .965 * (1 - vh) ** 5
    spec = D * G * F / (4 * np.maximum(nl * nv, .001))
    return base * (.35 + .65 * nl[:, None]) * ao[:, None] + (spec * nl * .8)[:, None]


def render(data, camera, centre, width_m, height_m, ppm=5000, light=(.7, .8, .4), dye=None, unlit=False, only=None, mirror=False):
    view = norm(np.array(camera, float)); right = norm(np.cross([0, 1, 0], view)); up = np.cross(view, right)
    selected = np.ones(len(data['p']), bool) if only is None else np.isin(data['piece'], only)
    p = data['p'][selected]; n = data['n'][selected]; gn = data['geo_n'][selected]
    pdx, pdy = data['dx'][selected], data['dy'][selected]
    base = data['base'][selected].copy(); ao = data['ao'][selected]; rough = data['rough'][selected]
    if dye:
        m = (data['region'][selected] == [0, 255, 0]).all(-1)
        base[m] = data['neutral'][selected][m] * colour(dye) / .5
    if mirror:
        # Add the other side only when displaying the complete bird. This is
        # not a correction to either input bake and never changes painted UVs.
        p = np.concatenate([p, p * [-1, 1, 1]])
        n = np.concatenate([n, n * [-1, 1, 1]])
        gn = np.concatenate([gn, gn * [-1, 1, 1]])
        pdx, pdy = [np.concatenate([a, a * [-1, 1, 1]]) for a in (pdx, pdy)]
        base, ao, rough = [np.concatenate([a, a]) for a in (base, ao, rough)]
    q = p - centre
    w, h = round(width_m * ppm), round(height_m * ppm)
    x, y = np.rint(paint.dot(q, right) * ppm + w / 2).astype(int), np.rint(h / 2 - paint.dot(q, up) * ppm).astype(int)
    z = paint.dot(q, view)
    visible = (paint.dot(gn, view) > -.05) & (x > -2) & (x < w + 2) & (y > -2) & (y < h + 2)
    rx = np.clip(np.ceil((np.abs(paint.dot(pdx, right)) + np.abs(paint.dot(pdy, right))) * ppm * .5), 1, 5).astype(int)[visible]
    ry = np.clip(np.ceil((np.abs(paint.dot(pdx, up)) + np.abs(paint.dot(pdy, up))) * ppm * .5), 1, 5).astype(int)[visible]
    x, y, z = x[visible], y[visible], z[visible]
    rgb = base[visible] if unlit else lighting(base[visible], n[visible], view, rough[visible], ao[visible], light)
    rgb = paint.srgb(rgb)
    # Project each atlas texel's footprint, with a depth buffer. The slightly
    # conservative rectangular splats avoid holes in oblique sparse regions.
    depth = np.full((h, w), -np.inf); out = np.full((h, w, 3), [.145, .155, .16])
    offsets = [(dy, dx) for dy in range(-int(ry.max()), int(ry.max()) + 1) for dx in range(-int(rx.max()), int(rx.max()) + 1)]
    for dy, dx in offsets:
        xx, yy = x + dx, y + dy
        k = (xx >= 0) & (xx < w) & (yy >= 0) & (yy < h) & (abs(dx) <= rx) & (abs(dy) <= ry)
        np.maximum.at(depth, (yy[k], xx[k]), z[k])
    for dy, dx in offsets:
        xx, yy = x + dx, y + dy
        k = (xx >= 0) & (xx < w) & (yy >= 0) & (yy < h) & (abs(dx) <= rx) & (abs(dy) <= ry)
        good = np.flatnonzero(k)
        good = good[z[good] >= depth[yy[good], xx[good]] - 1e-9]
        out[yy[good], xx[good]] = rgb[good]
    return image(out)


def previews(meta, piece, pos, ids):
    data = prepare(piece, pos)
    near = dict(centre=np.array([.043, .588, .177]), width_m=.060, height_m=.048, ppm=8000)
    items = []
    for title, camera in [('Side', [1, 0, 0]), ('Front', [0, 0, 1]), ('Back', [0, 0, -1])]:
        im = render(data, camera, np.array([0, .585, .235]), .26 if title == 'Side' else .16, .105, ppm=4200, mirror=title != 'Side')
        im.save(QA / f'head_{title.lower()}.png'); items.append((title + ' / composed maps', im))
    board(items, columns=1, w=1100, h=480).save(QA / 'head_views.png')
    items = []
    for title, kw in [('Unlit / rose buff', {'unlit': True}), ('Upper front light', {}),
                      ('Low back light', {'light': (.3, -.65, -.8)}), ('Ivory', {'dye': 'E6E2D6'}),
                      ('Dusky taupe', {'dye': 'A09A90'}), ('Lime', {'dye': 'AAEE16'}),
                      ('Near black', {'dye': '171717'}), ('Near white', {'dye': 'F1F1F1'})]:
        items.append((title, render(data, paint.LOOK, **near, **kw)))
    board(items, columns=4).save(QA / 'lid_dyes_relighting.png')
    wet = []
    isolated = dict(data); isolated['ao'] = np.ones_like(data['ao'])
    for title, light in [('Isolated cornea / upper light', (.7, .8, .4)),
                         ('Isolated cornea / lower light', (.7, -.5, .71)),
                         ('Isolated cornea / side light', (1., -.2, -.1))]:
        wet.append((title, render(isolated, paint.LOOK, paint.CENTRE, .029, .029, ppm=11000,
                                  only=[ids['eye_l']], light=light)))
    board(wet, columns=3, w=350, h=340).save(QA / 'cornea_relighting.png')
    # The real eye projection at 100 px iris diameter, with the actual lid.
    ppm = 100 / .022
    eye_centre = paint.CENTRE + np.array([0, .004, 0])
    alone = render(data, paint.LOOK, paint.CENTRE, .029, .029, ppm=ppm, only=[ids['eye_l']], unlit=True)
    side = render(data, [1, 0, 0], eye_centre, .045, .036, ppm=ppm)
    front = render(data, [0, 0, 1], eye_centre, .045, .036, ppm=ppm)
    gaze = render(data, paint.LOOK, eye_centre, .045, .036, ppm=ppm)
    side_ref = Image.open(paint.DODO / 'ref/concept/head_side.png').crop((795, 388, 990, 522))
    front_ref = Image.open(paint.DODO / 'ref/concept/head_front.png').crop((164, 505, 313, 645))
    sheet = Image.new('RGB', (1000, 530), (29, 31, 32)); d = ImageDraw.Draw(sheet)
    d.text((18, 15), 'Actual baked surface / iris 100 px before viewing foreshortening', fill='white', font=font(22))
    for x, title, im in [(18, 'Side concept', side_ref.resize((152, 105), Image.Resampling.LANCZOS)),
                         (230, 'Painted / side', side), (470, 'Painted / look direction', gaze),
                         (730, 'Eye alone / unlit', alone)]:
        d.text((x, 66), title, fill='white', font=font(16)); sheet.paste(im, (x, 94))
    d.text((18, 300), 'Front concept', fill='white', font=font(16)); sheet.paste(front_ref, (18, 328))
    d.text((230, 300), 'Painted / front', fill='white', font=font(16)); sheet.paste(front, (230, 328))
    d.text((470, 335), 'Position-map previews use the composed maps.\nBaked form AO and lighting are preview only.\nThe painter owns eye and upper lid;\nlower-lid skin belongs to the face group.', fill=(200, 200, 193), font=font(16), spacing=8)
    sheet.save(QA / 'concept_comparison.png')
    # Atlas crops display exact delivery coverage, pigment, relief and moisture.
    base = Image.open(ROOT / 'layers/dodo_base.png').convert('RGB')
    tiles = []
    for name in paint.NAMES:
        box = next(p['box'] for p in meta['pieces'] if p['name'] == name)
        for kind in ('base', 'height', 'rough', 'occlusion'):
            im = Image.open(ROOT / f'layers/dodo_{kind}.png').crop(box)
            if kind == 'height': im = image(np.asarray(im, float) / 65535)
            tiles.append((f'{name} / {kind}', im.convert('RGB')))
    board(tiles, columns=4, w=320, h=280).save(QA / 'atlas_layers.png')
    base.thumbnail((1024, 1024)); base.save(QA / 'atlas_coverage.png')


if __name__ == '__main__':
    QA.mkdir(exist_ok=True)
    stats, meta, piece, pos, ids = validate()
    previews(meta, piece, pos, ids)
    print(json.dumps({k: v for k, v in stats.items() if k not in ('sha256', 'pieces')}, indent=2))
