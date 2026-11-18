# Paints the compact's pictures from tex/bakes (tex/bake.py): every map of its three materials, and from its own hurt
# and decay the wrecks' pictures. The hurt and decay pictures the game lays over the car are tex/wear.py's. Everything
# is worked out from where each texel lies on the car, which way it
# faces, what it is (its tag, parts.py TAGS) and how much light reaches it, by seeded noise and measured shapes, so a
# picture is the same on every run and its charts meet without seams.
#
#   python3 -B tex/paint.py            (NumPy, SciPy, Pillow)
#
# Writes tex/<material>_{base,normal,packed,mask,height}.png and tex/maps.json, and tex/review/*.png, each map seen whole.

import ast
import json
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
BAKES = os.path.join(HERE, "bakes")
REVIEW = os.path.join(HERE, "review")
FOLDER = os.path.dirname(HERE)


def read_tags():
    """parts.py's TAGS, read as text: that module needs Blender."""
    tree = ast.parse(open(os.path.join(FOLDER, "parts.py")).read())
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "TAGS":
            return [t for t, _ in ast.literal_eval(node.value)]
    raise SystemExit("paint: no TAGS in parts.py")


TAGS = read_tags()
T = {name: i for i, name in enumerate(TAGS)}
PIVOTS = {"wheel_front_left": (0.78, 0.30, 1.25), "wheel_front_right": (-0.78, 0.30, 1.25), "wheel_rear_left": (0.78, 0.30, -1.25),
          "wheel_rear_right": (-0.78, 0.30, -1.25), "steering_wheel": (0.42, 0.89, 0.55)}

# ---------------------------------------------------------------------------------------------------------- noise


def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.uint64) * np.uint64(0x9E3779B185EBCA87)) ^ (iy.astype(np.uint64) * np.uint64(0xC2B2AE3D27D4EB4F)) ^ (iz.astype(np.uint64) * np.uint64(0x165667B19E3779F9)) ^ np.uint64(seed * 0x27D4EB2F165667C5 & 0xFFFFFFFFFFFFFFFF)
    h ^= h >> np.uint64(29)
    h *= np.uint64(0xBF58476D1CE4E5B9)
    h ^= h >> np.uint64(32)
    return (h & np.uint64(0xFFFFFF)).astype(np.float32) / np.float32(0xFFFFFF)


def noise(p, seed=0):
    """Value noise in 3D, 0 to 1, smooth: `p` is (n, 3) in noise units."""
    i = np.floor(p).astype(np.int64)
    f = (p - i).astype(np.float32)
    u = f * f * f * (f * (f * 6 - 15) + 10)
    out = np.zeros(len(p), np.float32)
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1 - u[:, 2]
                out += wx * wy * wz * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, scale, octaves=4, seed=0, gain=0.5):
    """Fractal noise about 0.5 at features `scale` metres across."""
    out = np.zeros(len(p), np.float32)
    amp, total, q = 1.0, 0.0, p / scale
    for o in range(octaves):
        out += amp * noise(q * (2.0 ** o) + o * 17.13, seed + o * 101)
        total += amp
        amp *= gain
    return out / total


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    """a to b by t; a colour (three numbers) or colours (n by 3) against t for each texel (n)."""
    a, b, t = np.asarray(a, np.float32), np.asarray(b, np.float32), np.asarray(t, np.float32)
    if t.ndim == 1 and (a.shape[-1:] == (3,) or b.shape[-1:] == (3,)) and len(t) != 3:
        t = t[:, None]
    return a + (b - a) * t


def rgb(*c):
    return np.array(c, np.float32)


# ------------------------------------------------------------------------------------------------------- surfaces


class Surface:
    """One material's picture as texels: where each lies on the car, what it is, and fields worked out from those.
    Texels no triangle covers take the values of the nearest that one does, so the gutters round each chart carry its
    colours into the smaller mips."""

    def __init__(self, name):
        d = np.load(os.path.join(BAKES, f"{name}.npz"))
        self.name = name
        self.size = S = int(d["size"])
        self.parts = [str(p) for p in d["parts"]]
        uv = d["uv"] * S
        tag = np.full((S, S), -1, np.int16)
        part = np.zeros((S, S), np.int16)
        pos = np.zeros((S, S, 3), np.float32)
        nrm = np.zeros((S, S, 3), np.float32)
        mpt = np.zeros((S, S), np.float32)
        for t in range(len(uv)):
            a, b, c = uv[t]
            x0, x1 = int(max(math.floor(min(a[0], b[0], c[0]) - 0.5), 0)), int(min(math.ceil(max(a[0], b[0], c[0]) + 0.5), S - 1))
            y0, y1 = int(max(math.floor(min(a[1], b[1], c[1]) - 0.5), 0)), int(min(math.ceil(max(a[1], b[1], c[1]) + 0.5), S - 1))
            den = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
            if abs(den) < 1e-9:
                continue
            X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            w1 = ((X - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (Y - a[1])) / den
            w2 = ((b[0] - a[0]) * (Y - a[1]) - (X - a[0]) * (b[1] - a[1])) / den
            w0 = 1 - w1 - w2
            inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
            if not inside.any():
                continue
            ys, xs = np.nonzero(inside)
            W = np.stack([w0[inside], w1[inside], w2[inside]], 1)
            P, N = d["pos"][t], d["nrm"][t]
            yy, xx = ys + y0, xs + x0
            pos[yy, xx] = np.einsum("ij,jk->ik", W, P.astype(np.float64))
            nn = np.einsum("ij,jk->ik", W, N.astype(np.float64))
            nrm[yy, xx] = nn / np.linalg.norm(nn, axis=1, keepdims=True).clip(1e-6)
            tag[yy, xx] = d["tag"][t]
            part[yy, xx] = d["part"][t]
            area3 = np.linalg.norm(np.cross(P[1] - P[0], P[2] - P[0])) / 2
            mpt[yy, xx] = math.sqrt(area3 / (abs(den) / 2))
        self.covered = tag >= 0
        idx = ndimage.distance_transform_edt(~self.covered, return_distances=False, return_indices=True)
        fill = lambda a: a[idx[0], idx[1]]
        self.tag, self.part, self.pos, self.nrm, self.mpt = fill(tag), fill(part), fill(pos), fill(nrm), fill(mpt)
        occ = np.asarray(Image.open(os.path.join(BAKES, f"{name}_occlusion.png")), np.float32)
        self.ao = (occ / (65535.0 if occ.max() > 255 else 255.0)).clip(0, 1)
        if self.ao.ndim == 3:
            self.ao = self.ao[..., 0]
        self.ao = fill(np.where(self.covered, self.ao, 0))
        # Flattened views, which every painter works on.
        self.n = S * S
        self.P = self.pos.reshape(-1, 3)
        self.N = self.nrm.reshape(-1, 3)
        self.TAG = self.tag.reshape(-1)
        self.PART = self.part.reshape(-1)
        self.AO = self.ao.reshape(-1)
        self.convex = self._convexity()
        # What is painted.
        self.base = np.full((self.n, 3), 0.5, np.float32)
        self.alpha = np.ones(self.n, np.float32)
        self.height = np.zeros(self.n, np.float32)
        self.rough = np.full(self.n, 0.6, np.float32)
        self.metal = np.zeros(self.n, np.float32)
        self.cavity = np.ones(self.n, np.float32)
        self.mask = np.zeros((self.n, 3), np.float32)
        self.hurt = np.zeros((self.n, 4), np.float32)
        self.decay = np.zeros((self.n, 4), np.float32)
        # When rust, not fire, shows in the decay picture, in stages; 9 for never.
        self.rust = np.full(self.n, 9.0, np.float32)

    def _convexity(self):
        """How sharply the surface turns at each texel, outward positive: the change of normal over distance to the
        texels beside it on the same part, blurred over a few centimetres."""
        p, n = self.pos, self.nrm
        k = np.zeros(p.shape[:2], np.float32)
        count = np.zeros(p.shape[:2], np.float32)
        for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            q = np.roll(p, (dy, dx), (0, 1))
            m = np.roll(n, (dy, dx), (0, 1))
            same = np.roll(self.part, (dy, dx), (0, 1)) == self.part
            d = q - p
            d2 = (d * d).sum(2)
            ok = same & (d2 > 1e-10) & (d2 < 0.01 ** 2 * 16)
            k += np.where(ok, ((m - n) * d).sum(2) / np.maximum(d2, 1e-10), 0)
            count += ok
        k = k / np.maximum(count, 1)
        sigma = max(1.0, 0.02 / max(float(np.median(self.mpt)), 1e-4))
        return ndimage.gaussian_filter(k, sigma).reshape(-1)

    def where(self, *names):
        return np.isin(self.TAG, [T[n] for n in names])

    def part_is(self, prefix):
        ids = [i for i, p in enumerate(self.parts) if p.startswith(prefix)]
        return np.isin(self.PART, ids)

    def wheel_local(self):
        """Each texel's place on its wheel: along the axle outward, the radius, and the angle round it."""
        a = np.zeros(self.n, np.float32)
        r = np.zeros(self.n, np.float32)
        th = np.zeros(self.n, np.float32)
        for i, name in enumerate(self.parts):
            if name not in PIVOTS or not name.startswith("wheel"):
                continue
            m = self.PART == i
            c = PIVOTS[name]
            side = 1 if c[0] > 0 else -1
            p = self.P[m]
            a[m] = side * (p[:, 0] - c[0])
            dy, dz = p[:, 1] - c[1], p[:, 2] - c[2]
            r[m] = np.hypot(dy, dz)
            th[m] = np.arctan2(dz, dy)
        return a, r, th

    # Writing.
    def normal_map(self):
        """The height's slope as a normal map: red along the picture, green up it."""
        S = self.size
        h = self.height.reshape(S, S)
        mpt = np.maximum(self.mpt, 1e-5)
        gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * mpt)
        gy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) / (2 * mpt)
        n = np.stack([-gx, -gy, np.ones_like(gx)], -1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        return n

    def save(self, cutout=False):
        S = self.size
        out = lambda suffix: os.path.join(HERE, f"{self.name}_{suffix}.png")
        base = np.clip(self.base, 0, 1).reshape(S, S, 3)
        alpha = np.clip(self.alpha, 0, 1).reshape(S, S, 1) if cutout else np.ones((S, S, 1), np.float32)
        Image.fromarray(np.round(np.concatenate([base, alpha], -1) * 255).astype(np.uint8)).convert("RGBA" if cutout else "RGB").save(out("base"), optimize=True)
        n = self.normal_map()
        Image.fromarray(np.round((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(out("normal"), optimize=True)
        occlusion = np.clip(self.AO * self.cavity, 0, 1)
        packed = np.stack([occlusion, np.clip(self.rough, 0, 1), np.clip(self.metal, 0, 1)], -1).reshape(S, S, 3)
        half = lambda a: a.reshape(S // 2, 2, S // 2, 2, *a.shape[2:]).mean((1, 3))
        Image.fromarray(np.round(half(packed) * 255).astype(np.uint8)).save(out("packed"), optimize=True)
        Image.fromarray(np.round(half(np.clip(self.mask, 0, 1).reshape(S, S, 3)) * 255).astype(np.uint8)).save(out("mask"), optimize=True)
        h = self.height.reshape(S, S)
        lo, hi = float(h.min()), float(h.max())
        Image.fromarray(np.round((h - lo) / max(hi - lo, 1e-9) * 65535).astype(np.uint16)).save(out("height"))
        return hi - lo


    def save_wreck(self, cutout=False):
        """The same surface as the burnt-out wreck (../compact_wreck): every hurt and decay texel shown, all of it dulled
        and darkened as the game does a corpse at its last stage (surface.ts `wounded`), roughened, and in the cabin the
        glass broken out of its frames."""
        S = self.size
        out = lambda suffix: os.path.join(WRECK, f"{self.name}_{suffix}.png")
        hurt = self.hurt[:, 3] > 0
        decay = (self.decay[:, 3] > 0) & ~hurt
        shown = hurt | decay
        albedo = self.base.copy()
        albedo[hurt] = self.hurt[hurt, :3]
        albedo[decay] = self.decay[decay, :3]
        lin = np.where(albedo <= 0.04045, albedo / 12.92, ((albedo + 0.055) / 1.055) ** 2.4)
        grey = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        lin = (lin + (grey[:, None] * np.array([1.04, 0.97, 0.86], np.float32) - lin) * 0.55) * (1 - 0.3)
        albedo = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
        alpha = self.alpha.copy()
        if cutout:
            broken = self.where("glass", "glass_in") & (fbm(self.P, 0.09, 3, 91) > 0.4)
            alpha[broken] = 0.0
        base = np.concatenate([np.clip(albedo, 0, 1), alpha[:, None]], -1).reshape(S, S, 4)
        Image.fromarray(np.round(base * 255).astype(np.uint8)).convert("RGBA" if cutout else "RGB").save(out("base"), optimize=True)
        rough = np.where(shown, 0.86, np.clip(self.rough + 0.2, 0, 1))
        metal = np.where(shown, 0.0, self.metal * 0.5)
        occlusion = np.clip(self.AO * self.cavity, 0, 1)
        half = lambda a: a.reshape(S // 2, 2, S // 2, 2, *a.shape[2:]).mean((1, 3))
        packed = np.stack([occlusion, rough, metal], -1).reshape(S, S, 3)
        Image.fromarray(np.round(half(packed) * 255).astype(np.uint8)).save(out("packed"), optimize=True)
        mask = (np.clip(self.mask, 0, 1) * (~shown)[:, None]).reshape(S, S, 3)
        Image.fromarray(np.round(half(mask) * 255).astype(np.uint8)).save(out("mask"), optimize=True)

    def save_abandoned(self, cutout=False):
        """The car as years standing in the street leave it (../compact_abandoned): its first knocks and the first rust on
        the body, as the first third of the hurt and decay pictures show them; dust settled on what faces up and run down
        the sides, the paint chalked by the sun where it faces it, the clear coat and the chrome dull. A static dyes region
        0 only, so the upholstery and the alloys are painted in at their sample colours, as a dye would show them."""
        S = self.size
        out = lambda suffix: os.path.join(ABANDONED, f"{self.name}_{suffix}.png")
        P, N = self.P, self.N
        lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((np.clip(c, 0, None) + 0.055) / 1.055) ** 2.4)
        srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)
        luma = np.array([0.2126, 0.7152, 0.0722], np.float32)
        albedo = lin(np.clip(self.base, 0, 1))
        mask = np.clip(self.mask, 0, 1).copy()
        # The material's grey, as the pack measures it (tools/art/materials.ts), divides a sample colour into a dye.
        share = mask[:, 1] + mask[:, 2]
        if share.sum() > 0:
            grey = float((share * (albedo @ luma)).sum() / share.sum())
            for k, colour in ((1, UPHOLSTERY), (2, WHEELS)):
                albedo *= (1 - mask[:, k:k + 1]) + mask[:, k:k + 1] * lin(colour) / grey
            mask[:, 1:] = 0
        albedo = srgb(albedo)
        rough, metal = self.rough.copy(), self.metal.copy()
        knocked = self.hurt[:, 3] >= 1 - FIRST / 3
        albedo[knocked] = self.hurt[knocked, :3]
        rough[knocked], metal[knocked] = 0.6, 0.0
        rusted = (self.rust < FIRST) & ~knocked
        albedo[rusted] = self.decay[rusted, :3]
        rough[rusted], metal[rusted] = 0.9, 0.0
        mask[knocked | rusted, 0] = 0
        up = np.clip(N[:, 1], 0, 1)
        runs = smoothstep(0.6, 0.85, streaks(P, 1, 0.05, 201)) * smoothstep(0.9, 0.4, P[:, 1])
        dust = np.clip(0.1 + up ** 1.5 * (0.3 + 0.4 * fbm(P, 0.3, 3, 202)) + runs * 0.18 + smoothstep(0.8, 0.3, self.AO) * 0.15, 0, 0.8)
        # Less on the glass, which stays dark enough to read as glass in a far level's flat colour.
        if self.name == "cabin":
            dust[self.where("glass")] *= 0.45
        mask[:, 0] *= (1 - dust) * (1 - 0.3 * up * fbm(P, 0.5, 2, 203))
        albedo = mix(albedo, DUST * (0.92 + 0.16 * fbm(P, 0.05, 3, 204))[:, None], dust)
        rough = np.clip(rough + 0.2 + dust * 0.4, 0, 1)
        metal = metal * (1 - dust) * 0.7
        alpha = self.alpha
        base = np.concatenate([np.clip(albedo, 0, 1), alpha[:, None]], -1).reshape(S, S, 4)
        Image.fromarray(np.round(base * 255).astype(np.uint8)).convert("RGBA" if cutout else "RGB").save(out("base"), optimize=True)
        occlusion = np.clip(self.AO * self.cavity, 0, 1)
        half = lambda a: a.reshape(S // 2, 2, S // 2, 2, *a.shape[2:]).mean((1, 3))
        packed = np.stack([occlusion, rough, metal], -1).reshape(S, S, 3)
        Image.fromarray(np.round(half(packed) * 255).astype(np.uint8)).save(out("packed"), optimize=True)
        Image.fromarray(np.round(half(mask.reshape(S, S, 3)) * 255).astype(np.uint8)).save(out("mask"), optimize=True)


WRECK = os.path.join(os.path.dirname(FOLDER), "compact_wreck", "tex")
ABANDONED = os.path.join(os.path.dirname(FOLDER), "compact_abandoned", "tex")
# How far into the hurt and decay pictures an abandoned car shows, in stages of three; dust's colour; the sample
# colours of the upholstery and the alloys (palette 220 and 91, asset.ts `regions`).
FIRST = 0.8
DUST = rgb(0.55, 0.51, 0.44)
UPHOLSTERY = rgb(150, 98, 66) / 255
WHEELS = rgb(174, 182, 191) / 255


# The order a layer reveals in: alpha 1 shows from the first stage, falling a third a stage, 0 never.
def reveal(t):
    """Alpha for a texel that starts to show `t` stages in (0 to 3)."""
    return np.where(t < 3, np.clip(1 - t / 3, 1 / 255, 1), 0)


def sites(points, s, spread, seed):
    """Distance from each texel to the nearest of `points`, roughened by noise, over each point's radius, and which."""
    best = np.full(s.n, np.inf, np.float32)
    which = np.full(s.n, -1, np.int32)
    wob = fbm(s.P, 0.12, 3, seed) - 0.5
    for i, (c, r) in enumerate(points):
        d = np.linalg.norm(s.P - np.array(c, np.float32), axis=1) / r * (1 + spread * wob * 2)
        closer = d < best
        best[closer] = d[closer]
        which[closer] = i
    return best, which


def streaks(p, along, scale, seed):
    """Noise stretched along a direction: scrapes and runs."""
    q = p.copy()
    q[:, along] *= 0.08
    return fbm(q, scale, 3, seed)


def cracks(p, centre, normal, radius, seed, rings=4, spokes=11):
    """A spider-web of cracks round an impact on glass: 1 on a crack, 0 between."""
    c = np.array(centre, np.float32)
    nrm = np.array(normal, np.float32)
    nrm /= np.linalg.norm(nrm)
    u = np.cross(nrm, [0, 1, 0] if abs(nrm[1]) < 0.9 else [1, 0, 0]).astype(np.float32)
    u /= np.linalg.norm(u)
    v = np.cross(nrm, u)
    d = p - c
    x, y = (d * u).sum(1), (d * v).sum(1)
    r = np.hypot(x, y)
    th = np.arctan2(y, x)
    rng = np.random.default_rng(seed)
    angles = np.sort(rng.uniform(-math.pi, math.pi, spokes))
    jitter = fbm(p, 0.03, 2, seed) - 0.5
    line = np.zeros(len(p), np.float32)
    for a in angles:
        da = np.angle(np.exp(1j * (th + jitter * 0.25 - a)))
        w = np.abs(da) * r
        line = np.maximum(line, smoothstep(0.0018, 0.0006, w) * (r < radius * rng.uniform(0.6, 1.0)))
    for k in range(1, rings + 1):
        rr = radius * k / (rings + 1) * (1 + 0.3 * jitter)
        line = np.maximum(line, smoothstep(0.0016, 0.0005, np.abs(r - rr)) * (fbm(p * 3, 0.05, 2, seed + k) > 0.45))
    line = np.maximum(line, smoothstep(0.012, 0.004, r))
    return line, r


# ----------------------------------------------------------------------------------------------------- the body

PAINT_GREY = 0.80
DIRT = rgb(0.43, 0.38, 0.31)


def paint_body():
    s = Surface("body")
    P, N, y = s.P, s.N, s.P[:, 1]
    paint, jamb = s.where("paint"), s.where("jamb")
    # Road film low on the panels and behind the wheels, dust settled in what light does not reach, a little on top.
    behind = np.zeros(s.n, np.float32)
    for z in (1.25, -1.25):
        behind = np.maximum(behind, smoothstep(0.75, 0.25, np.hypot(np.abs(P[:, 2] - (z - 0.25)), y - 0.25)))
    film = smoothstep(0.50, 0.16, y) * (0.18 + 0.4 * fbm(P, 0.25, 4, 1)) + behind * smoothstep(0.6, 0.3, y) * 0.25
    crevice = smoothstep(0.8, 0.3, s.AO) * 0.45
    dust = np.clip(N[:, 1], 0, 1) ** 2 * smoothstep(0.5, 0.75, fbm(P, 0.4, 4, 2)) * 0.12
    runs = smoothstep(0.62, 0.85, streaks(P, 1, 0.05, 3)) * smoothstep(0.8, 0.45, y) * 0.14
    dirt = np.clip(film + crevice + dust + runs, 0, 0.75)
    dirt[jamb] = np.clip(dirt[jamb] + 0.25, 0, 0.9)
    grime = mix(DIRT, rgb(0.30, 0.27, 0.23), fbm(P, 0.08, 3, 4))
    grey = PAINT_GREY * (0.97 + 0.06 * fbm(P, 0.6, 3, 5))
    base = mix(np.stack([grey] * 3, 1), grime, dirt)
    base[jamb] *= 0.72
    s.base[:] = base
    s.mask[:, 0] = np.where(paint | jamb, 1 - dirt, 0)
    # Clear coat: smooth, dulled by dirt; orange peel and a fuel door in the height.
    s.rough[:] = 0.22 + 0.5 * dirt + 0.04 * fbm(P, 0.3, 2, 6)
    s.rough[jamb] = 0.5
    s.metal[:] = 0.0
    s.height[:] = (fbm(P, 0.004, 2, 7) - 0.5) * 0.00006
    fuel = (P[:, 0] < -0.6) & (N[:, 0] < -0.5)
    d = np.hypot(P[:, 2] + 1.52, y - 0.80)
    groove = smoothstep(0.0025, 0.0005, np.abs(d - 0.068)) * fuel
    s.height -= groove * 0.0012
    s.cavity -= groove * 0.5
    hinge = smoothstep(0.006, 0.0015, np.abs(d - 0.06)) * fuel * (np.abs(y - 0.80) < 0.01) * (P[:, 2] > -1.52)
    s.base[groove > 0.5] *= 0.6
    # The hood's and the boot lid's shut lines, drawn into the paint: over the top as seen from above, and down the
    # nose and the tail as seen from in front and behind.
    top, front, back = N[:, 1] > 0.45, (N[:, 2] > 0.5) & (P[:, 2] > 1.7), (N[:, 2] < -0.5) & (P[:, 2] < -1.7)
    x, z = np.abs(P[:, 0]), P[:, 2]
    lines = [
        top & (P[:, 2] > 0.7) & (np.abs(z - 0.80) < 0.0025) & (x < 0.70),
        top & (z > 0.80) & (z < 1.95) & (np.abs(x - (0.70 + (z - 0.80) * 0.01)) < 0.0025),
        front & (np.abs(y - 0.665) < 0.0025) & (x < 0.405),
        top & (np.abs(z + 1.42) < 0.0025) & (x < 0.63),
        top & (z < -1.42) & (np.abs(x - 0.63) < 0.0025),
        back & (np.abs(y - 0.848) < 0.0025) & (x < 0.63),
        back & (y > 0.848) & (np.abs(x - 0.63) < 0.0025),
    ]
    shut = np.zeros(s.n, bool)
    for line in lines:
        shut |= line
    shut &= paint
    soft = ndimage.gaussian_filter(shut.reshape(s.size, s.size).astype(np.float32), 0.8).reshape(-1)
    s.height -= soft * 0.0015
    s.cavity -= np.clip(soft * 1.5, 0, 0.7)
    s.base[shut] *= 0.35

    # Hurt: knocks to the corners, the doors and the arches. A scrape's middle is bare steel streaked along the car,
    # round it primer and chipped paint; a dent's creases darken.
    knocks = [((0.72, 0.42, 1.92), 0.22), ((-0.70, 0.55, 1.88), 0.18), ((0.82, 0.55, -0.15), 0.26), ((-0.83, 0.50, 0.30), 0.22),
              ((0.80, 0.55, -1.72), 0.2), ((-0.72, 0.50, -1.92), 0.24), ((0.86, 0.62, 1.30), 0.16), ((-0.86, 0.62, -1.20), 0.18),
              ((0.0, 0.83, 1.55), 0.22), ((0.30, 1.47, -0.10), 0.16), ((-0.55, 0.98, -1.60), 0.16), ((0.85, 0.72, 0.30), 0.14)]
    start = [0.0, 0.3, 0.1, 0.9, 0.5, 1.2, 1.4, 1.6, 0.7, 1.9, 2.1, 1.0]
    # Knocks are long along the car and short up it, as a scrape is; their edges ragged.
    wob = fbm(P, 0.08, 3, 11) - 0.5
    d = np.full(s.n, np.inf, np.float32)
    which = np.zeros(s.n, np.int32)
    for i, (c, r) in enumerate(knocks):
        di = np.linalg.norm((P - np.array(c, np.float32)) * np.array([1.0, 1.5, 0.5], np.float32), axis=1) / r * (1 + 0.9 * wob)
        closer = di < d
        d[closer], which[closer] = di[closer], i
    t0 = np.array(start, np.float32)[which]
    t = t0 + d * 1.6
    hurt = (paint | jamb) & (d < 1.0)
    steel = mix(rgb(0.58, 0.58, 0.59), rgb(0.36, 0.36, 0.37), streaks(P, 2, 0.006, 12))
    primer = mix(rgb(0.56, 0.55, 0.51), rgb(0.44, 0.43, 0.40), fbm(P, 0.01, 2, 13))
    chip = rgb(0.20, 0.20, 0.21)
    scratch = streaks(P, 2, 0.004, 14)
    core = smoothstep(0.6, 0.3, d + (scratch - 0.5) * 0.5)
    ring = smoothstep(0.98, 0.85, d)
    colour = mix(mix(chip, primer, ring * 0.6), steel, core)
    crease = smoothstep(0.025, 0.0, np.abs(np.sin(d * 7.0 + wob * 5))) * (d < 0.75) * 0.5
    colour = colour * (1 - crease[:, None] * 0.5)
    keep = hurt & ((scratch > 0.35 + 0.25 * d) | (d < 0.3)) & (fbm(P, 0.02, 3, 16) > 0.3 * d)
    s.hurt[keep, :3] = colour[keep]
    s.hurt[keep, 3] = reveal(t[keep])

    # Decay, as a wreck burns and rusts: rust from the edges, the sills and the arches first, then the fire's soot and
    # blistered paint from the engine bay and the cabin out, until little paint is left.
    edge = np.clip(s.convex * 0.08, 0, 1)
    low = smoothstep(0.55, 0.2, y)
    arch = behind
    rusty = fbm(P, 0.09, 5, 21) + 0.35 * edge + 0.3 * low + 0.25 * arch + 0.15 * (1 - s.AO)
    burn_from = np.minimum(np.linalg.norm((P - [0, 0.8, 1.45]) * [1, 1, 0.8], axis=1), np.linalg.norm((P - [0, 1.2, -0.1]) * [1.3, 1, 1], axis=1))
    burnt = smoothstep(1.9, 0.2, burn_from) + (fbm(P, 0.25, 4, 22) - 0.5) * 0.8
    rust_t = np.clip((1.25 - rusty) * 3.2, 0, 3.2)
    burn_t = np.clip((1.15 - burnt) * 2.6, 0, 3.2)
    t = np.minimum(rust_t, burn_t)
    rust_c = mix(mix(rgb(0.42, 0.20, 0.09), rgb(0.26, 0.13, 0.07), fbm(P, 0.03, 3, 23)), rgb(0.55, 0.30, 0.12), smoothstep(0.6, 0.8, fbm(P, 0.01, 2, 24)))
    soot = mix(rgb(0.07, 0.065, 0.06), rgb(0.16, 0.15, 0.14), fbm(P, 0.04, 3, 25))
    blister = smoothstep(0.62, 0.72, fbm(P, 0.012, 3, 26))
    ash = mix(soot, rgb(0.30, 0.29, 0.27), blister * 0.5)
    is_burn = burn_t < rust_t
    colour = np.where(is_burn[:, None], mix(ash, rust_c, smoothstep(1.0, 2.6, burn_t) * 0.6), rust_c)
    decay = (paint | jamb) & (t < 3) & (s.hurt[:, 3] == 0)
    s.decay[decay, :3] = colour[decay]
    s.decay[decay, 3] = reveal(t[decay])
    s.rust[decay & ~is_burn] = rust_t[decay & ~is_burn]
    s.save()
    return s


# ----------------------------------------------------------------------------------------------------- the trim


def paint_trim():
    s = Surface("trim")
    P, N, y = s.P, s.N, s.P[:, 1]
    a, r, th = s.wheel_local()
    grain = fbm(P, 0.0025, 2, 31) - 0.5
    film = smoothstep(0.5, 0.12, y) * 0.5 * fbm(P, 0.2, 3, 32) + smoothstep(0.8, 0.4, s.AO) * 0.4
    grime = rgb(0.30, 0.27, 0.22)

    def tagged(name, colour, rough, metal=0.0, height=None):
        m = s.where(name)
        s.base[m] = colour[m] if np.ndim(colour) == 2 else colour
        s.rough[m] = rough[m] if np.ndim(rough) else rough
        s.metal[m] = metal
        if height is not None:
            s.height[m] = height[m]
        return m

    # Black textured plastic, the wheel wells' liners and the underside.
    plastic = mix(rgb(0.115, 0.115, 0.12), grime, film * 0.6)
    tagged("plastic", plastic, 0.62 + 0.15 * film, height=grain * 0.00015)
    tagged("liner", mix(rgb(0.085, 0.08, 0.075), grime * 0.7, fbm(P, 0.06, 3, 33)), 0.85, height=grain * 0.0003)
    tagged("under", mix(rgb(0.19, 0.17, 0.15), rgb(0.33, 0.24, 0.15), fbm(P, 0.15, 4, 34) * 0.8), 0.9)
    tagged("rubber", rgb(0.06, 0.06, 0.06), 0.72, height=grain * 0.0001)

    # Tyres: a tread of blocks between four grooves round and sipes across; ribbed walls.
    groove = np.zeros(s.n, np.float32)
    for g in (-0.06, -0.022, 0.022, 0.06):
        groove = np.maximum(groove, smoothstep(0.0065, 0.004, np.abs(a - g)))
    block = 2 * math.pi / 64
    phase = (th + np.where(np.abs(a) > 0.04, 0.5 * block, 0) + a * 1.6) / block
    sipe = smoothstep(0.08, 0.03, np.abs(phase - np.round(phase))) * (np.abs(a) < 0.085)
    lateral = smoothstep(0.06, 0.02, np.abs(phase - np.round(phase) - 0.5) - 0.0) * (np.abs(a) > 0.06)
    tread_h = -np.maximum(groove, np.maximum(sipe * 0.5, lateral)) * 0.006
    worn = fbm(P, 0.02, 2, 35)
    tread_col = mix(rgb(0.10, 0.10, 0.10), rgb(0.155, 0.15, 0.145), worn * 0.6) * (1 - np.maximum(groove, sipe * 0.6)[:, None] * 0.5)
    tagged("tread", tread_col, 0.88 - 0.1 * worn, height=tread_h)
    ribs = sum(smoothstep(0.0012, 0.0004, np.abs(r - rr)) for rr in (0.252, 0.27, 0.284))
    serr = (r > 0.214) & (r < 0.232)
    serration = np.abs(np.sin(th * 120)) * serr
    wall_h = ribs * 0.0004 + serration * 0.0003
    tagged("sidewall", mix(rgb(0.12, 0.12, 0.12), rgb(0.2, 0.19, 0.18), smoothstep(0.24, 0.215, r) * 0.4 + film * 0.3), 0.82, height=wall_h)

    # The alloys: bright, dulled by brake dust towards the hub and in what is hidden.
    dust = np.clip(smoothstep(0.9, 0.5, s.AO) * 0.7 + smoothstep(0.12, 0.05, r) * 0.2 + 0.25 * fbm(P, 0.05, 3, 36), 0, 1)
    alloy = mix(rgb(0.74, 0.75, 0.77), rgb(0.26, 0.23, 0.20), dust * 0.75)
    rim = tagged("rim", alloy, 0.30 + 0.35 * dust, metal=0.95, height=grain * 0.00004)
    s.mask[rim, 2] = 1 - dust[rim] * 0.6
    rings = np.sin(r * 2400 + fbm(P, 0.02, 2, 37) * 3) * 0.5 + 0.5
    tagged("disc", mix(rgb(0.40, 0.38, 0.36), rgb(0.45, 0.27, 0.17), smoothstep(0.14, 0.165, r) + smoothstep(0.075, 0.05, r)), 0.42 + 0.15 * rings, metal=0.9, height=rings * 0.00005)
    tagged("chrome", rgb(0.86, 0.86, 0.88), 0.07, metal=1.0)
    tagged("mirror", rgb(0.80, 0.82, 0.84), 0.02, metal=1.0)

    # The grille's and the intake's honeycomb.
    ax, ay = P[:, 0] / 0.013, P[:, 1] / 0.013
    q = ax * 2 / 3
    rr_ = (-ax / 3 + ay / math.sqrt(3))
    cell = hexdist(ax, ay)
    wall = smoothstep(0.80, 0.9, cell)
    tagged("mesh", mix(rgb(0.025, 0.025, 0.028), rgb(0.12, 0.12, 0.125), wall), 0.6, height=(wall - 1) * 0.006)

    # The headlamps under a clear lens: a dark housing, two chrome bowls each round a projector, a light strip along
    # the top and the indicator at the outer end.
    m = s.where("headlamp")
    x = np.abs(P[:, 0])
    lens_y = y - 0.016 * (x - 0.405) / 0.367
    lamp = np.tile(rgb(0.10, 0.10, 0.11), (s.n, 1))
    lamp_r = np.full(s.n, 0.05, np.float32)
    lamp_h = np.zeros(s.n, np.float32)
    lamp_m = np.full(s.n, 0.5, np.float32)
    for cx in (0.505, 0.635):
        d = np.hypot(x - cx, lens_y - 0.612)
        bowl = d < 0.034
        lamp[bowl] = mix(rgb(0.86, 0.87, 0.9), rgb(0.6, 0.6, 0.62), d[bowl] / 0.034)
        lamp_h += np.where(bowl, -(0.034 ** 2 - d ** 2) * 1.5, 0)
        proj = d < 0.016
        lamp[proj] = rgb(0.05, 0.06, 0.08)
        lamp_m[bowl & ~proj] = 1.0
        lamp_h += smoothstep(0.0015, 0.0, np.abs(d - 0.034)) * 0.0006
    strip = (lens_y > 0.636) & (lens_y < 0.646) & (x > 0.43) & (x < 0.71)
    lamp[strip] = rgb(0.93, 0.95, 0.96)
    lamp_m[strip] = 0.0
    ind = x > 0.715
    lamp[ind] = mix(rgb(0.85, 0.45, 0.06), rgb(0.7, 0.33, 0.04), (np.sin(lens_y * 900) * 0.5 + 0.5) * 0.4)[ind]
    lamp_m[ind] = 0.0
    lamp_h += np.where(ind, np.sin(lens_y * 900) * 0.00015, 0)
    s.base[m], s.rough[m], s.metal[m], s.height[m] = lamp[m], lamp_r[m], lamp_m[m], lamp_h[m]

    # The tail band: red lamps with fine ribs, reversing lamps beside the middle, and the middle smoked, with the
    # maker's mark: a chevron over a bar, ours.
    m = s.where("taillamp")
    tail = np.tile(rgb(0.50, 0.025, 0.03), (s.n, 1))
    ribs = np.sin(y * 1100) * 0.5 + 0.5
    tail *= (0.85 + 0.15 * ribs)[:, None]
    rev = (x > 0.29) & (x < 0.39)
    tail[rev] = rgb(0.80, 0.80, 0.78)
    mid = x < 0.285
    tail[mid] = rgb(0.10, 0.025, 0.028)
    cy = y - 0.769
    chevron = (np.abs(cy - (0.012 - np.abs(P[:, 0]) * 0.35)) < 0.0035) & (np.abs(P[:, 0]) < 0.05)
    bar = (np.abs(cy + 0.016) < 0.0025) & (np.abs(P[:, 0]) < 0.05)
    mark = chevron | bar
    tail[mark] = rgb(0.82, 0.82, 0.84)
    tail_m = np.where(mark, 1.0, 0.0)
    tail_h = ribs * 0.0001 * ~mid + mark * 0.0006
    s.base[m], s.rough[m], s.metal[m], s.height[m] = tail[m], np.where(mark, 0.15, 0.06)[m], tail_m[m], tail_h[m]
    m = s.where("amber")
    prisms = (np.sin(P[:, 0] * 700) * np.sin(y * 700)) * 0.5 + 0.5
    s.base[m] = mix(rgb(0.86, 0.46, 0.05), rgb(0.66, 0.30, 0.03), prisms)[m]
    s.rough[m], s.height[m] = 0.08, (prisms * 0.0002)[m]

    # Plates: no words on them, but the look of a plate: a raised rim, two bolts, a stripe and seven stamped marks.
    m = s.where("plate")
    front = P[:, 2] > 0
    px = np.where(front, P[:, 0], -P[:, 0])
    py = y - np.where(front, 0.32, 0.561)
    plate = mix(rgb(0.86, 0.85, 0.79), rgb(0.7, 0.66, 0.55), fbm(P, 0.05, 3, 38) * 0.4)
    rim_ = (np.abs(px) > 0.215) | (np.abs(py) > 0.040)
    stripe = (py > 0.026) & (py < 0.034) & ~rim_
    glyphs = np.zeros(s.n, bool)
    rng = np.random.default_rng(39)
    for g in range(7):
        gx = -0.165 + g * 0.055
        for cell_ in np.argwhere(rng.random((5, 3)) > 0.45):
            yy, xx = cell_
            glyphs |= (np.abs(px - (gx + (xx - 1) * 0.011)) < 0.0055) & (np.abs(py - (0.014 - yy * 0.009)) < 0.0045)
    bolt = (np.hypot(np.abs(px) - 0.17, py - 0.03) < 0.006)
    plate[stripe] = rgb(0.18, 0.28, 0.45)
    plate[glyphs] = rgb(0.12, 0.13, 0.16)
    plate[bolt] = rgb(0.6, 0.6, 0.6)
    s.base[m] = plate[m]
    s.rough[m] = 0.5
    s.height[m] = ((rim_ * 0.0008) + glyphs * 0.0006 + bolt * 0.0008)[m]

    # The exhaust: steel, sooted to the tip.
    m = s.where("exhaust")
    soot = smoothstep(-1.93, -1.995, P[:, 2])
    s.base[m] = mix(rgb(0.48, 0.46, 0.43), rgb(0.07, 0.06, 0.055), soot)[m]
    s.rough[m] = (0.35 + 0.5 * soot)[m]
    s.metal[m] = (1 - soot)[m]

    # Hurt: a cracked headlamp lens, a tail lamp broken through, scuffed and curbed wheels, scraped plastic.
    hl = s.where("headlamp")
    line, rr = cracks(P, (0.62, 0.62, 1.95), (0.3, 0.2, 1.0), 0.16, 41)
    gone = rr < 0.03
    m = hl & (line > 0.3) & (P[:, 0] > 0)
    s.hurt[m, :3] = np.where(gone[m, None], rgb(0.02, 0.02, 0.02), mix(rgb(0.55, 0.58, 0.6), rgb(0.85, 0.87, 0.88), line[m]))
    s.hurt[m, 3] = reveal(0.6 + rr[m] * 10)
    tl = s.where("taillamp")
    line, rr = cracks(P, (-0.58, 0.77, -1.98), (0.0, 0.0, -1.0), 0.18, 42)
    m = tl & ((line > 0.3) | (rr < 0.06))
    s.hurt[m, :3] = np.where((rr[m] < 0.06)[:, None], rgb(0.03, 0.02, 0.02), rgb(0.85, 0.55, 0.55))
    s.hurt[m, 3] = reveal(1.1 + rr[m] * 8)
    wheel = s.where("rim", "sidewall", "tread")
    curb = smoothstep(0.205, 0.214, r) * (s.where("rim") | (r < 0.222))
    scuff = smoothstep(0.55, 0.75, streaks(np.stack([th * 0.2, r, a], 1).astype(np.float32), 0, 0.02, 43))
    rash = wheel & (((curb > 0.5) & (fbm(P, 0.03, 3, 44) > 0.5)) | (s.where("sidewall") & (scuff > 0.5) & (r > 0.235)))
    s.hurt[rash, :3] = np.where(s.where("rim")[rash, None], rgb(0.85, 0.85, 0.86), rgb(0.42, 0.40, 0.36))
    s.hurt[rash, 3] = reveal(0.4 + 2.4 * fbm(P, 0.1, 2, 45)[rash])
    scrape = s.where("plastic") & (smoothstep(0.55, 0.7, streaks(P, 2, 0.02, 46)) > 0.5) & (y < 0.5)
    s.hurt[scrape, :3] = rgb(0.38, 0.37, 0.35)
    s.hurt[scrape, 3] = reveal(0.8 + 2.0 * fbm(P, 0.2, 2, 47)[scrape])

    # Decay: tyres burnt to grey and split, the alloys chalky, chrome rusted, lamps and plastics charred.
    ages = fbm(P, 0.12, 4, 51)
    t = np.clip((1.0 - ages) * 3.2 - 0.3, 0, 3.2)
    burnt_tyre = mix(rgb(0.13, 0.125, 0.12), rgb(0.33, 0.32, 0.30), smoothstep(0.5, 0.75, fbm(P, 0.01, 3, 52)))
    chalk = mix(rgb(0.62, 0.62, 0.60), rgb(0.20, 0.19, 0.18), fbm(P, 0.03, 3, 53))
    rust = mix(rgb(0.40, 0.19, 0.08), rgb(0.25, 0.13, 0.06), fbm(P, 0.02, 3, 54))
    char = mix(rgb(0.035, 0.032, 0.03), rgb(0.22, 0.21, 0.20), smoothstep(0.6, 0.8, fbm(P, 0.02, 3, 55)))
    colour = np.where(s.where("tread", "sidewall")[:, None], burnt_tyre,
                      np.where(s.where("rim")[:, None], chalk, np.where(s.where("chrome", "disc", "exhaust", "plate", "mirror")[:, None], rust, char)))
    decay = (t < 3) & (s.hurt[:, 3] == 0)
    s.decay[decay, :3] = colour[decay]
    s.decay[decay, 3] = reveal(t[decay])
    rusts = decay & s.where("chrome", "disc", "exhaust", "plate", "mirror")
    s.rust[rusts] = t[rusts]
    s.save()
    return s


def hexdist(x, y):
    """Distance to the nearest hexagon's middle on a lattice of unit cells, 0 at the middle to 1 at its walls."""
    qx = x * 2 / 3
    qy = -x / 3 + y / math.sqrt(3)
    qz = -qx - qy
    rx, ry, rz = np.round(qx), np.round(qy), np.round(qz)
    dx, dy, dz = np.abs(rx - qx), np.abs(ry - qy), np.abs(rz - qz)
    fx = np.where((dx > dy) & (dx > dz), -ry - rz, rx)
    fy = np.where(~((dx > dy) & (dx > dz)) & (dy > dz), -fx - rz, ry)
    cx = fx * 1.5
    cy = (fy + fx / 2) * math.sqrt(3)
    px, py = x - cx, y - cy
    # Distance to the walls of a flat-topped hexagon of circumradius 1.
    ax, ay = np.abs(px), np.abs(py)
    return np.maximum(ay / (math.sqrt(3) / 2), (ax * 0.5 + ay * math.sqrt(3) / 2) / (math.sqrt(3) / 2))


# ------------------------------------------------------------------------------------------------------ the cabin

LEATHER = rgb(0.46, 0.27, 0.16)


def paint_cabin():
    s = Surface("cabin")
    P, N, y = s.P, s.N, s.P[:, 1]
    grain = fbm(P, 0.0016, 2, 61) - 0.5
    shade = smoothstep(0.85, 0.35, s.AO)

    def tagged(name, colour, rough, metal=0.0, height=None):
        m = s.where(name)
        s.base[m] = colour[m] if np.ndim(colour) == 2 else colour
        s.rough[m] = rough[m] if np.ndim(rough) else rough
        s.metal[m] = metal
        if height is not None:
            s.height[m] = height[m]
        return m

    # The glass, seen from outside: dark and smooth, with the black dotted band round its edge. Its inside is cut out.
    glass = s.where("glass")
    S = s.size
    inside = ndimage.distance_transform_edt(glass.reshape(S, S)).reshape(-1) * s.mpt.reshape(-1)
    band = smoothstep(0.035, 0.03, inside)
    dots = smoothstep(0.0045, 0.0035, np.hypot((P[:, 0] / 0.012 - np.round(P[:, 0] / 0.012)) * 0.012, (P[:, 2] / 0.012 - np.round(P[:, 2] / 0.012)) * 0.012) / (smoothstep(0.075, 0.035, inside) + 1e-3) * 0.6)
    frit = np.maximum(band, dots * (inside < 0.075))
    tagged("glass", mix(rgb(0.045, 0.055, 0.06), rgb(0.02, 0.02, 0.02), frit), 0.04 + 0.5 * frit)
    s.height[glass] = frit[glass] * 0.0001
    gin = tagged("glass_in", rgb(0.05, 0.06, 0.065), 0.05)
    s.alpha[gin] = 0.0

    # The seats: leather, perforated down the middle of cushion and back, pleated, stitched, worn on the bolsters.
    m = s.where("leather")
    sx = np.abs(np.abs(P[:, 0]) - 0.42)
    middle = sx < 0.13
    facing = (N[:, 1] > 0.6) | (N[:, 2] > 0.6)
    perf = middle & facing & (smoothstep(0.0016, 0.0009, np.hypot(((P[:, 0] / 0.009) % 1 - 0.5) * 0.009, ((P[:, 1] + P[:, 2]) / 0.009 % 1 - 0.5) * 0.009)) > 0.5)
    pleat = middle & facing & (np.abs(((P[:, 1] - P[:, 2]) / 0.07) % 1 - 0.5) > 0.47)
    seam = smoothstep(0.004, 0.0015, np.abs(sx - 0.13)) * facing
    stitch = (np.abs(sx - 0.137) < 0.0012) & ((((P[:, 1] + P[:, 2]) / 0.008) % 1) < 0.55) & facing
    worn = np.clip(s.convex * 0.03, 0, 1) * (~middle)
    leather = mix(LEATHER * (0.92 + 0.16 * fbm(P, 0.05, 3, 62))[:, None], rgb(0.62, 0.42, 0.28), worn * 0.6)
    leather = np.where(middle[:, None] & facing[:, None], leather * 0.86, leather)
    leather[perf] *= 0.35
    leather[pleat] *= 0.6
    leather[stitch] = rgb(0.78, 0.70, 0.55)
    leather = mix(leather, leather * 0.5, shade)
    lh = grain * 0.00012 - perf * 0.0005 - pleat * 0.0012 - seam * 0.001 + stitch * 0.0002
    tagged("leather", leather, 0.55 - 0.15 * worn, height=lh)
    s.mask[m, 1] = 1 - shade[m] * 0.4

    tagged("carpet", mix(rgb(0.16, 0.15, 0.14), rgb(0.11, 0.105, 0.1), fbm(P, 0.004, 3, 63)) * (1 - 0.4 * shade[:, None]), 0.95, height=(fbm(P, 0.002, 3, 64) - 0.5) * 0.0006)
    dash = rgb(0.13, 0.13, 0.14) * (1 - 0.3 * shade[:, None])
    # Vents in the dash's face, louvred across.
    face = N[:, 2] < -0.6
    vent = face & (((np.abs(P[:, 0] - 0.0) < 0.075) & (np.abs(y - 0.81) < 0.022)) | ((np.abs(np.abs(P[:, 0]) - 0.66) < 0.05) & (np.abs(y - 0.80) < 0.025)))
    louvre = vent * (np.sin(y * 900) * 0.5 + 0.5)
    dash[vent] *= 0.4
    tagged("dash", dash, 0.72, height=grain * 0.0001 - louvre * 0.002)
    tagged("headliner", mix(rgb(0.52, 0.50, 0.46), rgb(0.44, 0.42, 0.39), fbm(P, 0.003, 2, 65)) * (1 - 0.35 * shade[:, None]), 0.95, height=grain * 0.0002)
    panel = rgb(0.20, 0.19, 0.18) * (1 - 0.35 * shade[:, None])
    speaker = (np.abs(P[:, 0]) > 0.6) & (np.hypot(P[:, 2] - 0.25, y - 0.35) < 0.065)
    holes = speaker & (smoothstep(0.0018, 0.001, np.hypot(((P[:, 2] / 0.007) % 1 - 0.5) * 0.007, ((y / 0.007) % 1 - 0.5) * 0.007)) > 0.5)
    panel[holes] *= 0.3
    tagged("panel", panel, 0.68, height=grain * 0.00012 - holes * 0.0006 - smoothstep(0.003, 0.0, np.abs(np.hypot(P[:, 2] - 0.25, y - 0.35) - 0.065)) * 0.0008 * (np.abs(P[:, 0]) > 0.6))
    tagged("grip", mix(rgb(0.065, 0.065, 0.065), rgb(0.1, 0.1, 0.1), fbm(P, 0.002, 2, 66)), 0.55, height=grain * 0.0002)
    tagged("metal", rgb(0.62, 0.62, 0.64), 0.3, metal=1.0)

    # The dials: black faces, white ticks, red needles at rest; the radio's buttons and dark screen.
    m = s.where("gauge")
    g = np.tile(rgb(0.03, 0.03, 0.035), (s.n, 1))
    for cx in (0.355, 0.485):
        dx, dy = P[:, 0] - cx, y - 0.852
        d = np.hypot(dx, dy)
        ang = np.arctan2(dy, dx)
        ticks = (d > 0.034) & (d < 0.042) & (np.abs(((ang / (math.pi / 12)) % 1) - 0.5) > 0.42) & (ang > -0.9)
        ring = np.abs(d - 0.044) < 0.0012
        needle = (np.abs(dx * math.sin(2.4) - dy * math.cos(2.4)) < 0.0012) & (d < 0.036) & (dx * math.cos(2.4) + dy * math.sin(2.4) > 0)
        g[ticks | ring] = rgb(0.85, 0.85, 0.82)
        g[needle] = rgb(0.85, 0.15, 0.08)
    buttons = (np.abs(y - 0.68) < 0.01) & (np.abs(((P[:, 0] + 0.1) / 0.04) % 1 - 0.5) < 0.3) & (np.abs(P[:, 0]) < 0.09)
    g[buttons] = rgb(0.25, 0.25, 0.26)
    screen = (np.abs(y - 0.735) < 0.022) & (np.abs(P[:, 0]) < 0.07)
    g[screen] = rgb(0.03, 0.07, 0.06)
    s.base[m], s.rough[m], s.height[m] = g[m], 0.12, (buttons * 0.001)[m]

    # Hurt: the windscreen and the rear glass star round their impacts; the seats split to their foam.
    for centre, normal, radius, start, seed in (((0.25, 1.22, 0.47), (0, 0.7, 0.7), 0.30, 0.2, 71), ((-0.32, 1.08, 0.62), (0, 0.7, 0.7), 0.22, 1.2, 72),
                                                 ((0.15, 1.24, -0.95), (0, 0.8, -0.6), 0.25, 1.8, 73)):
        line, rr = cracks(P, centre, normal, radius, seed)
        m = glass & (line > 0.25) & (rr < radius)
        s.hurt[m, :3] = mix(rgb(0.45, 0.5, 0.52), rgb(0.82, 0.86, 0.88), line[m])
        s.hurt[m, 3] = np.maximum(s.hurt[m, 3], reveal(start + rr[m] / radius * 1.4))
    leather = s.where("leather")
    tears, which = sites([((0.42, 0.56, 0.15), 0.12), ((-0.40, 0.85, -0.12), 0.1), ((0.50, 0.62, -0.05), 0.08)], s, 0.5, 74)
    m = leather & (tears < 1)
    foam = mix(rgb(0.72, 0.62, 0.40), rgb(0.55, 0.45, 0.28), fbm(P, 0.01, 2, 75))
    edge = smoothstep(0.75, 0.95, tears)
    s.hurt[m, :3] = mix(foam, rgb(0.15, 0.08, 0.05), edge)[m]
    s.hurt[m, 3] = reveal(np.array([0.5, 1.4, 2.0])[which[m]] + tears[m] * 0.8)

    # Decay: the cabin burnt out: char and ash on every surface, the glass sooted, the seats down to their springs.
    burn = fbm(P, 0.15, 4, 81)
    t = np.clip((1.05 - burn) * 3.0 - 0.2, 0, 3.2)
    char = mix(rgb(0.03, 0.028, 0.026), rgb(0.42, 0.40, 0.37), smoothstep(0.62, 0.8, fbm(P, 0.008, 3, 82)))
    springs = s.where("leather") & (np.abs(((np.abs(P[:, 0]) - 0.42) / 0.04) % 1 - 0.5) < 0.08) & (N[:, 1] > 0.5)
    char[springs] = rgb(0.22, 0.12, 0.07)
    soot = mix(rgb(0.04, 0.035, 0.03), rgb(0.12, 0.10, 0.08), fbm(P, 0.05, 3, 83))
    colour = np.where(glass[:, None], soot, char)
    decay = (t < 3) & (s.hurt[:, 3] == 0) & ~s.where("glass_in")
    s.decay[decay, :3] = colour[decay]
    s.decay[decay, 3] = reveal(t[decay])
    # Keep the printed perimeter on the drivable car; its glass admits sight and shots from either side.
    s.alpha[glass] = frit[glass]
    s.save(cutout=True)
    s.alpha[glass] = 1.0  # parked wreck and abandoned variants have their own weathered glass
    return s


def review(s):
    """Each map of a material shrunk to 512, side by side, with the layers over a grey ground."""
    os.makedirs(REVIEW, exist_ok=True)
    names = ["base", "normal", "packed", "mask", "hurt", "decay"]
    tiles = []
    for n in names:
        im = Image.open(os.path.join(HERE, f"{s.name}_{n}.png")).convert("RGBA")
        bg = Image.new("RGBA", im.size, (128, 128, 128, 255))
        tiles.append(Image.alpha_composite(bg, im).convert("RGB").resize((512, 512), Image.LANCZOS))
    sheet = Image.new("RGB", (512 * 3, 1024), (40, 40, 40))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 3) * 512, (i // 3) * 512))
    sheet.save(os.path.join(REVIEW, f"{s.name}_maps.png"), optimize=True)


if __name__ == "__main__":
    import sys

    only = sys.argv[1:]
    ranges = {}
    known = os.path.join(HERE, "maps.json")
    if os.path.exists(known):
        ranges = json.load(open(known))
    for name, fn in (("body", paint_body), ("trim", paint_trim), ("cabin", paint_cabin)):
        if only and name not in only:
            continue
        s = fn()
        os.makedirs(WRECK, exist_ok=True)
        s.save_wreck(cutout=name == "cabin")
        os.makedirs(ABANDONED, exist_ok=True)
        s.save_abandoned(cutout=name == "cabin")
        ranges[f"{name}_height_mm"] = round(float(s.height.max() - s.height.min()) * 1000, 4)
        review(s)
        print(f"paint: {name}")
    with open(known, "w") as f:
        json.dump(ranges, f, indent=1)
        f.write("\n")
