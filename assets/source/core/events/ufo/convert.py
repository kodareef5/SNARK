"""Reads FlexUnit's CC0 "3D Game Ready UFO spaceship" (assets/raw/flexunit/ufo-spaceship/UFO_Source.blend) and writes
what the model is built from into ref/flexunit.json: the hull's turned profile as its subdivision cage, the windows of
the band under its dome, and the rings of lights under it. Nothing of the file is drawn as it is: model.py smooths that
cage, sizes it to the sky's hull and builds the craft round it.

    blender -b --factory-startup --disable-autoexec --python-exit-code 1 \
        --python assets/source/core/events/ufo/convert.py -- assets/raw/flexunit/ufo-spaceship/UFO_Source.blend

The file is opened as data: no script of it runs, and the digest is checked first.
"""

import hashlib
import json
import math
import pathlib
import sys

import bpy

HERE = pathlib.Path(__file__).resolve().parent
DIGEST = "5ce0afd1beb27a2e1c1ee626e4c2ef21dbd79b5e8a6727266d09243ee9de093a"

path = pathlib.Path(sys.argv[sys.argv.index("--") + 1])
if hashlib.sha256(path.read_bytes()).hexdigest() != DIGEST:
    raise SystemExit(f"{path} is not the file this was written for")
bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False, use_scripts=False)

ufo = bpy.data.objects["UFO"]
mesh = ufo.data
names = [m.name for m in mesh.materials]


def key(v):
    return (round(math.hypot(v.x, v.y), 3), round(v.z, 3))


# The rings of the cage: each vertex's distance from the axis and its height, in the hull's own frame (the file leans
# the object for its picture; its mesh is upright).
ring_of = {v.index: key(v.co) for v in mesh.vertices}
rings = sorted(set(ring_of.values()), key=lambda k: (k[1], k[0]))
links = {k: set() for k in rings}
for e in mesh.edges:
    a, b = ring_of[e.vertices[0]], ring_of[e.vertices[1]]
    if a != b:
        links[a].add(b)
        links[b].add(a)
materials = {k: set() for k in rings}
for p in mesh.polygons:
    for i in p.vertices:
        materials[ring_of[i]].add(names[p.material_index])

# The profile from the lowest ring nearest the axis, along the meridian, to the top of the antenna: each ring's next is
# the one it is joined to that is not yet walked, going the way round the solid the walk is going.
start = min(rings, key=lambda k: (k[1], k[0]))
walk = [start]
while True:
    here = walk[-1]
    ahead = [k for k in links[here] if k not in walk]
    if not ahead:
        break
    if len(walk) > 1:
        prev = walk[-2]
        heading = math.atan2(here[1] - prev[1], here[0] - prev[0])
        ahead.sort(key=lambda k: (math.atan2(k[1] - here[1], k[0] - here[0]) - heading + math.pi) % math.tau)
    else:
        ahead.sort(key=lambda k: -k[0])
    walk.append(ahead[0])

# The band's windows: the faces in the window material, by their middle's angle round the axis and how wide they are.
windows = []
for p in mesh.polygons:
    if names[p.material_index] != "Blue":
        continue
    angles = [math.atan2(mesh.vertices[i].co.y, mesh.vertices[i].co.x) for i in p.vertices]
    mid = math.atan2(sum(map(math.sin, angles)), sum(map(math.cos, angles)))
    span = max(abs((a - mid + math.pi) % math.tau - math.pi) for a in angles) * 2
    zs = [mesh.vertices[i].co.z for i in p.vertices]
    windows.append({"angle": round(math.degrees(mid), 2), "span": round(math.degrees(span), 2), "low": round(min(zs), 3), "high": round(max(zs), 3)})

# The lights under it: one lens repeated round the axis by the file's array modifier, read as Blender evaluates it and
# taken into the hull's frame. Each lens's middle, its distance from the axis and its height, and its size across.
depsgraph = bpy.context.evaluated_depsgraph_get()
lights = bpy.data.objects["Lights"]
array = next(m for m in lights.modifiers if m.type == "ARRAY")
evaluated = lights.evaluated_get(depsgraph)
into = ufo.matrix_world.inverted() @ lights.matrix_world
shown = evaluated.to_mesh()
parent = {v.index: v.index for v in shown.vertices}


def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


for e in shown.edges:
    parent[find(e.vertices[0])] = find(e.vertices[1])
shells = {}
for v in shown.vertices:
    shells.setdefault(find(v.index), []).append(into @ v.co)
lens = []
for pts in shells.values():
    c = sum(pts, pts[0] * 0) / len(pts)
    size = max((p - c).length for p in pts) * 2
    lens.append({"r": round(math.hypot(c.x, c.y), 3), "z": round(c.z, 3), "angle": round(math.degrees(math.atan2(c.y, c.x)), 1), "size": round(size, 3)})
evaluated.to_mesh_clear()
lens.sort(key=lambda l: (l["r"], l["angle"]))

out = {
    "source": "FlexUnit, 3D Game Ready UFO spaceship, UFO_Source.blend (CC0 1.0)",
    "sha256": DIGEST,
    "units": "the file's metres; r from the axis, z up",
    "profile": [{"r": k[0], "z": k[1], "materials": sorted(materials[k])} for k in walk],
    "off_the_walk": [{"r": k[0], "z": k[1], "materials": sorted(materials[k])} for k in rings if k not in walk],
    "windows": sorted(windows, key=lambda w: w["angle"]),
    "lights": {"around": array.count, "lenses": lens},
}
(HERE / "ref/flexunit.json").write_text(json.dumps(out, indent=1) + "\n")
print(f"convert: {len(walk)} rings of {len(rings)}, {len(windows)} windows, {len(lens)} lights")
