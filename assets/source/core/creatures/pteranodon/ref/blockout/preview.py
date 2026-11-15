"""Looks at the pteranodon's block-out: runs its scripts as the build does, then renders and measures. Not one of the
asset's scripts.

    blender --background --factory-startup --disable-autoexec --python ref/blockout/preview.py -- \
        --out DIR [--views] [--guides] [--poses] [--checks] [--saddle] [--blend F]

--views    the six orthographic views on the concept's canvases (blockout_<view>.png), for compare.py
--guides   the same views region-coloured, the three-quarter in flight, and the saddled views with the seated rider,
           for the image model to paint onto (guide_<view>.png)
--poses    POSES below from the side and from three-quarter (pose_<name>_<view>.png)
--checks   the folded wing against the body and itself, and the rider's room, in CHECKS; writes checks.json
--saddle   builds the saddle's block-out too
--blend    saves the scene
"""

import json
import math
import os
import runpy
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))

# The concept views' canvases: 400 px a metre. Wide for the spread views seen from above, below and in front; square
# for the side views and the folded front.
PX_PER_M = 400.0
WIDE = (3200, 1600)
SQUARE = (1600, 1600)
VIEWS = {
    # name: (canvas, pose, camera)
    "top": (WIDE, "rest", "top"),
    "underside": (WIDE, "rest", "under"),
    "front": (WIDE, "rest", "front_wide"),
    "side": (SQUARE, "rest", "side"),
    "folded_side": (SQUARE, "stance", "side"),
    "folded_front": (SQUARE, "stance", "front_square"),
}

# Poses that show the rig can do what the clips ask, made with the animators' helpers.
POSES = {
    "glide": {},
    "upstroke": {"wings": dict(flap=58, sweep=4, curl=-8)},
    "downstroke": {"wings": dict(flap=-42, sweep=10, curl=14)},
    "half_folded": {"wings": dict(fold=0.5)},
    "tucked": {"wings": dict(fold=0.8, flap=10)},
    "dive": {"body": dict(pitch=-35), "wings": dict(fold=0.42, sweep=-18, flap=12), "head": dict(pos=(0, 1.16, 0.55), pitch=-30)},
    "bank": {"body": dict(roll=40), "wings": dict(curl=6)},
    "hover": {"body": dict(pos=(0, 0.80, -0.55), pitch=48), "wings": dict(flap=20, sweep=18, curl=10),
              "feet": dict(pos=(0.16, 0.18, -0.40), pitch=60), "head": dict(pos=(0, 1.50, 0.12), pitch=0)},
    "carry": {"feet": dict(pos=(0.08, 0.30, -0.30), pitch=95), "talons": 1.0},
    "stance": {"stance": True},
    "stance_open": {"stance": True, "wings": dict(fold=0.55, flap=25), "unplant": True},
    "call": {"stance": True, "head": dict(pos=(0, 1.48, 0.40), pitch=15), "beak": 1.0},
}

# What --checks measures: the folded wing in STANCE and in the air, and the seated rider's room through the flap,
# the head's turns and the stance.
CHECKS = {
    "stance": {"stance": True},
    "air_quarter_folded": {"wings": dict(fold=0.25)},
    "air_tucked": {"wings": dict(fold=0.5)},
    "landing_three_quarter_folded": {"body": dict(pitch=25), "wings": dict(fold=0.75)},
    "rest": {},
    "upstroke": POSES["upstroke"],
    "upstroke_45": {"wings": dict(flap=45)},
    "upstroke_40_elbow_25": {"wings": dict(flap=40), "bones": {"forearm": dict(roll=-25)}},
    "downstroke": POSES["downstroke"],
    "sweep_forward": {"wings": dict(flap=20, sweep=22)},
    "sweep_12": {"wings": dict(flap=20, sweep=12)},
    "head_left": {"head": dict(pos=(0.05, 1.32, 0.49), yaw=80)},
    "head_right": {"head": dict(pos=(-0.05, 1.32, 0.49), yaw=-80)},
    "head_up": {"head": dict(pos=(0, 1.38, 0.49), pitch=20)},
    "head_up_10": {"head": dict(pos=(0, 1.32, 0.51), pitch=10)},
    "head_up_15": {"head": dict(pos=(0, 1.36, 0.52), pitch=15)},
    "call_stance": {"stance": True, "head": dict(pos=(0, 1.48, 0.40), pitch=15), "beak": 1.0},
    "head_down": {"head": dict(pos=(0, 1.18, 0.57), pitch=-35)},
    "bite": {"head": dict(pos=(0, 1.06, 0.67), pitch=-45), "beak": 1.0},
}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts, i = {}, 0
    while i < len(argv):
        key = argv[i].lstrip("-")
        if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            opts[key] = argv[i + 1]
            i += 2
        else:
            opts[key] = True
            i += 1
    return opts


def run_scripts(names):
    """As tools/blender/build.py does: an empty scene at 30 frames a second, each script as __main__."""
    sys.dont_write_bytecode = True
    sys.path.insert(0, FOLDER)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    for name in names:
        runpy.run_path(os.path.join(FOLDER, name), run_name="__main__")
        print(f"preview: ran {name}")


def camera(name, location, look_at, up, ortho_scale=None, lens=None):
    data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    loc, target = Vector(location), Vector(look_at)
    forward = (target - loc).normalized()
    right = forward.cross(Vector(up)).normalized()
    true_up = right.cross(forward)
    cam.matrix_world = Matrix(((right.x, true_up.x, -forward.x, loc.x), (right.y, true_up.y, -forward.y, loc.y),
                               (right.z, true_up.z, -forward.z, loc.z), (0, 0, 0, 1)))
    if ortho_scale:
        data.type = "ORTHO"
        data.ortho_scale = ortho_scale
    else:
        data.lens = lens or 50
    data.clip_start, data.clip_end = 0.05, 60
    return cam


def cameras(rig):
    tb = rig.to_blender
    wide, square = WIDE[0] / PX_PER_M, SQUARE[0] / PX_PER_M
    plan_z = (860 - WIDE[1] / 2) / PX_PER_M  # z at the wide canvas's centre row, top and underside
    front_y = (1400 - WIDE[1] / 2) / PX_PER_M  # y at the wide canvas's centre row, front
    side_z = (900 - SQUARE[0] / 2) / PX_PER_M  # z at the square canvas's centre column (the beak points left)
    side_y = (1450 - SQUARE[1] / 2) / PX_PER_M
    return {
        "top": camera("cam_top", tb((0, 12, plan_z)), tb((0, 0, plan_z)), tb((0, 0, 1)), wide),
        "under": camera("cam_under", tb((0, -12, plan_z)), tb((0, 0, plan_z)), tb((0, 0, 1)), wide),
        "front_wide": camera("cam_front_wide", tb((0, front_y, 12)), tb((0, front_y, 0)), tb((0, 1, 0)), wide),
        "side": camera("cam_side", tb((12, side_y, side_z)), tb((0, side_y, side_z)), tb((0, 1, 0)), square),
        "front_square": camera("cam_front_square", tb((0, side_y, 12)), tb((0, side_y, 0)), tb((0, 1, 0)), square),
        # In flight, from a little below and in front of its left side.
        "three": camera("cam_three", tb((6.2, -1.6, 7.4)), tb((0.3, 0.9, -0.2)), tb((0, 1, 0)), lens=40),
        # Saddled, from above and behind its left side.
        "saddle_three": camera("cam_saddle_three", tb((3.4, 3.3, -3.6)), tb((0.0, 1.0, 0.1)), tb((0, 1, 0)), lens=45),
        "pose_side": camera("cam_pose_side", tb((12, 1.1, -0.1)), tb((0, 1.1, -0.1)), tb((0, 1, 0)), 4.6),
        "pose_three": camera("cam_pose_three", tb((2.6, 3.9, 6.4)), tb((0.0, 0.9, -0.2)), tb((0, 1, 0)), lens=32),
        # The folded wing on the ground, close, from behind its left shoulder.
        "fold_close": camera("cam_fold_close", tb((2.6, 1.6, -1.6)), tb((0.15, 0.75, -0.25)), tb((0, 1, 0)), lens=35),
    }


def setup():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    shading.show_cavity = False
    shading.show_backface_culling = False


def shoot(cam, path, size):
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def pose(rig, r, spec):
    """Sets a pose on frame 0 of a scratch action."""
    r.rest()
    c = rig.Clip(r, "_pose", 1)
    old = bpy.data.actions.get("_pose")
    if old is not None:
        bpy.data.actions.remove(old)
    c.action = bpy.data.actions.new("_pose")
    r.obj.animation_data.action = c.action
    if spec.get("stance"):
        c.stance(0)
    else:
        c.glide(0)
    if "body" in spec:
        b = dict(spec["body"])
        c.body(0, b.pop("pos", None) or (rig.STANCE["body"]["pos"] if spec.get("stance") else None), **b)
    if "head" in spec:
        c.head(0, **spec["head"])
    for side in "lr":
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
        if "talons" in spec:
            c.talons(0, side, spec["talons"])
        for bone, turn in spec.get("bones", {}).items():
            s = 1.0 if side == "l" else -1.0
            c.bone(0, f"{bone}_{side}", pitch=turn.get("pitch", 0.0), yaw=turn.get("yaw", 0.0) * s, roll=turn.get("roll", 0.0) * s)
    if "beak" in spec:
        c.beak(0, spec["beak"])
    bpy.context.scene.frame_set(0)


def rider_mesh(rig, r):
    """The seated rider as capsules, weighted to the chest so it follows the seat. Preview only."""
    r.rest()
    bm = bmesh.new()
    for a, b, rad in rig.rider_capsules(r):
        d = b - a
        n = max(2, int(d.length / 0.04))
        rig._loft(bm, [a + d * (k / n) for k in range(n + 1)], [(rad, rad, rad)] * (n + 1), ring=12, sub=1)
        for end in (a, b):
            rig._ellipsoid(bm, rig.to_animal(end), (0, 0, 1), rad, rad, rad, ring=10, rows=6)
    mesh = bpy.data.meshes.new("rider")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("rider", mesh)
    bpy.context.scene.collection.objects.link(obj)
    m = bpy.data.materials.new("rider")
    m.diffuse_color = rig._srgb("8A6E55")
    mesh.materials.append(m)
    g = obj.vertex_groups.new(name="chest")
    g.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    r.bind(obj)
    for p in mesh.polygons:
        p.use_smooth = True
    return obj


def mesh_tris(obj, parts=None):
    """World-space triangles of the evaluated object, optionally only of the named block-out parts."""
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = ev.to_mesh()
    names = obj.get("parts", [])
    layer = m.attributes.get("part")
    attached = m.attributes.get("attached")
    keep = None if parts is None else {i for i, n in enumerate(names) if n in parts}
    verts = [obj.matrix_world @ v.co for v in m.vertices]
    tris = []
    m.calc_loop_triangles()
    for t in m.loop_triangles:
        if keep is not None and layer.data[t.polygon_index].value not in keep:
            continue
        if attached is not None and attached.data[t.polygon_index].value:
            continue  # grown onto the body: the wing's root, the front membrane's shoulder end
        tris.append(tuple(t.vertices))
    ev.to_mesh_clear()
    return verts, tris


def overlap(obj, parts_a, parts_b, same=False):
    """Pairs of intersecting triangles between two sets of parts; for one set against itself, pairs that share no
    corner and lie apart in the grid (the slab's two faces never cross)."""
    va, ta = mesh_tris(obj, parts_a)
    vb, tb_ = mesh_tris(obj, parts_b) if not same else (va, ta)
    if not ta or not tb_:
        return 0
    a = BVHTree.FromPolygons(va, ta, epsilon=0.0)
    b = a if same else BVHTree.FromPolygons(vb, tb_, epsilon=0.0)
    pairs = a.overlap(b)
    if same:
        pairs = [(i, j) for i, j in pairs if i < j and not set(ta[i]) & set(ta[j]) and min((va[x] - va[y]).length for x in ta[i] for y in ta[j]) > 0.02]
    return len(pairs)


def main():
    opts = args()
    run_scripts(["rig.py"])
    import rig  # after run_scripts put the asset's folder on the path

    r = rig.find()
    out = opts.get("out")
    saddle = rig.build_saddle(r.obj) if ("saddle" in opts or "guides" in opts) else None
    if out:
        os.makedirs(out, exist_ok=True)
        setup()
        cams = cameras(rig)
        if "views" in opts:
            if saddle:
                saddle.hide_render = True
            for view, (canvas, which, cam) in VIEWS.items():
                pose(rig, r, {"stance": True} if which == "stance" else {})
                shoot(cams[cam], os.path.join(out, f"blockout_{view}.png"), canvas)
        if "guides" in opts:
            rider = rider_mesh(rig, r)
            for view, (canvas, which, cam) in VIEWS.items():
                rider.hide_render = saddle.hide_render = True
                pose(rig, r, {"stance": True} if which == "stance" else {})
                shoot(cams[cam], os.path.join(out, f"guide_{view}.png"), canvas)
                if view in ("side", "folded_side", "top"):
                    rider.hide_render = saddle.hide_render = False
                    shoot(cams[cam], os.path.join(out, f"guide_saddled_{view}.png"), canvas)
            rider.hide_render = saddle.hide_render = True
            pose(rig, r, {"body": dict(roll=-18, pitch=4), "wings": dict(flap=8, curl=6),
                          "feet": dict(pos=(0.17, 0.28, -0.62), pitch=55)})
            shoot(cams["three"], os.path.join(out, "guide_three_quarter.png"), (1600, 1200))
            rider.hide_render = saddle.hide_render = False
            shoot(cams["saddle_three"], os.path.join(out, "guide_saddled_three_quarter.png"), (1600, 1200))
            rider.hide_render = True
            pose(rig, r, {"stance": True})
            shoot(cams["saddle_three"], os.path.join(out, "guide_saddle_detail.png"), (1600, 1200))
        if "poses" in opts:
            for name, spec in POSES.items():
                pose(rig, r, spec)
                shoot(cams["pose_side"], os.path.join(out, f"pose_{name}_side.png"), (900, 900))
                shoot(cams["pose_three"], os.path.join(out, f"pose_{name}_three.png"), (900, 900))
                if spec.get("stance"):
                    shoot(cams["fold_close"], os.path.join(out, f"pose_{name}_close.png"), (900, 900))
        r.rest()
    if "checks" in opts:
        body = r.blockout
        solid = ["body", "neck", "head", "jaw", "crest", "tail", "thigh_l", "shin_l", "thigh_r", "shin_r"]
        report = {}
        for name, spec in CHECKS.items():
            pose(rig, r, spec)
            row = {}
            for side in "lr":
                wing = [f"membrane_{side}", f"front_{side}"]
                bones = [f"{n}_{side}" for n in ("forearm", "hand", "wing_1", "wing_2", "wing_3", "wing_4")]
                row[f"membrane_{side}_into_body"] = overlap(body, wing, solid)
                row[f"finger_{side}_into_body"] = overlap(body, bones, solid)
                row[f"membrane_{side}_self"] = overlap(body, [f"membrane_{side}"], None, same=True)
            row["wings_into_each_other"] = overlap(body, ["membrane_l", "front_l"] + [f"{n}_l" for n in ("forearm", "hand", "wing_1", "wing_2", "wing_3", "wing_4")],
                                                   ["membrane_r", "front_r"] + [f"{n}_r" for n in ("forearm", "hand", "wing_1", "wing_2", "wing_3", "wing_4")])
            depth, part = rig.rider_intrusion(r, body)
            row["rider_intrusion_cm"] = round(depth * 100, 1)
            row["rider_intrusion_part"] = part
            seat = r.socket("seat")
            row["seat"] = [round(x, 3) for x in seat]
            report[name] = row
            print(f"preview: check {name}: {row}")
        r.rest()
        path = os.path.join(out or HERE, "checks.json")
        with open(path, "w") as fh:
            json.dump(report, fh, indent=1)
        print("preview: wrote", path)
    if "blend" in opts:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opts["blend"]), check_existing=False)


main()
