# The egg in each of its sizes (shape.SIZES): one mesh object a size, "egg_<size>", in the one material "shell", whose
# pictures paint.py draws. Rings run from pole to pole with one on the waist where the two halves of the picture meet,
# so no face crosses from one to the other. Blender's +Z is up; the exporter turns it into the engine's +Y.

import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shape  # noqa: E402

AROUND = 32
RINGS = 22  # pole to pole, the waist at RINGS / 2

shell = bpy.data.materials.new("shell")


def egg(name, height):
    bm = bmesh.new()
    layer = bm.loops.layers.uv.new("UVMap")
    phis = [math.pi * i / RINGS for i in range(RINGS + 1)]
    thetas = [2 * math.pi * j / AROUND for j in range(AROUND)]

    def vert(theta, phi):
        x, y, z = shape.point(theta, phi, height)
        return bm.verts.new((float(x), float(-z), float(y)))

    bottom, top = vert(0.0, 0.0), vert(0.0, math.pi)
    rings = [[vert(t, p) for t in thetas] for p in phis[1:-1]]
    ring_phi = phis[1:-1]

    def face(corners):
        f = bm.faces.new([v for v, _, _ in corners])
        # A face below the waist lies on the blunt half's disc, one above it on the pointed half's.
        pointed = sum(p for _, _, p in corners) / len(corners) > math.pi / 2
        for loop, (_, t, p) in zip(f.loops, corners):
            u, v = shape.uv(t, p, pointed)
            loop[layer].uv = (float(u), float(v))
        f.smooth = True

    for j in range(AROUND):
        k = (j + 1) % AROUND
        t0, t1 = thetas[j], thetas[j] + 2 * math.pi / AROUND
        mid = (t0 + t1) / 2
        face([(bottom, mid, 0.0), (rings[0][k], t1, ring_phi[0]), (rings[0][j], t0, ring_phi[0])])
        for i in range(len(rings) - 1):
            face([(rings[i][j], t0, ring_phi[i]), (rings[i][k], t1, ring_phi[i]), (rings[i + 1][k], t1, ring_phi[i + 1]),
                  (rings[i + 1][j], t0, ring_phi[i + 1])])
        face([(top, mid, math.pi), (rings[-1][j], t0, ring_phi[-1]), (rings[-1][k], t1, ring_phi[-1])])
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(shell)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, mesh))


for size, height in shape.SIZES.items():
    egg(f"egg_{size}", height)
