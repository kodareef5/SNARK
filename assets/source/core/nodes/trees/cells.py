# The cells of a crown picture (layout.py CROWN_CELLS): each the picture a head of leaves (clusters.py) wears, made by
# laying the leaf atlas's own sprays (its cluster cells, cut out by their alpha) on the head unrolled from its top, in
# rings from the rim in: the sprays at the rim's scallops reaching out to it, sprays between them, and over them a ring
# and a few on top, each above those before, as the sprays of a head lie over one another seen from above. Sun sprays
# above, shade sprays at the rim; between sprays the dark of the leaves inside. Beyond the rim, the bowl: the same
# leaves seen from beneath, darker. Each picture's height is the sprays' stack and their own leaves' relief, its normal
# made from that height, its occlusion the height's crevices under the light the head's place lets in. Tiers are the
# same heads in sun (lighter, yellower, open), the middle, and shade (darker, cooler, closed in).
#
# Run with python3 from this folder: `python3 cells.py oak_leaves` writes tex/<atlas>/source cells to cells/, which
# crowns.py lays into the crown picture.

import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from clusters import AMP, ARC as ARC_SHARE  # noqa: E402
from layout import CELL_EDGE, CELL_RIM, LEAVES, SCALLOPS, leaf_cell  # noqa: E402

WORK = 1024
OUT = 512
# Metres along the arc of a head's top the picture is made for: an oak's head 2.7 m across.
ARC = ARC_SHARE * 1.36
# The sprays: which cells of the leaf atlas are sun sprays and which shade sprays.
SUN, SHADE = (0, 2), (1, 3)

# By tier: the colour the leaves are scaled by (linear), how much light the head's place lets in, and how much of the
# rim and mid rings are sun sprays.
TIERS = [
    {"tint": (1.42, 1.62, 0.86), "open": 1.0, "sunny": 0.75},
    {"tint": (1.0, 1.2, 0.98), "open": 0.95, "sunny": 0.4},
    {"tint": (0.66, 0.88, 1.0), "open": 0.86, "sunny": 0.1},
]
# The leaves deeper in a head, seen between its sprays (the atlas's mass, darkened), and the bowl's leaves seen from
# beneath, as a scale of light.
DEEP = 0.6
BOWL = 0.55
# A rosette of leaves, the end of a twig, in metres from its foot to its tips, and the least between two.
ROSETTE = 0.5
ROSETTE_GAP = 0.27
# Metres a spray's leaves stand over its edges, and its leaves' own relief.
MOUND = 0.15
LEAF = 0.05
# The rim's sprays against the top's, in light, and what the leaves at the rim are against those on top.
RIM_TINT = 0.85
RIM_SHADE = (0.62, 0.78, 0.94)


def linear(c):
    c = np.asarray(c, np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255


def sprays(atlas):
    """Each cluster cell of the atlas: its colour as light, its cover, its height 0 to 1."""
    d = os.path.join(HERE, "tex", atlas)
    base = np.asarray(Image.open(os.path.join(d, f"{atlas}_base.png")).convert("RGBA")).astype(np.float32)
    height = np.asarray(Image.open(os.path.join(d, f"{atlas}_height.png"))).astype(np.float32) / 65535.0
    n = base.shape[0]
    out = {}
    for k in SUN + SHADE:
        u0, v0, u1, v1 = leaf_cell(k)
        sl = (slice(round(v0 * n), round(v1 * n)), slice(round(u0 * n), round(u1 * n)))
        rgba = base[sl]
        out[k] = (linear(rgba[..., :3]), rgba[..., 3] / 255.0, height[sl])
    out["mass"] = (linear(base[n // 2 :, :, :3]), height[n // 2 :])
    return out


def laid(mass, metre, atlas):
    """The atlas's mass (leaves over leaves, `LEAVES` metres across) laid flat over the whole picture at its own size,
    repeating: its colour as light and its height 0 to 1."""
    col, height = mass
    h, w = height.shape
    scale = w / (LEAVES[atlas]["mass"] * metre)
    ys, xs = np.mgrid[0:WORK, 0:WORK].astype(np.float32)
    sx, sy = (xs * scale) % (w - 1), (ys * scale) % (h - 1)
    return sample(col, sx, sy), sample(height, sx, sy)


def sample(img, x, y):
    """Bilinear samples of `img` (H, W[, C]) at float pixel coordinates, nothing outside."""
    h, w = img.shape[:2]
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    ok = (x0 >= 0) & (y0 >= 0) & (x0 < w - 1) & (y0 < h - 1)
    x0c, y0c = np.clip(x0, 0, w - 2), np.clip(y0, 0, h - 2)
    if img.ndim == 3:
        fx, fy, ok = fx[..., None], fy[..., None], ok[..., None]
    v = (img[y0c, x0c] * (1 - fx) * (1 - fy) + img[y0c, x0c + 1] * fx * (1 - fy) + img[y0c + 1, x0c] * (1 - fx) * fy + img[y0c + 1, x0c + 1] * fx * fy)
    return np.where(ok, v, 0.0)


class Canvas:
    def __init__(self, deep):
        col, height = deep
        self.col = col * DEEP * np.array((0.82, 1.0, 1.12), np.float32)
        self.h = -0.12 + 0.04 * height
        ys, xs = np.mgrid[0:WORK, 0:WORK].astype(np.float32) + 0.5
        self.x, self.y = xs, ys
        c = WORK / 2
        self.rad = np.hypot(xs - c, ys - c) / c
        # The way round, as the head's phi: x right is phi 0, up the picture is a quarter turn.
        self.ang = np.arctan2(-(ys - c), xs - c)

    def stamp(self, spray, foot, way, length, lift, tint, mask=None, flip=False):
        """Lays a spray with its twig's end at `foot` (pixels), reaching `length` pixels along `way` (a unit vector in
        the picture), its leaves `lift` metres above the head and tinted by `tint`, where `mask` allows."""
        col, alpha, height = spray
        n = col.shape[0]
        scale = length / n
        reach = length * 0.75
        x0, x1 = int(max(0, min(foot[0], foot[0] + way[0] * length) - reach)), int(min(WORK, max(foot[0], foot[0] + way[0] * length) + reach))
        y0, y1 = int(max(0, min(foot[1], foot[1] + way[1] * length) - reach)), int(min(WORK, max(foot[1], foot[1] + way[1] * length) + reach))
        if x1 <= x0 or y1 <= y0:
            return
        xs, ys = self.x[y0:y1, x0:x1] - foot[0], self.y[y0:y1, x0:x1] - foot[1]
        along = xs * way[0] + ys * way[1]
        across = xs * -way[1] + ys * way[0]
        if flip:
            across = -across
        sx = n / 2 + across / scale
        sy = n - along / scale
        a = sample(alpha, sx, sy)
        a = np.clip((a - 0.3) / 0.35, 0.0, 1.0)
        if mask is not None:
            a = a * mask[y0:y1, x0:x1]
        if not a.any():
            return
        c = sample(col, sx, sy) * np.asarray(tint, np.float32)
        lh = sample(height, sx, sy)
        # A spray is a low mound of leaves over its twig, highest along its middle, falling to its leaves' tips.
        hump = np.clip(ndimage.gaussian_filter(a, length * 0.09), 0.0, 1.0) ** 0.6
        hs = lift + MOUND * hump + LEAF * lh
        a3 = a[..., None]
        self.col[y0:y1, x0:x1] = self.col[y0:y1, x0:x1] * (1 - a3) + c * a3
        self.h[y0:y1, x0:x1] = self.h[y0:y1, x0:x1] * (1 - a) + hs * a


def cell(atlas_sprays, deep, variant, tier, seed):
    """The picture of one head: colour, normal, height and occlusion, at OUT pixels."""
    rng = np.random.default_rng(seed)
    cv = Canvas(deep)
    c = WORK / 2
    R = CELL_RIM * c
    k, first, reach = SCALLOPS[variant]
    first = math.radians(first)
    t = TIERS[tier]
    top = cv.rad <= CELL_RIM

    def way_of(phi):
        return (math.cos(phi), -math.sin(phi))

    def at(rad, phi):
        return (c + rad * math.cos(phi), c - rad * math.sin(phi))

    def pick(sunny):
        ks = SUN if rng.random() < sunny else SHADE
        return atlas_sprays[ks[rng.integers(len(ks))]]

    def tint(extra=1.0):
        jitter = rng.uniform(0.9, 1.1)
        warm = rng.uniform(-0.03, 0.03)
        return tuple(np.asarray(t["tint"]) * jitter * extra * np.array([1 + warm, 1 + warm * 0.5, 1 - warm]))

    top_mask = top.astype(np.float32)
    # The rim: sprays at the notches between scallops, then a spray out to each scallop's reach, shade leaves.
    for j in range(k):
        phi = first + 2 * math.pi * j / k + rng.uniform(-0.08, 0.08)
        cv.stamp(pick(0.0), at(R * 0.52, phi), way_of(phi), R * rng.uniform(0.42, 0.5), 0.0, tint(RIM_TINT), top_mask, rng.random() < 0.5)
    for j in range(k):
        phi = first + 2 * math.pi * (j + 0.5) / k + rng.uniform(-0.06, 0.06)
        tip = (1.0 - 0.5 * AMP + AMP * reach[j]) / (1.0 + 0.5 * AMP) * R * 1.02
        foot = R * rng.uniform(0.45, 0.52)
        cv.stamp(pick(t["sunny"] * 0.3), at(foot, phi), way_of(phi + rng.uniform(-0.1, 0.1)), tip - foot, 0.03, tint(RIM_TINT * 1.05), top_mask, rng.random() < 0.5)
    # Within the rim, rosettes of leaves about a hand's breadth apart, each the end of a twig reaching out from the top:
    # from the rim in, each over those outside it, sun leaves more toward the top, a few catching more light.
    metre = R / ARC
    gap = ROSETTE_GAP * metre
    spots = []
    for _ in range(4000):
        rad, phi = R * math.sqrt(rng.random()) * 0.98, rng.uniform(0, 2 * math.pi)
        p = at(rad, phi)
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 >= gap * gap for q, _, _ in spots):
            spots.append((p, rad, phi))
    for p, rad, phi in sorted(spots, key=lambda s: -s[1]):
        out = rad / R
        length = ROSETTE * metre * rng.uniform(0.85, 1.2)
        way = phi + rng.uniform(-0.6, 0.6) if out > 0.15 else rng.uniform(0, 2 * math.pi)
        foot = (p[0] - math.cos(way) * length * 0.45, p[1] + math.sin(way) * length * 0.45)
        light = (1.0 - 0.06 * out) * (1.15 if rng.random() < 0.3 else 1.0)
        cv.stamp(pick(min(1.0, t["sunny"] + 0.5 - 0.5 * out)), foot, way_of(way), length, 0.03 + 0.11 * (1.0 - out), tint(light), top_mask, rng.random() < 0.5)
    # Sun leaves at the top shading to shade leaves at the rim, which are darker and cooler.
    toward = np.interp(cv.rad / CELL_RIM, [0.0, 0.5, 0.82, 1.0], [0.0, 0.08, 0.55, 1.0])[..., None]
    cv.col = np.where(top[..., None], cv.col * (1.0 - toward * (1.0 - np.array(RIM_SHADE, np.float32))), cv.col)
    # The bowl, seen from beneath: the deeper leaves, darker and a little cooler.
    bowl = (cv.rad > CELL_RIM) & (cv.rad <= 1.0)
    cv.col[bowl] = deep[0][bowl] * BOWL * np.array((0.92, 1.0, 1.08), np.float32)
    # Height to normal, at the picture's scale.
    hgt = ndimage.gaussian_filter(cv.h, 0.6)
    gy, gx = np.gradient(hgt * metre)
    normal = np.dstack([-gx, gy, np.ones_like(gx)])
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    # Occlusion: the crevices of the height, under the light the head's place and the way round it lets in.
    around = ndimage.gaussian_filter(cv.h, 0.08 * metre)
    cavity = np.clip((around - cv.h) / 0.12, 0.0, 1.0)
    rad = cv.rad
    place = np.where(rad <= CELL_RIM, np.interp(rad, [0.0, 0.5 * CELL_RIM, 0.82 * CELL_RIM, CELL_RIM], [1.0, 0.98, 0.9, 0.8]),
                     np.interp(rad, [CELL_RIM, CELL_EDGE, 1.5], [0.6, 0.5, 0.5]))
    occ = np.clip(place * t["open"] * (1.0 - 0.45 * cavity), 0.18, 1.0)
    rough = np.full_like(occ, 0.86)
    outside = rad > 1.0
    col = cv.col
    col[outside] = deep[0][outside] * BOWL
    normal[outside] = (0.0, 0.0, 1.0)
    hgt[outside] = -0.06
    return shrink(col, normal, hgt, occ, rough)


def shrink(col, normal, hgt, occ, rough):
    def box(a):
        return np.asarray(Image.fromarray(np.ascontiguousarray(a.astype(np.float32))).resize((OUT, OUT), Image.BOX))

    col = np.dstack([box(col[..., i]) for i in range(3)])
    nrm = np.dstack([box(normal[..., i]) for i in range(3)])
    nrm /= np.maximum(np.linalg.norm(nrm, axis=-1, keepdims=True), 1e-6)
    return {"base": srgb(col), "normal": nrm, "height": box(hgt), "occlusion": box(occ), "rough": box(rough)}


def cells(atlas):
    """Every cell of a kind's crown picture, by (tier, variant)."""
    s = sprays(atlas)
    deep = laid(s["mass"], CELL_RIM * WORK / 2 / ARC, atlas)
    return {(tier, v): cell(s, deep, v, tier, 1000 * tier + 17 * v + 3) for tier in range(len(TIERS)) for v in range(len(SCALLOPS))}


if __name__ == "__main__":
    atlas = sys.argv[1] if len(sys.argv) > 1 else "oak_leaves"
    got = cells(atlas)
    out = os.path.join(HERE, "tex", "_cells")
    os.makedirs(out, exist_ok=True)
    sheet = np.zeros((OUT * len(TIERS), OUT * len(SCALLOPS), 3), np.uint8)
    for (tier, v), c in got.items():
        sheet[tier * OUT : (tier + 1) * OUT, v * OUT : (v + 1) * OUT] = c["base"].round().astype(np.uint8)
    Image.fromarray(sheet).save(os.path.join(out, f"{atlas}_cells.png"))
    ys, xs = np.mgrid[0:OUT, 0:OUT] + 0.5
    disc = np.hypot(xs - OUT / 2, ys - OUT / 2) / (OUT / 2) <= CELL_RIM
    for t in range(len(TIERS)):
        tops = np.concatenate([got[(t, v)]["base"][disc] for v in range(len(SCALLOPS))])
        occ = np.concatenate([got[(t, v)]["occlusion"][disc] for v in range(len(SCALLOPS))])
        print(atlas, "tier", t, "top mean", tops.mean(0).round(), "p10", np.percentile(tops.mean(1), 10).round(), "p90", np.percentile(tops.mean(1), 90).round(), "occlusion mean %.2f" % occ.mean())
