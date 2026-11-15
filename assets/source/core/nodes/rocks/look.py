# A quick look at carved solids in clay, to judge a form before it is baked: one picture of each, side by side, from
# about where the concept sheets stand (a three-quarter view a little above), or turned to four sides.
#   blender -b --factory-startup --python look.py -- <out.png> [--turn] rock_1 [...]
# ROCK_CACHE names another folder of solids (sculpt.py writes there too), so a coarse trial leaves the bake's alone.

import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True

import png  # noqa: E402
from sculpt import cached  # noqa: E402

W, H = (int(v) for v in os.environ.get("LOOK_SIZE", "560x380").split("x"))


def load_high(name):
    z = np.load(cached(name))
    verts, quads = z["verts"], z["quads"]
    me = bpy.data.meshes.new(name + "_high")
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set("vertex_index", quads.ravel())
    me.polygons.add(len(quads))
    me.polygons.foreach_set("loop_start", np.arange(0, quads.size, 4))
    me.polygons.foreach_set("loop_total", np.full(len(quads), 4))
    me.update()
    me.validate()
    me.shade_smooth()
    ob = bpy.data.objects.new(name + "_high", me)
    bpy.context.scene.collection.objects.link(ob)
    above = verts[verts[:, 2] > -0.02]
    return ob, above.min(axis=0), above.max(axis=0)


def stage():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "GPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("sky")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.5, 0.6, 0.78, 1)
    bg.inputs[1].default_value = 0.7
    # The concept sheets' light: high, from the upper left and a little behind.
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.6
    sun.data.angle = math.radians(1.5)
    sun.rotation_euler = (math.radians(40), 0, math.radians(-150))
    sc.collection.objects.link(sun)
    ground = bpy.data.meshes.new("ground")
    s = 60
    ground.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    m = bpy.data.materials.new("sand")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.75, 0.58, 0.42, 1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    ground.materials.append(m)
    sc.collection.objects.link(bpy.data.objects.new("ground", ground))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def aim(cam, lo, hi, yaw, pitch):
    """The camera `yaw` degrees round from the front (-Y) and `pitch` above, far enough to hold the whole solid."""
    centre = (lo + hi) / 2
    centre[2] = (hi[2]) * 0.45
    size = max(float(np.hypot(hi[0] - lo[0], hi[1] - lo[1])) * 0.62, float(hi[2]) * 1.5, 1.0)
    dist = size / math.tan(cam.data.angle / 2) * 1.08
    a, b = math.radians(yaw), math.radians(pitch)
    d = np.array([math.sin(a) * math.cos(b), -math.cos(a) * math.cos(b), math.sin(b)])
    at = centre + d * dist
    cam.location = at
    v = centre - at
    cam.rotation_euler = (math.atan2(math.hypot(v[0], v[1]), -v[2]), 0, math.atan2(v[1], v[0]) - math.pi / 2)


def clay():
    m = bpy.data.materials.new("clay")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.36, 0.31, 0.24, 1)
    b.inputs["Roughness"].default_value = 0.85
    return m


def shot(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    a = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(H, W, 4)[::-1, :, :3]


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    out = args[0]
    turn = "--turn" in args
    names = [a for a in args[1:] if not a.startswith("--")]
    sc, cam = stage()
    mat = clay()
    tiles = []
    tmp = out + ".tile.png"
    for name in names:
        ob, lo, hi = load_high(name)
        ob.data.materials.append(mat)
        row = []
        for yaw in ((0, 90, 180, 270) if turn else (25,)):
            aim(cam, lo, hi, yaw, 16)
            row.append(shot(sc, tmp))
        tiles.append(np.concatenate(row, axis=1))
        bpy.data.objects.remove(ob)
    os.remove(tmp)
    if turn:
        sheet = np.concatenate(tiles, axis=0)
    else:
        cols = min(3, len(tiles))
        while len(tiles) % cols:
            tiles.append(np.ones_like(tiles[0]))
        sheet = np.concatenate([np.concatenate(tiles[r:r + cols], axis=1) for r in range(0, len(tiles), cols)], axis=0)
    png.write(out, sheet)
    print("look: wrote", out)
