"""Original Rex sculpt, palate, paired dental arcades, orbit and foot anatomy."""

import json, math
from pathlib import Path
import bmesh, bpy, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from facial import cheek_folds, labials
from parts import Part, activate, join, smooth_rows
from plan import BODY, BONES, EYE, NARIS, JAW, SKULL, mirror, to_animal, to_blender
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


def bump(value, width):
    return math.exp(-((value / width) ** 2))


def trunk():
    result = []
    for z, y, w, up, down in smooth_rows(BODY, 4):
        row = []
        for k in range(64):
            angle = math.tau * k / 64
            c, s = math.cos(angle), math.sin(angle)
            h = y + (up if s > 0 else down) * s
            # Oblique rib basket, lower nuchal band, scapular blade and ilium
            # alter one surface. Their sides taper continuously into the ribs.
            lateral = abs(c) ** 1.55
            chest = 0.072 * bump(z - (1.04 - 0.70 * (h - 3.05)), 0.29) * bump(h - 3.16, 0.56)
            chest -= 0.045 * bump(z - (0.48 - 0.58 * (h - 3.0)), 0.25) * bump(h - 3.02, 0.59)
            nuchal = 0.085 * bump(h - (3.46 + 0.31 * (z - 2.0)), 0.155) * bump(z - 2.12, 0.85)
            pelvic = 0.125 * bump(h - (2.93 + 0.29 * (z + 1.45)), 0.27) * bump(z + 1.95, 1.10)
            iliac = 0.095 * bump(h - (3.48 + 0.19 * (z + 1.45)), 0.22) * bump(z + 1.32, 0.75)
            flank = -0.061 * bump(z + 0.13, 0.45) * bump(h - 2.86, 0.29)
            rib = 0.018 * bump(z - 0.25, 0.89) * bump(h - 2.95, 0.48) * math.sin(13 * (z + 0.36 * (h - 2.9)))
            r = w * (1 - 0.12 * max(0, s)) + lateral * (chest + nuchal + pelvic + iliac + flank + rib)
            row.append((r * c, h, z))
        result.append(row)
    return rings(Part("axial_skin"), result)


def shell(stations, upper):
    # Cranial planes change section along the skull. The broad jugal sits
    # below the inset orbit, the postorbital pillar braces it from behind,
    # and a shallow soft-tissue fossa lies ahead. The dentary has a narrow
    # ventral keel and a fuller angular/surangular region behind the tooth row.
    upper_contour = [
        (0, 1),
        (0.27, 0.990),
        (0.48, 0.950),
        (0.69, 0.917),
        (0.79, 0.850),
        (0.89, 0.745),
        (0.95, 0.65),
        (0.965, 0.55),
        (0.965, 0.435),
        (0.983, 0.309),
        (0.997, 0.195),
        (1.0, 0.098),
        (0.989, 0.039),
        (0.942, 0),
        (0.77, 0.025),
        (0.49, 0.100),
        (0, 0.136),
    ]
    lower_contour = [
        (0, 0),
        (0.28, 0.025),
        (0.55, 0.095),
        (0.72, 0.163),
        (0.82, 0.235),
        (0.91, 0.355),
        (0.963, 0.519),
        (0.984, 0.68),
        (1, 0.805),
        (0.988, 0.933),
        (0.916, 1),
        (0.73, 0.928),
        (0.45, 0.852),
        (0, 0.825),
    ]
    contour = upper_contour if upper else lower_contour
    contour = contour + [(-x, y) for x, y in reversed(contour[1:-1])]
    rows = []
    for z, w, a, b in smooth_rows(stations, 6 if upper else 4):
        low, high = (a, b) if upper else (b, a)
        row = []
        for unit, v in contour:
            h = low + (high - low) * v
            if upper:
                orbit = -0.127 * bump(z - 3.459, 0.148) * bump(h - 4.176, 0.112)
                antorbital = -0.099 * bump(z - 3.924, 0.285) * bump(h - (3.925 - 0.12 * (z - 3.91)), 0.166)
                temporal = -0.085 * bump(z - 3.061, 0.148) * bump(h - 4.028, 0.201)
                pillar = 0.063 * bump(z - (3.246 + 0.18 * (h - 3.94)), 0.085) * bump(h - 3.97, 0.353)
                cheek = 0.090 * bump(h - (3.691 + 0.14 * (z - 3.40)), 0.132) * bump(z - 3.36, 0.365)
                maxilla = 0.048 * bump(h - (3.628 + 0.08 * (z - 4.23)), 0.135) * bump(z - 4.34, 0.59)
                flare = orbit + antorbital + temporal + pillar + cheek + maxilla
            else:
                flare = 0.087 * bump(h - (3.249 + 0.40 * (z - 3.13)), 0.145) * bump(z - 3.15, 0.306)
                flare -= 0.030 * bump(h - 3.241, 0.091) * bump(z - 3.76, 0.45)
            ridged, furrow = cheek_folds(z, h)
            flare += 0.038 * ridged - 0.032 * furrow
            if upper:
                plate, margin = labials(z, h)
                flare += 0.028 * plate - 0.016 * margin
                sill = 3.946 - 0.32 * (z - 4.69)
                flare += 0.052 * bump(h - sill, 0.046) * bump(z - 4.690, 0.153)
                flare += 0.072 * bump(h - (4.102 - 0.14 * (z - 3.45)), 0.093) * bump(z - 3.453, 0.204)
            width = (max(0.008, w) + flare * abs(unit) ** 2.5) * unit
            row.append((width, h, z))
        rows.append(row)
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
                (0.40, 3.61, -1.24, 0.14, 0.22),
                (0.58, 3.49, -1.03, 0.31, 0.54),
                (0.72, 3.25, -0.82, 0.39, 0.69),
                (0.78, 2.99, -0.63, 0.395, 0.699),
                (0.80, 2.70, -0.39, 0.371, 0.60),
                (0.78, 2.42, -0.192, 0.331, 0.469),
                (0.752, 2.16, -0.031, 0.282, 0.357),
                (0.721, 1.99, 0.035, 0.257, 0.274),
                (0.702, 1.85, -0.046, 0.217, 0.222),
            ],
            "caudofemoralis": [
                (0.24, 2.62, -3.21, 0.078, 0.119),
                (0.38, 2.67, -2.75, 0.176, 0.228),
                (0.474, 2.74, -2.31, 0.210, 0.294),
                (0.515, 2.817, -1.87, 0.249, 0.366),
                (0.56, 2.843, -1.51, 0.27, 0.436),
                (0.598, 2.792, -1.22, 0.277, 0.438),
                (0.654, 2.685, -0.90, 0.248, 0.359),
                (0.716, 2.53, -0.49, 0.162, 0.232),
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
                (0.40, 3.688, 0.14, 0.056, 0.11),
                (0.57, 3.59, 0.48, 0.116, 0.166),
                (0.72, 3.378, 0.88, 0.112, 0.174),
                (0.772, 3.161, 1.18, 0.109, 0.178),
                (0.68, 2.994, 1.438, 0.148, 0.194),
                (0.534, 2.901, 1.626, 0.115, 0.128),
            ],
            "pectoral_fan": [
                (0.235, 2.335, 0.74, 0.091, 0.132),
                (0.369, 2.381, 1.03, 0.160, 0.221),
                (0.445, 2.514, 1.282, 0.188, 0.223),
                (0.513, 2.719, 1.51, 0.172, 0.212),
                (0.521, 2.9, 1.61, 0.115, 0.153),
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
                (0.48, 4.374, 3.069, 0.073, 0.108),
                (0.631, 4.381, 3.222, 0.126, 0.146),
                (0.674, 4.325, 3.39, 0.141, 0.136),
                (0.663, 4.281, 3.51, 0.111, 0.094),
                (0.562, 4.216, 3.663, 0.086, 0.085),
                (0.481, 4.17, 3.78, 0.054, 0.067),
            ],
            "nasal_boss": [
                (0.375, 4.359, 3.524, 0.079, 0.102),
                (0.394, 4.297, 3.683, 0.099, 0.095),
                (0.346, 4.239, 3.88, 0.10, 0.087),
                (0.286, 4.232, 4.13, 0.095, 0.067),
                (0.243, 4.191, 4.39, 0.077, 0.060),
                (0.192, 4.122, 4.63, 0.054, 0.042),
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
                (0.542, 4.463, 3.103, 0.107, 0.074, 0.145),
                (0.61, 4.45, 3.247, 0.098, 0.084, 0.117),
                (0.633, 4.407, 3.389, 0.092, 0.064, 0.105),
                (0.593, 4.361, 3.513, 0.074, 0.061, 0.109),
                (0.353, 4.298, 3.83, 0.091, 0.046, 0.136),
                (0.298, 4.28, 4.01, 0.094, 0.044, 0.128),
                (0.244, 4.237, 4.24, 0.083, 0.041, 0.146),
                (0.202, 4.191, 4.42, 0.072, 0.038, 0.140),
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
            ("orbit", (EYE[0] + 0.044, EYE[1] + 0.002, EYE[2]), (0.146, 0.086, 0.140)),
            ("naris", NARIS, (0.125, 0.067, 0.123)),
        ]:
            if name == "naris":
                # The blind posterior pocket narrows beneath the nasal sill;
                # the fleshy rostral entrance opens obliquely out and forward.
                cut = loft(
                    "nasal_vestibule",
                    [
                        (0.388, 3.995, 4.489, 0.024, 0.015),
                        (0.399, 3.977, 4.542, 0.091, 0.042),
                        (0.401, 3.947, 4.621, 0.138, 0.060),
                        (0.401, 3.921, 4.708, 0.144, 0.066),
                        (0.393, 3.892, 4.783, 0.117, 0.062),
                        (0.366, 3.879, 4.826, 0.061, 0.038),
                        (0.346, 3.878, 4.848, 0.011, 0.012),
                    ],
                    sign,
                    power=0.85,
                    sides=22,
                )
            else:
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
    m.ratio = min(1, 15800 / len(obj.data.loop_triangles))
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


def detail(name, bone, rows, rect, sides=12, subdivisions=2):
    return Part(name, "rex_detail", bone).loft(rows, sides, rect, subdivisions).object()


def soft_parts():
    out = []
    # Oral roof and tongue track the asymmetric lip stations.
    for upper, st in [(True, SKULL), (False, JAW)]:
        values = np.array(st)
        rows = []
        for z, proportion in [
            (3.07, 0.56),
            (3.31, 0.71),
            (3.58, 0.72),
            (3.87, 0.72),
            (4.21, 0.68),
            (4.57, 0.60),
            (4.83, 0.41),
            (5.01, 0.21),
        ]:
            w = np.interp(z, values[:, 0], values[:, 1])
            lip = np.interp(z, values[:, 0], values[:, 2])
            rows.append((0, lip + (0.098 if upper else -0.087), z, w * proportion, 0.044 if upper else 0.068))
        out.append(
            detail(
                "palatal_ridges" if upper else "mobile_tongue",
                "maxilla" if upper else "jaw",
                rows,
                ORAL if upper else TONGUE,
                24,
            )
        )
    for side, sg in [("l", 1), ("r", -1)]:
        for upper, st in [(True, SKULL), (False, JAW)]:
            name = "upper" if upper else "lower"
            bone = "maxilla" if upper else "jaw"
            stations = np.array(st)
            lip_column = 2

            def gum(z):
                w = np.interp(z, stations[:, 0], stations[:, 1])
                y = np.interp(z, stations[:, 0], stations[:, lip_column])
                return ((0.64 if upper else 0.70) * w * sg, y + (0.042 if upper else -0.031), z)

            gumline = [(*gum(z), 0.048, 0.032) for z in np.linspace(3.36, 5.005, 15)]
            out.append(detail(name + "_gingiva_" + side, bone, gumline, ORAL))
            locations = np.linspace(3.41, 4.947, 13 if upper else 12) + (0.029 if not upper else 0)
            for i, z in enumerate(locations):
                xx, yy, _ = gum(z)
                h = (0.088 + 0.161 * math.sin(math.pi * (i + 0.7) / (len(locations) + 1)) ** 0.64) * (
                    0.78 if not upper else 1
                )
                h *= 0.88 + 0.12 * math.sin(i * 2.49 + (0 if upper else 0.7))
                r = 0.024 + h * 0.147
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
                        10,
                        subdivisions=1,
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
        for upper in (True,):
            path = []
            for i in range(13):
                a = math.pi * i / 12
                u = math.cos(a)
                s = math.sin(a)
                path.append(
                    (
                        (EYE[0] + 0.009 + 0.023 * s) * sg,
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


def lower_lid(body, side, sign):
    # The lower lid grows out of the actual suborbital surface. The broad outer
    # row dives into the cheek and the narrow inner edge touches the globe.
    casting = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    p = Part("lower_orbital_fold_" + side, "rex_head", "skull")
    ex, ey, ez = EYE
    columns = []
    for u in np.linspace(-1, 1, 19):
        arch = max(0, 1 - u * u) ** 0.63
        inner_y = ey - 0.028 * arch + 0.004 * u
        z = ez + 0.101 * u
        outer_y = inner_y - (0.051 * arch + 0.011)
        hit = casting.ray_cast(to_blender((sign * 1.5, outer_y, z)), Vector((-sign, 0, 0)))[0]
        if hit is None:
            raise RuntimeError("lower eyelid missed the suborbital surface")
        base = abs(hit.x) - 0.010
        lip_x = ex + 0.042 * arch - 0.015 * abs(u)
        row = []
        for hidden in (False, True):
            for v in np.linspace(0, 1, 6):
                x = (1 - v) * lip_x + v * base + 0.012 * arch * np.sin(v * np.pi)
                row.append(p.point((sign * (x - (0.020 if hidden else 0)), inner_y + (outer_y - inner_y) * v, z)))
        columns.append(row)
    for a, b in zip(columns, columns[1:]):
        for j in range(5):
            for off in (0, 6):
                p.face((a[j + off], a[j + off + 1], b[j + off + 1], b[j + off]))
        for j in (0, 5):
            p.face((a[j], a[j + 6], b[j + 6], b[j]))
    for row in (columns[0], columns[-1]):
        for j in range(5):
            p.face((row[j], row[j + 1], row[j + 7], row[j + 6]))
    return p.object()


def commissure(side, sign):
    # The mouth corner is an elastic fold behind the tooth arcade. Its
    # lower edge travels with the rotating dentary, the upper with the jugal.
    p = Part("commissure_" + side, "rex_head")
    columns = []
    zs = np.linspace(3.03, 3.73, 10)
    for z in zs:
        t = (z - zs[0]) / (zs[-1] - zs[0])
        w_upper = np.interp(z, np.array(SKULL)[:, 0], np.array(SKULL)[:, 1])
        w_lower = np.interp(z, np.array(JAW)[:, 0], np.array(JAW)[:, 1])
        top = np.interp(z, [3.03, 3.21, 3.42, 3.58, 3.73], [3.69, 3.73, 3.76, 3.69, 3.55])
        bottom = np.interp(z, [3.03, 3.22, 3.46, 3.73], [3.01, 3.05, 3.19, 3.44])
        section = []
        for inside in (False, True):
            for k in range(6):
                v = k / 5
                radius = (0.94 * w_lower * (1 - v) + 0.92 * w_upper * v) - 0.045 * math.sin(math.pi * v)
                radius -= 0.035 * math.sin(math.pi * t) * math.sin(math.pi * v) + (0.036 if inside else 0)
                section.append(p.point((sign * radius, bottom + v * (top - bottom), z)))
        columns.append(section)
    for a, b in zip(columns, columns[1:]):
        for j in range(5):
            for off in (0, 6):
                p.face([a[j + off], a[j + off + 1], b[j + off + 1], b[j + off]])
        for j in (0, 5):
            p.face([a[j], a[j + 6], b[j + 6], b[j]])
    for col in (columns[0], columns[-1]):
        for j in range(5):
            p.face([col[j], col[j + 1], col[j + 7], col[j + 6]])
    obj = p.object()
    skull = obj.vertex_groups.new(name="skull")
    jaw = obj.vertex_groups.new(name="jaw")
    for col in columns:
        for k, i in enumerate(col):
            v = (k % 6) / 5
            v = v * v * (3 - 2 * v)
            if v:
                skull.add([i], v, "REPLACE")
            if v < 1:
                jaw.add([i], 1 - v, "REPLACE")
    return obj


def build():
    body = hide()
    obj = join(
        [
            body,
            shell(JAW, False),
            commissure("l", 1),
            commissure("r", -1),
            lower_lid(body, "l", 1),
            lower_lid(body, "r", -1),
        ],
        "rex_skin",
    )
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
