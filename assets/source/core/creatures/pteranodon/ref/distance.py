"""Author the two far silhouettes from the packed hero and its posed flight rig."""

from pathlib import Path
import json
import subprocess

import numpy as np

here = Path(__file__).resolve().parent
skin = json.loads(subprocess.check_output(["bun", str(here / "sample-skin.ts")]))
points = np.asarray(skin["points"]).reshape(-1, 3)
tri = np.asarray(skin["triangles"]).reshape(-1, 3)
names = skin["names"]
joints = np.asarray(skin["joints"]).reshape(-1, 4)
weights = np.asarray(skin["weights"]).reshape(-1, 4)
matrices = np.asarray(skin["poses"]).reshape(-1, len(names), 3, 4)
labels = np.array(names)[joints[np.arange(len(joints)), weights.argmax(1)]]
is_wing = np.array(
    [s.startswith(("upper_arm", "forearm", "hand", "wing", "web", "pteroid", "pelvis", "shin")) for s in labels]
)
wing_faces = tri[is_wing[tri].any(1)]
levels = []


def binding(point, ids):
    # Flat levels permit one bone per vertex. Pick the joint with the least
    # motion error against the neighbouring skinned skin across fourteen poses.
    d = np.linalg.norm(points[ids] - point, axis=1)
    near = np.argsort(d)[:8]
    ids, d = ids[near], d[near]
    influence = 1 / np.maximum(0.0001, d) ** 2
    blend = np.bincount(joints[ids].ravel(), (weights[ids] * influence[:, None]).ravel(), minlength=len(names))
    blend /= blend.sum()
    motion = (matrices * np.r_[point, 1]).sum(3)
    ref = (motion * blend[None, :, None]).sum(1)
    err = ((motion - ref[:, None, :]) ** 2).sum(2).mean(0)
    return names[np.where(blend > 0.012, err, np.inf).argmin()]


for far in [False, True]:
    vertices, faces = [], []

    def vertex(p, bone):
        vertices.append([*(round(float(k), 5) for k in p), bone])
        return len(vertices) - 1

    def tube(rows, colours):
        """Closed rings; end rows can be single tips."""
        part = []

        def quad(a, b, c, d, col):
            part.extend(([a, b, d, col], [b, c, d, col]))

        for ri, (a, b) in enumerate(zip(rows, rows[1:])):
            n = max(len(a), len(b))
            for i in range(n):
                j = (i + 1) % n
                col = colours(ri, i)
                if len(a) == 1:
                    part.append([a[0], b[j], b[i], col])
                elif len(b) == 1:
                    part.append([a[i], a[j], b[0], col])
                else:
                    quad(a[i], a[j], b[j], b[i], col)
        for i in range(1, len(rows[0]) - 1):
            part.append([rows[0][0], rows[0][i + 1], rows[0][i], 0])
        for i in range(1, len(rows[-1]) - 1):
            part.append([rows[-1][0], rows[-1][i], rows[-1][i + 1], 1])
        vv = np.asarray([v[:3] for v in vertices])
        ff = np.asarray(part)[:, :3]
        a, b, c = vv[ff].transpose(1, 0, 2)
        if (a * np.cross(b, c)).sum() < 0:
            for f in part:
                f[1], f[2] = f[2], f[1]
        faces.extend(part)

    def axial(stations, sides, pigment):
        rings = []
        for z, y, w, h, b in stations:
            if not w:
                rings.append([vertex([0, y, z], b)])
                continue
            rings.append(
                [
                    vertex([w * np.cos(k * 2 * np.pi / sides), y + h * np.sin(k * 2 * np.pi / sides), z], b)
                    for k in range(sides)
                ]
            )
        tube(rings, pigment)

    axial(
        [
            (-0.83, 0.70, 0, 0, "pelvis"),
            (-0.46, 0.735, 0.165, 0.12, "pelvis"),
            (-0.09, 0.756, 0.215, 0.183, "chest"),
            (0.15, 0.84, 0.132, 0.145, "neck_1"),
            (0.31, 1.032, 0.067, 0.087, "neck_2"),
            (0.47, 1.215, 0.070, 0.088, "neck_4"),
            (0.61, 1.315, 0.125, 0.148, "skull"),
            (0.79, 1.335, 0.105, 0.101, "skull"),
            (1.50, 1.30, 0, 0, "skull"),
        ],
        4 if far else 6,
        lambda i, k: (5 if i < 3 and k < (2 if far else 3) else 2) if i < 7 else 3,
    )
    axial(
        [(0.14, 1.71, 0, 0, "skull"), (0.43, 1.49, 0.055, 0.085, "skull"), (0.65, 1.385, 0.093, 0.08, "skull")],
        3 if far else 4,
        lambda i, k: 4 if i else 3,
    )
    if not far:
        axial(
            [(0.58, 1.24, 0, 0, "jaw"), (0.74, 1.244, 0.089, 0.064, "jaw"), (1.44, 1.275, 0, 0, "jaw")],
            4,
            lambda i, k: 3,
        )
    for sign, suffix in [(1, "_l"), (-1, "_r")]:
        rings = []
        stations = [0.19, 0.454, 0.966, 1.524, 2.204, 2.764, 3.20] if not far else [0.19, 0.67, 1.524, 2.52]
        side = wing_faces[(sign * points[wing_faces, 0]).max(1) > 0.15]
        for xx in stations:
            xxpts = sign * points[side, 0]
            crosses = side[(xxpts.min(1) <= xx) & (xxpts.max(1) >= xx)]
            vs = np.unique(crosses)
            cuts = []
            for f in crosses:
                for a, b in zip(f, np.roll(f, 1)):
                    xa, xb = sign * points[[a, b], 0]
                    if (xa - xx) * (xb - xx) < 0:
                        cuts.append(points[a] + (points[b] - points[a]) * (xx - xa) / (xb - xa))
            cut = np.array(cuts)
            lead = cut[cut[:, 2].argmax()]
            back = cut[cut[:, 2].argmin()]
            midz = (lead[2] + back[2]) * 0.5
            near = cut[np.argsort(abs(cut[:, 2] - midz))[:8]]
            mid = [sign * xx, max(near[:, 1].max(), (lead[1] + back[1]) * 0.5 + 0.012), midz]
            low = [sign * xx, min(near[:, 1].min(), mid[1] - 0.011), midz]
            pts = [lead, mid, back] if far else [lead, mid, back, low]
            rings.append([vertex(v, binding(v, vs)) for v in pts])
        tip = points[(sign * points[:, 0]).argmax()]
        rings.append([vertex(tip, "wing_4" + suffix)])
        tube(
            rings,
            lambda i, k: (
                0
                if i >= len(stations) - 2
                else 5
                if (i % 3 == 1 and k == 0)
                else 7
                if i == 0 and k < 2
                else 1
                if k < 2
                else 6
            ),
        )
        if not far:
            rows = []
            for y, z, x, r, b in [
                (0.72, -0.62, 0.10, 0.057, "thigh"),
                (0.62, -0.83, 0.14, 0.052, "shin"),
                (0.47, -1.08, 0.20, 0.038, "foot"),
                (0.39, -1.29, 0.22, 0, "toes"),
            ]:
                rows.append(
                    [
                        vertex(
                            [sign * x + r * np.cos(k * 2 * np.pi / 3), y + r * np.sin(k * 2 * np.pi / 3), z],
                            b + suffix,
                        )
                        for k in range(3 if r else 1)
                    ]
                )
            tube(rows, lambda i, k: 0 if i == 2 else 2)
    levels.append({"vertices": vertices, "faces": faces})
    print(len(faces), "triangles")
(here / "distance.json").write_text(json.dumps(levels, separators=(",", ":")) + "\n")
