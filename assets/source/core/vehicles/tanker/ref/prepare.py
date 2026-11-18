"""Split the CC0 donor at its welded seams. Run with Python, numpy and scipy."""

from collections import Counter
import json
from pathlib import Path
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

folder = Path(__file__).resolve().parent
raw = (folder.parents[4] / "raw/grab3d/tanker-truck.glb").read_bytes()
end = 20 + int.from_bytes(raw[12:16], "little")
doc = json.loads(raw[20:end])
binary = raw[end + 8 :]


def accessor(index):
    a = doc["accessors"][index]
    view = doc["bufferViews"][a["bufferView"]]
    dtype = np.dtype({5123: "<u2", 5125: "<u4", 5126: "<f4"}[a["componentType"]])
    dim = {"VEC3": 3, "SCALAR": 1}[a["type"]]
    return np.ndarray(
        (a["count"], dim),
        dtype,
        binary,
        view.get("byteOffset", 0) + a.get("byteOffset", 0),
        strides=(view.get("byteStride", dim * dtype.itemsize), dtype.itemsize),
    )


def seal(vertices, faces):
    # Welded donor has open backs on the lamps, tyre hubs, collars and rail sockets.
    # Walk each oriented boundary and cap it in the reverse direction.
    v = list(vertices)
    f = faces.reshape(-1, 3).tolist()
    edges = [(face[i], face[(i + 1) % 3]) for face in f for i in range(3)]
    counts = Counter(tuple(sorted(pair)) for pair in edges)
    boundary = {a: b for a, b in edges if counts[tuple(sorted((a, b)))] == 1}
    while boundary:
        start = next(iter(boundary))
        ring = [start]
        end = boundary.pop(start)
        while end != start:
            ring.append(end)
            end = boundary.pop(end)
        center = len(v)
        v.append(vertices[ring].mean(0))
        for i, a in enumerate(ring):
            f.append([ring[(i + 1) % len(ring)], a, center])
    v = np.array(v)
    f = np.array(f)
    p = v[f] - v.mean(0)
    if np.einsum("ij,ij->i", p[:, 0], np.cross(p[:, 1], p[:, 2])).sum() < 0:
        f = f[:, ::-1]
    return v.astype("f4"), f.astype("u2")


parts = {}
for node in doc["nodes"]:
    if "mesh" not in node or node["name"].endswith("windows"):
        continue
    p = doc["meshes"][node["mesh"]]["primitives"][0]
    v = accessor(p["attributes"]["POSITION"]) + np.array(node["translation"])
    xyz, idx = np.unique(np.round(v, 5), axis=0, return_inverse=True)
    tri = idx[accessor(p["indices"]).reshape(-1, 3)]
    edges = coo_matrix(
        (np.ones(tri.size), (tri.flatten(), tri[:, [1, 2, 0]].flatten())), shape=(len(xyz),) * 2
    )
    count, label = connected_components(edges, directed=False)
    for j in range(count):
        faces = tri[label[tri[:, 0]] == j]
        used, local = np.unique(faces, return_inverse=True)
        key = node["name"].removeprefix("tanker-truck_") + "_" + str(j)
        parts[key + "_v"], parts[key + "_f"] = seal(xyz[used], local)
np.savez_compressed(folder / "parts.npz", **parts)
