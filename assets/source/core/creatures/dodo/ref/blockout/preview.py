"""Looks at the dodo: runs its scripts as the build does, then renders. Not one of the asset's scripts.

    blender --background --factory-startup --disable-autoexec --python ref/blockout/preview.py -- \
        --out DIR [--scripts rig.py,clips_move.py] [--views] [--poses] [--clips walk,run] [--count 6] [--blend F]

--views    the four views on the concept's canvas (blockout_<view>.png), for compare.py
--poses    POSES below from the side and a three-quarter front view (pose_<name>_<view>.png)
--clips    `count` evenly spaced frames of each named clip from the side and three-quarter front
--blend    saves the scene

It always says whether asset.ts agrees with rig.py on the numbers both hold.
"""

import math
import os
import re
import runpy
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))

# The concept views' canvas, so renders lay over them: 1500 px a metre, ground at row 1150.
CANVAS = 1254
PX_PER_M = 1500.0
GROUND_ROW = 1150
SIDE_FEET_COLUMN = 640
TOP_FEET_ROW = 690

# Poses that show the rig can do what the clips ask, made with the animators' helpers.
POSES = {
    "standing": {},
    "peck": {"body": dict(pos=(0, 0.28, -0.02), pitch=-14), "head": dict(pos=(0, 0.47, 0.25), pitch=-32), "beak": 0.35,
             "neck": {"neck_1": dict(pitch=-8), "neck_2": dict(pitch=-6)}},
    "ground_peck": {"body": dict(pos=(0, 0.25, -0.03), pitch=-32), "head": dict(pos=(0, 0.15, 0.30), pitch=-75), "beak": 0.2,
                    "neck": {"neck_1": dict(pitch=-20), "neck_2": dict(pitch=-15), "neck_3": dict(pitch=-10)}},
    "startled": {"body": dict(pos=(0, 0.31, -0.03), pitch=10), "head": dict(pos=(0, 0.60, 0.10), pitch=38), "beak": 1.0,
                 "wings": dict(out=1.0, flap=8), "hood": 1.0, "tail": dict(lift=20), "throat": 0.5},
    "lying": {"body": dict(pos=(0.0, 0.150, -0.03), roll=82, pitch=-4), "head": dict(pos=(0.22, 0.07, 0.19), roll=75, pitch=-15),
              "feet": {"l": dict(pos=(-0.19, 0.05, 0.07), roll=80, pitch=-35), "r": dict(pos=(-0.17, 0.17, 0.04), roll=80, pitch=-35)},
              "knees": {"l": (-0.10, 0.02, -0.25), "r": (-0.10, 0.20, -0.25)}, "eyes": 1.0,
              "neck": {"neck_1": dict(roll=20), "neck_2": dict(roll=20)}},
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


def asset_regions():
    """Each region's material and dye as asset.ts gives them, read by Bun: the dyes come from the content's colour set,
    worked out when it loads. None without Bun."""
    import json
    import shutil
    import subprocess

    bun = shutil.which("bun")
    if bun is None:
        return None
    path = os.path.join(FOLDER, "asset.ts")
    code = f'const a = (await import({json.dumps(path)})).default; console.log(JSON.stringify(a.regions.map((r) => [r.material, r.sample])));'
    said = subprocess.run([bun, "-e", code], capture_output=True, text=True, cwd=FOLDER)
    if said.returncode != 0:
        raise RuntimeError(f"preview: Bun could not read asset.ts:\n{said.stderr[-800:]}")
    return [tuple(x) for x in json.loads(said.stdout.strip().splitlines()[-1])]


def agree(rig):
    """Says where asset.ts and rig.py disagree on the numbers both hold."""
    text = open(os.path.join(FOLDER, "asset.ts")).read()
    out = []
    gaits = {k: float(v) for k, v in re.findall(r"(\w+): \{ stride: ([\d.]+) \}", text)}
    if gaits != rig.STRIDE:
        out.append(f"strides: asset.ts {gaits}, rig.py {rig.STRIDE}")
    tri = [int(x) for x in re.search(r"triangles: \[([\d, ]+)\]", text).group(1).split(",")]
    if tri != rig.TRIANGLES:
        out.append(f"triangles: asset.ts {tri}, rig.py {rig.TRIANGLES}")
    if int(re.search(r"\bflat: (\d+)", text).group(1)) != rig.FLAT_FROM:
        out.append("flat level differs")
    top = max(m["size"] for m in rig.MATERIALS.values())
    budget = re.search(r"texture: \{ top: (\d+), megabytes: (\d+) \}", text)
    if (int(budget.group(1)), int(budget.group(2))) != (top, rig.TEXTURE_MEGABYTES):
        out.append(f"texture budget: asset.ts {budget.group(0)}, rig.py top {top}, megabytes {rig.TEXTURE_MEGABYTES}")
    for name, m in rig.MATERIALS.items():
        block = re.search(name + r": \{([^}]*)\}", text)
        if block is None:
            out.append(f"material {name}: missing from asset.ts")
        elif ("twoSided: true" in block.group(1)) != m["two_sided"] or ("cutout: true" in block.group(1)) != m["cutout"]:
            out.append(f"material {name}: two-sided or cutout differs")
    joints = {b[0]: b[2] for b in rig.all_bones()}
    sockets = {n: (b, [float(x) for x in o.split(",")]) for n, b, o in re.findall(r'\{ name: "(\w+)", bone: "(\w+)", offset: \[([-\d., ]+)\] \}', text)}
    for name, (bone, pos) in rig.SOCKETS.items():
        want = [round(pos[k] - joints[bone][k], 4) for k in range(3)]
        got = sockets.get(name)
        if got is None or got[0] != bone or max(abs(a - b) for a, b in zip(got[1], want)) > 5e-4:
            out.append(f'socket {name}: asset.ts {got}, rig.py ("{bone}", {want})')
    clips = {n: l == "true" for n, s, l in re.findall(r'\{ name: "(\w+)", source: "(\w+)", loop: (true|false) \}', text)}
    for name, spec in rig.CLIPS.items():
        if name not in clips and not spec.get("optional"):
            out.append(f"clip {name}: missing from asset.ts")
        elif name in clips and clips[name] != spec["loop"]:
            out.append(f"clip {name}: loop differs")
    want = list(zip(rig.REGION_MATERIALS, rig.REGION_DEFAULT))
    regions = asset_regions()
    if regions is None:
        # Without Bun the dyes cannot be read (the content works them out), so only the materials are compared.
        names = re.findall(r'\{ name: "[^"]+", material: "(\w+)", sample: [^}]+\}', text)
        if names != rig.REGION_MATERIALS:
            out.append(f"region materials: asset.ts {names}, rig.py {rig.REGION_MATERIALS}")
        print("preview: Bun was not found, so the regions' dyes were not compared")
    elif regions != want:
        out.append(f"regions: asset.ts {regions}, rig.py {want}")
    print("preview: asset.ts agrees with rig.py" if not out else "preview: asset.ts DISAGREES with rig.py:\n  " + "\n  ".join(out))
    return out


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
    data.clip_start, data.clip_end = 0.01, 20
    return cam


def cameras(rig):
    tb = rig.to_blender
    half = CANVAS / 2.0
    up = (GROUND_ROW - half) / PX_PER_M  # bird height at the image centre
    scale = CANVAS / PX_PER_M
    side_z = (SIDE_FEET_COLUMN - half) / PX_PER_M  # bird forward at the image centre (the beak points left)
    top_z = (TOP_FEET_ROW - half) / PX_PER_M
    return {
        "side": camera("cam_side", tb((3, up, side_z)), tb((0, up, side_z)), (0, 0, 1), scale),
        "front": camera("cam_front", tb((0, up, 3)), tb((0, up, 0)), (0, 0, 1), scale),
        "back": camera("cam_back", tb((0, up, -3)), tb((0, up, 0)), (0, 0, 1), scale),
        "top": camera("cam_top", tb((0, 3, top_z)), tb((0, 0, top_z)), tb((0, 0, 1)), scale),
        "three": camera("cam_three", tb((1.25, 0.75, 1.55)), tb((0, 0.33, 0.04)), (0, 0, 1), lens=60),
        # Wider than the concept canvas, for poses that reach past it: a head thrown up, a beak at the ground.
        "pose": camera("cam_pose", tb((3, 0.38, 0.05)), tb((0, 0.38, 0.05)), (0, 0, 1), 1.0),
    }


def setup(size):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    shading.show_cavity = False


def shoot(cam, path, size):
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def pose(rig, r, name):
    """Sets one of POSES on frame 0 of a scratch action."""
    spec = POSES[name]
    r.rest()
    c = rig.Clip(r, "_pose_" + name, 1)
    c.action = bpy.data.actions.new("_pose_" + name)
    r.obj.animation_data.action = c.action
    if "body" in spec:
        c.body(0, **spec["body"])
    if "head" in spec:
        c.head(0, **spec["head"])
    for bone, rot in spec.get("neck", {}).items():
        c.bone(0, bone, **rot)
    for side, f in spec.get("feet", {}).items():
        c.foot(0, side, **f)
    for side, p in spec.get("knees", {}).items():
        c.knee(0, side, p)
    if "beak" in spec:
        c.beak(0, spec["beak"])
    for side in "lr" if "wings" in spec else "":
        c.wing(0, side, **spec["wings"])
    if "hood" in spec:
        c.hood(0, spec["hood"])
    if "tail" in spec:
        c.tail(0, **spec["tail"])
    if "throat" in spec:
        c.throat(0, spec["throat"])
    if "eyes" in spec:
        c.eyes(0, spec["eyes"])
    bpy.context.scene.frame_set(0)


def main():
    opts = args()
    scripts = str(opts.get("scripts", "rig.py")).split(",")
    run_scripts(scripts)
    import rig  # after run_scripts put the asset's folder on the path

    r = rig.find()
    agree(rig)
    out = opts.get("out")
    if out:
        os.makedirs(out, exist_ok=True)
        setup(CANVAS)
        cams = cameras(rig)
        if "views" in opts:
            r.rest()
            for view in ("side", "front", "back", "top"):
                shoot(cams[view], os.path.join(out, f"blockout_{view}.png"), CANVAS)
        if "poses" in opts:
            for name in POSES:
                pose(rig, r, name)
                shoot(cams["pose"], os.path.join(out, f"pose_{name}_side.png"), 900)
                shoot(cams["three"], os.path.join(out, f"pose_{name}_three.png"), 900)
        count = int(opts.get("count", 6))
        for name in str(opts.get("clips", "")).split(","):
            if not name:
                continue
            action = bpy.data.actions[name]
            r.rest()
            r.obj.animation_data.action = action
            if action.slots:
                r.obj.animation_data.action_slot = action.slots[0]
            last = int(action.frame_range[1])
            for k in range(count):
                f = round(k * last / max(1, count - 1))
                bpy.context.scene.frame_set(f)
                shoot(cams["side"], os.path.join(out, f"{name}_side_{f:03d}.png"), 900)
                shoot(cams["three"], os.path.join(out, f"{name}_three_{f:03d}.png"), 900)
        r.rest()
    if "blend" in opts:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opts["blend"]), check_existing=False)


main()
