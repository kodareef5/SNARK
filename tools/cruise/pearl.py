"""Blender geometry half of pearl.ts; temporary output only, never writes assets."""
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

source, helper, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
sys.path.insert(0, str(source))
from model_parts import D, build
from model_cells import append_solid, clipped, orient
from layout_cells import axes, snap
from parts import Mesh
spec = importlib.util.spec_from_file_location('audited_pearl', helper)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
prototypes = {p['id']: p for p in D['prototypes']}
cells = [c for c in D['cells'] if any(m['category'] == 'pearl' for m in c['members'])]
fine = Mesh(0)
for instance in D['instances']:
    prototype = prototypes[instance['prototype']]
    if prototype['art']['kind'] != 'pearl':
        continue
    mesh = Mesh(0)
    build(mesh, prototype)
    orient(mesh)
    c, s = axes(instance['yaw'])
    at = [snap(v) for v in instance['at']]
    fine.indexed([[at[0] + c*x + s*z, at[1] + y, at[2] - s*x + c*z] for x, y, z in mesh.v], mesh.f, 'ivory')

def in_cell(mesh, cell, label):
    """Preserve each source solid through the same six clipping planes as render()."""
    result = Mesh(4)
    result.direct_uv = True
    for _, _, first, last in mesh.islands:
        faces = [([mesh.v[i] for i in face], [(0, 0)]*len(face), 'ivory') for face in mesh.f[first:last]]
        for axis in range(3):
            faces = clipped(faces, axis, cell['bounds']['min'][axis], 1)
            faces = clipped(faces, axis, cell['bounds']['max'][axis], -1)
        append_solid(result, faces, 0)
    obj = result.object(label, cell['origin'])
    return obj, {'positions': [x for v in obj.data.vertices for x in (v.co.x, v.co.z, -v.co.y)],
                 'indices': [i for face in obj.data.polygons for i in face.vertices]}

origin = D['pearl']['center']
portal = math.sqrt((D['pearl']['diameter']/2)**2 - 5.6**2) - .20 - .003
rows = []
for level in (4, 5):
    coarse = Mesh(level)
    module.pearl(coarse, D, level)
    edges = {}
    for face in coarse.f:
        for a, b in zip(face, face[1:] + face[:1]):
            edges.setdefault(tuple(sorted((a, b))), []).append((a, b))
    assert all(len(e) == 2 and e[0] == tuple(reversed(e[1])) for e in edges.values()), 'source winding/closedness'
    for axis in (0, 1):
        assert abs(max(v[axis] for v in coarse.v) - min(v[axis] for v in coarse.v) - D['pearl']['diameter']) < 1e-6
    vertices, faces = [], []
    for cell in cells:
        _, fine_lod = in_cell(fine, cell, 'fine_' + cell['id'])
        obj, coarse_lod = in_cell(coarse, cell, 'coarse_' + cell['id'])
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bad_edges = sum(len(e.link_faces) != 2 for e in bm.edges)
        volume = bm.calc_volume(signed=True)
        bm.free()
        assert bad_edges == 0 and volume > 0, (cell['id'], bad_edges, volume)
        offset = len(vertices)
        for v in obj.data.vertices:
            local = (v.co.x, v.co.z, -v.co.y)
            vertices.append(Vector(tuple(cell['origin'][k] + round(local[k]/8*32767)/32767*8 for k in range(3))))
        faces.extend(tuple(offset + i for i in face.vertices) for face in obj.data.polygons)
        rows.append({'cell': cell['id'], 'authoredLevel': level, 'triangles': len(obj.data.polygons),
                     'badEdges': bad_edges, 'signedVolume': volume, 'fine': fine_lod, 'coarse': coarse_lod})
    tree = BVHTree.FromPolygons(vertices, faces, all_triangles=True)
    for i in range(64):
        a = i*math.tau/64
        eye = Vector((origin[0] + portal*math.cos(a), origin[1] + portal*math.sin(a), origin[2] - 6.6))
        assert tree.ray_cast(eye, Vector((0, 0, 1)), 13.2)[0] is None, ('quantized portal', level, i)
paths = [helper, source/'model_parts.py', source/'model_cells.py', source/'parts.py',
         source.parents[3]/'content/landmarks/cruise-layout.json']
output.write_text(json.dumps({'sources': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}, 'rows': rows}))
