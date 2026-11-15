"""Bakes what the texture maker paints to: builds the dodo as the build does, bakes occlusion with Cycles, and writes
the surface (every face corner's texture coordinate, position, normal and feather direction) for draw.py.

    blender --background --factory-startup --disable-autoexec --python ref/bakes/bake.py -- [--size 1024] [--samples 48]

Writes ref/bakes/dodo_occlusion.png and the surface to the system's temporary folder; then run `python3 ref/bakes/draw.py`.
"""

import json
import math
import os
import runpy
import sys
import tempfile

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))
SCRATCH = os.path.join(tempfile.gettempdir(), "dodo_surface.json")


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"size": 1024, "samples": 48}
    for k in range(0, len(argv) - 1, 2):
        out[argv[k].lstrip("-")] = int(argv[k + 1])
    return out


def build():
    sys.dont_write_bytecode = True
    sys.path.insert(0, FOLDER)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    for name in ("rig.py", "model.py"):
        runpy.run_path(os.path.join(FOLDER, name), run_name="__main__")
    import model
    return bpy.data.objects["dodo_model"], model


def feather_direction(model, obj):
    """The way the feathers lie at each point of the shell, wings and legs, in the bird's frame: down the neck and back
    over the body to the tail, falling down the flanks; back along the wing; down the legs. Zero where it means
    nothing (beak, eyes, cards)."""
    mesh = obj.data
    pts = np.array([model.rig.to_bird(v.co) for v in mesh.vertices])
    flow = np.zeros_like(pts)
    # The shell's columns run from the rump to the beak; its feathers point back along them, towards the rump, and
    # lean down where the surface faces sideways.
    names = list(obj["islands"])
    isl = mesh.attributes["island"].data
    on = {}
    for p in mesh.polygons:
        on.setdefault(names[isl[p.index].value], set()).update(p.vertices)
    shell = set().union(*(on.get(n, set()) for n in ("shell_body", "shell_hood", "shell_face")))
    nbr = {v: set() for v in shell}
    for e in mesh.edges:
        a, b = e.vertices
        if a in shell and b in shell:
            nbr[a].add(b)
            nbr[b].add(a)
    normals = np.array([model.rig.to_bird(v.normal) for v in mesh.vertices])
    # towards the rump: the steepest way down a smooth field that is the distance along the body from the tail
    order = {}
    tail = np.array(model.TAIL_ROOT) + np.array([0.0, -0.1, -0.1])
    for v in shell:
        order[v] = np.linalg.norm(pts[v] - tail)
    for v in shell:
        d = np.zeros(3)
        for u in nbr[v]:
            step = pts[u] - pts[v]
            d += -step * (order[u] - order[v]) / max(np.dot(step, step), 1e-12)
        n = normals[v]
        down = np.array([0.0, -1.0, 0.0])
        side = abs(n[0])
        d = d / max(np.linalg.norm(d), 1e-9) + down * 0.5 * side
        d -= n * np.dot(d, n)
        flow[v] = d / max(np.linalg.norm(d), 1e-9)
    for name, way in (("wing_l_out", (0.0, -0.2, -1.0)), ("wing_l_in", (0.0, -0.2, -1.0)), ("leg_l", (0.0, -1.0, 0.0))):
        for n2 in (name, name.replace("_l", "_r")):
            for v in on.get(n2, ()):
                n = normals[v]
                d = np.array(way, float)
                d = d - n * np.dot(d, n)
                if np.linalg.norm(d) > 0.3:
                    flow[v] = d / np.linalg.norm(d)
    return flow


def surface(model, obj, flow):
    """Every face's corners: texture coordinate, bird-frame position, normal and feather direction (as a direction
    in the picture: how far along u and v)."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    uv = mesh.uv_layers.active.data
    reg = mesh.attributes["region"].data
    isl = mesh.attributes["island"].data
    names = list(obj["islands"])
    corner_normals = mesh.corner_normals
    faces = []
    for p in mesh.polygons:
        corners = list(p.loop_indices)
        q = [tuple(uv[i].uv) for i in corners]
        pos = [model.rig.to_bird(mesh.vertices[mesh.loops[i].vertex_index].co) for i in corners]
        nor = [model.rig.to_bird(corner_normals[i].vector) for i in corners]
        # the feather direction in the picture: solve flow = a dP/du + b dP/dv on the face's first triangle
        fl = []
        P = [np.array(x) for x in pos[:3]]
        Q = [np.array(x) for x in q[:3]]
        du = np.array([Q[1] - Q[0], Q[2] - Q[0]])
        dp = np.array([P[1] - P[0], P[2] - P[0]])
        for i in corners:
            f3 = flow[mesh.loops[i].vertex_index]
            if np.linalg.norm(f3) < 0.5 or abs(np.linalg.det(du)) < 1e-14:
                fl.append((0.0, 0.0))
                continue
            # dP = J duv, J = dp^T du^-T: the picture direction is J^+ f3
            J = np.linalg.solve(du, dp).T
            ab = np.linalg.lstsq(J, f3, rcond=None)[0]
            ab /= max(np.linalg.norm(ab), 1e-12)
            fl.append((float(ab[0]), float(ab[1])))
        faces.append({"m": p.material_index, "r": reg[p.index].value, "i": names[isl[p.index].value],
                      "uv": q, "p": [list(map(float, x)) for x in pos], "n": [list(map(float, x)) for x in nor], "f": fl})
    return faces


def occlusion(obj, size, samples):
    """Ambient occlusion of the opaque surface, the cards left out, baked into its texture."""
    import model
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
    bm = bmesh.new()
    bm.from_mesh(copy.data)
    cards = list(model.rig.MATERIALS).index("dodo_cards")
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == cards], context="FACES")
    bm.to_mesh(copy.data)
    bm.free()
    img = bpy.data.images.new("occlusion", size, size, alpha=False)
    mat = bpy.data.materials.new("bake")
    mat.use_nodes = True
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    mat.node_tree.nodes.active = node
    copy.data.materials.clear()
    copy.data.materials.append(mat)
    for o in scene.objects:
        o.select_set(o == copy)
        o.hide_render = o != copy
    bpy.context.view_layer.objects.active = copy
    bpy.ops.object.bake(type="AO", margin=8, margin_type="EXTEND", use_clear=True)
    img.filepath_raw = os.path.join(HERE, "dodo_occlusion.png")
    img.file_format = "PNG"
    img.save()


def main():
    a = args()
    obj, model = build()
    flow = feather_direction(model, obj)
    faces = surface(model, obj, flow)
    with open(SCRATCH, "w") as fh:
        json.dump({"faces": faces, "materials": list(model.rig.MATERIALS), "atlas": model.ATLAS,
                   "nape_wedge": model.NAPE_WEDGE}, fh)
    occlusion(obj, a["size"], a["samples"])
    print(f"bake: {len(faces)} faces, occlusion at {a['size']}; now run python3 {os.path.join(HERE, 'draw.py')}")


main()
