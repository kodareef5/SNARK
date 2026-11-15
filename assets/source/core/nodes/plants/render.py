# Review renders of the low plants in Cycles, under a low sun and a sky. Not part of the build.
#
#   blender --background --factory-startup --python render.py -- OUT_DIR [SHOT ...] [--flat N] [--samples N] [--scale S]
#
# With no shots named, every shot is drawn. --flat N draws level N in its palette colours with flat faces, as the low
# setting and far distances draw it.

import math
import os
import runpy
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index("--") + 1 :]
OUT = os.path.abspath(args[0])


def opt(name, default, kind=float):
    return kind(args[args.index(name) + 1]) if name in args else default


FLAT = opt("--flat", None, int)
SAMPLES = opt("--samples", 128, int)
SCALE = opt("--scale", 1.0)
WANTED = [a for i, a in enumerate(args[1:], 1) if not a.startswith("--") and args[i - 1] not in ("--samples", "--scale", "--flat")]
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import kit  # noqa: E402

kit.APART = 0.0006
runpy.run_path(os.path.join(HERE, "model.py"), run_name="__main__")

scene = bpy.context.scene
LEVEL = FLAT or 0
MESHES = {}
for o in list(scene.objects):
    if o.type != "MESH":
        continue
    base, _, lod = o.name.partition("_LOD")
    if int(lod or 0) == LEVEL:
        MESHES[base] = o.data
    bpy.data.objects.remove(o)

# Berry colours as the palette has them (sRGB), by the name a shot gives.
BERRIES = {"red": (218, 43, 43), "blue": (28, 28, 158), "violet": (93, 28, 158), "amber": (218, 130, 43), "black": (36, 40, 42), "white": (245, 245, 245)}


def linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# Materials -----------------------------------------------------------------------------------------------------------


def image(path, data):
    img = bpy.data.images.load(path, check_existing=True)
    if data:
        img.colorspace_settings.name = "Non-Color"
    return img


def grey_under(base, regions):
    """The mean light of the base colour where the regions dye it, as the game reads it."""
    b = np.array(base.pixels[:], dtype=np.float32).reshape(-1, 4)
    r = np.array(regions.pixels[:], dtype=np.float32).reshape(-1, 4)
    mask = r[:, 0] > 0.5
    if not mask.any():
        return 1.0
    lum = 0.2126 * b[mask, 0] + 0.7152 * b[mask, 1] + 0.0722 * b[mask, 2]
    return float(lum.mean())


def dress(m):
    """Puts a kind's atlas on the material model.py made for it. The berries take the colour of the object."""
    name = m.get("picture")
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes["Principled BSDF"]
    if name == "region0":
        info = nodes.new("ShaderNodeObjectInfo")
        links.new(info.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.35
        return
    if not name:
        return
    folder = os.path.join(HERE, "tex", name)
    files = {k: os.path.join(folder, f"{name}_{k}.png") for k in ("base", "normal", "orm", "regions")}
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"

    def tex(path, data):
        n = nodes.new("ShaderNodeTexImage")
        n.image = image(path, data)
        n.interpolation = "Cubic"
        links.new(uv.outputs["UV"], n.inputs["Vector"])
        return n

    base = tex(files["base"], False)
    colour = base.outputs["Color"]
    if os.path.exists(files["regions"]):
        reg = tex(files["regions"], True)
        grey = grey_under(base.image, reg.image)
        info = nodes.new("ShaderNodeObjectInfo")
        scale = nodes.new("ShaderNodeVectorMath")
        scale.operation = "SCALE"
        scale.inputs["Scale"].default_value = 1 / max(grey, 1e-3)
        links.new(info.outputs["Color"], scale.inputs[0])
        dyed = nodes.new("ShaderNodeMix")
        dyed.data_type = "RGBA"
        dyed.blend_type = "MULTIPLY"
        red = nodes.new("ShaderNodeSeparateColor")
        links.new(reg.outputs["Color"], red.inputs["Color"])
        links.new(red.outputs["Red"], dyed.inputs["Factor"])
        links.new(colour, dyed.inputs["A"])
        links.new(scale.outputs["Vector"], dyed.inputs["B"])
        colour = dyed.outputs["Result"]
    orm = tex(files["orm"], True)
    split = nodes.new("ShaderNodeSeparateColor")
    links.new(orm.outputs["Color"], split.inputs["Color"])
    shade = nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 0.6
    links.new(colour, shade.inputs["A"])
    links.new(split.outputs["Red"], shade.inputs["B"])
    links.new(shade.outputs["Result"], bsdf.inputs["Base Color"])
    links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    normal = tex(files["normal"], True)
    bump = nodes.new("ShaderNodeNormalMap")
    bump.uv_map = "UVMap"
    links.new(normal.outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    cut = nodes.new("ShaderNodeMath")
    cut.operation = "GREATER_THAN"
    cut.inputs[1].default_value = 0.5
    links.new(base.outputs["Alpha"], cut.inputs[0])
    links.new(cut.outputs["Value"], bsdf.inputs["Alpha"])
    # Thin leaves pass a little light: a translucent layer mixed under the surface, lit from behind.
    out = nodes["Material Output"]
    through = nodes.new("ShaderNodeBsdfTranslucent")
    links.new(shade.outputs["Result"], through.inputs["Color"])
    links.new(bump.outputs["Normal"], through.inputs["Normal"])
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.12
    links.new(bsdf.outputs["BSDF"], mix.inputs[1])
    links.new(through.outputs["BSDF"], mix.inputs[2])
    hole = nodes.new("ShaderNodeBsdfTransparent")
    cutmix = nodes.new("ShaderNodeMixShader")
    links.new(cut.outputs["Value"], cutmix.inputs["Fac"])
    links.new(hole.outputs["BSDF"], cutmix.inputs[1])
    links.new(mix.outputs["Shader"], cutmix.inputs[2])
    links.new(cutmix.outputs["Shader"], out.inputs["Surface"])


for m in list(bpy.data.materials):
    if not m.use_nodes:
        continue
    # Each card has its back as faces of its own, so nothing is culled here.
    m.use_backface_culling = False
    if FLAT is not None:
        if m.get("picture") == "region0":
            dress(m)
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
        continue
    dress(m)
if FLAT is not None:
    for me in MESHES.values():
        for p in me.polygons:
            p.use_smooth = False


def plain(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m


def noisy(name, dark, light, scale, rough=0.95, bump=0.3):
    """A ground or stone colour mixed by noise at two scales, with a bump."""
    m = plain(name, dark, rough)
    nodes, links = m.node_tree.nodes, m.node_tree.links
    coord = nodes.new("ShaderNodeTexCoord")
    big = nodes.new("ShaderNodeTexNoise")
    big.inputs["Scale"].default_value = scale
    big.inputs["Detail"].default_value = 6.0
    links.new(coord.outputs["Object"], big.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.3
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (*light, 1)
    links.new(big.outputs["Fac"], ramp.inputs["Fac"])
    fine = nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = scale * 300
    links.new(coord.outputs["Object"], fine.inputs["Vector"])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.3
    links.new(ramp.outputs["Color"], mix.inputs["A"])
    links.new(fine.outputs["Color"], mix.inputs["B"])
    links.new(mix.outputs["Result"], nodes["Principled BSDF"].inputs["Base Color"])
    b = nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = bump
    links.new(fine.outputs["Fac"], b.inputs["Height"])
    links.new(b.outputs["Normal"], nodes["Principled BSDF"].inputs["Normal"])
    return m


def tiled(name, stem, metres, tint=(1.0, 1.0, 1.0)):
    """A tiling material of another asset's, for the stage only: the earth of the thatch tier's foundations, the
    masonry of the stone tier. Mapped from above or from the side in metres. None where its pictures are not here."""
    files = {k: os.path.join(HERE, f"{stem}_{k}.png") for k in ("base", "normal", "orm")}
    if not all(os.path.exists(f) for f in files.values()):
        return None
    m = plain(name, (0.5, 0.5, 0.5), 0.9)
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coord = nodes.new("ShaderNodeTexCoord")
    scale = nodes.new("ShaderNodeMapping")
    scale.inputs["Scale"].default_value = (1 / metres, 1 / metres, 1 / metres)
    links.new(coord.outputs["Object"], scale.inputs["Vector"])

    def tex(path, data):
        n = nodes.new("ShaderNodeTexImage")
        n.image = image(path, data)
        n.projection = "BOX"
        n.projection_blend = 0.2
        links.new(scale.outputs["Vector"], n.inputs["Vector"])
        return n

    base = tex(files["base"], False)
    lift = nodes.new("ShaderNodeMix")
    lift.data_type = "RGBA"
    lift.blend_type = "MULTIPLY"
    lift.inputs["Factor"].default_value = 1.0
    lift.inputs["B"].default_value = (*tint, 1)
    links.new(base.outputs["Color"], lift.inputs["A"])
    links.new(lift.outputs["Result"], bsdf.inputs["Base Color"])
    orm = tex(files["orm"], True)
    split = nodes.new("ShaderNodeSeparateColor")
    links.new(orm.outputs["Color"], split.inputs["Color"])
    links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    normal = tex(files["normal"], True)
    bump = nodes.new("ShaderNodeNormalMap")
    links.new(normal.outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


# The stage -----------------------------------------------------------------------------------------------------------

stage = []


def put(name, x, y, turn=0.0, size=1.0, berry="red"):
    o = bpy.data.objects.new(name, MESHES[name])
    o.location = (x, y, 0)
    o.rotation_euler = (0, 0, math.radians(turn))
    o.scale = (size, size, size)
    o.color = (*[linear(c) for c in BERRIES[berry]], 1)
    scene.collection.objects.link(o)
    stage.append(o)
    return o


def box(name, centre, size, mat, turn=0.0):
    me = bpy.data.meshes.new(name)
    sx, sy, sz = (s / 2 for s in size)
    v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz), (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me.from_pydata(v, [], f)
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    o.location = centre
    o.rotation_euler = (0, 0, math.radians(turn))
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
ground_obj.data.materials.append(tiled("Ground", "../../structures/thatch/tex/earth/earth", 1.5, (1.25, 1.18, 1.05)) or noisy("Ground", (0.22, 0.16, 0.085), (0.31, 0.23, 0.125), 0.6, 1.0, 0.15))
scene.collection.objects.link(ground_obj)
STONE = tiled("Masonry", "../../structures/stone/tex/masonry/masonry", 3.0) or noisy("Limestone", (0.30, 0.27, 0.21), (0.50, 0.46, 0.37), 1.2, 0.9, 0.6)

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


def aim_sun(azimuth, elevation, strength=3.2, sky_strength=0.3, warm=(1.0, 0.88, 0.72)):
    """Azimuth in degrees from +y toward +x, elevation above the ground."""
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
    cam.data.clip_end = 3000


scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.cycles.transparent_max_bounces = 32
if "--cpu" not in args:
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "METAL"
        scene.cycles.device = "GPU"
    except Exception as e:
        print("render: no GPU,", e)
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Punchy"
if FLAT is not None:
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.4
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 92


def shoot(name, size=(1920, 1080)):
    scene.render.resolution_x = int(size[0] * SCALE)
    scene.render.resolution_y = int(size[1] * SCALE)
    scene.render.filepath = os.path.join(OUT, name + (f"_flat{FLAT}" if FLAT is not None else "") + ".jpg")
    bpy.ops.render.render(write_still=True)
    print("render: wrote", scene.render.filepath)


def wanted(name):
    return not WANTED or name in WANTED


def kinds():
    out = {}
    for n in MESHES:
        k = n.split("_")[0]
        if n.endswith("depleted"):
            continue
        out.setdefault(k, []).append(n)
    return out


class Rand:
    def __init__(self, seed):
        self.r = kit.Rng(seed)

    def __call__(self, a=0.0, b=1.0):
        return self.r.uniform(a, b)


def undergrowth(side, seed, wall=True):
    """A patch of every kind, as the far-layer counts would have it dense, along the foot of a ruined wall."""
    r = Rand(seed)
    ks = kinds()
    mix = [("fern", 4, 1.6), ("palmetto", 3, 2.6), ("bush", 2, 2.2), ("creeper", 1, 3.0), ("seagrape", 1, 3.4)]
    bag = [k for k, w, _ in mix if k in ks for _ in range(w)]
    gap = {k: g for k, _, g in mix}
    spots = []
    for _ in range(4000):
        x, y = r(-side / 2, side / 2), r(-side / 2, side / 2)
        k = bag[int(r() * len(bag)) % len(bag)]
        if wall and y > side / 2 - 2.0 and k not in ("creeper", "fern"):
            continue
        if any((sx - x) ** 2 + (sy - y) ** 2 < ((g + gap[k]) / 2) ** 2 for sx, sy, g in spots):
            continue
        spots.append((x, y, gap[k]))
        names = ks[k]
        put(names[int(r() * len(names)) % len(names)], x, y, r(0, 360), r(0.85, 1.15), ["red", "red", "blue", "violet", "amber"][int(r() * 5) % 5])
    if wall:
        box("wall", (0, side / 2 + 0.3, 1.1), (side * 0.8, 0.5, 2.2), STONE, 2)
        box("wall2", (side * 0.3, side / 2 + 0.3, 2.6), (side * 0.25, 0.5, 1.2), STONE, 2)


# Shots ---------------------------------------------------------------------------------------------------------------

# One of each kind close up, from where a player stands: name, distance, height looked at.
HEROES = {"bush": (2.7, 0.55), "palmetto": (3.4, 0.6), "fern": (2.6, 0.35), "seagrape": (4.6, 0.75), "creeper": (4.4, 0.55)}
for kind, (far, at) in HEROES.items():
    for n in range(1, 5):
        name = f"{kind}_{n}"
        for cut in ("", "_depleted"):
            shot = f"hero_{name}{cut}"
            if not wanted(shot) or name + cut not in MESHES:
                continue
            put(name + cut, 0, 0, 20)
            aim_sun(-140, 30)
            look((-far * 0.45, -far * 0.9, 1.7), (0, 0, at), 35)
            shoot(shot, (1440, 1080))
            clear()

if wanted("colours") and "bush_1" in MESHES:
    names = [n for n in ("bush_1", "bush_2", "bush_3", "bush_4", "bush_1", "bush_2") if n in MESHES]
    for i, (n, c) in enumerate(zip(names, BERRIES)):
        put(n, (i - 2.5) * 1.75, 0, i * 57, 1.0, c)
    aim_sun(-140, 28)
    look((0, -8.5, 2.6), (0, 0, 0.5), 50)
    shoot("colours", (1920, 720))
    clear()

if wanted("picked") and "bush_1_depleted" in MESHES:
    put("bush_1", -0.9, 0, 20)
    put("bush_1_depleted", 0.9, 0, 20)
    aim_sun(-140, 30)
    look((0, -4.2, 1.7), (0, 0, 0.5), 35)
    shoot("picked", (1920, 1080))
    clear()

for kind, names in kinds().items():
    for cut in (False, True):
        shot = f"kind_{kind}" + ("_cut" if cut else "")
        if not wanted(shot):
            continue
        row = [n + "_depleted" for n in names if n + "_depleted" in MESHES] if cut else names
        span = 3.0 if kind in ("seagrape", "creeper") else 2.2
        for i, n in enumerate(row):
            put(n, (i - (len(row) - 1) / 2) * span, 0, 30 + i * 70)
        aim_sun(-140, 30)
        far = (len(row) * span) * 0.95 + 1.5
        look((0, -far, 1.7 + far * 0.13), (0, 0, 0.45), 50)
        shoot(shot, (1920, 900))
        clear()

if wanted("undergrowth"):
    undergrowth(20, 7)
    aim_sun(-130, 26)
    look((-1.5, -11.5, 1.7), (0.5, 0, 0.6), 30)
    shoot("undergrowth")
    if wanted("far"):
        look((-6, -48, 3.0), (0, 0, 0.6), 50)
        shoot("far")
    clear()
