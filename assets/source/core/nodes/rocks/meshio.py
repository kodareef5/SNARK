# The game meshes are kept as plain OBJ text in mesh/: positions in metres
# (Blender's axes, +Z up), texture coordinates and triangles. Only what the
# bake was made to is kept; normals are Blender's smooth ones, made again on
# reading.

import numpy as np


def write_obj(path, verts, uvs, tris, tri_uvs, groups=None):
    """`tris` index `verts`; `tri_uvs` index `uvs`, three a triangle. `groups` names runs of triangles: [(name, start, count)]."""
    with open(path, "w") as f:
        f.write("# A rock of assets/source/core/nodes/rocks, written by make.py. Metres, +Z up.\n")
        for v in verts:
            f.write(f"v {v[0]:.5f} {v[1]:.5f} {v[2]:.5f}\n")
        for t in uvs:
            f.write(f"vt {t[0]:.6f} {t[1]:.6f}\n")
        runs = groups or [("rock", 0, len(tris))]
        for name, start, count in runs:
            f.write(f"g {name}\n")
            for k in range(start, start + count):
                a, b, c = tris[k] + 1
                ta, tb, tc = tri_uvs[k] + 1
                f.write(f"f {a}/{ta} {b}/{tb} {c}/{tc}\n")


def read_obj(path):
    verts, uvs, tris, tri_uvs, groups = [], [], [], [], []
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("vt "):
                uvs.append([float(x) for x in line.split()[1:3]])
            elif line.startswith("g "):
                groups.append([line.split()[1], len(tris), 0])
            elif line.startswith("f "):
                corners = [c.split("/") for c in line.split()[1:4]]
                tris.append([int(c[0]) - 1 for c in corners])
                tri_uvs.append([int(c[1]) - 1 for c in corners])
                if groups:
                    groups[-1][2] += 1
    return (np.array(verts, np.float32), np.array(uvs, np.float32), np.array(tris, np.int64), np.array(tri_uvs, np.int64),
            [tuple(g) for g in groups])
