"""Paints the shell's pictures, the ones asset.ts names in tex/: every texel is a point of the egg (shape.py), and the
shell is drawn there in three dimensions, so the pictures agree with one another and with the mesh, and a marking is
one size wherever it lies.

    python3 -I paint.py

The shell is two colour regions. Region 0, the ground, takes the colour of the species' egg prop; region 1, the
markings, takes the second colour an instance carries, and stays the base colour's grey where it is given none. Both
are light grey in the base colour (0.5 in linear light, as the game divides the dye by it), with the shell's
mottling and the markings' density in their value. Lengths are in heights of the egg, so the one set of pictures
serves every size.

The markings are an egg's: fine speckles all over, thicker in a loose wreath below the waist, a few larger blotches of
two or three blots run together, and pale spots laid deeper in the shell, under the rest. The surface is a satin
cuticle over fine pores.
"""

import math
import os
import site
import sys

site.addsitedir(site.getusersitepackages())
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from scipy.spatial import cKDTree  # noqa: E402

import shape  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 1024
SEED = 4127
GREY = 0.5


def srgb(l):
    l = np.clip(l, 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)


class Noise:
    """Smooth value noise in three dimensions: random values on the whole-number lattice, eased between."""

    def __init__(self, seed):
        self.table = np.random.default_rng(seed).random(1 << 16)

    def __call__(self, p):
        p = np.asarray(p, float)
        i = np.floor(p).astype(np.int64)
        f = p - i
        f = f * f * (3 - 2 * f)
        out = np.zeros(p.shape[:-1])
        for c in range(8):
            o = np.array([(c >> 0) & 1, (c >> 1) & 1, (c >> 2) & 1])
            q = i + o
            h = (q[..., 0] * 73856093) ^ (q[..., 1] * 19349663) ^ (q[..., 2] * 83492791)
            w = np.prod(np.where(o == 1, f, 1 - f), axis=-1)
            out += w * self.table[h & 0xFFFF]
        return out * 2 - 1

    def fbm(self, p, octaves, gain=0.5):
        total, amp, norm = 0.0, 1.0, 0.0
        for k in range(octaves):
            total = total + amp * self(p * (2.0 ** k) + 17.3 * k)
            norm += amp
            amp *= gain
        return total / norm


def surface():
    """Each texel's point on an egg one unit tall, its outward normal, and the picture's two directions there: across
    (the tangent) and up, square to it (the engine's bitangent)."""
    c = (np.arange(SIZE) + 0.5) / SIZE
    u, v = np.meshgrid(c, 1 - c)
    theta, phi = shape.angles(u, v)
    p = shape.point(theta, phi, 1.0)
    e = 0.25 / SIZE
    ta, pa = shape.angles(u + e, v)
    tb, pb = shape.angles(u - e, v)
    across = shape.point(ta, pa, 1.0) - shape.point(tb, pb, 1.0)
    ta, pa = shape.angles(u, v + e)
    tb, pb = shape.angles(u, v - e)
    up = shape.point(ta, pa, 1.0) - shape.point(tb, pb, 1.0)
    n = np.cross(across, up)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    t = across / np.linalg.norm(across, axis=-1, keepdims=True)
    return p, n, t, np.cross(n, t), phi


def scatter(rng, count, weight):
    """`count` places on the egg, as thick as `weight(phi)` says over its surface."""
    out = []
    while len(out) < count:
        theta = rng.random(4096) * 2 * math.pi
        phi = rng.random(4096) * math.pi
        e = 1e-4
        a = shape.point(theta + e, phi, 1.0) - shape.point(theta - e, phi, 1.0)
        b = shape.point(theta, phi + e, 1.0) - shape.point(theta, phi - e, 1.0)
        area = np.linalg.norm(np.cross(a, b), axis=-1) * weight(phi)
        keep = rng.random(4096) * area.max() * 1.05 < area
        out += [(t, f) for t, f in zip(theta[keep], phi[keep])]
    return np.array(out[:count])


def markings(p, n, tree, noise, rng):
    """How much of each texel is marking, 0 to 1, and how dark the marking is there."""
    wreath = lambda phi: 1 + 1.4 * np.exp(-(((phi - 1.0) / 0.38) ** 2))  # noqa: E731
    even = lambda phi: 1 + 0.3 * np.exp(-(((phi - 1.0) / 0.5) ** 2))  # noqa: E731
    sets = [
        # (how many, where, radius in heights, how much at the core, how ragged the edge, how soft, how drawn out, blots)
        (60, even, (0.010, 0.026), (0.22, 0.38), 0.5, 0.5, (1.0, 1.6), 1),  # pale, deep in the shell
        (1800, even, (0.0007, 0.0022), (0.55, 1.0), 0.15, 0.35, (1.0, 1.4), 1),  # pin pricks
        (560, wreath, (0.0020, 0.0060), (0.70, 1.0), 0.35, 0.2, (1.0, 2.0), 1),  # speckles
        (24, wreath, (0.0035, 0.0090), (0.70, 1.0), 0.25, 0.25, (3.5, 6.0), 1),  # short streaks
        (22, wreath, (0.008, 0.020), (0.80, 1.0), 0.55, 0.15, (1.0, 1.8), 4),  # blotches
    ]
    m = np.zeros(len(p))
    dark = np.zeros(len(p))
    for count, weight, (lo, hi), (least, most), ragged, soft, (long_lo, long_hi), blots in sets:
        for theta, phi in scatter(rng, count, weight):
            centre = shape.point(theta, phi, 1.0)
            radius = math.exp(rng.uniform(math.log(lo), math.log(hi)))
            core = rng.uniform(least, most)
            for _ in range(blots):
                at = centre + (rng.normal(size=3) * radius * 0.5 if blots > 1 else 0)
                r = radius * (rng.uniform(0.45, 0.85) if blots > 1 else 1)
                stretch = math.sqrt(rng.uniform(long_lo, long_hi))
                near = tree.query_ball_point(at, r * (1.6 + stretch))
                if not near:
                    continue
                q = p[near] - at
                # Drawn out along a direction of its own on the shell.
                axis = np.cross(n[near][0], rng.normal(size=3))
                axis /= np.linalg.norm(axis)
                along = (q * axis).sum(-1)
                across = np.sqrt(np.maximum((q * q).sum(-1) - along ** 2, 0))
                d = np.hypot(along / stretch, across * stretch) / r
                at_noise = p[near] / r + rng.random(3) * 100
                d += ragged * (noise(at_noise * 0.9) + 0.5 * noise(at_noise * 2.3))
                # Thicker in some places than others inside.
                k = core * np.clip((1.0 - d) / soft, 0, 1) * (0.85 + 0.15 * noise(at_noise * 1.7))
                m[near] = 1 - (1 - m[near]) * (1 - k)
                dark[near] = np.maximum(dark[near], k * (1 if core > 0.5 else 0.4))
    return m, dark


def main():
    rng = np.random.default_rng(SEED)
    noise = Noise(SEED)
    p, n, t, b, phi = surface()
    flat = p.reshape(-1, 3)
    m, dark = markings(flat, n.reshape(-1, 3), cKDTree(flat), noise, rng)
    m, dark = m.reshape(SIZE, SIZE), dark.reshape(SIZE, SIZE)

    # The ground's faint mottling, and the markings darker at their dense cores, about the grey the dye is divided by.
    mottle = 0.045 * noise.fbm(p * 4.0, 3) + 0.02 * noise.fbm(p * 30.0 + 5, 2)
    value = GREY * (1 + mottle) * (1 - 0.35 * (dark - dark.mean()))

    # Relief in heights of the egg: fine pores and a gentle unevenness; the pigment lies flat in the cuticle.
    def relief(q):
        return 0.0002 * noise.fbm(q * 200.0, 3) + 0.00025 * noise.fbm(q * 12.0 + 40, 2)

    e = 1e-4
    h = relief(p)
    slope_t = (relief(p + e * t) - relief(p - e * t)) / (2 * e)
    slope_b = (relief(p + e * b) - relief(p - e * b)) / (2 * e)
    normal = np.stack([-slope_t, -slope_b, np.ones_like(h)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)

    pores = np.clip(-noise.fbm(p * 200.0, 3), 0, 1)
    occlusion = 1 - 0.06 * pores
    rough = 0.6 + 0.05 * noise.fbm(p * 20.0 + 9, 2) + 0.06 * pores - 0.07 * m

    tex = os.path.join(HERE, "tex")
    os.makedirs(tex, exist_ok=True)
    grey = np.round(srgb(value) * 255).astype(np.uint8)
    Image.fromarray(np.dstack([grey] * 3)).save(os.path.join(tex, "shell_base.png"))
    Image.fromarray(np.round((normal * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(tex, "shell_normal.png"))
    span = h.max() - h.min()
    Image.fromarray(np.round((h - h.min()) / span * 65535).astype(np.uint16)).save(os.path.join(tex, "shell_height.png"))
    packed = np.dstack([occlusion, rough, np.zeros_like(rough)])
    Image.fromarray(np.round(np.clip(packed, 0, 1) * 255).astype(np.uint8)).save(os.path.join(tex, "shell_packed.png"))
    mask = np.dstack([1 - m, m, np.zeros_like(m)])
    Image.fromarray(np.round(np.clip(mask, 0, 1) * 255).astype(np.uint8)).save(os.path.join(tex, "shell_mask.png"))
    print(f"paint: relief {span * shape.SIZES['xs'] * 1000:.3f} mm on the smallest egg; markings cover {m.mean() * 100:.1f}% of the picture")


if __name__ == "__main__":
    main()
