# Renders the new and old Rex with the same orthographic cameras and measures both: length, height, width, and the
# skin's top, bottom and width every 5% along the body. Writes PNGs and measure.json to OUTDIR.
#   blender -b --factory-startup --python-exit-code 1 -P compare.py -- NEW.glb OLD.obj OUTDIR
# Make OLD.obj with pack-obj.ts.
import json
import math
import sys

import bpy
from mathutils import Vector

new_path, old_path, out = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

bpy.ops.import_scene.gltf(filepath=new_path)
arm = next(o for o in scene.objects if o.type == "ARMATURE")
new = next(o for o in scene.objects if o.type == "MESH")
print("armature", arm.name, "bones", len(arm.data.bones), "mesh", new.name, "fps", scene.render.fps)
print("actions", [(a.name, tuple(a.frame_range)) for a in bpy.data.actions])
print("jaw head (world)", tuple(round(v, 3) for v in arm.matrix_world @ arm.data.bones["jaw"].head_local))
print("pelvis head (world)", tuple(round(v, 3) for v in arm.matrix_world @ arm.data.bones["pelvis"].head_local))

bpy.ops.wm.obj_import(filepath=old_path)
old = [o for o in scene.objects if o.type == "MESH" and o is not new][0]


def verts(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return pts


def measure(pts, name):
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    # Forward is the end of the long axis where the jaw is; both face -Y here (glTF/OBJ +Z maps to Blender -Y).
    lo, hi = min(ys), max(ys)
    length = hi - lo
    report = {"name": name, "length": length, "height": max(zs) - min(zs), "width": max(xs) - min(xs), "y_min": lo, "y_max": hi}
    # Slices along the body: top, bottom and width of the skin, every 5% of the length.
    slices = []
    for i in range(21):
        y0 = lo + length * i / 20
        band = [p for p in pts if abs(p.y - y0) < length * 0.0125]
        if not band:
            slices.append(None)
            continue
        slices.append({"at": round(i / 20, 2), "top": round(max(p.z for p in band), 3), "bottom": round(min(p.z for p in band), 3),
                       "width": round(max(p.x for p in band) - min(p.x for p in band), 3)})
    report["slices"] = slices
    return report


# Both in their rest pose. The glTF importer leaves an action on the armature, so clear it first.
arm.animation_data.action = None
for b in arm.pose.bones:
    b.matrix_basis.identity()
scene.frame_set(0)
new_m = measure(verts(new), "new rest")
old_m = measure(verts(old), "old rest")
json.dump([new_m, old_m], open(f"{out}/measure.json", "w"), indent=1)
for r in (new_m, old_m):
    print(r["name"], "length %.2f height %.2f width %.2f" % (r["length"], r["height"], r["width"]))

# Materials: flat colours so silhouettes read.
def flat(obj, rgba):
    m = bpy.data.materials.new(obj.name + "_flat")
    m.diffuse_color = rgba
    obj.data.materials.clear()
    obj.data.materials.append(m)

flat(new, (0.85, 0.45, 0.2, 1))
flat(old, (0.25, 0.5, 0.9, 1))

scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
scene.display.shading.show_shadows = False
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w")
scene.display.shading.background_type = "VIEWPORT"
scene.render.resolution_x, scene.render.resolution_y = 1800, 900
scene.render.image_settings.file_format = "PNG"

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def shot(name, loc, rot, scale, shown):
    for o in (new, old):
        o.hide_render = o not in shown
    cam.location = loc
    cam.rotation_euler = rot
    cam_data.ortho_scale = scale
    scene.render.filepath = f"{out}/{name}.png"
    bpy.ops.render.render(write_still=True)

side = (math.radians(90), 0, math.radians(90))
shot("side-new", (14, 0, 2.6), side, 14, [new])
shot("side-old", (14, 0, 2.6), side, 14, [old])
# The old one moves aside so one camera sees both.
old.location.x = 4.5
shot("front-both", (2.25, -20, 3), (math.radians(90), 0, 0), 12, [new, old])
shot("top-both", (2.25, 0, 30), (0, 0, 0), 14, [new, old])
shot("quarter-both", (16, -14, 9), (math.radians(68), 0, math.radians(48)), 20, [new, old])
print("compare: done")
