# Builds one asset from the Blender scripts in its folder and writes what they
# made as glTF binary. It does nothing else: everything that decides how the
# game sees the model is done afterwards in TypeScript, where it can be tested.
#
#   blender --background --factory-startup --disable-autoexec \
#       --python tools/blender/build.py -- job.json
#
# The job names the asset's folder, its scripts in the order to run them, and
# what to write:
#
#   {"folder": "...", "scripts": ["rig.py", "model.py"], "out": "model.glb"}
#   {"folder": "...", "scripts": ["model.py"], "pieces": {"wall": "wall.glb"}}
#
# The scene starts empty, at 30 frames a second: a frame is a tick. Each script
# runs top to bottom as "__main__" and finds the scene as the one before left
# it. A script may import any module in the asset's folder, which is how
# scripts share numbers.
#
# With "out", the whole scene is written: one armature, the meshes skinned to
# it, and every action as an animation of its own, named as the action is and
# sampled at every frame. With "pieces", each named object is written to its
# own file together with its "<name>_LOD<n>" objects. Modifiers other than the
# armature are applied as the file is written.

import json
import os
import re
import runpy
import sys

import bpy

with open(sys.argv[sys.argv.index("--") + 1]) as f:
    job = json.load(f)
folder = job["folder"]

# Nothing is left behind in the asset's folder.
sys.dont_write_bytecode = True
sys.path.insert(0, folder)

bpy.ops.wm.read_factory_settings(use_empty=True)
# A frame is a tick of the game.
bpy.context.scene.render.fps = 30
for script in job["scripts"]:
    runpy.run_path(os.path.join(folder, script), run_name="__main__")
    print(f"build: ran {script}")

# Tangents are written wherever a mesh has texture coordinates. A vertex on the
# seam of a mirrored half is then written twice, once for each side, which is
# what lets each side be lit its own way.
common = dict(
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_tangents=True,
    export_materials="EXPORT",
    export_image_format="NONE",
)

if "out" in job:
    # One track for each action, so that the exporter writes each as an animation.
    for obj in bpy.context.scene.objects:
        if obj.type != "ARMATURE":
            continue
        if obj.animation_data is None:
            obj.animation_data_create()
        obj.animation_data.action = None
        for action in sorted(bpy.data.actions, key=lambda a: a.name):
            track = obj.animation_data.nla_tracks.new()
            track.name = action.name
            track.strips.new(track.name, int(action.frame_range[0]), action)
    bpy.ops.export_scene.gltf(
        filepath=job["out"],
        export_skins=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        **common,
    )
    print(f"build: wrote {job['out']}")

for name, out in job.get("pieces", {}).items():
    level = re.compile(re.escape(name) + r"(_LOD\d)?$")
    found = [o for o in bpy.context.scene.objects if o.type == "MESH" and level.match(o.name)]
    if not found:
        raise SystemExit(f"build: no mesh object named {name}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in found:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        use_selection=True,
        export_animations=False,
        **common,
    )
    print(f"build: wrote {out}")

print("build: done")
