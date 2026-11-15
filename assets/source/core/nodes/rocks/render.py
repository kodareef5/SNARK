# Review renders of the rocks as the game has them (the game meshes in mesh/, their pictures in tex/<name>/) in
# Blender's light: a sun with shadows and a sky. Each scene places rocks as nodes stand, on their origins, turned and
# sized, on sand or grass, with a 1.8 m figure for scale.
#   blender -b --factory-startup --python render.py -- <scene> <out.png> [width height samples]
# Scenes: sheet_<family> (the whole rocks), broken_<family> (what is left of them), pairs_<family> (each beside what is
# left of it), for the families rock, metal_rock and rubble; shore, hillside, ruins.

import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True

from meshio import read_obj  # noqa: E402

LIMESTONE = [f"rock_{k}" for k in range(1, 7)]
ORE = [f"metal_rock_{k}" for k in range(1, 4)]
RUBBLE = [f"rubble_{k}" for k in range(1, 4)]


def material(name):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = os.path.join(HERE, "tex", name.removesuffix("_depleted"))

    def image(kind, data):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(os.path.join(tex, f"{name}_{kind}.png"), check_existing=True)
        if data:
            n.image.colorspace_settings.name = "Non-Color"
        return n

    nt.links.new(image("base", False).outputs[0], bsdf.inputs["Base Color"])
    orm = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(image("orm", True).outputs[0], orm.inputs[0])
    nt.links.new(orm.outputs[1], bsdf.inputs["Roughness"])
    nt.links.new(orm.outputs[2], bsdf.inputs["Metallic"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(image("normal", True).outputs[0], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    return mat


def mesh(name):
    me = bpy.data.meshes.get(name)
    if me:
        return me
    verts, uvs, tris, tri_uvs, _ = read_obj(os.path.join(HERE, "mesh", f"{name}.obj"))
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(tris.size)
    me.loops.foreach_set("vertex_index", tris.ravel())
    me.polygons.add(len(tris))
    me.polygons.foreach_set("loop_start", np.arange(0, tris.size, 3))
    me.polygons.foreach_set("loop_total", np.full(len(tris), 3))
    me.uv_layers.new(name="UVMap").data.foreach_set("uv", uvs[tri_uvs.ravel()].ravel())
    me.update()
    me.shade_smooth()
    me.materials.append(material(name))
    return me


def place(name, x, y, turn=0.0, size=1.0, z=0.0):
    ob = bpy.data.objects.new(name, mesh(name))
    ob.location = (x, y, z)
    ob.rotation_euler = (0, 0, math.radians(turn))
    ob.scale = (size, size, size)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def stage(width, height, samples, ground=(0.6, 0.53, 0.4), sun=(50, 205)):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = width, height
    sc.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("sky")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.45, 0.6, 0.85, 1)
    bg.inputs[1].default_value = 0.8
    light = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    light.data.energy = 4.0
    light.data.angle = math.radians(1.0)
    light.rotation_euler = (math.radians(90 - sun[0]), 0, math.radians(sun[1]))
    sc.collection.objects.link(light)
    # The ground: sand or grass with a little variation, large.
    g = bpy.data.meshes.new("ground")
    s = 400
    g.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    m = bpy.data.materials.new("ground")
    m.use_nodes = True
    nt = m.node_tree
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.6
    noise.inputs["Detail"].default_value = 6
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*[c * 0.82 for c in ground], 1)
    ramp.color_ramp.elements[1].color = (*ground, 1)
    nt.links.new(noise.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], nt.nodes["Principled BSDF"].inputs["Base Color"])
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    g.materials.append(m)
    sc.collection.objects.link(bpy.data.objects.new("ground", g))
    return sc


def figure(x, y, turn=0):
    """A plain 1.8 m figure for scale."""
    bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=1.45, location=(x, y, 0.725))
    body = bpy.context.object
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.13, location=(x, y, 1.62))
    m = bpy.data.materials.new("figure")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.22, 0.18, 1)
    for ob in (body, bpy.context.object):
        ob.data.materials.append(m)


def camera(sc, at, target, lens=35):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = lens
    cam.data.clip_end = 2000
    sc.collection.objects.link(cam)
    cam.location = at
    d = np.asarray(target, float) - np.asarray(at, float)
    cam.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)
    sc.camera = cam


def sheet(names, sc, turn=0.0):
    """The rocks in rows of three, as the concept sheets have them, seen a little from above, a figure for scale."""
    cols = 3
    rows = (len(names) + cols - 1) // cols
    for k, n in enumerate(names):
        r, c = divmod(k, cols)
        place(n, (c - (cols - 1) / 2) * 4.7, (rows - 1 - r) * 5.0, turn=turn)
    figure(7.4, (rows - 1) * 5.0 + 1.0)
    depth = (rows - 1) * 5.0
    camera(sc, (0, -11.5 - depth * 0.6, 5.2 + depth * 0.45), (0, depth * 0.42, 0.5), lens=40 if rows > 1 else 30)


def pairs(names, sc):
    """Each rock and, beside it, what is left of it."""
    for k, n in enumerate(names):
        y = (len(names) - 1 - k) * 4.6
        place(n, -2.0, y, turn=0)
        place(n + "_depleted", 2.4, y, turn=0)
    depth = (len(names) - 1) * 4.6
    camera(sc, (0, -9.5 - depth * 0.5, 4.8 + depth * 0.5), (0.2, depth * 0.45, 0.4), lens=40)


def scatter(names, weights, count, area, seed, spacing=3.5, sizes=(0.8, 1.25)):
    rng = np.random.default_rng(seed)
    spots = []
    while len(spots) < count:
        x, y = rng.uniform(area[0], area[1]), rng.uniform(area[2], area[3])
        if all(math.hypot(x - a, y - b) > spacing for a, b in spots):
            spots.append((x, y))
    p = np.asarray(weights, float) / sum(weights)
    for x, y in spots:
        place(names[rng.choice(len(names), p=p)], x, y, rng.uniform(0, 360), rng.uniform(*sizes))


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    scene, out = args[0], args[1]
    w, h, samples = (int(a) for a in (args[2:5] if len(args) >= 5 else (1600, 900, 64)))
    families = {"rock": LIMESTONE, "metal_rock": ORE, "rubble": RUBBLE}
    # The sheets: on the concept's pale sand, the sun high over the left shoulder.
    if scene.startswith("sheet_"):
        sc = stage(w, h, samples, ground=(0.62, 0.47, 0.35), sun=(48, 315))
        sheet(families[scene[len("sheet_"):]], sc)
    elif scene.startswith("broken_"):
        sc = stage(w, h, samples, ground=(0.62, 0.47, 0.35), sun=(48, 315))
        sheet([n + "_depleted" for n in families[scene[len("broken_"):]]], sc)
    elif scene.startswith("pairs_"):
        sc = stage(w, h, samples, ground=(0.62, 0.47, 0.35), sun=(48, 315))
        pairs(families[scene[len("pairs_"):]], sc)
    elif scene == "shore":
        sc = stage(w, h, samples, ground=(0.66, 0.6, 0.47))
        have = [n for n in LIMESTONE if os.path.exists(os.path.join(HERE, "mesh", f"{n}.obj"))]
        scatter(have, [3, 2, 2, 1, 2, 1][: len(have)], 22, (-30, 30, 4, 60), 7, spacing=5)
        figure(1.5, 9)
        camera(sc, (0, -6, 1.7), (0, 20, 0.8), lens=32)
    elif scene == "hillside":
        sc = stage(w, h, samples, ground=(0.42, 0.5, 0.28))
        lime = [n for n in LIMESTONE if os.path.exists(os.path.join(HERE, "mesh", f"{n}.obj"))]
        ore = [n for n in ORE if os.path.exists(os.path.join(HERE, "mesh", f"{n}.obj"))]
        scatter(lime + ore, [3] * len(lime) + [2] * len(ore), 40, (-70, 70, 40, 140), 11, spacing=9)
        figure(0, 80)
        camera(sc, (0, -10, 1.7), (0, 80, 1.0), lens=50)
    elif scene == "ruins":
        sc = stage(w, h, samples, ground=(0.62, 0.58, 0.48))
        have = [n for n in RUBBLE if os.path.exists(os.path.join(HERE, "mesh", f"{n}.obj"))]
        scatter(have, [1] * len(have), 12, (-14, 14, 4, 40), 5, spacing=6)
        figure(2, 9)
        camera(sc, (0, -5, 1.7), (0, 15, 0.8), lens=30)
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("render: wrote", out)
