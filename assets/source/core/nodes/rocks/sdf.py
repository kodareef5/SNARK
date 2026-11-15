# Solids as signed distance: negative inside, in metres, +Z up. The noise and
# the shapes the rocks are carved from, and the meshing of a field into quads
# by OpenVDB. Plain NumPy, so a field can be tried outside Blender too.

import numpy as np

_GRADS = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                   [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1]], dtype=np.float32)


def _hash3(x, y, z, seed):
    """A 32-bit hash of whole-number lattice points."""
    h = (x.astype(np.uint32) * np.uint32(0x8DA6B343)) ^ (y.astype(np.uint32) * np.uint32(0xD8163841)) ^ (z.astype(np.uint32) * np.uint32(0xCB1AB31F))
    h ^= np.uint32(seed * 0x9E3779B1 & 0xFFFFFFFF)
    h ^= h >> np.uint32(15)
    h *= np.uint32(0x2C1B3C6D)
    h ^= h >> np.uint32(12)
    h *= np.uint32(0x297A2D39)
    h ^= h >> np.uint32(15)
    return h


class Noise:
    """Gradient noise and cellular noise of one seed. Points are (N, 3) arrays in metres; `scale` is the feature size."""

    def __init__(self, seed):
        self.seed = int(seed) & 0xFFFF

    def perlin(self, p, scale, seed=0):
        q = p / scale + np.float32(17.31 * (seed % 97))
        i = np.floor(q)
        f = (q - i).astype(np.float32)
        i = i.astype(np.int64)
        u = f * f * f * (f * (f * 6 - 15) + 10)
        s = self.seed * 131 + seed
        out = None
        for dx in (0, 1):
            wx = u[:, 0] if dx else 1 - u[:, 0]
            for dy in (0, 1):
                wy = u[:, 1] if dy else 1 - u[:, 1]
                for dz in (0, 1):
                    wz = u[:, 2] if dz else 1 - u[:, 2]
                    g = _GRADS[_hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, s) & np.uint32(15)]
                    d = g[:, 0] * (f[:, 0] - dx) + g[:, 1] * (f[:, 1] - dy) + g[:, 2] * (f[:, 2] - dz)
                    t = d * wx * wy * wz
                    out = t if out is None else out + t
        return out

    def fbm(self, p, scale, octaves=4, gain=0.5, lac=2.03, seed=0):
        total = np.zeros(len(p), np.float32)
        amp, sc, norm = 1.0, scale, 0.0
        for o in range(octaves):
            total += amp * self.perlin(p, sc, seed + o * 7)
            norm += amp
            amp *= gain
            sc /= lac
        return total / norm

    def ridged(self, p, scale, octaves=3, gain=0.5, seed=0):
        """Sharp crests where the noise crosses zero: 1 on a crest, falling to 0."""
        total = np.zeros(len(p), np.float32)
        amp, sc, norm = 1.0, scale, 0.0
        for o in range(octaves):
            total += amp * (1 - np.abs(self.perlin(p, sc, seed + o * 11)) * 1.6)
            norm += amp
            amp *= gain
            sc /= 2.1
        return total / norm

    def cells(self, p, scale, seed=0, jitter=0.9):
        """Distance to the nearest and second nearest of points scattered one to a cell, in metres, and the nearest's hash."""
        q = p / scale
        i = np.floor(q).astype(np.int64)
        f1 = np.full(len(p), 9.0, np.float32)
        f2 = np.full(len(p), 9.0, np.float32)
        id1 = np.zeros(len(p), np.uint32)
        s = self.seed * 977 + seed
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    cx, cy, cz = i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz
                    h = _hash3(cx, cy, cz, s)
                    jx = ((h & np.uint32(1023)).astype(np.float32) / 1023 - 0.5) * jitter + 0.5
                    jy = (((h >> np.uint32(10)) & np.uint32(1023)).astype(np.float32) / 1023 - 0.5) * jitter + 0.5
                    jz = (((h >> np.uint32(20)) & np.uint32(1023)).astype(np.float32) / 1023 - 0.5) * jitter + 0.5
                    ddx = (cx + jx - q[:, 0]).astype(np.float32)
                    ddy = (cy + jy - q[:, 1]).astype(np.float32)
                    ddz = (cz + jz - q[:, 2]).astype(np.float32)
                    d = np.sqrt(ddx * ddx + ddy * ddy + ddz * ddz)
                    nearer = d < f1
                    f2 = np.where(nearer, f1, np.minimum(f2, d))
                    id1 = np.where(nearer, h, id1)
                    f1 = np.where(nearer, d, f1)
        return f1 * scale, f2 * scale, id1


def smin(a, b, k):
    """Union with a fillet of about k."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def smax(a, b, k):
    """Intersection with the edge rounded by about k."""
    return -smin(-a, -b, k)


def box(p, centre, half, round_=0.0):
    q = np.abs(p - np.asarray(centre, np.float32)) - (np.asarray(half, np.float32) - round_)
    outside = np.sqrt(np.sum(np.maximum(q, 0) ** 2, axis=1))
    inside = np.minimum(np.max(q, axis=1), 0)
    return (outside + inside - round_).astype(np.float32)


def ellipsoid(p, centre, radii):
    """A close bound of the distance to an ellipsoid (Quilez)."""
    r = np.asarray(radii, np.float32)
    q = (p - np.asarray(centre, np.float32))
    k0 = np.sqrt(np.sum((q / r) ** 2, axis=1))
    k1 = np.sqrt(np.sum((q / (r * r)) ** 2, axis=1))
    return (k0 * (k0 - 1) / np.maximum(k1, 1e-6)).astype(np.float32)


def capsule(p, a, b, r):
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    pa = p - a
    ba = b - a
    t = np.clip((pa @ ba) / max(float(ba @ ba), 1e-9), 0, 1)
    d = pa - t[:, None] * ba
    return np.sqrt(np.sum(d * d, axis=1)) - r


def tube(p, points, radii):
    """A rounded tube along a polyline, its radius running from point to point."""
    out = np.full(len(p), 9.0, np.float32)
    for k in range(len(points) - 1):
        a = np.asarray(points[k], np.float32)
        b = np.asarray(points[k + 1], np.float32)
        pa = p - a
        ba = b - a
        t = np.clip((pa @ ba) / max(float(ba @ ba), 1e-9), 0, 1)
        d = pa - t[:, None] * ba
        r = radii[k] + (radii[k + 1] - radii[k]) * t
        out = np.minimum(out, np.sqrt(np.sum(d * d, axis=1)) - r)
    return out


def planes(p, normals, offsets):
    """The convex solid inside every plane: dot(p, n) <= d."""
    n = np.asarray(normals, np.float32)
    n = n / np.linalg.norm(n, axis=1, keepdims=True)
    return np.max(p @ n.T - np.asarray(offsets, np.float32)[None, :], axis=1)


_JOB = {}


def _slab(i):
    lo, step, ys, zs = _JOB["lo"], _JOB["step"], _JOB["ys"], _JOB["zs"]
    return np.stack([np.full(len(ys), lo[0] + i * step, np.float32), ys, zs], axis=1)


def _base(i):
    return _JOB["form"].base(_slab(i))


def _detail(i):
    vol, g = _JOB["vol"], _JOB["grad"]
    near = np.abs(vol[i]) < _JOB["form"].margin
    out = vol[i].copy()
    if near.any():
        n = np.stack([g[0][i][near], g[1][i][near], g[2][i][near]], axis=1)
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-6)
        out[near] = _JOB["form"].detail(_slab(i)[near.ravel()], vol[i][near], n)
    return out


def mesh_field(form, lo, hi, step, workers=6):
    """
    Meshes the zero surface of a form over the box lo..hi at `step` metres. `form.base(points)` is its solid without
    the fine detail, and `form.detail(points, base, normals)` adds the detail, which moves the surface less than
    `form.margin`, at the points that near the surface. Slabs of the box are worked in `workers` processes. Returns
    vertices (V, 3) and quads (Q, 4).
    """
    import multiprocessing as mp

    import openvdb as vdb

    lo = np.asarray(lo, np.float32)
    hi = np.asarray(hi, np.float32)
    n = np.ceil((hi - lo) / step).astype(int) + 1
    ys, zs = np.meshgrid(np.arange(n[1], dtype=np.float32) * step + lo[1], np.arange(n[2], dtype=np.float32) * step + lo[2], indexing="ij")
    _JOB.clear()
    _JOB.update(form=form, lo=lo, step=step, ys=ys.ravel(), zs=zs.ravel())
    ctx = mp.get_context("fork")
    with ctx.Pool(workers) as pool:
        vol = np.stack([v.reshape(n[1], n[2]) for v in pool.map(_base, range(n[0]))]).astype(np.float32)
    _JOB.update(vol=vol, grad=np.gradient(vol, step))
    with ctx.Pool(workers) as pool:
        vol = np.stack(pool.map(_detail, range(n[0]))).astype(np.float32)
    _JOB.clear()
    np.clip(vol, -4 * step, 4 * step, out=vol)
    grid = vdb.FloatGrid(background=float(4 * step))
    grid.copyFromArray(vol)
    verts, quads = grid.convertToQuads(isovalue=0.0)
    verts = verts.astype(np.float32) * step + lo
    return verts, quads.astype(np.int64)
