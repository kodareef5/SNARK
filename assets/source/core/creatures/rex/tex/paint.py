"""Paint the original Rex into its actual unwrapped triangles. No photographic input."""

from pathlib import Path
import json
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from facial import cheek_folds, labials

OUT = HERE.parents[5] / "var/rex"
MESH = np.load(OUT / "layout.npz")
MATS = json.loads((OUT / "layout.json").read_text())["materials"]
REGIONS = np.array(
    [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 255, 255], [255, 0, 255], [255, 255, 0], [0, 0, 0]], np.uint8
)


def smooth(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def noise(x, y, seed=0):
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = smooth(0, 1, x - ix), smooth(0, 1, y - iy)

    def h(a, b):
        n = np.sin(a * 127.1 + b * 311.7 + seed * 42.77) * 43758.5453
        return (n - np.floor(n)) * 2 - 1

    return (h(ix, iy) * (1 - fx) + h(ix + 1, iy) * fx) * (1 - fy) + (
        h(ix, iy + 1) * (1 - fx) + h(ix + 1, iy + 1) * fx
    ) * fy


def scales(x, y):
    ix, iy = np.floor(x), np.floor(y)
    first = np.full(x.shape, 8.0)
    second = first.copy()
    identity = np.zeros_like(first)
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            a = ix + i
            b = iy + j
            f = np.sin(a * 71.97 + b * 24.18) * 8247.626
            g = np.sin(a * 104.31 + b * 36.57) * 28741.75
            px = a + 0.22 + 0.56 * (f % 1)
            py = b + 0.22 + 0.56 * (g % 1)
            d = np.hypot(x - px, y - py)
            win = d < first
            second = np.where(win, first, np.minimum(d, second))
            first = np.minimum(first, d)
            identity = np.where(win, f % 1, identity)
    return smooth(0.025, 0.18, second - first) * (1 - 0.25 * smooth(0.15, 0.68, first)), identity - 0.5


def raster(mat, size):
    pts = np.zeros((size, size, 3), np.float32)
    used = np.zeros((size, size), bool)
    for tri, uv, mi in zip(MESH["triangles"], MESH["uvs"], MESH["materials"]):
        if mi != mat:
            continue
        uv = uv.copy() * size
        uv[:, 1] = size - uv[:, 1]
        x0, y0 = np.maximum(0, np.floor(uv.min(0)).astype(int))
        x1, y1 = np.minimum(size, np.ceil(uv.max(0)).astype(int) + 1)
        if x0 >= x1 or y0 >= y1:
            continue
        a, b, c = uv
        det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(det) < 1.0e-7:
            continue
        y, x = np.mgrid[y0:y1, x0:x1]
        x = x + 0.5
        y = y + 0.5
        wa = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det
        wb = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det
        wc = 1 - wa - wb
        inside = (wa >= -0.00005) & (wb >= -0.00005) & (wc >= -0.00005)
        p = MESH["points"][tri]
        pts[y0:y1, x0:x1][inside] = (p[0] * wa[..., None] + p[1] * wb[..., None] + p[2] * wc[..., None])[inside]
        used[y0:y1, x0:x1] |= inside
    index = distance_transform_edt(~used, return_distances=False, return_indices=True)
    return pts[index[0], index[1]], index


def maps(p, head):
    x, y, z = np.moveaxis(p, -1, 0)
    y = y + 0.036
    ax = abs(x)
    centre = np.interp(
        z,
        [-7.15, -6, -4, -2, -0.8, 0.4, 1.5, 2.32, 3.05, 3.6, 4.98],
        [1.51, 1.63, 2.25, 2.98, 3.09, 3.03, 3.08, 3.33, 3.64, 3.72, 3.68],
    )
    radius = np.interp(
        z,
        [-7.15, -6, -4, -2, -0.75, 0.4, 1.5, 2.45, 3.35, 4.98],
        [0.02, 0.14, 0.34, 0.56, 0.85, 0.84, 0.59, 0.45, 0.49, 0.19],
    )
    theta = np.arctan2(y - centre, ax)
    arc = theta * radius
    macro = noise(z * 1.65, arc * 2.1, 12) * 0.6 + noise(z * 5.1, y * 4.6, 19) * 0.4
    # Small gathered groups of granular scales on the flank. Scales widen around
    # the brow and turn into transverse plates over the metatarsals.
    pitch = 0.018 if head else 0.029
    if head:
        u = (z + 0.008 * noise(z * 9, y * 8, 3)) / pitch
        v = (y + 0.20 * ax + 0.004 * macro) / (pitch * 0.70)
    else:
        u = (z + 0.22 * ax + 0.009 * macro) / pitch
        v = (arc + 0.37 * y + 0.006 * macro) / (pitch * 0.81)
    dome, tone = scales(u, v)
    feature = np.zeros_like(x)
    if head:
        # Enlarged facial scutes gather on the bony brow, along the cutting margin
        # and above the nostril. Smoothly varying regions retain the small scales
        # in the cheek, around the pupil and across the underside.
        roof = smooth(3.93, 4.13, y) * smooth(2.97, 3.32, z)
        muzzle = np.exp(-(((y - (3.54 + 0.035 * np.sin(z * 4))) / 0.082) ** 2)) * smooth(3.58, 4.05, z)
        nasal = np.exp(-(((y - 3.91) / 0.11) ** 2) - ((z - 4.38) / 0.47) ** 2)
        feature = np.maximum.reduce([roof, muzzle, nasal]) * (0.68 + 0.25 * noise(z * 6, y * 5, 17))
        plate, variation = scales((z + 0.025 * macro) / 0.047, (y + 0.30 * ax + 0.020 * macro) / 0.033)
        dome = dome * (1 - feature) + plate * feature
        tone = tone * (1 - feature) + variation * feature
    else:
        feature = smooth(0.22, 1.12, theta) * (0.6 + 0.24 * macro)
        plate, variation = scales((z + 0.09 * ax + 0.036 * macro) / 0.069, (arc + 0.13 * y + 0.024 * macro) / 0.044)
        dome = dome * (1 - feature) + plate * feature
        tone = tone * (1 - feature) + variation * feature
    # Macrostructure is shared across both UV sets at the head/neck seam.
    # Broad bands follow the nuchal muscles, rib angles and tail taper before
    # the individual scales are shaded. The jaw and maxillary break turn the
    # direction of the compressed folds around the mouth corner.
    cranial = smooth(2.70, 3.30, z)
    extent = np.interp(
        z,
        [-7.12, -4.6, -2.7, -1, 0.45, 1.55, 2.35, 3.20, 4.4, 5.15],
        [0.07, 0.34, 0.58, 0.92, 1.0, 0.85, 0.74, 0.78, 0.48, 0.28],
    )
    skyward = (y - centre) / extent
    # The broad thorax has an uninterrupted side plane. Only the neck
    # bears a short fan of marks, the far tail an interrupted succession;
    # the hip carries a swept dorsal saddle with an irregular lower edge.
    shoulder_window = smooth(0.75, 1.42, z) * (1 - smooth(2.75, 3.09, z))
    tail_window = 1 - smooth(-2.45, -1.75, z)
    undulation = (
        0.14 * np.sin(z * 1.77 + 0.5) + 0.13 * noise(z * 2.5, arc * 3.1, 283) + 0.065 * noise(z * 7.5, arc * 6.4, 55)
    )
    nape = smooth(0.47 + undulation, 0.92 + undulation, skyward)
    belly = (1 - smooth(-0.79, -0.25, skyward)) * (1 - 0.40 * smooth(2.70, 3.25, z))
    bars = np.zeros_like(x)
    for anchor, tilt, width, depth, amp in [
        (-6.23, 0.20, 0.08, 0.04, 0.70),
        (-5.32, 0.26, 0.126, 0.1, 0.77),
        (-4.38, 0.30, 0.173, -0.11, 0.91),
        (-3.60, 0.34, 0.174, 0.08, 0.68),
        (-2.92, 0.34, 0.188, -0.03, 0.81),
        (1.32, -0.20, 0.142, 0.05, 0.65),
        (1.86, -0.25, 0.172, -0.11, 0.85),
        (2.35, -0.14, 0.109, 0.13, 0.60),
    ]:
        descending = np.clip(0.81 - skyward, 0, 1.43)
        centre = anchor + tilt * descending + 0.046 * np.sin(descending * 4 + anchor * 2) + 0.071 * macro
        thick = width * (0.24 + 0.76 * smooth(-0.1, 0.85, skyward))
        mark = amp * np.exp(-(((z - centre) / thick) ** 2)) * smooth(depth, depth + 0.47, skyward)
        bars = np.maximum(bars, mark)
    bars *= np.maximum(shoulder_window, tail_window) * (
        0.57 + 0.43 * smooth(-0.48, 0.45, noise(z * 4, arc * 7 + 0.8, 71))
    )
    loinmark = np.exp(-(((z + 1.31 + 0.34 * (skyward - 0.57)) / 0.745) ** 4)) * smooth(
        0.37 + undulation, 0.81 + undulation, skyward
    )
    bars = np.clip(bars + 0.35 * loinmark, 0, 1)
    flank = np.exp(-(((skyward + 0.14) / 0.48) ** 2)) * smooth(-2.7, -1.30, z) * (1 - smooth(1.60, 2.46, z))
    loin = np.exp(-(((z + 1.23 - 0.58 * (y - 2.9)) / 0.27) ** 2) - ((y - 2.87) / 0.65) ** 2)
    shoulder = np.exp(-(((z - (1.18 - 0.62 * (y - 3.14))) / 0.149) ** 2) - ((y - 3.15) / 0.52) ** 2)
    fold = np.zeros_like(x)
    for z0, arc0, strength in [
        (1.52, 0.28, 0.37),
        (1.68, 0.30, 0.62),
        (1.87, 0.32, 0.83),
        (2.09, 0.34, 0.81),
        (2.33, 0.31, 0.59),
        (2.58, 0.26, 0.38),
    ]:
        line = z0 + arc0 * (y - 3.0) - 0.22 * (y - 3.02) ** 2 + 0.018 * macro
        fold += strength * np.exp(-(((z - line) / 0.023) ** 2) - ((y - (3.10 + 0.19 * (z0 - 1.6))) / 0.41) ** 2)
    fold += 0.47 * np.exp(-(((y - 0.97) / 0.28) ** 2)) * np.maximum(0, np.cos(y * 39 + z * 4 + macro)) ** 3
    fold += (
        0.43
        * np.exp(-(((z - (-0.33 - 0.45 * (y - 2.19))) / 0.040) ** 2) - ((y - 2.28) / 0.31) ** 2)
        * smooth(0.49, 0.72, ax)
    )
    for z0, rise, reach in [(3.05, 0.29, 0.34), (3.16, 0.23, 0.40), (3.25, 0.13, 0.45)]:
        cy = 3.38 + rise * np.exp(-(((z - z0) / 0.31) ** 2)) + 0.065 * (z - 3.4)
        fold += 0.68 * np.exp(-(((y - cy) / 0.016) ** 2) - ((z - 3.37) / reach) ** 4) * cranial
    mouthline = np.interp(
        z,
        [2.85, 3.05, 3.34, 3.49, 3.75, 4.1, 4.27, 4.55, 4.86, 5.14],
        [3.38, 3.37, 3.55, 3.555, 3.451, 3.37, 3.36, 3.39, 3.45, 3.52],
    )
    lip = np.exp(-(((y - mouthline) / 0.028) ** 2)) * smooth(3.23, 3.54, z)
    liplight = np.exp(-(((y - mouthline - 0.068) / 0.051) ** 2)) * smooth(3.49, 3.92, z)
    # The orbital patch is smaller than the jugal field beneath it. A lighter
    # stripe on the bony cheek carries visually from the mouth to the neck.
    eye = np.exp(-(((z - 3.448) / 0.210) ** 2) - ((y - 4.189) / 0.107) ** 2)
    # Darken the sunken wall of the cut itself. The lateral sill remains
    # skin-coloured even at the centre of the opening in a frontal view.
    sill = 3.946 - 0.32 * (z - 4.69)
    nasal_window = 1 - smooth(0.77, 1.03, ((z - 4.679) / 0.20) ** 2 + ((y - (sill - 0.012)) / 0.083) ** 2)
    outside_x = np.interp(z, [4.488, 4.62, 4.71, 4.83], [0.450, 0.412, 0.39, 0.358])
    naris = nasal_window * smooth(0.014, 0.086, outside_x - ax)
    nose_rim = np.exp(-(((y - sill - 0.043) / 0.035) ** 2) - ((z - 4.675) / 0.155) ** 4)
    labial, labial_groove = labials(z, y)
    soft_ridge, soft_crease = cheek_folds(z, y)
    sideface = smooth(0.32, 0.50, ax) * cranial
    labial *= sideface
    labial_groove *= sideface
    soft_ridge *= sideface
    soft_crease *= sideface
    hood = np.exp(-(((y - (4.241 - 0.12 * (z - 3.45))) / 0.066) ** 2) - ((z - 3.438) / 0.192) ** 4)
    lid_edge = np.exp(-(((y - (4.143 + 0.035 * (z - 3.44))) / 0.044) ** 2) - ((z - 3.447) / 0.099) ** 4)
    temporal = np.exp(-(((z - 3.115) / 0.18) ** 2) - ((y - 4.005) / 0.20) ** 2)
    hollow = np.exp(-(((z - 3.941) / 0.32) ** 2) - ((y - (3.967 - 0.15 * (z - 3.88))) / 0.150) ** 2)
    brow = np.exp(-(((y - (4.34 - 0.30 * (z - 3.38))) / 0.094) ** 2) - ((z - 3.40) / 0.39) ** 2)
    jugal = np.exp(-(((y - (3.725 + 0.19 * (z - 3.39))) / 0.111) ** 2) - ((z - 3.40) / 0.46) ** 2)
    cheekband = np.exp(-(((y - (3.635 + 0.32 * (z - 3.18))) / 0.151) ** 2) - ((z - 3.09) / 0.52) ** 2)
    throatlight = np.exp(-(((y - (3.21 + 0.22 * (z - 2.5))) / 0.32) ** 2) - ((z - 2.48) / 0.67) ** 2)
    facewash = smooth(1.25, 3.72, z)
    ginger = facewash * (0.23 + 0.47 * smooth(-0.15, 0.56, skyward) + 0.25 * cheekband + 0.22 * macro)
    band = np.clip(0.50 * nape + 1.20 * bars + 0.72 * hollow + 0.55 * eye + 0.30 * temporal, 0, 1)
    belly = np.clip(
        belly + 0.26 * throatlight + 0.46 * jugal + 0.36 * liplight + 0.32 * (1 - smooth(3.19, 3.48, y)) * cranial, 0, 1
    )
    limb = (1 - smooth(1.26, 2.90, y)) * smooth(-1.70, -0.90, z) * (1 - smooth(0.41, 0.94, z))
    keratin = np.clip(0.69 * brow + 0.30 * np.exp(-(((y - 4.195) / 0.065) ** 2) - ((z - 4.11) / 0.42) ** 2), 0, 0.76)
    ww = np.stack([np.ones_like(x), belly, band, ginger, limb + 0.22 * bars * (1 - smooth(-3, -1.5, z)), keratin], -1)
    ww[..., 0] = np.maximum(0.035, 1 - np.maximum.reduce([belly, band, limb, ginger]))
    ww /= ww.sum(-1)[..., None]
    fleck = smooth(0.10, 0.57, noise(z * 11, y * 12, 91)) * smooth(0.09, 0.58, noise(z * 3, arc * 5, 72))
    lum = (
        166
        + 23 * dome
        + 17 * tone
        + 15 * macro
        - 15 * fleck
        - 35 * bars
        - 18 * nape
        + 23 * belly
        + 8 * flank
        - 16 * loin
        + 12 * shoulder
        - 27 * fold
        - 35 * lip
        + 18 * liplight
        - 41 * eye
        - 22 * hollow
        - 19 * temporal
        + 17 * jugal
        + 15 * brow
    )
    lum = np.maximum(22, lum * (1 - 0.86 * naris))
    lum += (
        20 * labial
        - 39 * labial_groove
        + 18 * soft_ridge
        - 36 * soft_crease
        + 17 * nose_rim
        - 28 * hood
        - 11 * lid_edge
    )
    color = np.stack([lum * (1 + 0.035 * facewash), lum, lum * (0.974 - 0.020 * facewash)], -1)
    height = np.clip(
        0.43
        + 0.089 * dome
        + 0.03 * tone
        + 0.027 * macro
        + 0.048 * feature * dome
        - 0.083 * fold
        - 0.055 * lip
        + 0.057 * brow
        + 0.019 * shoulder,
        0.12,
        0.84,
    )
    height = np.clip(
        height + 0.094 * labial - 0.097 * labial_groove + 0.075 * soft_ridge - 0.076 * soft_crease + 0.061 * nose_rim,
        0.08,
        0.89,
    )
    rough = np.clip(0.75 - 0.095 * dome + 0.05 * macro - 0.095 * lip - 0.115 * brow, 0.47, 0.94)
    ao = np.clip(193 + 48 * dome - 32 * fold - 30 * eye - 97 * naris - 8 * hollow, 58, 249)
    wound = np.zeros_like(x)
    for cz, cy, length, slope in [
        (0.56, 3.38, 0.49, -0.35),
        (0.72, 3.23, 0.39, -0.42),
        (-1.11, 3.02, 0.31, 0.64),
        (3.66, 3.90, 0.17, -0.40),
    ]:
        feather = np.clip(1 - ((z - cz) / length) ** 2, 0, 1)
        d = abs(y - cy - (z - cz) * slope - 0.008 * macro)
        wound = np.maximum(wound, feather * (1 - smooth(0.010, 0.027, d)) * smooth(0.28, 0.47, ax))
    return color, height, rough, ao, ww, wound, macro


def save(name, base, height, rough, ao, weights, wound, macro):
    def put(role, p, side=0):
        im = Image.fromarray(p)
        if side:
            im = im.resize((side, side), Image.Resampling.LANCZOS)
        if role == "decay":
            # Filters resample alpha on both sides of a wound boundary. Reserve the
            # final mip's injured texels exclusively for the wound the renderer shows.
            a = np.array(im)
            hurt = np.asarray(Image.open(HERE / (name + "_hurt.png")))
            a[hurt[..., 3] > 0, 3] = 0
            im = Image.fromarray(a)
        im.save(HERE / (name + "_" + role + ".png"), compress_level=7)

    n = height.shape[0]
    height = gaussian_filter(height, 0.43)
    dy, dx = np.gradient(height)
    normal = np.stack([-dx * 7.4, dy * 7.4, np.ones_like(dx)], -1)
    normal /= np.linalg.norm(normal, axis=-1)[..., None]
    put("height", (height.clip(0, 1) * 65535).astype(np.uint16))
    put("normal", ((0.5 + 0.5 * normal) * 255).astype(np.uint8))
    put("base", base.clip(0, 255).astype(np.uint8))
    put("packed", np.stack([ao, 255 * rough, np.zeros_like(ao)], -1).clip(0, 255).astype(np.uint8), n // 2)
    for i, (role, span) in enumerate([("mask", slice(0, 3)), ("mask2", slice(3, 6))]):
        a = weights[..., span] * 255
        put(role, (0.25 * (a[::2, ::2] + a[1::2, ::2] + a[::2, 1::2] + a[1::2, 1::2])).clip(0, 255).astype(np.uint8))
    if name != "rex_saddle":
        hurt = np.zeros((*wound.shape, 4), np.uint8)
        hurt[..., 0] = 85 + 12 * macro
        hurt[..., 1] = 29 + 6 * macro
        hurt[..., 2] = 26 + 5 * macro
        hurt[..., 3] = np.where(wound > 0.08, 85 + 155 * wound, 0)
        put("hurt", hurt, 256)
        decay = np.zeros_like(hurt)
        decay[..., 0] = 70 + 11 * macro
        decay[..., 1] = 64 + 12 * macro
        decay[..., 2] = 49 + 8 * macro
        decay[..., 3] = np.where(wound > 0.08, 0, 45 + 65 * (0.5 + 0.5 * macro))
        put("decay", decay, 256)


def material(name, size):
    pts, ix = raster(MATS.index(name), size)
    # Read the same physical fields at all seams. Only the comparison masks and
    # interpolation buffers are per strip; memory use stays bounded at 2K.
    images = []
    for start in range(0, size, 96):
        fields = maps(pts[start : start + 96], name == "rex_head")
        if not images:
            images = [[] for _ in fields]
        for a, b in zip(images, fields):
            a.append(b.astype(np.float32))
    save(name, *[np.concatenate(a, 0) for a in images])
    print("painted", name, flush=True)


def atlas(name, n):
    y, x = np.mgrid[:n, :n]
    u, v = (x + 0.5) / n, 1 - (y + 0.5) / n
    grain = noise(u * 199, v * 264, 81)
    macro = noise(u * 12, v * 19, 72)
    ww = np.zeros((n, n, 6))
    rough = np.full((n, n), 0.69)
    ao = np.full((n, n), 235.0)
    h = 0.46 + 0.04 * grain

    def rgb(r, g, b):
        return np.stack(np.broadcast_arrays(r, g, b), -1)

    if name == "rex_saddle":
        wood = (u > 0.50) & (u < 0.73)
        metal = u >= 0.75
        stitch = (abs(np.sin(v * 235)) > 0.55) * np.exp(-(((u - 0.043) / 0.005) ** 2))
        color = rgb(
            105 + 14 * macro + 9 * grain + 45 * stitch,
            61 + 8 * macro + 6 * grain + 41 * stitch,
            38 + 8 * macro + 4 * grain + 30 * stitch,
        )
        lines = np.sin(268 * u + 5 * macro)
        color[wood] = rgb(140 + 18 * lines, 100 + 12 * lines, 61 + 8 * lines)[wood]
        color[metal] = rgb(126 + 15 * grain, 119 + 12 * grain, 93 + 10 * grain)[metal]
        rough[metal] = 0.36
        rough[wood] = 0.59
    else:
        color = rgb(145 + 12 * grain, 127 + 9 * grain, 98 + 7 * grain)
        claw = (u < 0.26) & (v < 0.50)
        ww[..., 5] = claw
        tooth = (u > 0.26) & (u < 0.50) & (v < 0.5)
        t = np.clip((v - 0.02) / 0.45, 0, 1)
        stri = np.sin(u * 320 + macro)
        color[tooth] = rgb(177 + 49 * t + 4 * stri, 152 + 61 * t + 3 * stri, 110 + 76 * t + 3 * stri)[tooth]
        rough[tooth] = 0.44
        tongue = (u > 0.5) & (v < 0.5)
        gum = (u > 0.39) & (u < 0.70) & (v > 0.50)
        folds = np.sin(v * 141 + u * 8)
        color[tongue] = rgb(118 + 13 * macro + 6 * grain, 61 + 7 * macro + 4 * grain, 58 + 7 * macro + 4 * grain)[
            tongue
        ]
        color[gum] = rgb(78 + 8 * folds + 11 * macro, 43 + 5 * folds + 5 * macro, 39 + 3 * folds + 5 * macro)[gum]
        rough[tongue | gum] = 0.50
        eye = (u < 0.39) & (v > 0.50)
        a = (u - 0.02) / 0.35 * math_tau
        ev = (v - 0.52) / 0.46
        radial = np.hypot(np.sin(a) * 0.9, (ev - 0.5) * 2.1)
        iris = 1 - smooth(0.63, 0.77, radial)
        pupil = 1 - smooth(0.205, 0.275, radial)
        lines = np.sin(np.arctan2(ev - 0.5, np.sin(a)) * 34)
        ec = rgb(42 + iris * (129 + 19 * lines), 36 + iris * (78 + 12 * lines), 30 + iris * (20 + 5 * lines))
        ec = ec * (1 - pupil[..., None]) + np.array([18, 16, 13]) * pupil[..., None]
        # The overhanging corneal margin breaks the uniform lit marble.
        ec *= (0.86 - 0.22 * smooth(0.52, 0.92, ev))[..., None]
        color[eye] = ec[eye]
        rough[eye] = 0.16
        h[eye] = 0.49
        lids = (u > 0.70) & (v > 0.50)
        lv = (v - 0.52) / 0.46
        ld, lt = scales(u * 150 + macro, v * 92 + 0.3 * macro)
        bright = 122 + 24 * ld + 15 * lt + 11 * grain
        color[lids] = rgb(bright, bright - 4, bright - 9)[lids]
        h[lids] = (0.38 + 0.10 * ld + 0.03 * grain)[lids]
        ww[..., 3] = lids * 0.73
        ww[..., 5] += lids * 0.20
        ww[..., 2] = lids * 0.07
    save(name, color, h, rough, ao, ww, np.zeros_like(v), macro)
    if name == "rex_saddle":
        packed = np.asarray(Image.open(HERE / "rex_saddle_packed.png")).copy()
        packed[:, :, 2] = np.where(packed[:, :, 1] < 120, 155, 0)
        Image.fromarray(packed).save(HERE / "rex_saddle_packed.png")


math_tau = 2 * np.pi
if __name__ == "__main__":
    material("rex_hide", 2048)
    material("rex_head", 2048)
    atlas("rex_detail", 512)
    atlas("rex_saddle", 1024)
