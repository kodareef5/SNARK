"""Project the donor tyre onto a round game tyre and its tangent-space normal map."""

import math
from math import cos, sin, tau
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def tyre(source, base, normal, orm, size):
    points = [source.matrix_world @ v.co for v in source.data.vertices]
    tree = BVHTree.FromPolygons(points, [f.vertices[:] for f in source.data.polygons])
    centre = Vector(tuple((min(p[i] for p in points) + max(p[i] for p in points)) / 2 for i in range(3)))
    rim = 0.376
    samples = 16
    angles = np.arange(size) * tau / size
    sections = np.arange(size // 2) * tau / (size // 2)
    profile = np.zeros((len(sections), size))
    normals = np.zeros((len(sections), size, 3))
    for j, v in enumerate(sections):
        for i, u in enumerate(angles):
            radial = Vector((0, cos(u), sin(u)))
            tangent = Vector((0, -sin(u), cos(u)))
            direction = Vector((cos(v), 0, 0)) + radial * sin(v)
            origin = centre + radial * rim + direction * 0.32
            hit, n, _, _ = tree.ray_cast(origin, -direction, 0.34)
            if hit is None:
                # The inward bead disappears under the rim on the source tyre.
                profile[j, i] = 1 / math.hypot(cos(v) / 0.182, sin(v) / 0.048)
                normals[j, i] = (cos(v), sin(v), 0)
                continue
            profile[j, i] = max(0.005, (hit - centre - radial * rim).dot(direction))
            normals[j, i] = (n.x, n.dot(radial), n.dot(tangent))
    profile = np.median(profile, axis=1)
    for j in range(len(sections)):
        if profile[j] == 0:
            raise ValueError(f"Missing donor tread section {j}")
    vertical = np.gradient(profile * np.cos(sections))
    radial = np.gradient(profile * np.sin(sections))
    length = np.hypot(vertical, radial)
    axial_n, radial_n = radial / length, -vertical / length
    tx = normals[:, :, 2]
    ty = (normals[:, :, 0] * vertical[:, None] + normals[:, :, 1] * radial[:, None]) / length[:, None]
    tz = normals[:, :, 0] * axial_n[:, None] + normals[:, :, 1] * radial_n[:, None]
    # Pixels run down the PNG as the UV's second coordinate rises from the Blender atlas midpoint.
    baked = np.stack((tx, ty, np.maximum(0.12, tz)), axis=2)
    baked /= np.maximum(0.001, np.linalg.norm(baked, axis=2, keepdims=True))
    normal[: size // 2] = ((baked[::-1] * 0.5 + 0.5) * 255).astype("uint8")
    occlusion = np.maximum(0.28, np.minimum(1, tz))
    base[: size // 2] = (np.array([48, 51, 54]) * (0.55 + 0.45 * occlusion[:, :, None]))[::-1]
    orm[: size // 2, :, 0] = (210 + 45 * occlusion[::-1]).astype("uint8")
    orm[: size // 2, :, 1:] = [178, 0]
    return [
        (float(cos(v) * profile[j]), float(rim + sin(v) * profile[j]))
        for j, v in enumerate(sections)
        if j % (len(sections) // samples) == 0
    ]


def tyre_mesh(centre, profile):
    segments, rings = 48, len(profile)
    verts, faces, uvs = [], [], []
    for i in range(segments):
        theta = tau * i / segments
        for dx, r in profile:
            verts.append((centre.x + dx, centre.y + r * cos(theta), centre.z + r * sin(theta)))
    for i in range(segments):
        for j in range(rings):
            ij = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
            faces.append([(k % segments) * rings + v % rings for k, v in ij])
            uvs.append([(k / segments, 0.5 + 0.5 * v / rings) for k, v in ij])
    return verts, faces, uvs
