"""Fit closed, weighted game topology to the Grab3D surface in model metres."""

import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

folder = Path(__file__).resolve().parents[1]


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


def dot(a, b):
    return (a * b).sum(axis=-1)


def mix(a, b, t):
    return a + (b - a) * t[..., None]


class Sculpt:
    def __init__(self, path):
        raw = Path(path).read_bytes()
        if (
            hashlib.sha256(raw).hexdigest()
            != "eab01a7bb9355e205144f56c0f495657e1f09cad9ef4b10735ad862a05317145"
        ):
            raise ValueError("Expected the full Grab3D stegosaurus.glb")
        end = 20 + int.from_bytes(raw[12:16], "little")
        doc = json.loads(raw[20:end])
        buf = memoryview(raw)[end + 8 :]
        prim = doc["meshes"][0]["primitives"][0]

        def accessor(index, n):
            a = doc["accessors"][index]
            v = doc["bufferViews"][a["bufferView"]]
            dtype = np.dtype({5126: "<f4", 5125: "<u4", 5123: "<u2"}[a["componentType"]])
            return np.ndarray(
                (a["count"], n),
                dtype,
                buf,
                v.get("byteOffset", 0) + a.get("byteOffset", 0),
                strides=(v.get("byteStride", dtype.itemsize * n), dtype.itemsize),
            )

        self.p = accessor(prim["attributes"]["POSITION"], 3).astype(float)
        self.n = accessor(prim["attributes"]["NORMAL"], 3)
        self.uv = accessor(prim["attributes"]["TEXCOORD_0"], 2)
        self.tri = accessor(prim["indices"], 1).reshape(-1, 3)

        def image(slot):
            image = doc["images"][doc["textures"][slot["index"]]["source"]]
            v = doc["bufferViews"][image["bufferView"]]
            start = v.get("byteOffset", 0)
            return np.asarray(
                Image.open(io.BytesIO(buf[start : start + v["byteLength"]])).convert("RGB")
            )

        m = doc["materials"][prim.get("material", 0)]
        pbr = m["pbrMetallicRoughness"]
        self.base = image(pbr["baseColorTexture"])
        self.bump = image(m["normalTexture"])
        self.mro = image(pbr["metallicRoughnessTexture"])


# Measured sagittal back line beneath the paired blades. The slice is taken
# above their roots, where each blade separates cleanly from its neighbour.
def back(z):
    return np.interp(
        z,
        [
            -3.6,
            -3.15,
            -2.75,
            -2.35,
            -2,
            -1.6,
            -1.15,
            -0.75,
            -0.35,
            0.15,
            0.6,
            1,
            1.4,
            1.65,
            1.95,
            2.25,
            2.65,
            2.95,
            3.25,
            3.55,
            4.5,
        ],
        [
            1.37,
            1.39,
            1.45,
            1.57,
            1.70,
            1.94,
            2.18,
            2.43,
            2.66,
            2.88,
            3.03,
            3.02,
            2.90,
            2.78,
            2.65,
            2.49,
            2.32,
            2.23,
            2.22,
            2.3,
            2.20,
        ],
    )


def blades(s):
    x, h, z = s.p.T
    active = (h > back(z) + 0.055) & (z > -3.4) & (z < 3.75)
    _, weld = np.unique(np.round(s.p, 5), axis=0, return_inverse=True)
    faces = s.tri[active[s.tri].all(1)]
    t = weld[faces]
    graph = coo_matrix(
        (np.ones(t.size), (t.ravel(), np.roll(t, 1, axis=1).ravel())), shape=(weld.max() + 1,) * 2
    )
    label = connected_components(graph, directed=False)[1][weld]
    ids, n = np.unique(label[active], return_counts=True)
    result = []
    for i in ids[n > 75]:
        pts = s.p[label == i]
        centre = pts.mean(0)
        tri = faces[label[faces[:, 0]] == i]
        if 1.5 < centre[2] < 2:
            # These two opposing shoulder blades meet under the hide. Split
            # that pair at the sagittal valley before sampling its two faces.
            for sign in [-1, 1]:
                half = tri[sign * (s.p[tri, 0].mean(1) + 0.068) > 0]
                result.append((s.p[np.unique(half)].mean(0), half))
        else:
            result.append((centre, tri))
    return result


def register(p):
    x, h, z = p.T
    along = np.interp(
        z,
        [
            -4.50,
            -3.53,
            -3.12,
            -2.70,
            -2.05,
            -1.5,
            -0.75,
            0.32,
            0.85,
            1.67,
            2.32,
            2.80,
            3.23,
            3.66,
            4.50,
        ],
        [
            -6.03,
            -5.42,
            -4.61,
            -4.06,
            -3.45,
            -2.91,
            -2.14,
            -0.91,
            -0.50,
            0.16,
            1.02,
            1.51,
            1.96,
            2.36,
            3.02,
        ],
    )
    mid = np.interp(
        z,
        [-4.5, -3.5, -2, -0.8, 0.5, 1.5, 2.5, 4.5],
        [0, -0.04, -0.04, -0.012, -0.04, -0.06, -0.06, -0.07],
    )
    across = (x - mid) * 1.16
    up = h + np.interp(
        z,
        [-4.5, -3.35, -2.5, -0.65, 0.65, 1.4, 2.35, 3, 3.65, 4.5],
        [-0.32, 0, -0.02, 0.02, 0, -0.11, -0.27, -0.6, -0.80, -0.85],
    ) * smooth(0.36, 1.6, h)
    # Register the stance on each side separately. The artist posed the left
    # rear foot 60 cm behind its partner and both wrists behind the toes.
    for fore in [False, True]:
        band = smooth(0.85, 1.65, z) if fore else 1 - smooth(0.85, 1.65, z)
        influence = (
            band * (1 - smooth(0.95, 1.96, h)) * smooth(-1.25, -0.56, z) * (1 - smooth(2.95, 3.48, z))
        )
        levels = [0, 0.3, 0.65, 1.10, 1.75]
        positive = x > 0
        if fore:
            sz = np.where(
                positive,
                np.interp(h, levels, [2.79, 2.60, 2.40, 2.30, 2.26]),
                np.interp(h, levels, [2.60, 2.39, 2.25, 2.2, 2.2]),
            )
            sx = np.where(positive, 0.65, -0.60)
            tx = 0.71
            tz = np.interp(h, levels, [1.22, 1.05, 0.80, 0.92, 1.05])
        else:
            sz = np.where(
                positive,
                np.interp(h, levels, [-0.11, -0.26, -0.07, 0.18, 0.36]),
                np.interp(h, levels, [0.49, 0.33, 0.34, 0.48, 0.51]),
            )
            sx = np.where(positive, 0.47, -0.51)
            tx = 0.77
            tz = np.interp(h, levels, [-0.55, -0.66, -0.52, -0.40, -0.8])
        along += influence * (tz + (z - sz) - along)
        across += influence * (np.where(positive, tx, -tx) + (x - sx) - across)
    return np.column_stack((across, up, along))


class Surface:
    """Closest oriented point on nearby source triangles and its barycentrics."""

    def __init__(self, points, tris, ids):
        self.ids = np.asarray(ids)
        self.faces = points[tris[self.ids]]
        self.tree = cKDTree(self.faces.mean(1))

    def sample(self, p, n=None):
        k = 6 if n is None else 20
        near = self.tree.query(p, k=k)[1]
        a, b, c = self.faces[near].transpose(2, 0, 1, 3)
        ab = b - a
        ac = c - a
        ap = p[:, None] - a
        v0 = dot(ab, ab)
        v1 = dot(ab, ac)
        v2 = dot(ac, ac)
        d0 = dot(ap, ab)
        d1 = dot(ap, ac)
        den = np.maximum(1e-20, v0 * v2 - v1 * v1)
        v = (v2 * d0 - v1 * d1) / den
        w = (v0 * d1 - v1 * d0) / den
        bary = np.maximum(np.stack((1 - v - w, v, w), axis=-1), 0)
        bary /= bary.sum(-1, keepdims=True)
        q = a + ab * bary[:, :, 1, None] + ac * bary[:, :, 2, None]
        cost = dot(p[:, None] - q, p[:, None] - q)
        if n is not None:
            cost += 0.14**2 * np.maximum(0, 1 - dot(unit(np.cross(ab, ac)), n[:, None])) ** 2
        row = np.arange(len(p))
        pick = np.argmin(cost, axis=1)
        return self.ids[near[row, pick]], bary[row, pick], q[row, pick]


def blade_rings(p, tri, steps, sides):
    # Intersect the actual triangulated blade with a series of sloped planes.
    # The inner and outer intersections retain the asymmetric keel and rim.
    t = p[tri]
    delta = t[:, :, 1] - back(t[:, :, 2])
    a = t.reshape(-1, 3)
    b = np.roll(t, 1, axis=1).reshape(-1, 3)
    da = delta.ravel()
    db = np.roll(delta, 1, axis=1).ravel()
    rings = []
    for row in range(steps):
        u = row / (steps - 1)
        elevation = 0.055 + (delta.max() - 0.055) * (0.10 + 0.89 * u)
        use = ((da <= elevation) & (db > elevation)) | ((db <= elevation) & (da > elevation))
        hits = a[use] + (b[use] - a[use]) * ((elevation - da[use]) / (db[use] - da[use]))[:, None]
        lines = hits.reshape(-1, 2, 3)
        lo = hits[:, 2].min()
        hi = hits[:, 2].max()
        points = []
        for angle in np.arange(sides) * 2 * np.pi / sides:
            z = (hi + lo) / 2 + (hi - lo) * 0.4999 * np.sin(angle)
            left, right = lines[:, 0], lines[:, 1]
            use = (
                (np.minimum(left[:, 2], right[:, 2]) <= z)
                & (np.maximum(left[:, 2], right[:, 2]) >= z)
                & (abs(left[:, 2] - right[:, 2]) > 1e-12)
            )
            x = left[use, 0] + (right[use, 0] - left[use, 0]) * (z - left[use, 2]) / (
                right[use, 2] - left[use, 2]
            )
            if not len(x):
                # A chipped margin can leave a narrow gap in a horizontal
                # section. Interpolate the neighbouring cut edges across it.
                order = np.argsort(hits[:, 2])
                x = np.array([np.interp(z, hits[order, 2], hits[order, 0])])
            points.append([x.max() if np.cos(angle) >= 0 else x.min(), back(z) + elevation, z])
        rings.append(points)
    return np.array(rings)


def fit(d, s):
    pos = d["pos"]
    n = d["normals"]
    z = pos[:, 2]
    h = pos[:, 1]
    verts = register(s.p)
    x0, h0, z0 = s.p.T
    # Blades have their own sampling surfaces. Restrict the torso fit to hide
    # so a ray across the shoulders cannot catch the side of a blade.
    body_face = ((h0 <= back(z0) + 0.045) | (z0 > 3.76) | (z0 < -3.4))[s.tri].all(1)
    surface = Surface(verts, s.tri, np.flatnonzero(body_face))
    face, bary, hit = surface.sample(pos, n)
    ref = (s.p[s.tri[face]] * bary[:, :, None]).sum(1)
    move = dot(hit - pos, n)
    # Limit movement near plate insertions and the physical saddle tree.
    # The plantar surfaces and the working eyelid, jaw and nares remain exact.
    wrap = smooth(0.16, 0.72, h) * (1 - smooth(1.92, 2.42, z)) * smooth(-5.35, -4.45, z)
    root = smooth(0.38, 0.89, n[:, 1]) * smooth(1.72, 2.24, h)
    pad = smooth(0.44, 0.84, z) * (1 - smooth(1.50, 1.83, z)) * smooth(1.80, 2.25, h)
    limit = 0.29 - 0.24 * np.maximum(root, pad)
    move = np.clip(move, -limit, limit) * wrap
    edges = np.sort(
        np.concatenate((d["tri"][:, [0, 1]], d["tri"][:, [1, 2]], d["tri"][:, [2, 0]])), axis=1
    )
    ea, eb = np.unique(edges, axis=0).T
    a = np.r_[ea, eb]
    b = np.r_[eb, ea]
    count = np.maximum(1, np.bincount(a, minlength=len(pos)))
    for _ in range(3):
        move = 0.55 * move + 0.45 * np.bincount(a, weights=move[b], minlength=len(pos)) / count
    displacement = move[:, None] * n
    # An abrupt normal change at a crease can pull two neighbouring vertices
    # apart even when their scalar offsets agree. Bound that extra stretch
    # in metres relative to the actual edge length at the armpit and hip.
    limit = 0.55 * np.linalg.norm(pos[ea] - pos[eb], axis=1)
    for _ in range(10):
        delta = displacement[eb] - displacement[ea]
        length = np.linalg.norm(delta, axis=1)
        excess = 0.5 * np.maximum(0, 1 - limit / np.maximum(length, 1e-12))
        correction = delta * excess[:, None]
        degree = np.maximum(1, np.bincount(a, weights=np.tile(excess > 0, 2), minlength=len(pos)))
        for k in range(3):
            displacement[:, k] += (
                np.bincount(a, weights=np.r_[correction[:, k], -correction[:, k]], minlength=len(pos))
                / degree
            )
    fitted = pos + displacement
    strength = 1 - 0.27 * smooth(2.02, 2.65, z)
    strength *= 0.68 + 0.32 * smooth(0.03, 0.23, h)
    # Keep the articulated eye, oral cavity, beak and their surrounding lids.
    native_horn = np.unique(d["tri"][d["mat"] == "stego_horn"])
    strength[native_horn] = 0
    fitted[native_horn] = pos[native_horn]
    source_blades = blades(s)
    # Measured centres in the sculpture, from the neck pair back to the tip.
    stations = [
        3.09,
        3.02,
        2.55,
        2.62,
        1.82,
        1.73,
        0.77,
        0.44,
        -0.79,
        -0.77,
        -1.51,
        -1.56,
        -1.96,
        -2.29,
        -2.63,
        -2.86,
    ]
    for index, station in enumerate(stations):
        ids = np.unique(d["tri"][d["plate"] == index + 1])
        joint = d["joints"][index]
        height, width, lean = d["blade_dims"][index]
        sides = 16 if height > 0.7 else 12
        steps = (len(ids) - 2) // sides
        if len(ids) != steps * sides + 2 or np.any(np.diff(ids) != 1):
            raise ValueError(f"Unexpected source rings on plate {index}")
        sign = np.sign(joint[0])
        choices = [(c, t) for c, t in source_blades if abs(c[2] - station) < 0.40]
        centre, tri = min(
            choices,
            key=lambda item: abs(item[0][2] - station)
            + (0.21 if np.sign(item[0][0] + 0.055) != sign else 0),
        )
        rings = blade_rings(s.p, tri, steps, sides)
        # Reflect a single-row terminal blade across the animal when needed.
        # Reversing the ring indices keeps both winding and tangent direction.
        mirror = 1 if np.sign(centre[0] + 0.055) == sign else -1
        if mirror < 0:
            rings = rings[:, (sides // 2 - np.arange(sides)) % sides]
        low = rings[0].mean(0)
        span = np.ptp(rings[:, :, 2])
        rise = rings[:, :, 1] - back(rings[:, :, 2])
        rise -= rise.min()
        u = np.arange(steps)[:, None] / (steps - 1)
        orig = pos[ids[:-2]].reshape(steps, sides, 3)
        root_center = orig[0].mean(0)
        target = orig.copy()
        # Retain the donor's broad crown, sloped margins and uneven thickness.
        # Fit the base to the existing insertion and the blade to its joint.
        scale = width * 1.14 / span
        target[:, :, 2] = joint[2] + (rings[:, :, 2] - low[2]) * scale
        target[:, :, 1] = root_center[1] + rise / rise.max() * (orig[-1, :, 1].mean() - root_center[1])
        centre_x = mirror * (rings[:, :, 0] - low[0]) * scale
        target[:, :, 0] = (
            root_center[0]
            + centre_x
            + u * (orig[-1, :, 0].mean() - root_center[0] - centre_x[-1].mean())
        )
        target = mix(orig, target, smooth(0, 0.32, u))
        fitted[ids[:-2]] = target.reshape(-1, 3)
        ref[ids[:-2]] = rings.reshape(-1, 3)
        for offset, row in [(-2, 0), (-1, -1)]:
            fitted[ids[offset]] = target[row].mean(0)
            ref[ids[offset]] = rings[row].mean(0)
        strength[ids] = 1
    for name in np.unique(d["spikes"]):
        if not name:
            continue
        ids = np.flatnonzero(d["spikes"] == name)
        sign = 1 if name.endswith("_l") else -1
        xyz = pos[ids]
        start = xyz[np.argmin(abs(xyz[:, 0]))]
        end = xyz[np.argmax(abs(xyz[:, 0]))]
        axis = unit(end - start)
        along = (xyz - start) @ axis
        t = np.clip(along / np.linalg.norm(end - start), 0, 1)
        rear = "rear" in name
        a = np.array([sign * 0.10, 1.29, -3.44])
        b = np.array(
            [sign * (0.55 if rear else 0.93), 1.74 if rear else 1.00, -4.48 if rear else -3.53]
        )
        # Transport each cross-section onto its matching source spike.
        forward = unit(b - a)
        lateral = unit(np.cross(axis, [0, 1, 0]))
        normal = np.cross(lateral, axis)
        side2 = unit(np.cross(forward, [0, 1, 0]))
        up2 = np.cross(side2, forward)
        offset = xyz - start - along[:, None] * axis
        ref[ids] = (
            a
            + t[:, None] * (b - a)
            + (offset @ lateral)[:, None] * side2
            + (offset @ normal)[:, None] * up2
        )
        fitted[ids] = xyz
        strength[ids] = 1
    return fitted, ref, strength


if __name__ == "__main__":
    from bake import bake

    sculpture = Sculpt(sys.argv[1])
    layout = dict(np.load(sys.argv[2]))
    fitted, reference, strength = fit(layout, sculpture)
    np.save(sys.argv[3], fitted)
    bake(layout, sculpture, reference, strength, folder)
