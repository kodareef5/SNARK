# Review renders of the stone tier with its materials on: each piece alone, and a
# small house built from them. Not part of the build.
#
#   blender --background --factory-startup --python render.py -- <out folder> [shot ...]
#
# With no shots named, every one is rendered. With FLAT=1 in the environment the
# materials keep their palette colours and each picture's name ends in _flat:
# how the game draws the pieces until it draws textures. Pieces are placed as the game
# places them (shared/world/snap.ts): walls on foundation edges, ceilings level
# with the wall tops, doors on their doorframes' sills.

import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import model  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(args[0] if args else os.path.join(HERE, "ref", "renders"))
WANT = set(args[1:])
FLAT = os.environ.get("FLAT") == "1"
os.makedirs(OUT, exist_ok=True)

scene = bpy.context.scene
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj)


def textured(name):
    """The material with its four maps, where they exist; otherwise the flat palette colour it is built with."""
    folder = os.path.join(HERE, "tex", name)
    files = {k: os.path.join(folder, f"{name}_{k}.png") for k in ("base", "normal", "orm")}
    m = model.MATS[name]
    if FLAT:
        return m
    if not all(os.path.exists(p) for p in files.values()):
        print(f"render: {name} has no textures yet, drawn flat")
        return m
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes["Principled BSDF"]

    def image(path, colour):
        n = nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(path, check_existing=True)
        n.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        n.interpolation = "Cubic" if not colour else "Linear"
        return n

    base = image(files["base"], True)
    links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    normal = image(files["normal"], False)
    nmap = nodes.new("ShaderNodeNormalMap")
    links.new(normal.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    orm = image(files["orm"], False)
    split = nodes.new("ShaderNodeSeparateColor")
    links.new(orm.outputs["Color"], split.inputs["Color"])
    links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(split.outputs["Blue"], bsdf.inputs["Metallic"])
    # Occlusion darkens only the light that comes from the sky.
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.6
    links.new(base.outputs["Color"], mix.inputs["A"])
    links.new(split.outputs["Red"], mix.inputs["B"])
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return m


for name in model.COLOURS:
    textured(name)

# One mesh for each piece, finest level, placed as often as the house needs it.
MESHES = {}
for name, (make, _) in model.PIECES.items():
    mesh = make(0)
    MESHES[name] = mesh.build("_" + name, model.MATS).data
    if name == "door":
        MESHES["door_open"] = mesh.transformed(model.swung).build("_door_open", model.MATS).data
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj)

house = bpy.data.collections.new("house")
scene.collection.children.link(house)


def place(piece, x, y, z, quarter=0, into=house, name=None):
    """A piece at the game's (x, y, z), turned `quarter` quarter turns: 1 turns its front from +z to +x."""
    obj = bpy.data.objects.new(name or piece, MESHES[piece])
    obj.location = (x, -z, y)
    obj.rotation_euler = (0.0, 0.0, quarter * math.pi / 2)
    into.objects.link(obj)
    return obj


FOUND_Y = 0.1875
WALL_Y = 0.375 + 1.5
CEIL_Y = 0.375 + 3.0 - 0.125
DOOR_Y = WALL_Y - 1.5 + 2.3125 / 2

for x in (-3.0, 0.0, 3.0):
    for z in (-1.5, 1.5):
        place("foundation", x, FOUND_Y, z)
        place("ceiling", x, CEIL_Y, z)
# Front, facing +z: a window, the door standing open, a wall.
place("windowframe", -3.0, WALL_Y, 3.0)
place("doorframe", 0.0, WALL_Y, 3.0)
place("door_open", 0.0, DOOR_Y, 3.0)
place("wall", 3.0, WALL_Y, 3.0)
# Back, facing -z.
place("wall", -3.0, WALL_Y, -3.0, 2)
place("windowframe", 0.0, WALL_Y, -3.0, 2)
place("wall", 3.0, WALL_Y, -3.0, 2)
# Right, facing +x: a door shut, a wall.
place("doorframe", 4.5, WALL_Y, 1.5, 1)
place("door", 4.5, DOOR_Y, 1.5, 1)
place("wall", 4.5, WALL_Y, -1.5, 1)
# Left, facing -x.
place("wall", -4.5, WALL_Y, 1.5, -1)
place("windowframe", -4.5, WALL_Y, -1.5, -1)
# Beside it, a flight of stairs up to a ceiling held on a pillar.
place("foundation", 9.0, FOUND_Y, -1.5)
place("stairs", 9.0, WALL_Y, -1.5)
place("foundation", 9.0, FOUND_Y, 1.5)
place("pillar", 9.0, WALL_Y, 1.5)
place("ceiling", 9.0, CEIL_Y, 1.5)

# The ground, and a sky.
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new("ground")
gm.use_nodes = True
gb = gm.node_tree.nodes["Principled BSDF"]
noise = gm.node_tree.nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 0.6
ramp = gm.node_tree.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = (0.11, 0.13, 0.05, 1)
ramp.color_ramp.elements[1].color = (0.20, 0.19, 0.09, 1)
gm.node_tree.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
gm.node_tree.links.new(ramp.outputs["Color"], gb.inputs["Base Color"])
gb.inputs["Roughness"].default_value = 0.95
ground.data.materials.append(gm)

world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
# Late afternoon: the sun low over the front left, raking across the front of the house so every stone casts its
# shadow, and a physical sky lighting what the sun does not reach.
ELEVATION = math.radians(float(os.environ.get("SUN_ELEVATION", "26")))
AZIMUTH = math.radians(float(os.environ.get("SUN_AZIMUTH", "-64")))  # from the front (+z) toward +x: the sun is over the front left
toward_sun = Vector((math.sin(AZIMUTH) * math.cos(ELEVATION), -math.cos(AZIMUTH) * math.cos(ELEVATION), math.sin(ELEVATION)))
nodes = world.node_tree.nodes
sky_tex = nodes.new("ShaderNodeTexSky")
sky_tex.sky_type = "MULTIPLE_SCATTERING"
sky_tex.sun_disc = False
sky_tex.sun_elevation = ELEVATION
sky_tex.sun_rotation = math.atan2(toward_sun.x, toward_sun.y)
background = nodes["Background"]
world.node_tree.links.new(sky_tex.outputs["Color"], background.inputs["Color"])
background.inputs["Strength"].default_value = float(os.environ.get("SKY", "0.07"))

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = float(os.environ.get("SUN", "4.5"))
sun_data.color = (1.0, 0.88, 0.72)
sun_data.angle = math.radians(0.8)
sun = bpy.data.objects.new("sun", sun_data)
scene.collection.objects.link(sun)
# A sun shines along its -Z.
sun.rotation_euler = toward_sun.to_track_quat("Z", "Y").to_euler()

# Cycles on the graphics card by default, so the inside of a house is dark but for what comes in at its door and
# windows; ENGINE=eevee for quick looks.
if os.environ.get("ENGINE", "cycles") == "cycles":
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
    except Exception as e:  # noqa: BLE001
        print(f"render: no Metal device ({e}), on the processor")
    scene.cycles.samples = int(os.environ.get("SAMPLES", "128"))
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
else:
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    eevee = scene.eevee
    for attr, value in (("taa_render_samples", 64), ("use_shadows", True), ("use_raytracing", True), ("shadow_ray_count", 2), ("shadow_step_count", 8)):
        if hasattr(eevee, attr):
            setattr(eevee, attr, value)
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = float(os.environ.get("EXPOSURE", "-0.5"))
scene.view_settings.look = "AgX - Medium High Contrast" if "AgX - Medium High Contrast" in [i.identifier for i in scene.view_settings.bl_rna.properties["look"].enum_items] else "None"

cam_data = bpy.data.cameras.new("camera")
cam = bpy.data.objects.new("camera", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def game(x, y, z):
    return Vector((x, -z, y))


def shoot(name, eye, target, lens=35.0, size=(1600, 1000), exposure=0.0):
    """A picture from `eye` toward `target`, both the game's (x, y, z). `exposure` is added for a dark interior, as an
    eye opens in one."""
    if WANT and name not in WANT:
        return
    scene.view_settings.exposure = float(os.environ.get("EXPOSURE", "-0.5")) + exposure
    cam.location = game(*eye)
    direction = game(*target) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = lens
    cam_data.clip_start = 0.05
    cam_data.clip_end = 1000
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.render.filepath = os.path.join(OUT, name + ("_flat" if FLAT else "") + ".jpg")
    bpy.ops.render.render(write_still=True)
    print(f"render: wrote {name}")


# The house.
shoot("house_front", (13.5, 3.2, 17.0), (3.2, 1.9, 0.0), 30)
shoot("house_hero", (11.5, 1.75, 12.5), (1.8, 1.7, 0.6), 24)
shoot("house_hero_front", (4.2, 1.7, 13.0), (2.6, 1.9, 0.0), 26)
shoot("house_door_open", (2.6, 1.7, 7.4), (0.0, 1.6, 3.0), 30)
shoot("house_door_shut", (8.6, 1.8, 4.6), (4.5, 1.7, 1.2), 30)
shoot("house_back", (-12.0, 4.0, -13.0), (1.5, 1.6, 0.0), 32)
shoot("house_inside", (-2.6, 1.65, -1.9), (0.6, 1.9, 3.0), 20, exposure=2.4)
shoot("house_wall_close", (5.6, 1.7, 5.2), (3.6, 1.5, 3.0), 35)
shoot("house_roof", (14.0, 11.0, 12.0), (1.5, 2.5, 0.0), 32)
shoot("house_far", (45.0, 2.0, 62.0), (3.0, 2.0, 0.0), 50)
shoot("house_far_tele", (45.0, 2.0, 62.0), (3.0, 2.0, 0.0), 150)

# Each piece alone, on bare ground.
house.hide_render = True
alone = bpy.data.collections.new("alone")
scene.collection.children.link(alone)
VIEWS = {
    "foundation": ((3.4, 2.4, 4.4), (0.0, 0.0, 0.0), 40),
    "wall": ((3.2, 2.6, 5.8), (0.0, 1.5, 0.0), 35),
    "doorframe": ((3.2, 2.6, 5.8), (0.0, 1.5, 0.0), 35),
    "windowframe": ((3.2, 2.6, 5.8), (0.0, 1.5, 0.0), 35),
    "ceiling": ((3.0, 1.1, 3.8), (0.0, 2.7, 0.0), 30),
    "pillar": ((1.6, 2.0, 3.2), (0.0, 1.5, 0.0), 35),
    "stairs": ((-4.6, 3.6, -5.4), (0.0, 1.3, 0.0), 35),
    "door": ((1.4, 1.6, 2.9), (0.0, 1.1, 0.0), 35),
    "door_open": ((2.6, 1.6, 2.6), (-0.6, 1.1, 0.7), 35),
}
LIFT = {"foundation": 0.1875, "wall": 1.5, "doorframe": 1.5, "windowframe": 1.5, "ceiling": 2.9, "pillar": 1.5, "stairs": 1.5, "door": 2.3125 / 2, "door_open": 2.3125 / 2}
for piece, (eye, target, lens) in VIEWS.items():
    if WANT and piece not in WANT:
        continue
    obj = place(piece, 0.0, LIFT[piece], 0.0, into=alone, name="alone_" + piece)
    shoot(piece, eye, target, lens, (1000, 1000))
    bpy.data.objects.remove(obj)
print("render: done")
