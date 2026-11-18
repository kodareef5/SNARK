"""Bake the fitted donor in the two native UV sets, including tangent relief."""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, map_coordinates
from wrap import Surface, dot, mix, unit


def raster(uv, size):
    ids = np.full((size, size), -1, np.int32)
    weights = np.zeros((size, size, 2), np.float32)
    for i, q in enumerate(uv * size - 0.5):
        lo = np.maximum(0, np.ceil(q.min(0)).astype(int))
        hi = np.minimum(size, np.floor(q.max(0)).astype(int) + 1)
        if np.any(lo >= hi):
            continue
        a, b, c = q
        ab = b - a
        ac = c - a
        den = ab[0] * ac[1] - ab[1] * ac[0]
        if abs(den) < 1e-8:
            continue
        yy, xx = np.mgrid[lo[1] : hi[1], lo[0] : hi[0]]
        x = xx - a[0]
        y = yy - a[1]
        v = (x * ac[1] - y * ac[0]) / den
        w = (y * ab[0] - x * ab[1]) / den
        use = (v >= 0) & (w >= 0) & (v + w <= 1)
        rows, cols = yy[use], xx[use]
        ids[rows, cols] = i
        weights[rows, cols] = np.stack((v[use], w[use]), axis=1)
    return ids, weights


def basis(xyz, uv, n):
    a, b, c = np.moveaxis(xyz, 1, 0)
    ab = b - a
    ac = c - a
    v, w = uv[:, 1] - uv[:, 0], uv[:, 2] - uv[:, 0]
    # Both images have their origin at the upper left. Native tangents use
    # the upward V axis; undo the image convention in both tangent frames.
    det = v[:, 1] * w[:, 0] - v[:, 0] * w[:, 1]
    tangent = unit((ac * v[:, 1, None] - ab * w[:, 1, None]) * np.sign(det)[:, None])
    tangent = unit(tangent - n * dot(n, tangent)[:, None])
    sign = np.sign(det * dot(np.cross(ab, ac), n))
    return tangent, np.cross(n, tangent) * sign[:, None]


def sample(image, uv):
    h, w = image.shape[:2]
    coords = np.stack((uv[:, 1] * h - 0.5, uv[:, 0] * w - 0.5))
    return (
        np.stack(
            [map_coordinates(image[:, :, k], coords, order=1, mode="grid-wrap") for k in range(3)],
            axis=1,
        )
        / 255
    )


def linear(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def srgb(x):
    x = np.maximum(0, x)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055)


def bake(d, s, reference, strength, folder):
    out = folder / "tex/sculpt"
    out.mkdir(exist_ok=True)
    surface = Surface(s.p, s.tri, np.arange(len(s.tri)))
    dyes = (
        linear(
            np.array(
                [
                    [35, 59, 45],
                    [67, 91, 57],
                    [156, 150, 105],
                    [134, 82, 46],
                    [73, 48, 36],
                    [153, 138, 92],
                ]
            )
            / 255
        )
        / 0.5
    )
    for material in ["stego_skin", "stego_horn"]:
        source = {}
        target = {}
        sizes = {}
        for k in ["base", "normal", "packed", "mask", "mask2"]:
            img = Image.open(folder / "tex" / (material + "_" + k + ".png")).convert("RGB")
            sizes[k] = img.size
            source[k] = np.array(img.resize((2048, 2048), Image.Resampling.BILINEAR))
            target[k] = source[k].copy()
        faces = np.flatnonzero(d["mat"] == material)
        ids, weights = raster(d["uv"][faces], 2048)
        used = ids >= 0
        yy, xx = np.where(used)
        for start in range(0, len(yy), 32768):
            rows, cols = yy[start : start + 32768], xx[start : start + 32768]
            tri_id = faces[ids[rows, cols]]
            tri = d["tri"][tri_id]
            bc = weights[rows, cols]
            bary = np.column_stack((1 - bc.sum(1), bc))
            blend = (strength[tri] * bary).sum(1).clip(0, 1)
            active = blend > 0.001
            if not np.any(active):
                continue
            rows, cols, tri_id, tri, bary, blend = (
                a[active] for a in (rows, cols, tri_id, tri, bary, blend)
            )
            r = reference[tri]
            query = (r * bary[:, :, None]).sum(1)
            si, sw, _ = surface.sample(query)
            st = s.tri[si]
            suv = (s.uv[st] * sw[:, :, None]).sum(1)
            n = unit((s.n[st] * sw[:, :, None]).sum(1))
            ts, bs = basis(s.p[st], s.uv[st], n)
            tn = unit(sample(s.bump, suv) * 2 - 1)
            bumped = ts * tn[:, 0, None] + bs * tn[:, 1, None] + n * tn[:, 2, None]
            tt, bt = basis(r, d["uv"][tri_id], n)
            relief = unit(
                np.column_stack((dot(bumped, tt), dot(bumped, bt), np.maximum(0.12, dot(bumped, n))))
            )
            # Keep the native insertion creases at the blade bed and fitted joints.
            native_normal = source["normal"][rows, cols] / 127.5 - 1
            final_n = unit(mix(native_normal, relief, blend * 0.92))
            mro = source["packed"][rows, cols] / 255
            donor_rough = sample(s.mro, suv)[:, 1]
            mro[:, 1] += blend * (donor_rough - mro[:, 1])
            mro[:, 2] *= 1 - blend
            old = np.column_stack((source["mask"][rows, cols], source["mask2"][rows, cols])) / 255
            new = old * (1 - 0.55 * blend[:, None])
            before = 1 - old.sum(1, keepdims=True) + np.einsum("ij,jk->ik", old, dyes)
            after = 1 - new.sum(1, keepdims=True) + np.einsum("ij,jk->ik", new, dyes)
            colour = mix(
                linear(source["base"][rows, cols] / 255) * before, linear(sample(s.base, suv)), blend
            )
            values = {
                "base": srgb(colour / np.maximum(0.012, after)),
                "normal": (final_n + 1) / 2,
                "packed": mro,
                "mask": new[:, :3],
                "mask2": new[:, 3:],
            }
            for k, arr in values.items():
                target[k][rows, cols] = np.rint(arr.clip(0, 1) * 255)
        pad = distance_transform_edt(~used, return_distances=False, return_indices=True)
        for k, arr in target.items():
            Image.fromarray(arr[tuple(pad)]).resize(sizes[k], Image.Resampling.BOX).save(
                out / (material + "_" + k + ".png")
            )
        print(material, len(yy), "covered pixels", flush=True)
