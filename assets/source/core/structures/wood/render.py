# Review renders of the wood tier with its materials on: each piece alone, and a
# small homestead built from them. Not part of the build.
#
#   blender --background --factory-startup --python render.py -- <out folder> [what ...]
#
# `what` picks shots by name (default: all). Shots are listed in SHOTS below.

import math
import os
import runpy
import sys

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = args[0] if args else os.path.join(HERE, "ref", "renders")
WANT = set(args[1:])
FLAT = "flat" in WANT
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
runpy.run_path(os.path.join(HERE, "model.py"), run_name="__main__")
from parts import MATERIALS, PALETTE  # noqa: E402  (model.py made them)

scene = bpy.context.scene
built = {o.name: o for o in scene.objects}
for o in built.values():
    scene.collection.objects.unlink(o)


def textured(name):
    """Turns a piece material into the full layer set from tex/<name>/."""
    if not os.path.exists(os.path.join(HERE, "tex", name, f"{name}_base.png")):
        return flat(name)
    m = MATERIALS[name]
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])

    def image(layer, data):
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(os.path.join(HERE, "tex", name, f"{name}_{layer}.png"), check_existing=True)
        node.image.colorspace_settings.name = "Non-Color" if data else "sRGB"
        node.interpolation = "Smart"
        return node

    base = image("base", False)
    orm = image("orm", True)
    normal = image("normal", True)
    split = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], split.inputs[0])
    # Occlusion darkens the colour a little; light does the rest.
    ao = nt.nodes.new("ShaderNodeMix")
    ao.data_type = "RGBA"
    ao.blend_type = "MULTIPLY"
    ao.inputs["Factor"].default_value = 0.7
    nt.links.new(base.outputs["Color"], ao.inputs["A"])
    nt.links.new(split.outputs[0], ao.inputs["B"])
    nt.links.new(ao.outputs["Result"], bsdf.inputs["Base Color"])
    nt.links.new(split.outputs[1], bsdf.inputs["Roughness"])
    nt.links.new(split.outputs[2], bsdf.inputs["Metallic"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(normal.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])


def flat(name):
    m = MATERIALS[name]
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9


for name in MATERIALS:
    (flat if FLAT else textured)(name)

# Light: a sun and a sky, plainly.
world = bpy.data.worlds.new("sky")
scene.world = world
wn = world.node_tree.nodes
sky = wn.new("ShaderNodeTexSky")
for kind in ("SINGLE_SCATTERING", "MULTIPLE_SCATTERING", "NISHITA", "PREETHAM"):
    try:
        sky.sky_type = kind
        break
    except TypeError:
        continue
sun_dir = Euler((math.radians(55), 0, math.radians(-42)))
for key, value in (("sun_elevation", math.radians(35)), ("sun_rotation", math.radians(228)), ("sun_disc", False)):
    if hasattr(sky, key):
        setattr(sky, key, value)
world.node_tree.links.new(sky.outputs[0], wn["Background"].inputs[0])
wn["Background"].inputs[1].default_value = float(os.environ.get("SKY", "0.2"))

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = float(os.environ.get("SUN", "5.0"))
sun_data.color = (1.0, 0.86, 0.68)
sun_data.angle = math.radians(1.5)
sun = bpy.data.objects.new("sun", sun_data)
sun.rotation_euler = sun_dir
scene.collection.objects.link(sun)

# Grass, roughly: two greens and a straw colour mixed by noise, with a little bump.
ground_mat = bpy.data.materials.new("ground")
gt = ground_mat.node_tree
gb = gt.nodes["Principled BSDF"]
gb.inputs["Roughness"].default_value = 1.0
noise = gt.nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 0.35
noise.inputs["Detail"].default_value = 8.0
ramp = gt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = (0.055, 0.07, 0.025, 1)
ramp.color_ramp.elements[1].color = (0.2, 0.17, 0.07, 1)
ramp.color_ramp.elements.new(0.55).color = (0.1, 0.105, 0.04, 1)
gt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
gt.links.new(ramp.outputs["Color"], gb.inputs["Base Color"])
fine = gt.nodes.new("ShaderNodeTexNoise")
fine.inputs["Scale"].default_value = 60.0
bump = gt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.4
gt.links.new(fine.outputs["Fac"], bump.inputs["Height"])
gt.links.new(bump.outputs["Normal"], gb.inputs["Normal"])
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.19))
ground = bpy.context.active_object
ground.data.materials.append(ground_mat)

try:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = int(os.environ.get("SAMPLES", "96"))
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
except Exception:
    pass
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Punchy"
except TypeError:
    pass
scale = float(os.environ.get("SCALE", "1"))
scene.render.resolution_x = int(1600 * scale)
scene.render.resolution_y = int(1000 * scale)
scene.view_settings.exposure = float(os.environ.get("EXPOSURE", "-0.3"))
scene.render.film_transparent = False

placed = []


def place(name, at, turn=0.0):
    o = bpy.data.objects.new(f"{name}@{len(placed)}", built[name].data)
    o.location = at
    o.rotation_euler = (0, 0, math.radians(turn))
    scene.collection.objects.link(o)
    placed.append(o)
    return o


def clear():
    for o in placed:
        bpy.data.objects.remove(o)
    placed.clear()


cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def shoot(file, eye, target, lens=35):
    cam.location = eye
    d = Vector(target) - Vector(eye)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = lens
    cam_data.clip_end = 2000
    scene.render.filepath = os.path.join(OUT, ("flat-" if FLAT else "") + file)
    bpy.ops.render.render(write_still=True)
    print(f"render: wrote {file}")


# A homestead: a house of four foundations with a doorway and windows, a ceiling,
# a porch roof on pillars, and stairs up to the roof.
F = 0.1875  # a foundation's top, with foundations centred at z = 0
WALL_Z = F + 1.5
CEIL_Z = F + 3.0 - 0.125


def homestead(door_open):
    for x in (0, 3):
        for y in (0, 3, -3):
            place("foundation", (x, y, 0))
    place("foundation", (6, -3, 0))
    # South face: the doorway and a window. North and west: walls. East: a window and a wall.
    place("doorframe", (0, -1.5, WALL_Z))
    place("door_open" if door_open else "door", (0, -1.5, WALL_Z - 1.5 + 2.3125 / 2))
    place("windowframe", (3, -1.5, WALL_Z))
    place("wall", (0, 4.5, WALL_Z), 180)
    place("wall", (3, 4.5, WALL_Z), 180)
    place("wall", (-1.5, 0, WALL_Z), 90)
    place("wall", (-1.5, 3, WALL_Z), 90)
    place("windowframe", (4.5, 0, WALL_Z), -90)
    place("wall", (4.5, 3, WALL_Z), -90)
    for x in (0, 3):
        for y in (0, 3, -3):
            place("ceiling", (x, y, CEIL_Z))
    for x in (0, 3):
        place("pillar", (x, -3, WALL_Z))
    place("stairs", (6, -3, WALL_Z), -90)


SHOTS = {}


def shot(name):
    def add(fn):
        SHOTS[name] = fn
        return fn

    return add


@shot("pieces")
def pieces():
    spots = {
        "wall": ((0, 0, 1.5), 0),
        "doorframe": ((4, 0, 1.5), 0),
        "windowframe": ((8, 0, 1.5), 0),
        "door": ((11.2, 0, 1.15625), 0),
        "pillar": ((13.4, 0, 1.5), 0),
        "foundation": ((0, 5, 0.1875), 0),
        "ceiling": ((4, 5, 0.125), 0),
        "stairs": ((8.5, 5.5, 1.5), 180),
        "door_open": ((12.4, 5.5, 1.15625), 0),
    }
    for name, (at, turn) in spots.items():
        place(name, at, turn)
    shoot("pieces.png", (6.5, -14, 7), (6.5, 2, 1.2), 32)
    clear()


@shot("alone")
def alone():
    """Each piece by itself, as the concept shows it."""
    views = {
        "wall": ((0, 0, 1.5), 0, (-2.6, -4.6, 2.1), (0.1, 0, 1.45), 32),
        "doorframe": ((0, 0, 1.5), 0, (-2.6, -4.6, 2.1), (0.1, 0, 1.45), 32),
        "windowframe": ((0, 0, 1.5), 0, (-2.6, -4.6, 2.1), (0.1, 0, 1.45), 32),
        "foundation": ((0, 0, 0.1875), 0, (-3.4, -4.2, 3.2), (0, 0, 0.1), 32),
        "ceiling": ((0, 0, 2.9), 0, (-3.0, -3.8, 0.9), (0, 0, 2.6), 30),
        "pillar": ((0, 0, 1.5), 0, (-2.6, -4.4, 2.3), (0, 0, 1.45), 35),
        "door": ((0, 0, 1.15625), 0, (-1.9, -3.9, 1.7), (0, 0, 1.1), 35),
        "stairs": ((0, 0, 1.5), 180, (-4.6, -4.6, 3.0), (0, 0, 1.2), 30),
    }
    for name, (at, turn, eye, target, lens) in views.items():
        if WANT & PIECE_NAMES and name not in WANT:
            continue
        place(name, at, turn)
        shoot(f"alone-{name}.png", eye, target, lens)
        clear()


@shot("closeup")
def closeup():
    for name, at, turn in (("wall", (0, 0, 1.5), 0), ("doorframe", (3, 0, 1.5), 0), ("door", (3, 0, 1.15625), 0), ("foundation", (0, 0, -F), 0), ("foundation", (3, 0, -F), 0)):
        place(name, at, turn)
    shoot("closeup-wall.png", (0.6, -3.2, 1.7), (1.4, 0, 1.3), 30)
    shoot("closeup-door.png", (2.2, -2.4, 1.4), (3, 0, 1.0), 35)
    clear()


@shot("house")
def house():
    homestead(door_open=False)
    shoot("house-front.png", (-4.6, -12.6, 1.75), (2.8, 0.6, 1.45), 30)
    if "quick" in WANT or FLAT:
        clear()
        return
    shoot("house-high.png", (-7, -15, 4.5), (2.0, 0.5, 1.6), 30)
    shoot("house-back.png", (14, 13, 6), (2.5, 0.5, 1.6), 30)
    clear()
    homestead(door_open=True)
    shoot("house-door-open.png", (-2.5, -8.5, 1.8), (0.5, -1.0, 1.4), 30)
    shoot("house-far.png", (-40, -70, 14), (2.5, 0.5, 1.5), 50)
    shoot("house-above.png", (-6, -12, 16), (2.5, 0.0, 2.5), 30)
    clear()


@shot("corner")
def corner():
    """Where two walls meet outside, and the wall foot on the foundation."""
    homestead(door_open=False)
    shoot("corner.png", (-3.6, -3.9, 2.3), (-1.5, -1.5, 1.4), 30)
    clear()


@shot("ends")
def ends():
    """Where a wall's end meets something: an outside corner, a doorframe and a
    window in a run, a free end, and an inside corner seen from the room."""
    for x in (0, 3, 6):
        for y in (0, 3):
            place("foundation", (x, y, 0))
    place("wall", (0, -1.5, WALL_Z))
    place("doorframe", (3, -1.5, WALL_Z))
    place("windowframe", (6, -1.5, WALL_Z))
    place("wall", (-1.5, 0, WALL_Z), 90)
    place("wall", (-1.5, 3, WALL_Z), 90)
    place("wall", (0, 4.5, WALL_Z), 180)
    shoot("ends-outside.png", (-4.6, -6.2, 2.1), (2.0, -1.5, 1.5), 30)
    shoot("ends-free.png", (9.8, -4.4, 2.2), (7.4, -1.5, 1.6), 32)
    shoot("ends-inside.png", (3.4, 2.2, 1.7), (-1.5, -1.5, 1.6), 30)
    shoot("ends-above.png", (-3.0, -3.6, 4.4), (-1.5, -1.5, 2.9), 30)
    shoot("ends-back-corner.png", (2.6, 1.6, 2.0), (-1.5, 4.5, 2.4), 30)
    clear()


@shot("row")
def row():
    """A long wall and a floor of many pieces, to see the joints and the repeat."""
    for i in range(6):
        place("foundation", (i * 3, 0, 0))
        place("foundation", (i * 3, 3, 0))
        place("wall" if i != 2 else "windowframe", (i * 3, 4.5, WALL_Z), 180)
    place("wall", (-1.5, 0, WALL_Z), 90)
    place("wall", (-1.5, 3, WALL_Z), 90)
    shoot("row.png", (2, -8, 4), (8, 3, 1.5), 28)
    clear()


PIECE_NAMES = {"wall", "doorframe", "windowframe", "foundation", "ceiling", "pillar", "door", "stairs"}
for name, fn in SHOTS.items():
    if not WANT - {"flat", "quick"} - PIECE_NAMES or name in WANT:
        fn()
print("render: done")
