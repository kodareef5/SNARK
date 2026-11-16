# Paints the boat's pictures from tex/bakes (tex/bake.py): every map of its three materials, and the hurt and decay
# pictures the game lays over them. Everything is worked out from where each texel lies on the boat, which way it
# faces, what it is (its tag, parts.py TAGS) and how much light reaches it, by seeded noise and measured shapes, so a
# picture is the same on every run and its charts meet without seams.
#
#   python3 -B tex/paint.py            (NumPy, SciPy, Pillow)
#
# Writes tex/<material>_{base,normal,packed,mask,height,hurt,decay}.png and tex/maps.json, and tex/review/*.png, each
# map seen whole.

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
    """One material's picture as texels: where each lies on the boat, what it is, and fields worked out from those.
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

    def save(self, cutout=False, layer_scale=2):
        S = self.size
        # These UV atlases share one measured metre span across liveries. Their outer four-pixel unused gutter
        # wraps to a neutral constant on all maps, retaining the six-pixel coloured gutters around every chart.
        rim = np.zeros((S,S),bool); rim[:4]=True; rim[-4:]=True; rim[:,:4]=True; rim[:,-4:]=True
        rim = rim.reshape(-1)
        for field,value in (("base",.5),("alpha",0 if cutout else 1),("height",0),("rough",.7),("metal",0),("AO",1),("cavity",1),("mask",0),("hurt",0),("decay",0)):
            getattr(self,field)[rim]=value
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
        # The layers at a size under the base colour's: colour weighed by how soon it shows, alpha the soonest of four.
        hurt_alpha = None
        for kind, layer in (("hurt", self.hurt), ("decay", self.decay)):
            L = layer.reshape(S, S, 4)
            k = layer_scale
            blocks = L.reshape(S // k, k, S // k, k, 4)
            a = blocks[..., 3]
            w = a[..., None] + 1e-6
            colour = (blocks[..., :3] * w).sum((1, 3)) / w.sum((1, 3))
            amax = np.round(a.max((1, 3)) * 255) / 255
            # Where any of the hurt shows, the decay is passed over: none of it may lie under the hurt.
            if hurt_alpha is None:
                hurt_alpha = amax
            else:
                amax = np.where(hurt_alpha > 0, 0, amax)
            img = np.concatenate([np.clip(colour, 0, 1), amax[..., None]], -1)
            Image.fromarray(np.round(img * 255).astype(np.uint8)).save(out(kind), optimize=True)
        return hi - lo


    def save_wreck(self, cutout=False):
        """The same surface as the burnt-out wreck (../boat_wreck): every hurt and decay texel shown, all of it dulled
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


WRECK = os.path.join(os.path.dirname(FOLDER), "boat_wreck", "tex")


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

