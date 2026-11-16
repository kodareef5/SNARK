# Bakes what tex/paint.py paints from: the boat built as `bun run art` builds it, each material's triangles on its
# picture (where each texel is on the car, which way it faces and what it is), and the light the car hides from
# itself. Run it after the model's layout changes, then paint.py:
#
#   blender --background --factory-startup --python tex/bake.py
#
# It writes tex/layout.json (the layout the pictures are painted for, which model.py checks on every build),
# tex/bakes/<material>.npz and tex/bakes/<material>_occlusion.png.

import json
import os
import runpy
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(HERE)
OUT = os.path.join(HERE, "bakes")
os.makedirs(OUT, exist_ok=True)
os.environ["BOAT_LAYOUT"] = "new"
sys.dont_write_bytecode = True
sys.path.insert(0, FOLDER)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
runpy.run_path(os.path.join(FOLDER, "rig.py"), run_name="__main__")
SIZES = runpy.run_path(os.path.join(FOLDER, "model.py"), run_name="__main__")["SIZES"]

from parts import MATERIALS, layout_hash  # noqa: E402

objects = [o for o in bpy.data.objects if o.type == "MESH"]
bones = [o.name for o in objects]

# Each material's triangles: corners on the picture (u across, v down, 0 to 1), on the car in the engine's frame, their
# normals, and each triangle's tag and part.
for m, name in enumerate(MATERIALS):
    uv, pos, nrm, tag, part = [], [], [], [], []
    for k, o in enumerate(objects):
        me = o.data
        me.calc_loop_triangles()
        uvs = me.uv_layers.active.data
        tags = me.attributes["tag"].data
        normals = me.corner_normals
        for t in me.loop_triangles:
            if t.material_index != m:
                continue
            uv.append([(uvs[l].uv[0], 1 - uvs[l].uv[1]) for l in t.loops])
            # Blender's frame back to the engine's: x, z, -y.
            pos.append([(me.vertices[v].co.x, me.vertices[v].co.z, -me.vertices[v].co.y) for v in t.vertices])
            nrm.append([(normals[l].vector.x, normals[l].vector.z, -normals[l].vector.y) for l in t.loops])
            tag.append(tags[t.polygon_index].value)
            part.append(k)
    np.savez_compressed(os.path.join(OUT, f"{name}.npz"), uv=np.array(uv, np.float32), pos=np.array(pos, np.float32),
                        nrm=np.array(nrm, np.float32), tag=np.array(tag, np.int16), part=np.array(part, np.int16),
                        parts=np.array(bones), size=SIZES[name])
    print(f"bake: {name}, {len(tag)} triangles")

# Occlusion: what each texel sees of the open sky within 0.7 m, the boat's every part in place.
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 32
scene.world = bpy.data.worlds.new("sky")
scene.world.light_settings.distance = 0.7
images = {}
for name in MATERIALS:
    mat = bpy.data.materials[name]
    mat.use_nodes = True
    size = SIZES[name]
    img = bpy.data.images.new(f"{name}_occlusion", size, size, alpha=False, float_buffer=True)
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    mat.node_tree.nodes.active = node
    images[name] = img
for o in objects:
    o.modifiers.clear()
    o.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.bake(type="AO", margin=16, margin_type="EXTEND")
for name, img in images.items():
    img.filepath_raw = os.path.join(OUT, f"{name}_occlusion.png")
    img.file_format = "PNG"
    scene.render.image_settings.color_depth = "16"
    scene.render.image_settings.color_mode = "BW"
    img.save_render(img.filepath_raw, scene=scene)
    print(f"bake: {name}_occlusion.png")

with open(os.path.join(HERE, "layout.json"), "w") as f:
    json.dump({"about": "The layout tex/ is painted for, written by tex/bake.py and checked by model.py on every build.", "hash": layout_hash(objects)}, f)
    f.write("\n")
print("bake: done")
