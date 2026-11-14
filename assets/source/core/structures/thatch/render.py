# Review renders of the thatch tier: the pieces from model.py with the tier's materials on, alone and built into a
# small house, plainly lit. Not part of the build.
#
#   blender --background --factory-startup --python render.py -- OUT_DIR [SHOT ...] [--flat] [--samples N] [--scale S]
#
# With no shots named, every shot is drawn. --flat draws the pieces in their palette colours with flat faces, as the
# game draws them before the textured renderer.

import math
import os
import runpy
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index("--") + 1 :]
OUT = os.path.abspath(args[0])
FLAT = "--flat" in args
SAMPLES = int(args[args.index("--samples") + 1]) if "--samples" in args else 96
SCALE = float(args[args.index("--scale") + 1]) if "--scale" in args else 1.0
WANTED = [a for i, a in enumerate(args[1:], 1) if not a.startswith("--") and args[i - 1] not in ("--samples", "--scale")]
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
runpy.run_path(os.path.join(HERE, "model.py"), run_name="__main__")

scene = bpy.context.scene
PIECES = {o.name: o for o in scene.objects if o.type == "MESH"}
for o in PIECES.values():
    scene.collection.objects.unlink(o)


# Materials -----------------------------------------------------------------------------------------------------------


def texture(nodes, path, data):
    node = nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(path, check_existing=True)
    if data:
        node.image.colorspace_settings.name = "Non-Color"
    node.interpolation = "Cubic"
    return node


def dress(material):
    """Puts the tier's pictures on a material made by model.py, or leaves its flat colour where there are none."""
    name = material.name
    folder = os.path.join(HERE, "tex", name.lower())
    files = {k: os.path.join(folder, f"{name.lower()}_{k}.png") for k in ("base", "normal", "orm")}
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    if FLAT or not all(os.path.exists(f) for f in files.values()):
        return
    base = texture(nodes, files["base"], False)
    normal = texture(nodes, files["normal"], True)
    orm = texture(nodes, files["orm"], True)
    split = nodes.new("ShaderNodeSeparateColor")
    links.new(orm.outputs["Color"], split.inputs["Color"])
    # Occlusion darkens the colour in the crevices that the geometry does not have.
    shade = nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 1.0
    links.new(base.outputs["Color"], shade.inputs["A"])
    links.new(split.outputs["Red"], shade.inputs["B"])
    links.new(shade.outputs["Result"], bsdf.inputs["Base Color"])
    links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(split.outputs["Blue"], bsdf.inputs["Metallic"])
    bump = nodes.new("ShaderNodeNormalMap")
    bump.uv_map = "UVMap"
    links.new(normal.outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


for m in list(bpy.data.materials):
    if m.name in ("Thatch", "Pole", "Cord", "Mat"):
        dress(m)

if FLAT:
    for o in PIECES.values():
        for p in o.data.polygons:
            p.use_smooth = False


def plain(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m


def ground_material():
    """Dry grass and earth: two colours mixed by noise, so the ground is not a flat card."""
    m = plain("Ground", (0.16, 0.17, 0.08))
    nodes, links = m.node_tree.nodes, m.node_tree.links
    coord = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.35
    noise.inputs["Detail"].default_value = 8.0
    links.new(coord.outputs["Object"], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.13, 0.15, 0.06, 1)
    ramp.color_ramp.elements[1].color = (0.24, 0.21, 0.12, 1)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
    fine = nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 40.0
    bumpn = nodes.new("ShaderNodeBump")
    bumpn.inputs["Strength"].default_value = 0.3
    links.new(coord.outputs["Object"], fine.inputs["Vector"])
    links.new(fine.outputs["Fac"], bumpn.inputs["Height"])
    links.new(bumpn.outputs["Normal"], nodes["Principled BSDF"].inputs["Normal"])
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
ground.from_pydata([(-400, -400, 0), (400, -400, 0), (400, 400, 0), (-400, 400, 0)], [], [(0, 1, 2, 3)])
ground_obj = bpy.data.objects.new("ground", ground)
ground_obj.data.materials.append(ground_material())
scene.collection.objects.link(ground_obj)

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.2
sun.data.angle = math.radians(1.5)
scene.collection.objects.link(sun)


def aim_sun(azimuth, elevation):
    sun.rotation_euler = (0, 0, 0)
    d = Vector((math.cos(math.radians(elevation)) * math.sin(math.radians(azimuth)), -math.cos(math.radians(elevation)) * math.cos(math.radians(azimuth)), math.sin(math.radians(elevation))))
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()


world = bpy.data.worlds.new("sky")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.52, 0.66, 0.86, 1)
bg.inputs["Strength"].default_value = 0.9
scene.world = world

cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
scene.collection.objects.link(cam)
scene.camera = cam


def look(eye, at, lens=35):
    cam.location = eye
    cam.rotation_euler = (Vector(at) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    cam.data.clip_start = 0.05
    cam.data.clip_end = 1000


if "--eevee" in args:
    # Much quicker to start than Cycles on a machine that has not compiled Cycles' GPU kernels.
    scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys() else "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = SAMPLES
    scene.eevee.use_raytracing = True
    scene.eevee.ray_tracing_options.resolution_scale = "1"
    scene.eevee.use_shadows = True
    scene.eevee.shadow_ray_count = 2
    scene.eevee.shadow_step_count = 8
    scene.eevee.fast_gi_method = "GLOBAL_ILLUMINATION"
else:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    if "--cpu" not in args:
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            scene.cycles.device = "GPU"
        except Exception as e:  # A machine without a GPU draws on the processor.
            print("render: no GPU,", e)
# A tone curve that keeps base colours as they are, as a game's does, rather than one that bleaches bright ones.
transforms = scene.view_settings.bl_rna.properties["view_transform"].enum_items.keys()
scene.view_settings.view_transform = "Khronos PBR Neutral" if "Khronos PBR Neutral" in transforms else "Standard"
scene.view_settings.exposure = -0.3
scene.render.image_settings.file_format = "PNG"


def shoot(name, size=(1920, 1080)):
    if WANTED and name not in WANTED:
        return
    scene.render.resolution_x = int(size[0] * SCALE)
    scene.render.resolution_y = int(size[1] * SCALE)
    scene.render.filepath = os.path.join(OUT, name + ("_flat" if FLAT else "") + ".png")
    bpy.ops.render.render(write_still=True)
    print("render: wrote", scene.render.filepath)


# The house -----------------------------------------------------------------------------------------------------------

FOUND = 0.375
FLOOR = FOUND
WALL = FLOOR + 1.5
DOOR = FLOOR + 2.3125 / 2
ROOF = FLOOR + 3.0 - 0.125


def house(ox=0.0, oy=0.0):
    """Four foundations, walls round them with two doorways, one door open and one shut, and four ceilings."""
    for x in (-1.5, 1.5):
        for y in (-1.5, 1.5):
            put("foundation", ox + x, oy + y, FOUND / 2)
            put("ceiling", ox + x, oy + y, ROOF)
    # Front, facing the camera at -y: a doorway with its door open, and a wall.
    put("doorframe", ox - 1.5, oy - 3, WALL)
    put("door_open", ox - 1.5, oy - 3, DOOR)
    put("wall", ox + 1.5, oy - 3, WALL)
    # Right side: a doorway with its door shut, and a wall.
    put("doorframe", ox + 3, oy - 1.5, WALL, 1)
    put("door", ox + 3, oy - 1.5, DOOR, 1)
    put("wall", ox + 3, oy + 1.5, WALL, 1)
    for x in (-1.5, 1.5):
        put("wall", ox + x, oy + 3, WALL, 2)
    for y in (-1.5, 1.5):
        put("wall", ox - 3, oy + y, WALL, -1)


house()
aim_sun(-35, 38)
look((-6.8, -10.5, 2.3), (0.6, 0.0, 1.5), 32)
shoot("house_front")
look((9.5, -8.5, 3.2), (0.4, 0.0, 1.4), 32)
shoot("house_right")
look((-2.6, -6.0, 1.75), (-1.2, -1.5, 1.4), 30)
shoot("house_door")
look((-9.0, -13.0, 9.0), (0.0, 0.0, 1.5), 30)
shoot("house_above")
look((-24, -40, 2.0), (0.0, 0.0, 1.8), 50)
shoot("house_field")
# Inside, through the open doorway, under the ceilings: the frame side of the walls and the mat floor.
look((-1.4, -1.9, 1.7), (1.4, 2.4, 1.3), 18)
shoot("house_inside")
clear()

# A run of walls and a corner: the thatch carries on from wall to wall and round the corner.
for x in (-4.5, -1.5, 1.5):
    put("foundation", x, 0, FOUND / 2)
    put("wall", x, -1.5, WALL)
put("wall", 3, 0, WALL, 1)
put("doorframe", -6, 0, WALL, -1)
aim_sun(-30, 34)
look((-5.5, -9.5, 2.0), (-0.5, -1.5, 1.6), 35)
shoot("run")
clear()

# Each piece alone, at its finest level.
aim_sun(-40, 40)
for piece, z, eye, at in [
    ("wall", WALL, (-3.4, -5.6, 2.2), (0, 0, 1.75)),
    ("doorframe", WALL, (-3.4, -5.6, 2.2), (0, 0, 1.75)),
    ("foundation", FOUND / 2, (-3.4, -4.6, 2.4), (0, 0, 0.1)),
    ("ceiling", 1.2, (-3.6, -4.8, 3.4), (0, 0, 1.1)),
    ("door", DOOR, (-2.3, -4.4, 1.6), (0, 0, 1.5)),
]:
    put(piece, 0, 0, z)
    look(eye, at, 35)
    shoot("piece_" + piece, (1440, 1080))
    clear()

# The backs: the frame side of a wall, the door's brace, and a ceiling from below.
put("wall", 0, 0, WALL, 2)
look((-3.4, -5.6, 2.2), (0, 0, 1.75), 35)
shoot("piece_wall_back", (1440, 1080))
clear()
put("door", 0, 0, DOOR, 2)
look((-2.3, -4.4, 1.6), (0, 0, 1.5), 35)
shoot("piece_door_back", (1440, 1080))
clear()
put("ceiling", 0, 0, 2.2)
look((-3.0, -4.2, 0.4), (0, 0, 2.0), 30)
shoot("piece_ceiling_below", (1440, 1080))
clear()
