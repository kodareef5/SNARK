# Review renders of the stone tools with their materials on, in Blender's light (sun, sky, shadows): each tool alone at
# a three-quarter view and close on its head, and the three lying together. Not part of the build.
#
#   blender --background --factory-startup --python render.py -- <out folder> [shot ...]

import math
import os
import runpy
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = args[0] if args else os.path.join(HERE, "ref", "renders")
WANT = set(args[1:])
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
runpy.run_path(os.path.join(HERE, "model.py"), run_name="__main__")
scene = bpy.context.scene
tools = {o.name: o for o in scene.objects}

# What each material's pictures are called under tex/ (stone and flint share one relief).
LAYERS = {
    "wood": ("wood/wood_base", "wood/wood_normal", "wood/wood_orm"),
    "lashing": ("lashing/lashing_base", "lashing/lashing_normal", "lashing/lashing_orm"),
    "stone": ("stone/stone_base", "stone/stone_normal", "stone/stone_orm"),
    "flint": ("stone/flint_base", "stone/stone_normal", "stone/flint_orm"),
}


def textured(m):
    base, normal, orm = (os.path.join(HERE, "tex", p + ".png") for p in LAYERS[m.name])
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])

    def image(path, data):
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(path, check_existing=True)
        node.image.colorspace_settings.name = "Non-Color" if data else "sRGB"
        node.interpolation = "Smart"
        return node

    b, o, n = image(base, False), image(orm, True), image(normal, True)
    split = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(o.outputs["Color"], split.inputs[0])
    ao = nt.nodes.new("ShaderNodeMix")
    ao.data_type = "RGBA"
    ao.blend_type = "MULTIPLY"
    ao.inputs["Factor"].default_value = 0.7
    nt.links.new(b.outputs["Color"], ao.inputs["A"])
    nt.links.new(split.outputs[0], ao.inputs["B"])
    nt.links.new(ao.outputs["Result"], bsdf.inputs["Base Color"])
    nt.links.new(split.outputs[1], bsdf.inputs["Roughness"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])


for m in bpy.data.materials:
    if m.name in LAYERS:
        textured(m)

# Light: a low warm sun with soft shadows, and a pale sky.
try:
    scene.render.engine = "BLENDER_EEVEE"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 92
scene.view_settings.view_transform = "AgX"
world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.62, 0.72, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.2
sun.data.angle = math.radians(3)
sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
scene.collection.objects.link(sun)
ground = bpy.data.materials.new("ground")
ground.use_nodes = True
ground.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.28, 0.22, 1)
ground.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
bpy.ops.mesh.primitive_plane_add(size=8)
floor = bpy.context.object
floor.data.materials.append(ground)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam


def shoot(name, look, at, distance, lens=50):
    if WANT and name not in WANT:
        return
    d = Vector(look).normalized()
    cam.location = Vector(at) - d * distance
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    scene.render.filepath = os.path.join(OUT, f"{name}.jpg")
    bpy.ops.render.render(write_still=True)
    print("render:", scene.render.filepath)


def lay(obj, at, turn, roll=math.pi / 2):
    """A tool lying on its flat side on the ground: its +X (Blender +X) down."""
    obj.rotation_euler = (0, roll, turn)
    obj.location = at
    bpy.context.view_layer.update()
    low = min((obj.matrix_world @ v.co).z for v in obj.data.vertices)
    obj.location.z -= low


# Each alone, lying as dropped, then all three together.
for o in tools.values():
    o.hide_render = True
for name, o in tools.items():
    o.hide_render = False
    lay(o, (0, 0, 0), 0.4)
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    mid = sum(pts, Vector()) / len(pts)
    size = max((p - mid).length for p in pts)
    shoot(f"{name}", (0.5, 0.8, -0.65), mid, size * 3.4)
    top = o.matrix_world @ Vector((0, -(1.36 if name == "spear" else 0.3), 0))
    shoot(f"{name}_head", (0.45, 0.75, -0.6), top, 0.42 if name != "spear" else 0.36)
    o.hide_render = True
for o in tools.values():
    o.hide_render = False
lay(tools["pick"], (-0.3, 0.05, 0), 0.5)
lay(tools["hatchet"], (0.3, -0.05, 0), 0.2)
lay(tools["spear"], (0.95, -0.42, 0), 4.76)
shoot("together", (0.15, 0.8, -0.95), (0.0, -0.25, 0.03), 2.0, lens=40)
