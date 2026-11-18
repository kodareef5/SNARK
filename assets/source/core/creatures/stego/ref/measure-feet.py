"""Measure actual fully foot-weighted plantar surfaces, not ankle centres.

Run after preview.py saves the current original source, or pass its blend path
after --. The resulting witnesses
calibrate planted contact sockets; their coordinates are in engine metres.
"""
import json,sys,hashlib
from pathlib import Path
import bpy
from mathutils.geometry import closest_point_on_tri
root=Path.cwd();folder=root/'assets/source/core/creatures/stego';sys.path.insert(0,str(folder))
blend=root/(sys.argv[sys.argv.index('--')+1]if '--'in sys.argv else'var/stego-review/stego.blend')
bpy.ops.wm.open_mainfile(filepath=str(blend))
import rig
body=bpy.data.objects['stego_body'];body.data.calc_loop_triangles();rows={}
for kind in ['hind','fore']:
 for side in ['l','r']:
  name=f'{kind}_foot_{side}';index=body.vertex_groups[name].index
  candidates=[v for v in body.data.vertices if rig.E(v.co).y<.3 and any(g.group==index and g.weight>.999 for g in v.groups)]
  if not candidates:raise RuntimeError('foot has no fully weighted plantar vertices: '+name)
  minimum=min(rig.E(v.co).y for v in candidates)
  # A planar pad has many equally low points. Project the metapodial midpoint
  # onto an actual fully foot-weighted plantar triangle, so the witness lies
  # near the load centre instead of an arbitrary simplifier vertex at its edge.
  bone=rig.armature().data.bones[name];centre=rig.E((bone.head_local+bone.tail_local)*.5);centre.y=minimum
  lowest={v.index for v in candidates if rig.E(v.co).y<=minimum+1e-6}
  triangles=[t for t in body.data.loop_triangles if all(v in lowest for v in t.vertices)]
  if not triangles:raise RuntimeError('foot has no planar fully weighted plantar triangle: '+name)
  choices=[(closest_point_on_tri(centre,*[rig.E(body.data.vertices[v].co)for v in t.vertices]),t)for t in triangles]
  point,triangle=min(choices,key=lambda q:(q[0]-centre).length_squared)
  rows[name]={'surfacePoint':list(point),'bone':name,'offset':list(point-rig.JOINTS[name]),'sourceTriangle':triangle.index,
    'triangleVertices':list(triangle.vertices),'weights':{name:1.0},'candidateVertices':len(candidates),'planarTriangles':len(triangles)}

out={'scope':__doc__,'blendSha256':hashlib.sha256(blend.read_bytes()).hexdigest(),'sourceSha256':{name:hashlib.sha256((folder/name).read_bytes()).hexdigest()for name in ['model.py','rig.py']},'landmarks':rows}
path=root/'var/stego-review/foot-landmarks.json';path.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
