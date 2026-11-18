"""Read rigid islands from the indexed, translated Grab3D glTF meshes in game coordinates."""

import json
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from manifold3d import Manifold, Mesh64


def read_parts(path):
    raw = path.read_bytes()
    end = 20 + int.from_bytes(raw[12:16], "little")
    doc = json.loads(raw[20:end])

    def access(i):
        a = doc["accessors"][i]
        b = doc["bufferViews"][a["bufferView"]]
        dim = {"VEC3": 3, "SCALAR": 1}[a["type"]]
        dt = np.dtype({5126: "<f4", 5123: "<u2", 5125: "<u4"}[a["componentType"]])
        return np.ndarray(
            (a["count"], dim),
            dt,
            raw,
            end + 8 + b.get("byteOffset", 0) + a.get("byteOffset", 0),
            strides=(b.get("byteStride", dim * dt.itemsize), dt.itemsize),
        )

    parts = {}
    pivots = {}
    for node in doc["nodes"]:
        if "mesh" not in node:
            continue
        name = node["name"].removeprefix(path.stem + "_")
        pivots[name] = node.get("translation", [0, 0, 0])
        islands = []
        for mat, p in enumerate(doc["meshes"][node["mesh"]]["primitives"]):
            v = access(p["attributes"]["POSITION"]) + np.array(pivots[name])
            xyz, inv = np.unique(v.round(5), axis=0, return_inverse=True)
            t = inv[access(p["indices"]).reshape(-1, 3)]
            edges = coo_matrix(
                (np.ones(t.size), (t.flatten(), t[:, [1, 2, 0]].flatten())), shape=(len(xyz),) * 2
            )
            count, lab = connected_components(edges, directed=False)
            for i in range(count):
                f = t[lab[t[:, 0]] == i]
                used, local = np.unique(f, return_inverse=True)
                points = xyz[used]
                m = Manifold(Mesh64(points, local.reshape(-1, 3).astype("uint64")))
                if m.is_empty():
                    m = Manifold.hull_points(points)
                elif m.volume() < 0:
                    m = Manifold(Mesh64(points, local.reshape(-1, 3)[:, ::-1].copy().astype("uint64")))
                islands.append((mat, m))
        parts[name] = islands
    return parts, pivots
