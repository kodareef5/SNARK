"""Original Rex sculpt, palate, paired dental arcades, orbit and foot anatomy."""

import json, math
from pathlib import Path
import bmesh, bpy, numpy as np
from parts import Part, activate, join, smooth_rows
from plan import BODY, BONES, EYE, JAW, SKULL, mirror, to_animal
import rig

OUT = Path(__file__).resolve().parents[5] / "var/rex"
# Atlas rectangles for hard/soft details. Linear physical gradients are painted
# separately in each island; the rest of the head is unwrapped from its own skin.
CLAW = (0.02, 0.02, 0.25, 0.48)
TOOTH = (0.28, 0.02, 0.48, 0.47)
TONGUE = (0.52, 0.02, 0.98, 0.47)
EYES = (0.02, 0.52, 0.37, 0.98)
ORAL = (0.41, 0.52, 0.68, 0.98)
LIDS = (0.72, 0.52, 0.98, 0.98)


def rings(part, rows):
    ids = [[part.point(p) for p in row] for row in rows]
    n = len(ids[0])
    for a, b in zip(ids, ids[1:]):
        for k in range(n):
            part.face((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    part.face(list(reversed(ids[0])))
    part.face(ids[-1])
    return part.object()


def trunk():
    result = []
    for z, y, w, up, down in smooth_rows(BODY, 3):
        row = []
        for k in range(40):
            a = math.tau * k / 40
            c = math.cos(a)
            s = math.sin(a)
            row.append((w * c * (1 - 0.105 * max(0, s)), y + (up if s > 0 else down) * s, z))
        result.append(row)
    return rings(Part("axial_skin"), result)


def shell(stations, upper):
    contour = (
        [
            (0, 1),
            (0.43, 0.99),
            (0.72, 0.93),
            (0.91, 0.80),
            (0.99, 0.59),
            (1, 0.41),
            (0.98, 0.23),
            (0.95, 0.105),
            (0.89, 0),
            (0.75, 0.025),
            (0.56, 0.115),
            (0.30, 0.154),
            (0, 0.161),
        ]
        if upper
        else [
            (0, 0),
            (0.36, 0.035),
            (0.67, 0.13),
            (0.88, 0.27),
            (0.97, 0.49),
            (1, 0.73),
            (0.96, 0.94),
            (0.88, 1),
            (0.69, 0.925),
            (0.46, 0.848),
            (0.19, 0.814),
            (0, 0.815),
        ]
    )
    contour += [(-x, y) for x, y in reversed(contour[1:-1])]
    rows = []
    for z, w, a, b in smooth_rows(stations, 3):
        low, high = (a, b) if upper else (b, a)
        rows.append([(max(0.009, w) * x, low + (high - low) * y, z) for x, y in contour])
    return rings(Part("maxilla" if upper else "dentary", "rex_head", None if upper else "jaw"), rows)


def loft(name, path, sign=1, power=1, sides=18):
    return (
        Part(name)
        .loft([(*mirror(row[:3], sign), *row[3:]) for row in path], sides, subdivisions=3, section_power=power)
        .object()
    )


def hide():
    pieces = [trunk(), shell(SKULL, True)]
    for side, sign in [("l", 1), ("r", -1)]:
        forms = {
            "iliac_thigh": [
                (0.34, 3.54, -0.82, 0.11, 0.15),
                (0.57, 3.38, -0.76, 0.36, 0.56),
                (0.76, 3.03, -0.63, 0.406, 0.61),
                (0.79, 2.70, -0.41, 0.363, 0.51),
                (0.75, 2.29, -0.11, 0.285, 0.345),
                (0.72, 1.99, 0.025, 0.249, 0.275),
                (0.70, 1.86, -0.04, 0.222, 0.249),
            ],
            "hind_calf": [
                (0.70, 2.10, 0.005, 0.17, 0.20),
                (0.72, 1.90, -0.09, 0.248, 0.26),
                (0.72, 1.70, -0.31, 0.207, 0.30),
                (0.69, 1.47, -0.58, 0.194, 0.25),
                (0.655, 1.20, -0.78, 0.139, 0.187),
                (0.64, 0.99, -0.89, 0.117, 0.132),
                (0.64, 0.887, -0.854, 0.119, 0.128),
            ],
            "metatarsal": [
                (0.64, 1.05, -0.845, 0.100, 0.112),
                (0.64, 0.933, -0.875, 0.135, 0.125),
                (0.645, 0.737, -0.796, 0.098, 0.116),
                (0.65, 0.481, -0.67, 0.091, 0.101),
                (0.65, 0.295, -0.556, 0.109, 0.116),
                (0.64, 0.164, -0.44, 0.184, 0.161),
                (0.64, 0.119, -0.35, 0.195, 0.176),
            ],
            "iliotibial": [
                (0.50, 3.53, -1.11, 0.095, 0.13),
                (0.74, 3.29, -1.03, 0.223, 0.34),
                (0.873, 2.93, -0.86, 0.217, 0.32),
                (0.894, 2.55, -0.55, 0.146, 0.22),
                (0.81, 2.19, -0.18, 0.078, 0.116),
            ],
            "scapula": [
                (0.47, 3.55, 0.71, 0.095, 0.15),
                (0.63, 3.34, 0.94, 0.162, 0.29),
                (0.68, 3.15, 1.19, 0.139, 0.25),
                (0.59, 2.97, 1.54, 0.148, 0.19),
                (0.51, 2.89, 1.64, 0.122, 0.133),
            ],
            "arm": [
                (0.48, 3.01, 1.61, 0.103, 0.12),
                (0.555, 2.89, 1.61, 0.138, 0.142),
                (0.62, 2.68, 1.46, 0.105, 0.108),
                (0.646, 2.55, 1.425, 0.086, 0.095),
                (0.665, 2.53, 1.59, 0.075, 0.075),
                (0.692, 2.535, 1.76, 0.054, 0.058),
                (0.704, 2.52, 1.868, 0.057, 0.063),
                (0.71, 2.48, 1.94, 0.064, 0.055),
            ],
            "orbital_shelf": [
                (0.36, 4.045, 3.16, 0.09, 0.12),
                (0.474, 4.116, 3.32, 0.114, 0.111),
                (0.530, 4.132, 3.48, 0.101, 0.126),
                (0.489, 4.101, 3.67, 0.087, 0.101),
                (0.414, 4.046, 3.894, 0.062, 0.081),
            ],
            "jugal_bar": [
                (0.44, 3.506, 3.14, 0.080, 0.115),
                (0.505, 3.62, 3.30, 0.091, 0.13),
                (0.547, 3.74, 3.47, 0.072, 0.09),
                (0.521, 3.79, 3.60, 0.057, 0.081),
                (0.451, 3.775, 3.80, 0.050, 0.083),
            ],
            "nasal_boss": [
                (0.291, 4.099, 3.50, 0.084, 0.10),
                (0.309, 4.146, 3.68, 0.100, 0.108),
                (0.274, 4.126, 3.93, 0.084, 0.10),
                (0.218, 4.08, 4.20, 0.061, 0.078),
                (0.138, 3.997, 4.46, 0.046, 0.057),
            ],
        }
        for name, path in forms.items():
            pieces.append(loft(name + side, path, sign, 0.85 if name == "jugal_bar" else 1))
        for digit, x, z in ((2, 0.393, 0.075), (3, 0.64, 0.30), (4, 0.875, 0.046)):
            dx = x - 0.64
            path = [
                (0.64 + 0.22 * dx, 0.123, -0.432, 0.093, 0.090),
                (0.64 + 0.5 * dx, 0.119, -0.266, 0.096, 0.093),
                (0.64 + 0.78 * dx, 0.095, -0.11 + (z - 0.12) * 0.34, 0.084, 0.078),
                (x, 0.081, z - 0.116, 0.080, 0.063),
                (x + 0.12 * dx, 0.079, z, 0.050, 0.051),
            ]
            pieces.append(loft(f"digit{digit}_{side}", path, sign, sides=14))
        for digit, dx in ((1, -0.047), (2, 0.042)):
            pieces.append(
                loft(
                    f"manus{digit}_{side}",
                    [
                        (0.71 + dx * 0.45, 2.49, 1.899, 0.034, 0.039),
                        (0.71 + dx, 2.464, 1.98, 0.032, 0.034),
                        (0.715 + dx * 1.4, 2.422, 2.075 + dx, 0.024, 0.027),
                    ],
                    sign,
                    sides=12,
                )
            )
    # Coalescing low bosses in the supraorbital and nasal skin. Each sinks
    # through the cranial surface, keeping an irregular blunt keratin margin.
    for side, sg in [("l", 1), ("r", -1)]:
        for i, (x, y, z, rx, ry, rz) in enumerate(
            [
                (0.416, 4.208, 3.26, 0.099, 0.073, 0.145),
                (0.465, 4.206, 3.43, 0.088, 0.085, 0.120),
                (0.457, 4.178, 3.56, 0.096, 0.062, 0.118),
                (0.408, 4.144, 3.7, 0.090, 0.054, 0.121),
                (0.310, 4.113, 3.91, 0.095, 0.049, 0.147),
                (0.273, 4.086, 4.06, 0.095, 0.047, 0.136),
                (0.240, 4.060, 4.23, 0.081, 0.045, 0.127),
                (0.201, 4.029, 4.37, 0.080, 0.040, 0.113),
            ]
        ):
            pieces.append(
                Part("rugose_" + side + str(i)).ellipsoid((sg * x, y, z), (rx, ry, rz), (0, 0, 1, 1), 16, 8).object()
            )
    obj = join(pieces, "rex_continuous_hide")
    activate(obj)
    obj.data.remesh_voxel_size = 0.031
    obj.data.use_remesh_preserve_volume = True
    bpy.ops.object.voxel_remesh()
    m = obj.modifiers.new("blend_anatomical_volumes", "SMOOTH")
    m.factor = 0.48
    m.iterations = 3
    bpy.ops.object.modifier_apply(modifier=m.name)
    for side, sign in [("l", 1), ("r", -1)]:
        for name, centre, radii in [
            ("orbit", (0.554, 4.018, 3.492), (0.092, 0.072, 0.121)),
            ("naris", (0.360, 3.858, 4.49), (0.10, 0.056, 0.098)),
        ]:
            cut = Part(name).ellipsoid(mirror(centre, sign), radii, (0, 0, 1, 1), 24, 12).object()
            activate(obj)
            m = obj.modifiers.new(name + side, "BOOLEAN")
            m.operation = "DIFFERENCE"
            m.solver = "EXACT"
            m.object = cut
            bpy.ops.object.modifier_apply(modifier=m.name)
            bpy.data.objects.remove(cut, do_unlink=True)
    obj.data.calc_loop_triangles()
    m = obj.modifiers.new("muscle_topology", "DECIMATE")
    m.ratio = min(1, 16600 / len(obj.data.loop_triangles))
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=m.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0008)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=0.00004)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    mats = [bpy.data.materials.get(n) or bpy.data.materials.new(n) for n in ["rex_hide", "rex_head"]]
    obj.data.materials.clear()
    for m in mats:
        obj.data.materials.append(m)
    for v in obj.data.vertices:
        if v.co.z < 0.036:
            v.co.z = 0.036
    for p in obj.data.polygons:
        q = to_animal(p.center)
        p.material_index = int(q.z > 2.73 and q.y > 2.91)
        p.use_smooth = True
    weights(obj)
    return obj


def weights(obj):
    ps = np.array([to_animal(v.co) for v in obj.data.vertices])
    x, y, z = ps.T
    order = []
    fields = []
    widths = {
        "pelvis": 0.70,
        "chest": 0.68,
        "neck": 0.36,
        "skull": 0.41,
        "thigh": 0.38,
        "shank": 0.25,
        "metatarsus": 0.19,
        "toes": 0.15,
        "tail": 0.36,
        "humerus": 0.14,
        "forearm": 0.10,
        "manus": 0.09,
    }
    for n, parent, a, b in BONES:
        trunk = n.split("_")[0]
        if trunk not in widths:
            continue
        a, b = np.asarray(a), np.asarray(b)
        d = b - a
        t = np.clip((ps - a) @ d / (d @ d), 0, 1)
        centre = a + t[:, None] * d
        distance = np.linalg.norm(ps - centre, axis=1)
        # Axial segments share a considerable volume at their endpoints. The
        # distal limb and head use tight falloffs to keep teeth and soles rigid.
        width = widths[trunk]
        if trunk == "tail":
            width = max(0.106, 0.47 - 0.067 * int(n[-1]))
        influence = 1 / ((distance**2 + (width * 0.40) ** 2) ** 2.7)
        if n[-2:] in ("_l", "_r"):
            influence *= np.clip((x * (1 if n.endswith("_l") else -1) - 0.08) / 0.24, 0, 1) ** 2
            if trunk in ("humerus", "forearm", "manus"):
                influence *= np.clip((2.99 - y) / 0.35, 0, 1) * np.clip((z - 1.1) / 0.3, 0, 1)
        if trunk in ("pelvis", "chest", "neck", "tail", "skull"):
            influence *= np.where((y < 1.76) & (z > -1.8) & (z < 1.0), 0.0, 1.0)
        if trunk != "skull":
            influence *= 1 - np.clip((z - 2.87) / 0.43, 0, 1)
        if trunk not in ("forearm", "manus", "humerus"):
            influence *= np.where((y < 2.64) & (z > 1.34) & (z < 2.24), 0.002, 1.0)
        if trunk != "toes":
            influence *= np.where((y < 0.195) & (z > -0.48), 0.00001, 1.0)
        if trunk != "metatarsus" and trunk != "toes":
            influence *= np.where(y < 0.50, 0.00003, 1.0)
        # An actual naris and orbit are cut in the skull that owns them.
        fields.append(influence)
        order.append(n)
    values = np.array(fields).T
    best = np.argsort(values, axis=1)[:, -4:]
    groups = [obj.vertex_groups.new(name=n) for n in order]
    for i, bones in enumerate(best):
        selected = values[i, bones]
        selected = np.where(selected > selected.max() * 0.035, selected, 0)
        selected /= selected.sum()
        for k, w in zip(bones, selected):
            if w:
                groups[k].add([i], float(w), "REPLACE")


def unwrap_skin(obj):
    activate(obj)
    mesh = obj.data
    for mat in ("rex_hide", "rex_head"):
        matches = {i for i, m in enumerate(mesh.materials) if m.name == mat}
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bm = bmesh.from_edit_mesh(mesh)
        for face in bm.faces:
            face.select_set(face.material_index in matches)
        bmesh.update_edit_mesh(mesh)
        bpy.ops.uv.smart_project(
            angle_limit=math.radians(78),
            island_margin=0.0055,
            area_weight=0.24,
            correct_aspect=False,
            scale_to_bounds=True,
        )
        bpy.ops.object.mode_set(mode="OBJECT")


def detail(name, bone, rows, rect, sides=12):
    return Part(name, "rex_detail", bone).loft(rows, sides, rect, 2).object()


def soft_parts():
    out = []
    # Oral roof, tongue and gingiva remain anchored on opposite sides of the joint.
    out.append(
        detail(
            "palatal_ridges",
            "skull",
            [
                (0, 3.565, 3.16, 0.18, 0.033),
                (0, 3.56, 3.58, 0.35, 0.046),
                (0, 3.55, 4.09, 0.28, 0.044),
                (0, 3.55, 4.52, 0.211, 0.035),
                (0, 3.58, 4.83, 0.052, 0.017),
            ],
            ORAL,
            20,
        )
    )
    out.append(
        detail(
            "mobile_tongue",
            "jaw",
            [
                (0, 3.42, 3.10, 0.12, 0.050),
                (0, 3.444, 3.40, 0.305, 0.070),
                (0, 3.425, 3.75, 0.278, 0.065),
                (0, 3.414, 4.17, 0.211, 0.054),
                (0, 3.425, 4.50, 0.118, 0.040),
                (0, 3.45, 4.73, 0.027, 0.023),
            ],
            TONGUE,
            24,
        )
    )
    for side, sg in [("l", 1), ("r", -1)]:
        for upper, st in [(True, SKULL), (False, JAW)]:
            name = "upper" if upper else "lower"
            bone = "skull" if upper else "jaw"
            stations = np.array(st)
            lip_column = 2

            def gum(z):
                w = np.interp(z, stations[:, 0], stations[:, 1])
                y = np.interp(z, stations[:, 0], stations[:, lip_column])
                return ((0.64 if upper else 0.70) * w * sg, y + (0.042 if upper else -0.031), z)

            gumline = [(*gum(z), 0.048, 0.032) for z in np.linspace(3.40, 4.81, 15)]
            out.append(detail(name + "_gingiva_" + side, bone, gumline, ORAL))
            locations = np.linspace(3.44, 4.80, 13 if upper else 12) + (0.029 if not upper else 0)
            for i, z in enumerate(locations):
                xx, yy, _ = gum(z)
                h = (0.082 + 0.134 * math.sin(math.pi * (i + 0.7) / (len(locations) + 1)) ** 0.64) * (
                    0.78 if not upper else 1
                )
                h *= 0.88 + 0.12 * math.sin(i * 2.49 + (0 if upper else 0.7))
                r = 0.024 + h * 0.103
                direction = -1 if upper else 1
                out.append(
                    detail(
                        f"{name}_tooth_{side}_{i}",
                        bone,
                        [
                            (xx, yy - direction * 0.022, z, r * 0.63, r * 0.84),
                            (xx, yy, z, r, r * 1.08),
                            (xx - 0.005 * sg, yy + direction * h * 0.46, z - 0.007, r * 0.74, r * 0.86),
                            (xx - 0.011 * sg, yy + direction * h * 0.83, z - 0.030, r * 0.31, r * 0.42),
                            (xx - 0.017 * sg, yy + direction * h, z - 0.049, 0.0016, 0.0026),
                        ],
                        TOOTH,
                        9,
                    )
                )
        ex, ey, ez = mirror(EYE, sg)
        eye = (
            Part("recessed_eye_" + side, "rex_detail", "eye_" + side)
            .ellipsoid((ex, ey, ez), (0.045, 0.048, 0.070), EYES, 24, 12)
            .object()
        )
        out.append(eye)
        # A thin closed patch follows the ellipsoidal cornea at rest. Its
        # lower margin rolls past the pupil with the upper lid bone.
        cap = Part("upper_lid_surface_" + side, "rex_detail", "lid_" + side)
        sections = []
        for row in range(13):
            longitudinal = (row / 12 * 2 - 1) * 0.997
            a = math.sqrt(1 - longitudinal**2)
            ring = []
            for deep in (False, True):
                for j in range(8):
                    phi = math.radians(40 + j * 13.86)
                    thin = 0.003 if deep else 0
                    ring.append(
                        cap.point(
                            (
                                ex + sg * (0.050 - thin) * math.cos(phi) * a,
                                ey + (0.051 - thin) * math.sin(phi) * a,
                                ez + 0.070 * longitudinal,
                            )
                        )
                    )
            sections.append(ring)
        for i in range(12):
            for j in range(7):
                for layer in (0, 8):
                    cap.face(
                        (
                            sections[i][j + layer],
                            sections[i + 1][j + layer],
                            sections[i + 1][j + 1 + layer],
                            sections[i][j + 1 + layer],
                        ),
                        [
                            (0.72 + 0.24 * u / 12, 0.52 + 0.44 * v / 7)
                            for u, v in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))
                        ],
                    )
            for j in (0, 7):
                cap.face((sections[i][j], sections[i][8 + j], sections[i + 1][8 + j], sections[i + 1][j]))
        for ring in (sections[0], sections[-1]):
            for j in range(7):
                cap.face((ring[j], ring[j + 1], ring[j + 9], ring[j + 8]))
        out.append(cap.object())
        # The delicate orbital rims share the soft head paint; the mobile upper
        # lid rolls across the seated globe in the blink and torpor performances.
        for upper in (True, False):
            path = []
            for i in range(13):
                a = math.pi * i / 12
                u = math.cos(a)
                s = math.sin(a)
                path.append(
                    (
                        (0.532 + 0.023 * s) * sg,
                        ey + (0.035 if upper else -0.034) * s,
                        ez + 0.074 * u,
                        0.004 + 0.008 * s,
                        0.004 + 0.007 * s,
                    )
                )
            out.append(
                detail(
                    ("upperlid" if upper else "lowerlid") + side, "lid_" + side if upper else "skull", path, LIDS, 10
                )
            )
        for digit, x, z in ((2, 0.393, 0.075), (3, 0.64, 0.30), (4, 0.875, 0.046)):
            dx = x - 0.64
            x += dx * 0.12
            out.append(
                detail(
                    f"claw_{side}_{digit}",
                    "toes_" + side,
                    [
                        (x * sg, 0.09, z - 0.060, 0.043, 0.040),
                        (x * sg, 0.091, z, 0.055, 0.051),
                        ((x + dx * 0.11) * sg, 0.080, z + 0.105, 0.033, 0.036),
                        ((x + dx * 0.21) * sg, 0.043, z + 0.203, 0.003, 0.003),
                    ],
                    CLAW,
                    12,
                )
            )
        for i, dx in enumerate((-0.047, 0.042)):
            z = 2.055 + dx
            out.append(
                detail(
                    f"finger_claw_{side}_{i}",
                    "manus_" + side,
                    [
                        ((0.715 + dx * 1.4) * sg, 2.433, z - 0.016, 0.024, 0.024),
                        ((0.72 + dx * 1.45) * sg, 2.416, z + 0.023, 0.028, 0.028),
                        ((0.719 + dx * 1.6) * sg, 2.376, z + 0.073, 0.019, 0.020),
                        ((0.704 + dx * 1.6) * sg, 2.324, z + 0.053, 0.002, 0.002),
                    ],
                    CLAW,
                    10,
                )
            )
        out.append(
            detail(
                "hallux_" + side,
                "metatarsus_" + side,
                [
                    (0.609 * sg, 0.32, -0.575, 0.046, 0.049),
                    (0.55 * sg, 0.28, -0.63, 0.047, 0.045),
                    (0.52 * sg, 0.22, -0.70, 0.027, 0.029),
                    (0.52 * sg, 0.19, -0.751, 0.003, 0.004),
                ],
                CLAW,
                12,
            )
        )
    return out


def build():
    obj = join([hide(), shell(JAW, False)], "rex_skin")
    unwrap_skin(obj)
    obj = join([obj, *soft_parts()], "rex_model")
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    uv = mesh.uv_layers.active.data
    # Mirror boundaries must remain separate tangent charts after quantization.
    for loop in uv:
        loop.uv = [round(v * 65535) / 65535 for v in loop.uv]
    for face in mesh.polygons:
        a, b, c = [uv[li].uv for li in face.loop_indices]
        if (b.x - a.x) * (c.y - a.y) < (b.y - a.y) * (c.x - a.x):
            for li in face.loop_indices:
                uv[li].uv.x += 2 / 65535
    for v in mesh.vertices:
        v.co.z -= 0.036
    rig.bind(obj)
    OUT.mkdir(parents=True, exist_ok=True)
    points = np.asarray([to_animal(v.co) for v in mesh.vertices], np.float32)
    mesh.calc_loop_triangles()
    tris = mesh.loop_triangles
    np.savez_compressed(
        OUT / "layout.npz",
        points=points,
        triangles=np.asarray([t.vertices for t in tris], np.int32),
        uvs=np.asarray([[tuple(uv[li].uv) for li in t.loops] for t in tris], np.float32),
        materials=np.array([t.material_index for t in tris]),
    )
    (OUT / "layout.json").write_text(
        json.dumps(
            {
                "materials": [m.name for m in mesh.materials],
                "vertices": len(points),
                "triangles": len(tris),
                "bounds": [points.min(0).tolist(), points.max(0).tolist()],
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    build()
