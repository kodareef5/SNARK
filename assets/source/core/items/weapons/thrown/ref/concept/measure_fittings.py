"""Measure non-axis-aligned strip thickness directly from the saved shared mesh."""
import bpy,json,os,sys,math
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent;bpy.ops.wm.open_mainfile(filepath=str(R/'concept_models.blend'))
o=bpy.data.objects['steel_spoon_lever'];v=[x.co for x in o.data.vertices];values=[]
for i in range(len(v)//4-1):
 a=v[4*i];b=v[4*i+4];outer=v[4*i+2];d=b-a
 n=Vector((0,d.z,-d.y)).normalized();actual=abs((outer-a).dot(n));values.append(actual)
result={'lever_normal_thickness_m':values,'target_m':.002,'max_error_percent':max(abs(x/.002-1)*100 for x in values),'pass':all(abs(x/.002-1)<=.03 for x in values),'cap_contact_inner_corner_m':list(v[-4]),'all_orthographic_meshes_cast_no_shadows':all(not ob.visible_shadow for ob in bpy.context.scene.objects if ob.type=='MESH')}
(R/'checks/fitting_measurements.json').write_text(json.dumps(result,indent=2));print(result);sys.stdout.flush();os._exit(0)
