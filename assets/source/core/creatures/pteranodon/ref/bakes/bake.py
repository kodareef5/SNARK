"""Bakes what the texture maker paints to: builds the pteranodon as the build does, bakes occlusion with Cycles for each
material, and writes the surface (every face corner's texture coordinate, position, normal and the way the fuzz and
the veins run) for draw.py.

    blender --background --factory-startup --disable-autoexec --python ref/bakes/bake.py -- [--size 1024] [--samples 48]

Writes ref/bakes/pteranodon_occlusion.png and pteranodon_wing_occlusion.png, and the surface to the system's temporary
folder; then run `python3 ref/bakes/draw.py`.
"""

import json
import os
import runpy
import sys
import tempfile

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))
SCRATCH = os.path.join(tempfile.gettempdir(), "pteranodon_surface.json")


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"size": 1024, "samples": 48, "occlusion": 1}
    for k in range(0, len(argv) - 1, 2):
        out[argv[k].lstrip("-")] = int(argv[k + 1])
    return out


def build():
    sys.dont_write_bytecode = True
    sys.path.insert(0, FOLDER)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    for name in ("rig.py", "model.py", "saddle.py"):
        runpy.run_path(os.path.join(FOLDER, name), run_name="__main__")
    import model
    return bpy.data.objects["pteranodon_model"], model


def flow(model, obj):
    """The way the fuzz lies at each point, in the animal's frame: back along the head, neck and body to the tail, down
    the flanks; out along the arm and finger; down the legs. On the membrane, the way its veins run: from the leading
    edge back to the trailing edge, fanning out toward the tip. Zero where it means nothing (horn, eyes, claws)."""
    mesh = obj.data
    names = list(obj["islands"])
    isl = mesh.attributes["island"].data
    reg = mesh.attributes["region"].data
    pts = np.array([model.rig.to_animal(v.co) for v in mesh.vertices])
    normals = np.array([model.rig.to_animal(v.normal) for v in mesh.vertices])
    out = np.zeros_like(pts)
    on = {}
    for p in mesh.polygons:
        if reg[p.index].value in (model.HORN_R, model.BAND_R, model.BARE_R) and not names[isl[p.index].value].startswith(("arm", "finger")):
            continue
        on.setdefault(names[isl[p.index].value].split("_")[0], set()).update(p.vertices)
    spine = np.array([model.rig._TAIL["skull"], model.rig._JOINT["skull"], model.rig._JOINT["neck_3"],
                      model.rig._JOINT["neck_1"], model.rig._JOINT["chest"], model.rig._JOINT["spine"],
                      model.rig._JOINT["pelvis"], model.rig._TAIL["tail"]])
    for v in on.get("torso", set()) | on.get("neck", set()) | on.get("head", set()):
        p = pts[v] * np.array([0, 1, 1])
        k = int(np.argmin(np.linalg.norm(spine - p, axis=1)))
        a, b = spine[max(k - 1, 0)], spine[min(k + 1, len(spine) - 1)]
        d = b - a
        d = d / max(np.linalg.norm(d), 1e-9) + np.array([0.0, -0.5, 0.0]) * abs(normals[v][0])
        n = normals[v]
        d -= n * np.dot(d, n)
        out[v] = d / max(np.linalg.norm(d), 1e-9)
    for key, way in (("arm", (1.0, 0.0, -0.2)), ("finger", (1.0, -0.1, -0.3)), ("leg", (0.0, -0.5, -1.0))):
        for v in on.get(key, set()):
            n = normals[v]
            d = np.array(way) * np.array([np.sign(pts[v][0]) or 1, 1, 1])
            d = d - n * np.dot(d, n)
            out[v] = d / max(np.linalg.norm(d), 1e-9)
    tip = np.array(model.rig._TAIL["wing_4_l"])
    for v in on.get("membrane", set()):
        x = abs(pts[v][0])
        d = np.array([0.15 + 0.5 * max(0.0, x - 1.5) / 2.0, 0.0, -1.0]) * np.array([np.sign(pts[v][0]) or 1, 1, 1])
        n = normals[v]
        d = d - n * np.dot(d, n)
        out[v] = d / max(np.linalg.norm(d), 1e-9)
    return out


def surface(model, obj, fl, offset=0):
    """Every face's corners: texture coordinate, position in the animal's frame, normal, and the flow as a direction in
    the picture (how far along u and v). `offset` is added to the material index."""
    mesh = obj.data
    uv = mesh.uv_layers.active.data
    reg = mesh.attributes["region"].data
    isl = mesh.attributes["island"].data
    names = list(obj["islands"])
    corner_normals = mesh.corner_normals
    faces = []
    for p in mesh.polygons:
        corners = list(p.loop_indices)
        q = [tuple(uv[i].uv) for i in corners]
        pos = [model.rig.to_animal(mesh.vertices[mesh.loops[i].vertex_index].co) for i in corners]
        nor = [model.rig.to_animal(corner_normals[i].vector) for i in corners]
        f2 = []
        P = [np.array(x) for x in pos[:3]]
        Q = [np.array(x) for x in q[:3]]
        du = np.array([Q[1] - Q[0], Q[2] - Q[0]])
        dp = np.array([P[1] - P[0], P[2] - P[0]])
        for i in corners:
            f3 = fl[mesh.loops[i].vertex_index]
            if np.linalg.norm(f3) < 0.5 or abs(np.linalg.det(du)) < 1e-14:
                f2.append((0.0, 0.0))
                continue
            J = np.linalg.solve(du, dp).T
            ab = np.linalg.lstsq(J, f3, rcond=None)[0]
            ab /= max(np.linalg.norm(ab), 1e-12)
            f2.append((float(ab[0]), float(ab[1])))
        faces.append({"m": p.material_index + offset, "r": reg[p.index].value, "i": names[isl[p.index].value],
                      "uv": q, "p": [list(map(float, x)) for x in pos], "n": [list(map(float, x)) for x in nor], "f": f2})
    return faces


def occlusion(obj, material, size, samples, name, others=()):
    """Ambient occlusion of one material's faces from the whole animal at rest (and `others` in the scene, such as the
    saddle), baked into that material's texture."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.modifiers.clear()
    copy.parent = None
    copy.matrix_world = obj.matrix_world
    scene.collection.objects.link(copy)
    img = bpy.data.images.new(name, size, size, alpha=False)
    bake = bpy.data.materials.new("bake")
    bake.use_nodes = True
    node = bake.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    bake.node_tree.nodes.active = node
    blank = bpy.data.materials.new("blank")
    blank.use_nodes = True
    other = blank.node_tree.nodes.new("ShaderNodeTexImage")
    other.image = bpy.data.images.new("unused", 8, 8)
    blank.node_tree.nodes.active = other
    # clearing the materials sets every face's index to the first, so the indices are put back after
    index = [p.material_index for p in obj.data.polygons]
    copy.data.materials.clear()
    for k in range(len(obj.data.materials)):
        copy.data.materials.append(bake if k == material else blank)
    copy.data.polygons.foreach_set("material_index", index)
    copy.data.update()
    shadows = []
    for other in others:
        s = other.copy()
        s.data = other.data.copy()
        s.modifiers.clear()
        s.parent = None
        s.matrix_world = other.matrix_world
        scene.collection.objects.link(s)
        shadows.append(s)
    for o in scene.objects:
        o.select_set(o == copy)
        o.hide_render = o != copy and o not in shadows
    bpy.context.view_layer.objects.active = copy
    bpy.ops.object.bake(type="AO", margin=8, margin_type="EXTEND", use_clear=True)
    img.filepath_raw = os.path.join(HERE, name + ".png")
    img.file_format = "PNG"
    img.save()
    bpy.data.objects.remove(copy)
    for s in shadows:
        bpy.data.objects.remove(s)


def main():
    a = args()
    obj, model = build()
    saddle = bpy.data.objects["saddle"]
    fl = flow(model, obj)
    faces = surface(model, obj, fl) + surface(model, saddle, np.zeros((len(saddle.data.vertices), 3)), offset=2)
    with open(SCRATCH, "w") as fh:
        json.dump({"faces": faces, "materials": [model.BODY_MAT, model.WING_MAT, "pteranodon_saddle"],
                   "wing_uv": model.WING_UV}, fh)
    if a["occlusion"]:
        occlusion(obj, 0, a["size"], a["samples"], "pteranodon_occlusion")
        occlusion(obj, 1, a["size"], a["samples"], "pteranodon_wing_occlusion")
        # the saddle's own, in the shade of the animal it sits on
        occlusion(saddle, 0, a["size"] // 2, a["samples"], "pteranodon_saddle_occlusion", others=(obj,))
    print(f"bake: {len(faces)} faces; now run python3 {os.path.join(HERE, 'draw.py')}")


if __name__ == "__main__":
    main()
