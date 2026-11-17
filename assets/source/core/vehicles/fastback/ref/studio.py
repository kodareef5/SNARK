"""Render the actual skinned master, source textures and sample dyes. Pass an output directory after --."""

import runpy
import sys
from pathlib import Path
import bpy
from mathutils import Vector

folder = Path(__file__).resolve().parents[1]
out = Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else Path(__file__).parent
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sys.path.insert(0, str(folder))
runpy.run_path(str(folder / "model.py"), run_name="__main__")


def linear(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


for name in ("enamel", "detail"):
    m = bpy.data.materials[name]
    m.use_nodes = True
    t = m.node_tree
    shader = t.nodes.get("Principled BSDF")

    def picture(file, data=False):
        node = t.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(folder / "tex" / (file + ".png")))
        if data:
            node.image.colorspace_settings.name = "Non-Color"
        return node

    base = picture(name)
    mask = picture(name + "_mask", True)
    orm = picture(name + "_orm", True)
    channels = t.nodes.new("ShaderNodeSeparateColor")
    t.links.new(mask.outputs["Color"], channels.inputs[0])
    tint = None
    for color, wire in (((218, 43, 43), "Red"), ((150, 98, 66), "Green"), ((174, 183, 193), "Blue")):
        mix = t.nodes.new("ShaderNodeMixRGB")
        if tint is not None:
            t.links.new(tint, mix.inputs[1])
        else:
            mix.inputs[1].default_value = (1, 1, 1, 1)
        mix.inputs[2].default_value = tuple(linear(c) for c in color) + (1,)
        t.links.new(channels.outputs[wire], mix.inputs[0])
        tint = mix.outputs[0]
    multiply = t.nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1
    t.links.new(base.outputs["Color"], multiply.inputs[1])
    t.links.new(tint, multiply.inputs[2])
    t.links.new(multiply.outputs[0], shader.inputs["Base Color"])
    t.links.new(base.outputs["Alpha"], shader.inputs["Alpha"])
    pack = t.nodes.new("ShaderNodeSeparateColor")
    t.links.new(orm.outputs["Color"], pack.inputs[0])
    t.links.new(pack.outputs["Green"], shader.inputs["Roughness"])
    t.links.new(pack.outputs["Blue"], shader.inputs["Metallic"])
    if name == "enamel":
        shader.inputs["Coat Weight"].default_value = 0.34
        shader.inputs["Coat Roughness"].default_value = 0.19

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.world = bpy.data.worlds.new("Neutral cyclorama")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.50, 0.57, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.44
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.003))
floor = bpy.context.object
m = bpy.data.materials.new("Cyclorama")
m.use_nodes = True
pr = m.node_tree.nodes.get("Principled BSDF")
pr.inputs["Base Color"].default_value = (0.21, 0.225, 0.233, 1)
pr.inputs["Roughness"].default_value = 0.68
floor.data.materials.append(m)
for loc, pow, w, h, c in [
    ((3, -3, 6), 550, 5, 2, (1, 0.92, 0.85)),
    ((-3, -1, 4), 620, 6, 1.35, (0.76, 0.84, 1)),
    ((2, 5, 4), 770, 5, 1, (1, 0.93, 0.82)),
    ((-4, 2, 1.9), 150, 4, 1.6, (0.83, 0.92, 1)),
]:
    data = bpy.data.lights.new("Strip bank", "AREA")
    data.energy = pow
    data.shape = "RECTANGLE"
    data.size = w
    data.size_y = h
    data.color = c
    light = bpy.data.objects.new("Strip bank", data)
    scene.collection.objects.link(light)
    light.location = loc
    light.rotation_euler = (Vector((0, 0, 0.65)) - light.location).to_track_quat("-Z", "Y").to_euler()
camera_data = bpy.data.cameras.new("75 mm")
camera = bpy.data.objects.new("Studio camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.lens = 57
scene.render.resolution_x = 1056
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX"
for label, pos, target in (("front", (4.40, -5.80, 2.51), (0, -0.10, 0.70)), ("rear", (-4.15, 5.80, 2.48), (0, 0.09, 0.70))):
    camera.location = pos
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(out / f"studio-{label}.png")
    bpy.ops.render.render(write_still=True)
