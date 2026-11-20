# A contact sheet of the built Rex: each clip at evenly spaced moments, from the side and from the front quarter, in
# plain clay so tears and folds in the skin show. Runs the asset's own build scripts first.
#   blender -b --factory-startup --python-exit-code 1 -P sheet.py -- OUT.png [clip,clip,...] [moments]

import math
import os
import runpy
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(HERE)
args = sys.argv[sys.argv.index("--") + 1:]
out = os.path.abspath(args[0])
wanted = args[1].split(",") if len(args) > 1 and args[1] else None
moments = int(args[2]) if len(args) > 2 else 6

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
sys.path.insert(0, FOLDER)
sys.dont_write_bytecode = True
for script in ("import.py", "gaits.py", "clips.py"):
    if os.path.exists(os.path.join(FOLDER, script)):
        runpy.run_path(os.path.join(FOLDER, script), run_name="__main__")

rig = next(o for o in scene.objects if o.type == "ARMATURE")
meshes = [o for o in scene.objects if o.type == "MESH"]
clay = bpy.data.materials.new("clay")
clay.diffuse_color = (0.72, 0.62, 0.5, 1)
for m in meshes:
    m.data.materials.clear()
    m.data.materials.append(clay)

scene.render.engine = "BLENDER_WORKBENCH"
shading = scene.display.shading
shading.light, shading.color_type, shading.show_cavity = "STUDIO", "MATERIAL", True
shading.cavity_type, shading.show_shadows = "BOTH", False
scene.render.resolution_x, scene.render.resolution_y = 480, 360
scene.render.image_settings.file_format = "PNG"
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
ground = bpy.data.objects.new("ground", bpy.data.meshes.new("ground"))
ground.data.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
grey = bpy.data.materials.new("ground")
grey.diffuse_color = (0.3, 0.33, 0.3, 1)
ground.data.materials.append(grey)
scene.collection.objects.link(ground)

# The Rex faces -Y in Blender. Side looks from +X; the quarter from front-right and a little above. With "head" the
# cameras follow the skull, close up, from the side and from the front quarter.
head = len(args) > 3 and args[3] == "head"
VIEWS = ([((5, 0, 0.3), (math.radians(90), 0, math.radians(90)), 4.2),
          ((3.2, -3.6, 1.2), (math.radians(75), 0, math.radians(42)), 4.2)] if head else
         [((16, 0, 3), (math.radians(90), 0, math.radians(90)), 15),
          ((10, -11, 6.5), (math.radians(70), 0, math.radians(42)), 15)])
from mathutils import Vector

actions = [a for a in sorted(bpy.data.actions, key=lambda a: a.name) if not wanted or a.name in wanted]
tile_w, tile_h = scene.render.resolution_x, scene.render.resolution_y
rows = len(actions) * len(VIEWS)
sheet = np.zeros((rows * tile_h, moments * tile_w, 4), dtype=np.float32)
tmp = os.path.join(os.path.dirname(out), "_tile.png")
for ai, action in enumerate(actions):
    rig.animation_data_create()
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]
    start, end = action.frame_range
    for vi, (loc, rot, scale) in enumerate(VIEWS):
        cam.rotation_euler, cam_data.ortho_scale = rot, scale
        for k in range(moments):
            frame = start + (end - start) * k / max(1, moments - 1 if action.name not in ("idle", "walk", "run") else moments)
            scene.frame_set(int(frame), subframe=frame % 1)
            # The middle of the head: halfway from the skull joint to the end of the jaw.
            bones = rig.pose.bones
            skull = rig.matrix_world @ ((bones["skull"].head + bones["jaw"].tail) / 2) if head else Vector()
            cam.location = Vector(loc) + skull
            scene.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(tmp)
            px = np.empty(tile_w * tile_h * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            bpy.data.images.remove(img)
            row = ai * len(VIEWS) + vi
            # Blender's pixel rows run bottom to top; the sheet is filled top to bottom.
            y0 = (rows - 1 - row) * tile_h
            sheet[y0:y0 + tile_h, k * tile_w:(k + 1) * tile_w] = px.reshape(tile_h, tile_w, 4)
    print(f"sheet: {action.name} {start:.0f}-{end:.0f}")
os.remove(tmp)
image = bpy.data.images.new("sheet", moments * tile_w, rows * tile_h, alpha=True)
image.pixels.foreach_set(sheet.ravel())
image.filepath_raw = out
image.file_format = "PNG"
image.save()
print(f"sheet: wrote {out}, rows {[a.name for a in actions]}")
