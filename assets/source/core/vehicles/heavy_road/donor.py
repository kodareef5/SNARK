"""Measure the connected mechanical parts of the two Grab3D road vehicles."""

import json
import numpy as np
from scipy.spatial import ConvexHull, QhullError
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components


def body_parts(path, shift, suffix="_body"):
    raw = path.read_bytes()
    end = 20 + int.from_bytes(raw[12:16], "little")
    doc = json.loads(raw[20:end])
    binary = raw[end + 8 :]

    def access(i):
        a = doc["accessors"][i]
        view = doc["bufferViews"][a["bufferView"]]
        dim = {"VEC3": 3, "SCALAR": 1}[a["type"]]
        dt = np.dtype({5126: "<f4", 5123: "<u2", 5125: "<u4"}[a["componentType"]])
        return np.ndarray(
            (a["count"], dim),
            dt,
            binary,
            view.get("byteOffset", 0) + a.get("byteOffset", 0),
            strides=(view.get("byteStride", dim * dt.itemsize), dt.itemsize),
        )

    node = next(n for n in doc["nodes"] if n["name"].endswith(suffix))
    p = doc["meshes"][node["mesh"]]["primitives"][0]
    v = access(p["attributes"]["POSITION"]) + np.array(node["translation"])
    xyz, inv = np.unique(v.round(5), axis=0, return_inverse=True)
    tri = inv[access(p["indices"]).reshape(-1, 3)]
    edges = coo_matrix(
        (np.ones(tri.size), (tri.flatten(), tri[:, [1, 2, 0]].flatten())), shape=(len(xyz),) * 2
    )
    count, lab = connected_components(edges, directed=False)
    xyz[:, 2] -= shift
    return [xyz[lab == i] for i in range(count)]


def hull(v, samples):
    if samples and len(v) > samples:
        # Reduce in normalized part space so thin mirrors and running boards retain their footprint.
        u = (v - v.mean(0)) / np.maximum(np.ptp(v, axis=0), 0.0001)
        i = np.arange(samples)
        y = 1 - 2 * (i + 0.5) / samples
        r = np.sqrt(1 - y * y)
        dirs = np.column_stack((r * np.cos(i * 2.39996), y, r * np.sin(i * 2.39996)))
        dirs = np.vstack((dirs, np.eye(3), -np.eye(3)))
        v = v[np.unique(np.argmax(np.einsum("ij,kj->ik", u, dirs), axis=0))]
    try:
        h = ConvexHull(v)
    except QhullError:
        return None
    f = h.simplices.copy()
    a, b, c = v[f].transpose(1, 0, 2)
    flip = np.sum(np.cross(b - a, c - a) * h.equations[:, :3], axis=1) < 0
    f[flip] = f[flip, ::-1]
    indices, local = np.unique(f, return_inverse=True)
    return v[indices], local.reshape(-1, 3)
