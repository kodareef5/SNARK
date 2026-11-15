"""Renders the dodo for review: runs its scripts as the build does, then draws it with Workbench, or with EEVEE when
the cards are cut out by a picture. Not one of the asset's scripts.

    blender --background --factory-startup --disable-autoexec --python ref/renders/render.py -- OUT [options]

views                the four views on the concept's canvas (view_<view>.png)
three                three-quarter and head close-ups
early [back]         three-quarter, side and front framed on the bird, plainly lit (three.png, side.png, front.png);
                     with back, from behind and above as well, lit from behind (back.png)
epose=NAME           with early: one of POSES from the three-quarter camera (pose-NAME.png)
pose=A,B [closeup]   POSES from the side and three-quarter (and the eye and head)
clips clip=NAME[:F/G/..] [efront] [ethree]   frames of a clip, with the clips files run too
clay                 one plain colour; otherwise the colour regions (islands: the texture's pieces)
cutout=PICTURE       EEVEE, the cards cut out by PICTURE's alpha (testcards.py makes a plain one)
nocards              the opaque surface alone
cull, nocavity, shadow, size=N, folder=DIR (where the scripts are; default this asset's folder)
"""
import math
import os
import runpy
import sys

import bpy
from mathutils import Matrix, Vector

FOLDER = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
argv = sys.argv[sys.argv.index("--") + 1:]
for o in argv:
    if o.startswith("folder="):
        FOLDER = o[7:]
OUT = argv[0]
opts = set(argv[1:])
os.makedirs(OUT, exist_ok=True)
sys.dont_write_bytecode = True
sys.path.insert(0, FOLDER)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
scripts = ["rig.py", "model.py"]
for extra in ("clips_move.py", "clips_act.py", "clips_life.py"):
    if "clips" in opts and os.path.exists(os.path.join(FOLDER, extra)):
        scripts.append(extra)
for s in scripts:
    runpy.run_path(os.path.join(FOLDER, s), run_name="__main__")
import rig  # noqa: E402

r = rig.find()
obj = bpy.data.objects["dodo_model"]
mesh = obj.data
if "nocards" in opts:
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == 1], context="FACES")
    bm.to_mesh(mesh)
    bm.free()
card_faces = [p.index for p in mesh.polygons if p.material_index == 1]

COLOURS = ["6B737A", "DDA58E", "8F8A5E", "C4983C", "3B302A", "E6DCC4", "202020"]
clay = "clay" in opts


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]


mats = []
for i, h in enumerate(COLOURS):
    m = bpy.data.materials.new(f"look_{i}")
    m.diffuse_color = srgb("B8B4AC" if clay else h)
    m.roughness = 0.7
    mats.append(m)
n_old = len(mesh.materials)
for m in mats:
    mesh.materials.append(m)
reg = mesh.attributes.get("region")
if "islands" in opts:
    names = list(obj["islands"])
    isl = mesh.attributes["island"].data
    import colorsys
    pal = []
    for i, nme in enumerate(names):
        m = bpy.data.materials.new(f"isl_{i}")
        h = (hash(nme) % 1000) / 1000.0
        m.diffuse_color = list(colorsys.hsv_to_rgb(h, 0.55, 0.85)) + [1]
        mesh.materials.append(m)
        pal.append(len(mesh.materials) - 1)
    for p in mesh.polygons:
        p.material_index = pal[isl[p.index].value]
    reg = None
if reg is not None:
    for p in mesh.polygons:
        v = reg.data[p.index].value
        p.material_index = n_old + (6 if v < 0 else v)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"
sh = scene.display.shading
sh.light = "STUDIO"
sh.color_type = "MATERIAL"
sh.show_cavity = True
sh.cavity_type = "WORLD"
sh.show_shadows = "shadow" in opts
scene.display.render_aa = "8"
sh.show_backface_culling = "cull" in opts
if "nocavity" in opts:
    sh.show_cavity = False
for o in list(opts):
    if o.startswith("cutout="):
        # EEVEE, one plain colour or the regions, with the cards cut out by a test picture
        scene.render.engine = "BLENDER_EEVEE"
        scene.eevee.taa_render_samples = 24
        scene.render.film_transparent = False
        scene.world = bpy.data.worlds.new("bg")
        scene.world.use_nodes = True
        bg = scene.world.node_tree.nodes["Background"]
        bg.inputs[0].default_value = (0.62, 0.61, 0.58, 1)
        bg.inputs[1].default_value = 1.25
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        sun.data.energy = 2.0
        sun.data.angle = math.radians(12)
        # from above, in front and to the bird's left, so faces towards the cameras are lit
        sun.rotation_euler = (math.radians(38), math.radians(0), math.radians(40))
        scene.collection.objects.link(sun)
        img = bpy.data.images.load(o[7:])
        for m in mesh.materials:
            if m.name.startswith("look_") or m.name.startswith("isl_"):
                m.use_nodes = True
                m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = m.diffuse_color
                m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
        card_m = bpy.data.materials.new("cardtest")
        card_m.use_nodes = True
        nt = card_m.node_tree
        p2 = nt.nodes["Principled BSDF"]
        p2.inputs["Roughness"].default_value = 0.85
        p2.inputs["Base Color"].default_value = mats[0].diffuse_color
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.links.new(tex.outputs["Alpha"], p2.inputs["Alpha"])
        card_m.surface_render_method = "DITHERED"
        mesh.materials.append(card_m)
        cc = len(mesh.materials) - 1
        reg_cards = mesh.attributes.get("region")
        for i in card_faces:
            mesh.polygons[i].material_index = cc
if "early" in opts:
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("bg")
    scene.world.color = (0.66, 0.65, 0.62)
    sh.show_shadows = True
    sh.shadow_intensity = 0.35
    sh.show_cavity = True

CANVAS, PXM, GROUND, SIDEC, TOPR = 1254, 1500.0, 1150, 640, 690
tb = rig.to_blender


def camera(name, loc, at, up, ortho=None, lens=50):
    d = bpy.data.cameras.new(name)
    c = bpy.data.objects.new(name, d)
    scene.collection.objects.link(c)
    loc, at = Vector(loc), Vector(at)
    f = (at - loc).normalized()
    rt = f.cross(Vector(up)).normalized()
    u = rt.cross(f)
    c.matrix_world = Matrix(((rt.x, u.x, -f.x, loc.x), (rt.y, u.y, -f.y, loc.y), (rt.z, u.z, -f.z, loc.z), (0, 0, 0, 1)))
    if ortho:
        d.type = "ORTHO"
        d.ortho_scale = ortho
    else:
        d.lens = lens
    d.clip_start, d.clip_end = 0.01, 20
    return c


half = CANVAS / 2
upc = (GROUND - half) / PXM
sc = CANVAS / PXM
sz = (SIDEC - half) / PXM
tz = (TOPR - half) / PXM
cams = {
    "side": camera("side", tb((3, upc, sz)), tb((0, upc, sz)), (0, 0, 1), sc),
    "front": camera("front", tb((0, upc, 3)), tb((0, upc, 0)), (0, 0, 1), sc),
    "back": camera("back", tb((0, upc, -3)), tb((0, upc, 0)), (0, 0, 1), sc),
    "top": camera("top", tb((0, 3, tz)), tb((0, 0, tz)), tb((0, 0, 1)), sc),
    "three": camera("three", tb((1.25, 0.75, 1.55)), tb((0, 0.33, 0.04)), (0, 0, 1), lens=60),
    "head": camera("head", tb((0.9, 0.62, 0.75)), tb((0, 0.575, 0.2)), (0, 0, 1), lens=110),
    "eye": camera("eye", tb((0.5, 0.60, 0.42)), tb((0.045, 0.583, 0.18)), (0, 0, 1), lens=200),
    "headside": camera("headside", tb((3, 0.57, 0.2)), tb((0, 0.57, 0.2)), (0, 0, 1), 0.32),
    "headfront": camera("headfront", tb((0, 0.57, 3)), tb((0, 0.57, 0)), (0, 0, 1), 0.24),
    "pose": camera("pose", tb((3, 0.38, 0.05)), tb((0, 0.38, 0.05)), (0, 0, 1), 1.0),
    "eside": camera("eside", tb((3, 0.335, 0.05)), tb((0, 0.335, 0.05)), (0, 0, 1), 0.78),
    "efront": camera("efront", tb((0, 0.335, 3)), tb((0, 0.335, 0)), (0, 0, 1), 0.78),
    "ethree": camera("ethree", tb((1.35, 0.78, 1.45)), tb((0, 0.34, 0.03)), (0, 0, 1), lens=95),
    "eback": camera("eback", tb((-1.0, 0.85, -1.5)), tb((0, 0.40, 0.0)), (0, 0, 1), lens=85),
    "posethree": camera("posethree", tb((1.6, 0.8, 1.9)), tb((0, 0.3, 0.04)), (0, 0, 1), lens=55),
}


def shoot(cam, name, size):
    scene.camera = cams[cam]
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)


POSES = {
    "peck": {"body": dict(pos=(0, 0.28, -0.02), pitch=-14), "head": dict(pos=(0, 0.47, 0.25), pitch=-32), "beak": 0.35,
             "neck": {"neck_1": dict(pitch=-8), "neck_2": dict(pitch=-6)}},
    "ground_peck": {"body": dict(pos=(0, 0.25, -0.03), pitch=-32), "head": dict(pos=(0, 0.15, 0.30), pitch=-75), "beak": 0.2,
                    "neck": {"neck_1": dict(pitch=-20), "neck_2": dict(pitch=-15), "neck_3": dict(pitch=-10)}},
    "startled": {"body": dict(pos=(0, 0.31, -0.03), pitch=10), "head": dict(pos=(0, 0.60, 0.10), pitch=38), "beak": 1.0,
                 "wings": dict(out=1.0, flap=8), "hood": 1.0, "tail": dict(lift=20), "throat": 0.5},
    "lying": {"body": dict(pos=(0.0, 0.150, -0.03), roll=82, pitch=-4), "head": dict(pos=(0.22, 0.07, 0.19), roll=75, pitch=-15),
              "feet": {"l": dict(pos=(-0.19, 0.05, 0.07), roll=80, pitch=-35), "r": dict(pos=(-0.17, 0.17, 0.04), roll=80, pitch=-35)},
              "knees": {"l": (-0.10, 0.02, -0.25), "r": (-0.10, 0.20, -0.25)}, "eyes": 1.0,
              "neck": {"neck_1": dict(roll=20), "neck_2": dict(roll=20)}},
    "shut": {"eyes": 1.0, "beak": 1.0, "throat": 1.0},
}


def pose(name):
    spec = POSES[name]
    r.rest()
    c = rig.Clip(r, "_pose_" + name, 1)
    c.action = bpy.data.actions.new("_pose_" + name)
    r.obj.animation_data.action = c.action
    if "body" in spec:
        c.body(0, **spec["body"])
    if "head" in spec:
        c.head(0, **spec["head"])
    for bone, rot in spec.get("neck", {}).items():
        c.bone(0, bone, **rot)
    for side, f in spec.get("feet", {}).items():
        c.foot(0, side, **f)
    for side, p in spec.get("knees", {}).items():
        c.knee(0, side, p)
    if "beak" in spec:
        c.beak(0, spec["beak"])
    for side in "lr" if "wings" in spec else "":
        c.wing(0, side, **spec["wings"])
    if "hood" in spec:
        c.hood(0, spec["hood"])
    if "tail" in spec:
        c.tail(0, **spec["tail"])
    if "throat" in spec:
        c.throat(0, spec["throat"])
    if "eyes" in spec:
        c.eyes(0, spec["eyes"])
    scene.frame_set(0)


size = 900
for o in opts:
    if o.startswith("size="):
        size = int(o[5:])
r.rest()
if "views" in opts:
    for v in ("side", "front", "back", "top"):
        shoot(v, f"view_{v}.png", CANVAS)
if "three" in opts:
    shoot("three", "three.png", size)
    shoot("head", "head.png", size)
    shoot("headside", "headside.png", size)
    shoot("headfront", "headfront.png", size)
    shoot("eye", "eye.png", size)
if "early" in opts:
    for cam in ("ethree", "eside", "efront"):
        shoot(cam, f"{cam[1:]}.png", size)
    if "back" in opts:
        sun = bpy.data.objects.get("sun")
        if sun is not None:
            turned = sun.rotation_euler.copy()
            sun.rotation_euler = (math.radians(38), 0, math.radians(200))
        shoot("eback", "back.png", size)
        if sun is not None:
            sun.rotation_euler = turned
    for o in opts:
        if o.startswith("epose="):
            name = o[6:]
            pose(name)
            shoot("ethree", f"pose-{name}.png", size)
            r.rest()
for o in opts:
    if o.startswith("pose="):
        for name in o[5:].split(","):
            pose(name)
            shoot("pose", f"pose_{name}_side.png", size)
            shoot("posethree", f"pose_{name}_three.png", size)
            if "closeup" in opts:
                shoot("eye", f"pose_{name}_eye.png", size)
                shoot("head", f"pose_{name}_head.png", size)
            r.rest()
for o in opts:
    if o.startswith("clip="):
        name, _, frames = o[5:].partition(":")
        act = bpy.data.actions[name]
        r.rest()
        r.obj.animation_data.action = act
        if act.slots:
            r.obj.animation_data.action_slot = act.slots[0]
        last = int(act.frame_range[1])
        picks = [int(x) for x in frames.split("/")] if frames else [round(k * last / 5) for k in range(6)]
        for f in picks:
            scene.frame_set(f)
            for cam in ("eside", "ethree", "efront"):
                if cam in opts or (cam == "eside" and not any(c in opts for c in ("ethree", "efront"))):
                    shoot(cam, f"clip_{name}_{cam}_{f:03d}.png", size)
        r.rest()
print("look: done")
