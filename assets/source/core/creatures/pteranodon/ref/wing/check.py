"""Measures the model's membrane through the wing's poses, as the build makes it: builds rig.py and model.py, poses the
rig with the animators' helpers, and counts, for the left wing in each pose,

- self: pairs of its triangles that cross, sharing no corner and with no corners within 2 cm (its two faces never
  meet; neighbours bent at a crease are not counted);
- body: its triangles crossing the shell or the legs, leaving out the root and the leading edge, which are grown into
  the body and the arm;
- wings: triangles of the left wing crossing the right's;
- inverted: its triangles folded tighter than the skin is thick, so that the face looks the other way from the side
  it is shaded as (its corners' normals, skinned, against the normal its corners make).

    blender --background --factory-startup --disable-autoexec --python ref/wing/check.py -- [--out ref/wing/checks.json]

Writes the table to checks.json beside this script.
"""

import json
import os
import runpy
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))

# What the clips ask of the wing: the glide and its strokes, the fold in the air from a quarter to all but folded,
# the landing's (body pitched up), the ground's (hands lifted, wings half open) and STANCE.
POSES = {
    "glide": {},
    "upstroke": {"wings": dict(flap=58, sweep=4, curl=-8)},
    "upstroke_40_elbow_25": {"wings": dict(flap=40), "bones": {"forearm": dict(roll=-25)}},
    "downstroke": {"wings": dict(flap=-42, sweep=10, curl=14)},
    "sweep_forward": {"wings": dict(flap=20, sweep=22)},
    "bank": {"body": dict(roll=40), "wings": dict(curl=6)},
    "hover": {"body": dict(pos=(0, 0.80, -0.55), pitch=48), "wings": dict(flap=20, sweep=18, curl=10),
              "feet": dict(pos=(0.16, 0.18, -0.40), pitch=60), "head": dict(pos=(0, 1.50, 0.12), pitch=0)},
    "dive": {"body": dict(pitch=-35), "wings": dict(fold=0.42, sweep=-18, flap=12), "head": dict(pos=(0, 1.16, 0.55), pitch=-30)},
    "air_0.25": {"wings": dict(fold=0.25)},
    "air_0.4": {"wings": dict(fold=0.4)},
    "tuck": {"wings": dict(fold=0.5)},
    "air_0.7": {"wings": dict(fold=0.7)},
    "air_0.9": {"wings": dict(fold=0.9)},
    "land_0.6": {"body": dict(pitch=25), "wings": dict(fold=0.6)},
    "land_0.75": {"body": dict(pitch=25), "wings": dict(fold=0.75)},
    "land_0.9": {"body": dict(pitch=25), "wings": dict(fold=0.9)},
    "ground_0.6": {"stance": True, "wings": dict(fold=0.6), "unplant": True},
    "ground_0.8": {"stance": True, "wings": dict(fold=0.8), "unplant": True},
    "ground_open": {"stance": True, "wings": dict(fold=0.55, flap=25), "unplant": True},
    "stance": {"stance": True},
    "stance_call": {"stance": True, "head": dict(pos=(0, 1.48, 0.40), pitch=15), "beak": 1.0},
}


def pose(rig, r, spec):
    r.rest()
    c = rig.Clip(r, "_pose", 1)
    old = bpy.data.actions.get("_pose")
    if old is not None:
        bpy.data.actions.remove(old)
    c.action = bpy.data.actions.new("_pose")
    r.obj.animation_data.action = c.action
    c.stance(0) if spec.get("stance") else c.glide(0)
    if "body" in spec:
        b = dict(spec["body"])
        c.body(0, b.pop("pos", None) or (rig.STANCE["body"]["pos"] if spec.get("stance") else None), **b)
    if "head" in spec:
        c.head(0, **spec["head"])
    for side in "lr":
        s = 1.0 if side == "l" else -1.0
        if "wings" in spec:
            w = dict(spec["wings"])
            if spec.get("stance"):
                w.setdefault("fold", 1.0)
            c.wing(0, side, **w)
        if spec.get("unplant"):
            c.hand(0, side, None)
        if "feet" in spec:
            ft = dict(spec["feet"])
            c.foot(0, side, rig.mirrored(ft.pop("pos"), side), **ft)
        for bone, turn in spec.get("bones", {}).items():
            c.bone(0, f"{bone}_{side}", pitch=turn.get("pitch", 0.0), yaw=turn.get("yaw", 0.0) * s, roll=turn.get("roll", 0.0) * s)
    if "beak" in spec:
        c.beak(0, spec["beak"])
    bpy.context.scene.frame_set(0)


def measure(obj, rest_centres, groups):
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = ev.to_mesh()
    m.calc_loop_triangles()
    verts = [v.co.copy() for v in m.vertices]
    normals = m.corner_normals
    tris = {k: [] for k in groups}
    inverted = 0
    for t in m.loop_triangles:
        for k, test in groups.items():
            if test(t.polygon_index):
                tris[k].append(tuple(t.vertices))
        if groups["wing_l"](t.polygon_index):
            n = sum((normals[i].vector for i in t.loops), Vector())
            a, b, c = (verts[i] for i in t.vertices)
            if (b - a).cross(c - a).dot(n) < 0:
                inverted += 1
    ev.to_mesh_clear()

    def tree(ts):
        return BVHTree.FromPolygons(verts, ts, epsilon=0.0) if ts else None

    wl, wr, body, inner = (tree(tris[k]) for k in ("wing_l", "wing_r", "body", "wing_l_inner"))
    pairs = wl.overlap(wl)
    ts = tris["wing_l"]
    selfs = 0
    for i, j in pairs:
        if i >= j or set(ts[i]) & set(ts[j]):
            continue
        if min((verts[a] - verts[b]).length for a in ts[i] for b in ts[j]) > 0.02:
            selfs += 1
    return {"self": selfs, "body": len(inner.overlap(body)), "wings": len(wl.overlap(wr)), "inverted": inverted}


def groups_of(obj):
    """Which faces at rest are each wing's membrane, the left's not grown into the body, and the solid body; and every
    face's centre at rest."""
    me = obj.data
    names = list(obj["islands"])
    isl = me.attributes["island"].data
    cell = me.attributes["cell"].data
    centre = [p.center.copy() for p in me.polygons]
    piece = [names[isl[p.index].value] for p in me.polygons]
    wing = lambda f: piece[f].startswith("membrane") and cell[f].value >= 0
    solid = lambda f: piece[f] in ("torso", "neck", "head", "beak", "leg")
    return {
        "wing_l": lambda f: wing(f) and centre[f].x > 0,
        "wing_r": lambda f: wing(f) and centre[f].x < 0,
        # the root's first two columns and the leading edge's first row are grown into the body and the arm
        "wing_l_inner": lambda f: wing(f) and centre[f].x > 0 and cell[f].value // 256 >= 2 and cell[f].value % 256 >= 1,
        "body": solid,
    }, centre


def main():
    sys.dont_write_bytecode = True
    sys.path.insert(0, FOLDER)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    for name in ("rig.py", "model.py"):
        runpy.run_path(os.path.join(FOLDER, name), run_name="__main__")
    import rig
    r = rig.find()
    obj = bpy.data.objects["pteranodon_model"]
    groups, centre = groups_of(obj)
    report = {}
    for name, spec in POSES.items():
        pose(rig, r, spec)
        report[name] = measure(obj, centre, groups)
        print(f"check: {name:22s} {report[name]}")
    r.rest()
    out = os.path.join(HERE, "checks.json")
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
    with open(out, "w") as fh:
        json.dump(report, fh, indent=1)
    print("check: wrote", out)


if __name__ == "__main__":
    main()
