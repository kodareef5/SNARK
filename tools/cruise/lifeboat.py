"""Blender half of lifeboat.ts; compare the actual detailed shell with its fitted levels."""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

source, helper, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
sys.path.insert(0, str(source))
from parts import Mesh
from model_exterior import lifeboat as detailed

spec = importlib.util.spec_from_file_location('audited_lifeboat', helper)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def raw(mesh, name):
    obj = mesh.object(name, [0, 0, 0])
    return {'positions': [q for v in obj.data.vertices for q in (v.co.x, v.co.z, -v.co.y)],
            'indices': [i for face in obj.data.polygons for i in face.vertices]}


def envelope(mesh):
    # The source's first two solids are the complete hull and canopy. Separate
    # narrow grablines/door fittings must not stand in for their visible shape.
    out = Mesh(mesh.level)
    for first, last, f0, f1 in mesh.islands[:2]:
        out.indexed(mesh.v[first:last], [tuple(i-first for i in face) for face in mesh.f[f0:f1]], 'enamel')
    return out


fine = Mesh(0)
detailed(fine, {})
reference = raw(envelope(fine), 'reference')
rows = []
for level in range(1, 6):
    mesh = Mesh(level)
    if level == 1:
        detailed(mesh, {})
    else:
        module.lifeboat(mesh, level)
    rows.append({'stage': level, 'fine': reference, 'envelope': raw(envelope(mesh), 'envelope'+str(level)),
                 'full': raw(mesh, 'full'+str(level))})
files = [source/'model_exterior.py', source/'parts.py', helper]
output.write_text(json.dumps({'sources': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}, 'rows': rows}))
print('lifeboat diagnostic ready')
