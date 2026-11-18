"""Apply the spatial spike finish to the four UV islands of a published pack."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from paint_fields import COLORS, linear, spike_sheath, srgb


def surface_fields(triangles, size):
    coordinates = np.zeros((size, size, 6), dtype=np.float32)
    occupied = np.zeros((size, size), dtype=bool)
    for _, triangle in triangles:
        vertices = np.asarray(triangle, dtype=np.float32)
        a, b, c = vertices[:, :2] * size
        lo = np.maximum(0, np.floor(np.minimum(np.minimum(a, b), c)).astype(int))
        hi = np.minimum(size, np.ceil(np.maximum(np.maximum(a, b), c)).astype(int))
        y, x = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]]
        ab, ac = b - a, c - a
        determinant = ab[0] * ac[1] - ab[1] * ac[0]
        if abs(determinant) < 1e-8:
            continue
        dx, dy = x + .5 - a[0], y + .5 - a[1]
        u = (dx * ac[1] - dy * ac[0]) / determinant
        v = (ab[0] * dy - ab[1] * dx) / determinant
        inside = (u >= 0) & (v >= 0) & (u + v <= 1)
        rows, cols = y[inside], x[inside]
        coordinates[rows, cols] = (vertices[0, 2:] +
            u[inside, None] * (vertices[1, 2:] - vertices[0, 2:]) +
            v[inside, None] * (vertices[2, 2:] - vertices[0, 2:]))
        occupied[rows, cols] = True
    # Bleed colours across the island boundary for bilinear sampling. All
    # spike UVs are interior to the atlas; two texels fit the export gutters.
    for _ in range(2):
        old = occupied.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            rows, cols = np.nonzero(np.roll(old, (dy, dx), (0, 1)) & ~occupied)
            coordinates[rows, cols] = coordinates[rows - dy, cols - dx]
            occupied[rows, cols] = True
    return coordinates[occupied], occupied


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("triangles", type=Path)
    parser.add_argument("textures", type=Path)
    args = parser.parse_args()
    source = args.textures / "stego_horn_base.png"
    size = Image.open(source).width
    data, occupied = surface_fields(json.loads(args.triangles.read_text()), size)
    normals = data[:, 3:]
    normals /= np.maximum(1e-8, np.linalg.norm(normals, axis=1, keepdims=True))
    base, weights, rough, occlusion = spike_sheath(data[:, :3], normals)
    preview = srgb(base * (weights @ linear(COLORS) / .5))
    channels = {"base": srgb(base), "mask": weights[:, :3], "mask2": weights[:, 3:],
                "packed": np.column_stack((occlusion, rough, np.zeros_like(rough))),
                "preview": preview}
    for role, field in channels.items():
        path = args.textures / f"stego_horn_{role}.png"
        pixels = np.array(Image.open(path))
        pixels[occupied] = np.round(np.clip(field, 0, 1) * 255).astype(np.uint8)
        Image.fromarray(pixels).save(path)
    print(f"{np.count_nonzero(occupied)} spike and gutter texels per map")


if __name__ == "__main__":
    main()
