"""Fit closed lower-detail shells per mechanical part before applying any wreck deformation."""

from pathlib import Path
import numpy as np
from scipy.spatial import ConvexHull

root = Path(__file__).resolve().parent
src = np.load(root / "parts.npz")
out = {}
for level, rays in enumerate([216, 72, 26]):
    # Preserve the six axis extremes, then distribute the remaining supports around the surface.
    j = np.arange(rays) + 0.5
    y = 1 - 2 * j / rays
    r = np.sqrt(1 - y * y)
    ang = j * (np.pi * (3 - np.sqrt(5)))
    directions = np.vstack([np.eye(3), -np.eye(3), np.stack([r * np.cos(ang), y, r * np.sin(ang)], axis=1)])
    for key in src.files:
        if not key.endswith("_v") or key.startswith("wheel_"):
            continue
        v = src[key].astype(float)
        f = src[key[:-1] + "f"]
        # Sample in normalized coordinates so long narrow valves keep their cross-section.
        norm = (v - v.mean(0)) / np.maximum(np.ptp(v, axis=0), 1e-6)
        idx = np.unique((np.einsum("ij,kj->ik", norm, directions)).argmax(axis=0))
        if np.linalg.matrix_rank(v[idx] - v[idx].mean(0)) < 3:
            continue
        hull = ConvexHull(v[idx])
        f = hull.simplices.copy()
        triangles = v[idx[f]]
        inward = (
            np.einsum(
                "ij,ij->i",
                np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]),
                hull.equations[:, :3],
            )
            < 0
        )
        f[inward] = f[inward, ::-1]
        used, idx2 = np.unique(f, return_inverse=True)
        out[str(level) + key] = v[idx[used]].astype("f4")
        out[str(level) + key[:-1] + "f"] = idx2.reshape(-1, 3).astype("u2")
np.savez_compressed(root / "shells.npz", **out)
