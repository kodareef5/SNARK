# Review renders of a weapon asset with its materials on, in Blender's light (sun, sky, shadows): each piece lying
# alone at three quarters, close on it, and all of them together; and for the firearms, each gun seen from behind along
# its sight line, as a player aiming down it would, with a crosshair drawn at the picture's middle. Not part of the build.
#
#   blender --background --factory-startup --python render.py -- <asset folder> [out folder]
#
# The out folder is <asset folder>/ref/renders where not given.

import math
import os
import runpy
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ASSET = os.path.abspath(args[0])
OUT = args[1] if len(args) > 1 else os.path.join(ASSET, "ref", "renders")
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, ASSET)
sys.dont_write_bytecode = True

bpy.ops.wm.read_factory_settings(use_empty=True)
model = runpy.run_path(os.path.join(ASSET, "model.py"), run_name="__main__")
SIGHT = model.get("SIGHT", {})
scene = bpy.context.scene
pieces = {o.name: o for o in scene.objects if o.type == "MESH"}

TOOLS = os.path.join(HERE, "..", "stone-tools", "tex")
# Each material's base, normal and packed pictures (materials.ts).
LAYERS = {
    "wood": [os.path.join(TOOLS, "wood", f"wood_{k}.png") for k in ("base", "normal", "orm")],
    "lashing": [os.path.join(TOOLS, "lashing", f"lashing_{k}_1024.png") for k in ("base", "normal", "orm")],
    "stone": [os.path.join(TOOLS, "stone", f"stone_{k}_1024.png") for k in ("base", "normal", "orm")],
    "flint": [os.path.join(TOOLS, "stone", f"{n}_{k}_1024.png") for n, k in (("flint", "base"), ("stone", "normal"), ("flint", "orm"))],
    "steel": [os.path.join(HERE, "firearms", "tex", "steel", f"steel_{k}_1024.png") for k in ("base", "normal", "orm")],
    "hide": [os.path.join(HERE, "thrown", "tex", "hide", f"hide_{k}_1024.png") for k in ("base", "normal", "orm")],
}
TINT = {"steel": (1.0, 0.94, 0.86)}


def textured(m):
    base, normal, orm = LAYERS[m.name]
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
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    tint.inputs["B"].default_value = (*TINT.get(m.name, (1, 1, 1)), 1)
    nt.links.new(ao.outputs["Result"], tint.inputs["A"])
    nt.links.new(tint.outputs["Result"], bsdf.inputs["Base Color"])
    nt.links.new(split.outputs[1], bsdf.inputs["Roughness"])
    nt.links.new(split.outputs[2], bsdf.inputs["Metallic"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])


for m in bpy.data.materials:
    if m.name in LAYERS:
        textured(m)

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
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (0.55, 0.62, 0.72, 1)
bg.inputs["Strength"].default_value = 0.8
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.2
sun.data.angle = math.radians(3)
sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
scene.collection.objects.link(sun)
ground = bpy.data.materials.new("ground")
ground.use_nodes = True
gp = next(n for n in ground.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
gp.inputs["Base Color"].default_value = (0.32, 0.28, 0.22, 1)
gp.inputs["Roughness"].default_value = 0.95
bpy.ops.mesh.primitive_plane_add(size=12)
floor = bpy.context.object
floor.data.materials.append(ground)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.clip_start = 0.005


def shoot(name, look, at, distance, lens=50):
    d = Vector(look).normalized()
    cam.location = Vector(at) - d * distance
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    scene.render.filepath = os.path.join(OUT, f"{name}.jpg")
    bpy.ops.render.render(write_still=True)
    print("render:", scene.render.filepath)


def bounds(o):
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    lo = Vector([min(p[k] for p in pts) for k in range(3)])
    hi = Vector([max(p[k] for p in pts) for k in range(3)])
    return lo, hi


# The pieces as modelled: a held piece has its length along Blender -Y and its top up; a lying piece (a name ending in
# _lying, or the live grenade) lies as it is.
held = [n for n in pieces if not n.endswith("_lying") and n != "grenade_thrown"]


def lay(o):
    """A held piece lying on the ground: turned onto its side (its x up), as dropped "auto" lays the thinnest axis up."""
    lo, hi = bounds(o)
    size = hi - lo
    if size.x <= size.z:
        o.rotation_euler = (0, math.pi / 2, 0)
    bpy.context.view_layer.update()
    lo, hi = bounds(o)
    o.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    bpy.context.view_layer.update()


for o in pieces.values():
    o.hide_render = True
# Each alone, lying, from three quarters above and close.
for name, o in pieces.items():
    if name == "bow":
        continue
    o.hide_render = False
    saved = (o.location.copy(), o.rotation_euler.copy())
    if name in held:
        lay(o)
    lo, hi = bounds(o)
    mid = (lo + hi) / 2
    size = (hi - lo).length
    shoot(name, (0.5, 0.8, -0.65), mid, size * 1.9)
    o.location, o.rotation_euler = saved
    o.hide_render = True

# Each gun seen along its sight line: the camera behind the gun, on the line, looking along the barrel (+Z in the
# engine, Blender -Y), the gun held as modelled. A long lens, so the rear and front sights both show.
floor.hide_render = True
for name, s in SIGHT.items():
    o = pieces.get(name)
    if not o:
        continue
    o.hide_render = False
    o.location, o.rotation_euler = Vector((0, 0, 1.0)), (0, 0, 0)
    bpy.context.view_layer.update()
    lo, hi = bounds(o)
    back = hi.y + 0.25
    cam.location = Vector((0, back, 1.0 + s))
    # Looking along Blender -Y with +Z up.
    cam.rotation_euler = (math.pi / 2, 0, math.pi)
    cam.data.lens = 70
    scene.render.resolution_x, scene.render.resolution_y = 1000, 1000
    path = os.path.join(OUT, f"sight_{name}.png")
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # The crosshair: the picture's middle row and column, thin red lines with a gap at the centre.
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:]).reshape(h, w, 4)
    cx, cy = w // 2, h // 2
    for d in range(12, 160):
        for x, y in ((cx + d, cy), (cx - d, cy), (cx, cy + d), (cx, cy - d)):
            px[y, x] = (0.9, 0.1, 0.1, 1)
    img.pixels = px.ravel()
    img.file_format = "JPEG"
    img.filepath_raw = path[:-4] + ".jpg"
    img.save()
    os.remove(path)
    print("render:", img.filepath_raw)
    o.hide_render = True
