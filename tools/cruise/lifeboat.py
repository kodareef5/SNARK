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


def envelope(mesh, joined=False, exterior=False):
    # The source's first two solids are the complete hull and canopy. Separate
    # narrow grablines/door fittings must not stand in for their visible shape.
    out = Mesh(mesh.level)
    for island, (first, last, f0, f1) in enumerate(mesh.islands[:1 if joined else 2]):
        faces = mesh.f[f0:f1]
        if exterior and not joined:
            # Loft caps are last: hull top and canopy bottom face each other
            # across the original 10 mm assembly seam. Keep every other face.
            faces = [face for j, face in enumerate(faces)
                     if j != len(faces) - (1 if island == 0 else 2)]
        out.indexed(mesh.v[first:last], [tuple(i-first for i in face) for face in faces], 'enamel')
    return out


fine = Mesh(0)
detailed(fine, {})
reference = raw(envelope(fine), 'reference')
exterior = raw(envelope(fine, exterior=True), 'exterior')
rows = []
for level in range(1, 6):
    mesh = Mesh(level)
    if level == 1:
        detailed(mesh, {})
    else:
        module.lifeboat(mesh, level)
    rows.append({'stage': level, 'fine': reference, 'fineExterior': exterior,
                 'envelope': raw(envelope(mesh, joined=level >= 4), 'envelope'+str(level)),
                 'exterior': raw(envelope(mesh, joined=level >= 4, exterior=True), 'exterior'+str(level)),
                 'full': raw(mesh, 'full'+str(level))})
files = [source/'model_exterior.py', source/'parts.py', helper]
output.write_text(json.dumps({'sources': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}, 'rows': rows}))
print('lifeboat diagnostic ready')
