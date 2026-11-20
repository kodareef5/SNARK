# How a lying clip rests on the ground: for each bone, the lowest skin point among the vertices it moves most, at
# chosen frames. A part lying on the ground reads near 0; one held in the air reads high.
#   blender -b --factory-startup --python-exit-code 1 -P rest.py -- clip frame[,frame...]

import os
import runpy
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
name, frames = args[0], [int(f) for f in args[1].split(",")]
folder = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
sys.path.insert(0, folder)
sys.dont_write_bytecode = True
for script in ("import.py", "gaits.py", "clips.py"):
    runpy.run_path(os.path.join(folder, script), run_name="__main__")
rig = next(o for o in scene.objects if o.type == "ARMATURE")
body = next(o for o in scene.objects if o.type == "MESH")
# Each vertex's strongest bone.
groups = {g.index: g.name for g in body.vertex_groups}
owner = []
for v in body.data.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    owner.append(groups[best.group] if best else "")
owner = np.array(owner)
for pb in rig.pose.bones:
    pb.scale = (1, 1, 1)
action = bpy.data.actions[name]
rig.animation_data_create()
rig.animation_data.action = action
rig.animation_data.action_slot = action.slots[0]
for f in frames:
    scene.frame_set(f)
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = ev.to_mesh()
    co = np.empty(len(mesh.vertices) * 3, np.float32)
    mesh.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    z = co[2::3]
    parts = {b: float(z[owner == b].min()) for b in sorted(set(owner)) if b}
    print(f"{name} {f}: lowest {z.min():.3f} m; " + ", ".join(f"{b} {h:.2f}" for b, h in parts.items()))
