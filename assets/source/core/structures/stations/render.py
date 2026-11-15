# Review renders of the stations with their materials on, in Blender's light (a low sun with shadows, a pale sky): each
# station alone at three quarters from where a survivor walks up to it, the lit ones beside their out forms, and all of
# them in a row with a 1.8 m figure for scale. Not part of the build.
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
from model import BOXES  # noqa: E402

scene = bpy.context.scene
pieces = {o.name: o for o in scene.objects}

ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
# Each material's pictures: base, normal, packed.
LAYERS = {
    "stone": ("items/stone-tools/tex/stone/stone_%s_1024.png", None),
    "lashing": ("items/stone-tools/tex/lashing/lashing_%s_1024.png", None),
    "hide": ("items/weapons/thrown/tex/hide/hide_%s_1024.png", None),
    "boards": ("structures/wood/tex/boards/boards_%s.png", None),
    "iron": ("structures/stone/tex/iron/iron_%s.png", None),
    "kiln": ("structures/stations/tex/kiln/kiln_%s_1024.png", None),
    "plate": ("structures/stations/tex/plate/plate_%s_1024.png", (0.98, 1.08, 0.82)),
}


def textured(m, pattern, tint):
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])

    def image(layer, data):
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(os.path.join(ROOT, pattern % layer), check_existing=True)
        node.image.colorspace_settings.name = "Non-Color" if data else "sRGB"
        node.interpolation = "Smart"
        return node

    b, o, n = image("base", False), image("orm", True), image("normal", True)
    split = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(o.outputs["Color"], split.inputs[0])
    ao = nt.nodes.new("ShaderNodeMix")
    ao.data_type = "RGBA"
    ao.blend_type = "MULTIPLY"
    ao.inputs["Factor"].default_value = 0.7
    nt.links.new(b.outputs["Color"], ao.inputs["A"])
    nt.links.new(split.outputs[0], ao.inputs["B"])
    colour = ao.outputs["Result"]
    if tint:
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        nt.links.new(colour, mul.inputs["A"])
        mul.inputs["B"].default_value = (*tint, 1)
        colour = mul.outputs["Result"]
    nt.links.new(colour, bsdf.inputs["Base Color"])
    nt.links.new(split.outputs[1], bsdf.inputs["Roughness"])
    nt.links.new(split.outputs[2], bsdf.inputs["Metallic"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])


for m in bpy.data.materials:
    if m.name in LAYERS:
        textured(m, *LAYERS[m.name])

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
sun.data.energy = 3.4
sun.data.angle = math.radians(3)
# From the front left and high, as a sun over a survivor's shoulder.
sun.rotation_euler = (math.radians(50), 0, math.radians(200))
scene.collection.objects.link(sun)
ground = bpy.data.materials.new("ground")
ground.use_nodes = True
ground.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.24, 0.28, 0.18, 1)
ground.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
bpy.ops.mesh.primitive_plane_add(size=40)
bpy.context.object.data.materials.append(ground)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam

# A plain grey figure 1.8 m tall for scale.
figure = bpy.data.materials.new("figure")
figure.use_nodes = True
figure.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.35, 0.36, 1)
bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=1.5, location=(0, 0, 0.75))
body = bpy.context.object
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.15, location=(0, 0, 1.65))
head = bpy.context.object
for o in (body, head):
    o.data.materials.append(figure)
    o.hide_render = True

# Blender's front of a station is +Y (kit.S): its own frame's F.
HALF = {"mortar": BOXES["mortar"], "smithy": BOXES["smithy"], "forge": BOXES["forge"], "forge_lit": BOXES["forge"], "fabricator": BOXES["fabricator"],
        "fabricator_lit": BOXES["fabricator"], "preserving_bin": BOXES["bin"], "preserving_bin_lit": BOXES["bin"]}


def stand(name, x, y=0.0):
    o = pieces[name]
    o.location = (x, y, HALF[name][1])
    o.hide_render = False


def shoot(name, at, distance, around=0.55, above=0.32, lens=50):
    if WANT and name not in WANT:
        return
    d = Vector((math.sin(around) * math.cos(above), math.cos(around) * math.cos(above), math.sin(above)))
    cam.location = Vector(at) + d * distance
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    scene.render.filepath = os.path.join(OUT, f"{name}.jpg")
    bpy.ops.render.render(write_still=True)
    print("render:", scene.render.filepath)


def hide_all():
    for o in pieces.values():
        o.hide_render = True
    body.hide_render = head.hide_render = True


# Each alone, from where a survivor walks up to it (front right, a little above).
for name, (hx, hy, hz) in HALF.items():
    hide_all()
    stand(name, 0)
    size = max(hx, hy, hz)
    shoot(name, (0, 0, hy * 0.9), 1.2 + size * 3.2)
# The lit beside the out.
for out in ("forge", "fabricator", "preserving_bin"):
    hide_all()
    w = HALF[out][0]
    stand(out, -(w + 0.25))
    stand(out + "_lit", w + 0.25)
    shoot(f"{out}_out_lit", (0, 0, HALF[out][1] * 0.9), 2.2 + w * 3.5, around=0.0, above=0.2)
# All in a row with the figure.
hide_all()
x = -4.2
for name in ("mortar", "preserving_bin", "smithy", "forge_lit", "fabricator"):
    w = HALF[name][0]
    stand(name, x + w)
    x += 2 * w + 0.45
body.location.x = head.location.x = x + 0.2
body.hide_render = head.hide_render = False
shoot("row", ((x - 4.2 + 0.4) / 2, 0, 0.7), 12.0, around=0.12, above=0.18, lens=40)
