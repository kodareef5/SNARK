# Review renders of the thatch tier, in Cycles, under a low sun with a sky. Not part of the build.
#
#   blender --background --factory-startup --python render.py -- OUT_DIR [SHOT ...] [--flat N] [--samples N] [--scale S]
#
# With no shots named, every shot is drawn. --flat N draws level N in its palette colours with flat faces, as the
# game draws it before the textured renderer; level 1 is the finest the low setting draws.

import math
import os
import runpy
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index("--") + 1 :]
OUT = os.path.abspath(args[0])


def opt(name, default, kind=float):
    return kind(args[args.index(name) + 1]) if name in args else default


FLAT = opt("--flat", None, int)
SAMPLES = opt("--samples", 160, int)
SCALE = opt("--scale", 1.0)
WANTED = [a for i, a in enumerate(args[1:], 1) if not a.startswith("--") and args[i - 1] not in ("--samples", "--scale", "--flat")]
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
runpy.run_path(os.path.join(HERE, "model.py"), run_name="__main__")

scene = bpy.context.scene
LEVEL = FLAT or 0
PIECES = {}
for o in list(scene.objects):
    if o.type != "MESH":
        continue
    base, _, lod = o.name.partition("_LOD")
    if int(lod or 0) == LEVEL:
        PIECES[base] = o
    scene.collection.objects.unlink(o)


# Materials -----------------------------------------------------------------------------------------------------------


def texture(nodes, path, data, uv):
    node = nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(path, check_existing=True)
    if data:
        node.image.colorspace_settings.name = "Non-Color"
    node.interpolation = "Cubic"
    node.extension = "REPEAT"
    return node


def dress(material):
    """Puts the tier's pictures on a material made by model.py; a material with no pictures keeps its flat colour."""
    name = material.get("picture")
    if not name:
        return
    folder = os.path.join(HERE, "tex", name)
    files = {k: os.path.join(folder, f"{name}_{k}.png") for k in ("base", "normal", "orm")}
    if not all(os.path.exists(f) for f in files.values()):
        return
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    base = texture(nodes, files["base"], False, uv)
    normal = texture(nodes, files["normal"], True, uv)
    orm = texture(nodes, files["orm"], True, uv)
    for t in (base, normal, orm):
        links.new(uv.outputs["UV"], t.inputs["Vector"])
    split = nodes.new("ShaderNodeSeparateColor")
    links.new(orm.outputs["Color"], split.inputs["Color"])
    # Occlusion darkens the crevices the geometry does not have. A game puts it on ambient light only, so here it is
    # put on the colour at part strength.
    shade = nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 0.6
    links.new(base.outputs["Color"], shade.inputs["A"])
    links.new(split.outputs["Red"], shade.inputs["B"])
    links.new(shade.outputs["Result"], bsdf.inputs["Base Color"])
    links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(split.outputs["Blue"], bsdf.inputs["Metallic"])
    bump = nodes.new("ShaderNodeNormalMap")
    bump.uv_map = "UVMap"
    links.new(normal.outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    if material.get("cutout"):
        cut = nodes.new("ShaderNodeMath")
        cut.operation = "GREATER_THAN"
        cut.inputs[1].default_value = material.get("cutoff", 0.5)
        links.new(base.outputs["Alpha"], cut.inputs[0])
        links.new(cut.outputs["Value"], bsdf.inputs["Alpha"])
    # Thin stems pass a little light.
    if "Subsurface Weight" in bsdf.inputs and name.startswith(("thatch", "fringe", "roof", "door")):
        pass


if "--clay" in args:
    for m in list(bpy.data.materials):
        if m.use_nodes:
            b = m.node_tree.nodes["Principled BSDF"]
            b.inputs["Base Color"].default_value = (0.42, 0.40, 0.37, 1)
            b.inputs["Roughness"].default_value = 0.8
elif FLAT is None:
    for m in list(bpy.data.materials):
        if m.use_nodes:
            dress(m)
else:
    for o in PIECES.values():
        for p in o.data.polygons:
            p.use_smooth = False
    for m in bpy.data.materials:
        if m.use_nodes:
            m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95


if "--hide" in args:
    # Draws nothing of one material, to see what is behind it.
    gone = bpy.data.materials.get(args[args.index("--hide") + 1])
    if gone:
        for link in list(gone.node_tree.links):
            if link.to_socket.name == "Alpha":
                gone.node_tree.links.remove(link)
        gone.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.0


def plain(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m


def ground_material():
    """Short dry grass over earth: colours mixed by noise at two scales, with a bump, so the ground is not a card."""
    m = plain("Ground", (0.16, 0.17, 0.08), 0.95)
    nodes, links = m.node_tree.nodes, m.node_tree.links
    coord = nodes.new("ShaderNodeTexCoord")
    big = nodes.new("ShaderNodeTexNoise")
    big.inputs["Scale"].default_value = 0.08
    big.inputs["Detail"].default_value = 6.0
    links.new(coord.outputs["Object"], big.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.3
    ramp.color_ramp.elements[0].color = (0.10, 0.10, 0.035, 1)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (0.26, 0.17, 0.09, 1)
    nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    links.new(big.outputs["Fac"], ramp.inputs["Fac"])
    fine = nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 60.0
    fine.inputs["Detail"].default_value = 4.0
    links.new(coord.outputs["Object"], fine.inputs["Vector"])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.35
    links.new(ramp.outputs["Color"], mix.inputs["A"])
    links.new(fine.outputs["Color"], mix.inputs["B"])
    links.new(mix.outputs["Result"], nodes["Principled BSDF"].inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.4
    links.new(fine.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], nodes["Principled BSDF"].inputs["Normal"])
    return m


# The stage -----------------------------------------------------------------------------------------------------------

stage = []


def put(piece, x, y, z, turn=0.0):
    """Places a piece as the game would: x, y on the ground, z its middle's height, turned `turn` quarters."""
    o = bpy.data.objects.new(piece, PIECES[piece].data)
    o.location = (x, y, z)
    o.rotation_euler = (0, 0, turn * math.pi / 2)
    scene.collection.objects.link(o)
    stage.append(o)
    return o


def clear():
    for o in stage:
        bpy.data.objects.remove(o)
    stage.clear()


ground = bpy.data.meshes.new("ground")
ground.from_pydata([(-600, -600, 0), (600, -600, 0), (600, 600, 0), (-600, 600, 0)], [], [(0, 1, 2, 3)])
ground_obj = bpy.data.objects.new("ground", ground)
ground_obj.data.materials.append(ground_material())
scene.collection.objects.link(ground_obj)

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.angle = math.radians(0.8)
scene.collection.objects.link(sun)

world = bpy.data.worlds.new("sky")
world.use_nodes = True
sky = world.node_tree.nodes.new("ShaderNodeTexSky")
sky.sky_type = "MULTIPLE_SCATTERING"
sky.sun_disc = False
world.node_tree.links.new(sky.outputs["Color"], world.node_tree.nodes["Background"].inputs["Color"])
scene.world = world


def aim_sun(azimuth, elevation, strength=3.2, sky_strength=0.28, warm=(1.0, 0.87, 0.7)):
    """Azimuth in degrees from +y toward +x, elevation above the ground. The sky follows the sun."""
    az, el = math.radians(azimuth), math.radians(elevation)
    d = Vector((math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)))
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sun.data.energy = strength
    sun.data.color = warm
    sky.sun_elevation = el
    sky.sun_rotation = math.atan2(d.x, d.y) - math.pi / 2 + math.pi
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = sky_strength


cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
scene.collection.objects.link(cam)
scene.camera = cam


def look(eye, at, lens=35):
    cam.location = eye
    cam.rotation_euler = (Vector(at) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    cam.data.clip_start = 0.05
    cam.data.clip_end = 2000


scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.cycles.transparent_max_bounces = 16
if "--cpu" not in args:
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "METAL"
        scene.cycles.device = "GPU"
    except Exception as e:  # A machine without a GPU draws on the processor.
        print("render: no GPU,", e)
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Punchy"
scene.view_settings.exposure = 0.0
if "--view" in args:
    scene.view_settings.view_transform = args[args.index("--view") + 1]
    scene.view_settings.look = "None"
if FLAT is not None:
    # Palette colours shown as they are, as the game's flat renderer shows them.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.4
scene.render.image_settings.file_format = "PNG"


def shoot(name, size=(1920, 1080)):
    if WANTED and name not in WANTED:
        return
    scene.render.resolution_x = int(size[0] * SCALE)
    scene.render.resolution_y = int(size[1] * SCALE)
    scene.render.filepath = os.path.join(OUT, name + (f"_flat{FLAT}" if FLAT is not None else "") + ("_clay" if "--clay" in args else "") + ".png")
    bpy.ops.render.render(write_still=True)
    print("render: wrote", scene.render.filepath)


# Shots ---------------------------------------------------------------------------------------------------------------

FOUND = 0.375
FLOOR = FOUND
WALL = FLOOR + 1.5
DOOR = FLOOR + 2.3125 / 2
ROOF = FLOOR + 3.0 - 0.125


def house(ox=0.0, oy=0.0, shut=False):
    """Four foundations, walls round them with a doorway, its door open, and four ceilings. The front faces -y."""
    for x in (-1.5, 1.5):
        for y in (-1.5, 1.5):
            put("foundation", ox + x, oy + y, FOUND / 2)
            put("ceiling", ox + x, oy + y, ROOF)
    put("doorframe", ox - 1.5, oy - 3, WALL)
    put("door" if shut else "door_open", ox - 1.5, oy - 3, DOOR)
    put("wall", ox + 1.5, oy - 3, WALL)
    for y in (-1.5, 1.5):
        put("wall", ox + 3, oy + y, WALL, 1)
        put("wall", ox - 3, oy + y, WALL, -1)
    for x in (-1.5, 1.5):
        put("wall", ox + x, oy + 3, WALL, 2)


def exposed(ev):
    scene.view_settings.exposure = ev + (-0.4 if FLAT is not None else 0.0)


# Each shot: name, sun (azimuth, elevation, strength), eye, target, lens, exposure.
HOUSE = [
    ("house_hero", (-108, 22, 3.2), (-6.4, -9.6, 1.7), (0.4, 0.0, 1.55), 30, 0.0),
    ("house_corner", (72, 22, 3.2), (9.4, 8.8, 1.7), (0.0, 0.0, 1.6), 30, 0.0),
    ("house_above", (-120, 34, 3.2), (-8.6, -10.8, 8.4), (0.0, 0.0, 1.0), 30, 0.0),
    ("house_door", (-130, 24, 3.2), (-2.4, -5.4, 1.7), (-1.3, -2.8, 1.5), 28, 0.0),
    ("house_wall_close", (-120, 22, 3.2), (2.6, -4.6, 1.65), (1.4, -3.0, 1.75), 32, 0.0),
    ("house_eave", (-150, 24, 3.2), (4.8, -4.6, 1.7), (3.0, -3.0, 3.2), 30, 0.0),
    ("house_inside", (-178, 16, 3.6), (1.9, 2.2, 1.7), (-0.9, -2.0, 1.4), 18, 1.6),
    ("house_field", (-110, 18, 3.2), (-30, -46, 1.7), (0.0, 0.0, 1.8), 50, 0.0),
    ("house_dusk", (-115, 4, 2.6), (-6.4, -9.6, 1.7), (0.4, 0.0, 1.55), 30, 0.6),
]

if "--house" in args:
    house()
    for name, (az, el, power), eye, at, lens, ev in HOUSE:
        if WANTED and name not in WANTED:
            continue
        aim_sun(az, el, power, warm=(1.0, 0.62, 0.36) if el < 8 else (1.0, 0.87, 0.7))
        exposed(ev)
        look(eye, at, lens)
        shoot(name)
    clear()

if "--run" in args:
    # A run of walls with a corner and a doorway: the thatch goes on from wall to wall.
    for x in (-4.5, -1.5, 1.5):
        put("foundation", x, 0, FOUND / 2)
        put("wall", x, -1.5, WALL)
    put("wall", 3, 0, WALL, 1)
    put("doorframe", -6, 0, WALL, -1)
    aim_sun(-140, 26)
    exposed(0.0)
    look((-6.2, -9.6, 1.7), (-0.8, -1.5, 1.6), 32)
    shoot("run")
    clear()

PIECE_SHOTS = [
    # name, piece, height of its middle, turn, eye, target
    ("piece_wall", "wall", WALL - FLOOR, 0, (-2.6, -5.0, 1.8), (0, 0, 1.5)),
    ("piece_wall_inside", "wall", WALL - FLOOR, 2, (-2.6, -5.0, 1.8), (0, 0, 1.5)),
    ("piece_doorframe", "doorframe", WALL - FLOOR, 0, (-2.6, -5.0, 1.8), (0, 0, 1.5)),
    ("piece_door", "door", DOOR - FLOOR, 0, (-1.6, -3.4, 1.4), (0, 0, 1.15)),
    ("piece_door_inside", "door", DOOR - FLOOR, 2, (-1.6, -3.4, 1.4), (0, 0, 1.15)),
    ("piece_foundation", "foundation", FOUND / 2, 0, (-3.0, -4.2, 2.6), (0, 0, 0.1)),
    ("piece_ceiling", "ceiling", 1.6, 0, (-3.4, -4.6, 3.6), (0, 0, 1.5)),
    ("piece_ceiling_below", "ceiling", 2.4, 0, (-2.8, -4.0, 0.6), (0, 0, 2.3)),
]

if "--pieces" in args:
    for name, piece, z, turn, eye, at in PIECE_SHOTS:
        if WANTED and name not in WANTED:
            continue
        put(piece, 0, 0, z, turn)
        aim_sun(-140, 30)
        exposed(0.0)
        look(eye, at, 35)
        shoot(name, (1440, 1080))
        clear()

if "--test" in args:
    for x in (-3, 0, 3):
        put("wall", x, 0, 1.5)
    aim_sun(-140, 32)
    look((-2.5, -6.5, 1.7), (0.3, 0, 1.4), 32)
    shoot("test_wall")
    look((2.5, 4.5, 1.7), (0.3, 0, 1.4), 32)
    shoot("test_wall_back")
    look((-0.4, -1.6, 1.9), (0.2, 0, 1.75), 30)
    shoot("test_skirt")
