# Review renders of the trees, in Cycles, under a low sun with a sky. Not part of the build.
#
#   blender --background --factory-startup --python render.py -- OUT_DIR SHOT [SHOT ...] [--level N] [--samples N] [--scale S]
#
# Shots: lineup_<kind> (every individual of a kind side by side, a figure 1.8 m tall for scale), near_<piece> (one tree
# from where a player stands), portrait_<piece> (one tree whole), crown_<piece> (looking up into one crown),
# stumps_<kind>, hall_<piece> (inside a banyan's colonnade), shore (mangroves at the water, palms, the hammock beyond),
# grove (a stand of them from eye height), hill (a hillside of them from across the water). --level N draws level N;
# a flat level is drawn in its palette colours with flat faces, as the game draws it.

import math
import os
import random
import runpy
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index("--") + 1 :]
OUT = os.path.abspath(args[0])


def opt(name, default, kind=float):
    return kind(args[args.index(name) + 1]) if name in args else default


LEVEL = opt("--level", 0, int)
SAMPLES = opt("--samples", 96, int)
SCALE = opt("--scale", 1.0)
SHOTS = [a for i, a in enumerate(args[1:], 1) if not a.startswith("--") and args[i - 1] not in ("--samples", "--scale", "--level")]
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
runpy.run_path(os.path.join(HERE, "model.py"), run_name="__main__")
scene = bpy.context.scene

PIECES = {}
for o in list(scene.objects):
    if o.type != "MESH":
        continue
    base, _, lod = o.name.partition("_LOD")
    if int(lod or 0) == LEVEL:
        PIECES[base] = o
    scene.collection.objects.unlink(o)
FLAT = not any(m.get("picture") and os.path.exists(os.path.join(HERE, "tex", m["picture"])) for o in PIECES.values() for m in o.data.materials)


# Materials -----------------------------------------------------------------------------------------------------------


from layout import picture_dir  # noqa: E402


def texture(nodes, path, data):
    node = nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(path, check_existing=True)
    if data:
        node.image.colorspace_settings.name = "Non-Color"
    node.interpolation = "Cubic"
    return node


def dress(material):
    """Puts a material's pictures on it: base colour with its alpha cut at a half, normal, and occlusion, roughness and
    metal. Leaves pass a little light, as leaves do."""
    name = material.get("picture")
    if not name:
        return
    folder = picture_dir(name)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    base = texture(nodes, os.path.join(folder, f"{name}_base.png"), False)
    normal = texture(nodes, os.path.join(folder, f"{name}_normal.png"), True)
    orm = texture(nodes, os.path.join(folder, f"{name}_orm.png"), True)
    for t in (base, normal, orm):
        links.new(uv.outputs["UV"], t.inputs["Vector"])
    split = nodes.new("ShaderNodeSeparateColor")
    links.new(orm.outputs["Color"], split.inputs["Color"])
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
    if "frond" in name or "leaves" in name or "moss" in name:
        cut = nodes.new("ShaderNodeMath")
        cut.operation = "GREATER_THAN"
        cut.inputs[1].default_value = 0.5
        links.new(base.outputs["Alpha"], cut.inputs[0])
        links.new(cut.outputs["Value"], bsdf.inputs["Alpha"])
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = 0.0
        if "Subsurface Weight" in bsdf.inputs:
            bsdf.inputs["Subsurface Weight"].default_value = 0.0


for m in list(bpy.data.materials):
    if not m.use_nodes:
        continue
    if m.get("picture"):
        dress(m)
    else:
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
if LEVEL >= 3 or FLAT:
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


def ground_material(colour=(0.30, 0.27, 0.20)):
    """Dry sandy ground with patches of grass: colours mixed by noise at two scales, with a bump."""
    m = plain("Ground", colour, 1.0)
    nodes, links = m.node_tree.nodes, m.node_tree.links
    coord = nodes.new("ShaderNodeTexCoord")
    big = nodes.new("ShaderNodeTexNoise")
    big.inputs["Scale"].default_value = 0.05
    big.inputs["Detail"].default_value = 6.0
    links.new(coord.outputs["Object"], big.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.12, 0.13, 0.05, 1)
    ramp.color_ramp.elements[1].position = 0.62
    ramp.color_ramp.elements[1].color = (*colour, 1)
    links.new(big.outputs["Fac"], ramp.inputs["Fac"])
    fine = nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 40.0
    links.new(coord.outputs["Object"], fine.inputs["Vector"])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.3
    links.new(ramp.outputs["Color"], mix.inputs["A"])
    links.new(fine.outputs["Color"], mix.inputs["B"])
    links.new(mix.outputs["Result"], nodes["Principled BSDF"].inputs["Base Color"])
    return m


# The stage -----------------------------------------------------------------------------------------------------------

stage = []


def put(piece, x, y, turn=0.0, z=0.0, size=1.0):
    """A piece standing with its origin on the ground at (x, y), turned `turn` degrees."""
    o = bpy.data.objects.new(piece, PIECES[piece].data)
    o.location = (x, y, z)
    o.rotation_euler = (0, 0, math.radians(turn))
    o.scale = (size, size, size)
    scene.collection.objects.link(o)
    stage.append(o)
    return o


def clear():
    for o in stage:
        bpy.data.objects.remove(o)
    stage.clear()


def figure(x, y):
    """A plain figure 1.8 m tall, for scale."""
    me = bpy.data.meshes.new("figure")
    o = bpy.data.objects.new("figure", me)
    scene.collection.objects.link(o)
    import bmesh

    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.2, radius2=0.17, depth=1.5)
    for v in bm.verts:
        v.co.z += 0.75
    head = bmesh.new()
    bmesh.ops.create_uvsphere(head, u_segments=12, v_segments=8, radius=0.12)
    for v in head.verts:
        v.co.z += 1.68
    bm.to_mesh(me)
    head_me = bpy.data.meshes.new("head")
    head.to_mesh(head_me)
    h = bpy.data.objects.new("head", head_me)
    scene.collection.objects.link(h)
    for ob in (o, h):
        ob.location = (x, y, 0)
        ob.data.materials.append(plain("figure", (0.25, 0.22, 0.18), 0.8))
        stage.append(ob)


ground = bpy.data.meshes.new("ground")
ground.from_pydata([(-3000, -3000, 0), (3000, -3000, 0), (3000, 3000, 0), (-3000, 3000, 0)], [], [(0, 1, 2, 3)])
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


def aim_sun(azimuth, elevation, strength=3.4, sky_strength=0.3, warm=(1.0, 0.88, 0.72)):
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
    cam.data.clip_end = 6000


scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.cycles.transparent_max_bounces = 48
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
if LEVEL >= 3:
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.4
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 92


def shoot(name, size=(1920, 1080)):
    scene.render.resolution_x = int(size[0] * SCALE)
    scene.render.resolution_y = int(size[1] * SCALE)
    scene.render.filepath = os.path.join(OUT, name + (f"_level{LEVEL}" if LEVEL else "") + ".jpg")
    bpy.ops.render.render(write_still=True)
    print("render: wrote", scene.render.filepath)


# Shots ---------------------------------------------------------------------------------------------------------------


def trees_of(kind):
    return sorted(p for p in PIECES if p.startswith(kind + "_") and not p.endswith("_depleted"))


for shot in SHOTS:
    kind, _, rest = shot.partition("_")
    if shot.startswith("lineup_"):
        names = trees_of(rest)
        spread = max(max(v.co.x for v in PIECES[n].data.vertices) - min(v.co.x for v in PIECES[n].data.vertices) for n in names)
        tall = max(max(v.co.z for v in PIECES[n].data.vertices) for n in names)
        gap = max(11.0, spread * 0.95)
        for i, n in enumerate(names):
            put(n, (i - (len(names) - 1) / 2) * gap, 0, turn=-90 + 37 * i)
        figure(-gap * 0.5 + 2.0, -3.0)
        aim_sun(-130, 24)
        width = gap * len(names)
        look((0, -width * 1.15, tall * 0.45), (0, 0, tall * 0.45), 35)
        shoot(shot, (2400, 1000))
        clear()
    elif shot.startswith("stumps_"):
        names = sorted(p for p in PIECES if p.startswith(rest + "_") and p.endswith("_depleted"))
        wide = max(max(abs(v.co.x) for v in PIECES[n].data.vertices if v.co.z > -0.05) for n in names)
        gap = max(1.6, wide * 2.4)
        for i, n in enumerate(names):
            put(n, (i - (len(names) - 1) / 2) * gap, 0, turn=31 * i)
        figure(-(len(names) / 2 + 0.3) * gap, 0.5)
        aim_sun(-140, 30)
        k = gap / 1.6
        look((0, -5.5 * k, 2.2 * min(k, 2.5)), (0, 0, 0.45), 40)
        shoot(shot, (1920, 1080))
        clear()
    elif shot.startswith("near_"):
        put(rest, 0, 0, turn=20)
        o = PIECES[rest]
        # Back from the trunk by as much as its foot is wide, so the foot fills the picture.
        foot = max(math.hypot(v.co.x, v.co.y) for v in o.data.vertices if v.co.z < 1.5 and math.hypot(v.co.x, v.co.y) < 3.0)
        k = max(1.0, foot / 0.5)
        figure(1.4 * k, -0.6 * k)
        aim_sun(-120, 28)
        look((-1.6 * k, -3.4 * k, 1.7), (0.1, 0, 1.0 * k), 30)
        shoot(shot, (1440, 1080))
        clear()
    elif shot.startswith("portrait_"):
        put(rest, 0, 0, turn=20)
        figure(2.0, -1.5)
        aim_sun(-130, 26)
        o = PIECES[rest]
        top = max(v.co.z for v in o.data.vertices)
        look((0, -top * 1.55, top * 0.45), (0, 0, top * 0.5), 35)
        shoot(shot, (1080, 1440))
        clear()
    elif shot.startswith("crown_"):
        put(rest, 0, 0, turn=20)
        aim_sun(-120, 50)
        o = PIECES[rest]
        top = max(v.co.z for v in o.data.vertices)
        look((-3.5, -4.5, 1.7), (0.0, 0.0, top - 2.5), 20)
        shoot(shot, (1080, 1440))
        clear()
    elif shot.startswith("hall_"):
        # Inside a banyan's colonnade, among its pillars, looking out past them.
        put(rest, 0, 0, turn=0)
        figure(-4.0, 3.0)
        aim_sun(-140, 35)
        look((4.5, -4.5, 1.7), (-9.0, 4.0, 3.4), 22)
        shoot(shot)
        clear()
    elif shot == "shore":
        # A shore as the map has one: mangroves at the water, palms behind on the sand, the hammock beyond.
        rng = random.Random(9)
        water = bpy.data.meshes.new("water")
        water.from_pydata([(-400, -400, 0.04), (400, -400, 0.04), (400, 6, 0.04), (-400, 6, 0.04)], [], [(0, 1, 2, 3)])
        wo = bpy.data.objects.new("water", water)
        wm = plain("water", (0.05, 0.12, 0.13), 0.08)
        wo.data.materials.append(wm)
        scene.collection.objects.link(wo)
        stage.append(wo)
        spots = []
        bands = [("mangrove", -2, 12, 8.0), ("palm", 12, 40, 9.0), ("tree", 40, 200, 17.0), ("fig", 40, 200, 20.0), ("banyan", 70, 220, 28.0), ("palm", 40, 220, 9.0)]
        for kind, y0, y1, gap in bands:
            names = trees_of(kind)
            for k in range(400):
                x, y = rng.uniform(-120, 120), rng.uniform(y0, y1)
                if any((x - a) ** 2 + (y - b) ** 2 < (gap * (0.8 if kind == "palm" else 1.0)) ** 2 for a, b in spots):
                    continue
                if kind in ("fig", "banyan") and rng.random() < 0.6:
                    continue
                spots.append((x, y))
                put(rng.choice(names), x, y, turn=rng.uniform(0, 360), size=rng.uniform(0.9, 1.15))
        aim_sun(-115, 24)
        look((6, -26, 3.0), (0, 40, 7), 26)
        shoot(shot)
        clear()
    elif shot in ("grove", "hill"):
        names = [p for p in PIECES if not p.endswith("_depleted")]
        rng = random.Random(4)
        spots = []
        far = shot == "hill"
        for k in range(1400 if far else 160):
            x, y = rng.uniform(-600, 600) if far else rng.uniform(-60, 60), rng.uniform(80, 900) if far else rng.uniform(4, 110)
            if any((x - a) ** 2 + (y - b) ** 2 < (36 if far else 30) for a, b in spots):
                continue
            spots.append((x, y))
            put(rng.choice(names), x, y, turn=rng.uniform(0, 360), size=rng.uniform(0.9, 1.1))
        aim_sun(-115, 22)
        if far:
            look((0, -380, 30), (0, 400, 0), 50)
        else:
            look((0, -2, 1.7), (0, 40, 6), 22)
        shoot(shot)
        clear()
