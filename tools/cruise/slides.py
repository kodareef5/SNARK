"""Blender half of the bounded slide audit. Writes only its temporary result."""
import hashlib
import importlib.util
import itertools
import json
import math
import sys
from pathlib import Path

import bmesh

arguments = sys.argv[sys.argv.index('--') + 1:]
source, helper, output = map(Path, arguments[:3])
candidate = '--candidate' in arguments[3:]
sys.path.insert(0, str(source))
from model_cells import append_solid, clipped, orient
from parts import Mesh
spec = importlib.util.spec_from_file_location('slide_courses', helper/'slide_courses.py')
module = importlib.util.module_from_spec(spec)
sys.modules['slide_courses'] = module
spec.loader.exec_module(module)
spec = importlib.util.spec_from_file_location('audited_slides', helper/'model_far_slides.py')
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)
courses = module.courses()
layout = {'waterpark': {'courses': courses}}
# Exact persisted paths, if the authoring integration has already generated them.
layout_path = source.parents[3]/'content/landmarks/cruise-layout.json'
persisted = json.loads(layout_path.read_text()).get('waterpark', {}).get('courses')
if persisted is not None and not candidate:
    assert persisted == courses, 'persisted course source differs from generator'

def geometry(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bad = sum(len(e.link_faces) != 2 for e in bm.edges)
    volume = bm.calc_volume(signed=True)
    bm.free()
    assert bad == 0 and volume > 0, (obj.name, bad, volume)
    return {'positions': [x for v in obj.data.vertices for x in (v.co.x, v.co.z, -v.co.y)],
            'indices': [i for f in obj.data.polygons for i in f.vertices],
            'triangles': len(obj.data.polygons), 'badEdges': bad, 'signedVolume': volume}

def in_cell(mesh, grid, name):
    out = Mesh(4)
    out.direct_uv = True
    lo = [v*16 for v in grid]
    hi = [v+16 for v in lo]
    for v0, v1, f0, f1 in mesh.islands:
        pts = mesh.v[v0:v1]
        if any(max(p[k] for p in pts) <= lo[k]+1e-5 or min(p[k] for p in pts) >= hi[k]-1e-5 for k in range(3)):
            continue
        faces = [([mesh.v[i] for i in f], [(0, 0)]*len(f), 'ivory') for f in mesh.f[f0:f1]]
        for k in range(3):
            faces = clipped(faces, k, lo[k], 1)
            faces = clipped(faces, k, hi[k], -1)
        append_solid(out, faces, 0)
    return geometry(out.object(name, [v+8 for v in lo])) if out.f else None

meshes = {}
grids = set()
for course in courses:
    assert course['points'] == course['lodPoints'][0]
    assert len(course['lodPoints']) == 6
    assert all(p[0] == course['points'][0] and p[-1] == course['points'][-1] for p in course['lodPoints'])
    assert all(math.dist(a, b) <= 4.000001 for a, b in zip(course['points'], course['points'][1:]))
    assert all(len(h['points']) <= 12 for h in module.collision_hulls(course))
    for first in range(0, len(course['points'])-1, 2):
        look = module.look_hulls(course, (first, min(first+2, len(course['points'])-1)))
        assert len(look) <= 64 and all(len(h['points']) <= 12 for h in look)
    bounds = module.course_bounds(course)
    for x in range(math.floor(bounds['min'][0]/16), math.floor(bounds['max'][0]/16)+1):
        for y in range(math.floor(bounds['min'][1]/16), math.floor(bounds['max'][1]/16)+1):
            for z in range(math.floor(bounds['min'][2]/16), math.floor(bounds['max'][2]/16)+1):
                grids.add((x, y, z))
    for stage in range(6):
        mesh = Mesh(stage)
        render.slides(mesh, layout, course['number'])
        orient(mesh)
        geometry(mesh.object('whole', [0, 0, 0]))
        meshes[(course['number'], stage)] = mesh

# Segment-segment distance, not just ring samples; bounds the solid round tubes.
def distance_segments(p, q, r, s):
    sub, dot = module._sub, module._dot
    u, v, w = sub(q, p), sub(s, r), sub(p, r)
    a, b, c, d, e = dot(u, u), dot(u, v), dot(v, v), dot(u, w), dot(v, w)
    denominator = a*c-b*b
    first = max(0, min(1, (b*e-c*d)/denominator)) if denominator > 1e-12 else 0
    second = (b*first+e)/c
    if second < 0:
        second = 0
        first = max(0, min(1, -d/a))
    elif second > 1:
        second = 1
        first = max(0, min(1, (b-d)/a))
    return math.dist(module._mix(p, q, first), module._mix(r, s, second))

separation = []
for a, b in itertools.combinations(courses, 2):
    distance = min(distance_segments(p, q, r, s) for p, q in zip(a['points'], a['points'][1:])
                   for r, s in zip(b['points'], b['points'][1:])) - a['outerRadius'] - b['outerRadius']
    assert distance > .25, (a['number'], b['number'], distance)
    separation.append({'courses': [a['number'], b['number']], 'fineOuterClearance': distance})

# Each open shell sector remains below its mouth plane. Its center is outside
# every sector; the collision source never substitutes a filled cylinder.
yellow = next(c for c in courses if c['open'])
assert all(y <= 1e-9 for _, y in module.profile(yellow, 0))
assert min(math.hypot(x, y) for x, y in module.profile(yellow, 0)) >= yellow['radius']-1e-9
rows = {}
for grid in sorted(grids):
    by_course = {}
    for course in courses:
        levels = {str(stage): in_cell(meshes[(course['number'], stage)], grid,
                                     'cell_'+'_'.join(map(str, grid))+'_'+str(course['number'])+'_'+str(stage))
                  for stage in range(6)}
        if any(levels.values()):
            by_course[str(course['number'])] = levels
    if by_course:
        rows[','.join(map(str, grid))] = by_course
paths = [helper/'slide_courses.py', helper/'model_far_slides.py', source/'model_cells.py', source/'parts.py', layout_path]
output.write_text(json.dumps({'sources': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
                             'persistedCoursesMatched': persisted == courses, 'courses': courses,
                             'separation': separation, 'grids': rows}))
