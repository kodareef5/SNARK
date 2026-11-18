"""Project lower nostril witnesses onto the finished original skin.

preview.py must first save var/stego-review/stego.blend. The y/z sample is
inside the lower edge of the authored nasal aperture in paint_fields.py;
the lateral coordinate comes from the actual remeshed surface, not a marker.
"""
import json,sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
root=Path.cwd();folder=root/'assets/source/core/creatures/stego';sys.path.insert(0,str(folder))
bpy.ops.wm.open_mainfile(filepath=str(root/'var/stego-review/stego.blend'))
import rig
body=bpy.data.objects['stego_body'];tree=BVHTree.FromObject(body,bpy.context.evaluated_depsgraph_get())
rows={}
for sign,name in [(1,'breath_l'),(-1,'breath_r')]:
 origin=rig.B((sign*3,1.238,rig.shape((0,0,3.35))[2]))
 hit,normal,index,distance=tree.ray_cast(origin,Vector((-sign,0,0)),5)
 if hit is None:raise RuntimeError('nasal aperture has no skin surface')
 point=rig.E(hit)
 rows[name]={'surfacePoint':list(point),'bone':'skull','offset':list(point-rig.JOINTS['skull']),
             'sourceFace':index,'sourceVertices':[list(rig.E(body.data.vertices[v].co))for v in body.data.polygons[index].vertices]}
out=root/'var/stego-review/breath-landmarks.json';out.write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(rows,indent=2))
