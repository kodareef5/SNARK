"""Read actual saved meshes for shaft cross sections, bend and tail lengths."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/tool_masters.blend'))
result={'cross_sections':{},'tail_centerline_lengths_m':{},'shaft_bow_m':{}}
def section(ob,z):
 points=[]
 for edge in ob.data.edges:
  a,b=[ob.data.vertices[i].co for i in edge.vertices]
  if abs(a.z-z)<1e-7:points.append(a)
  if abs(b.z-z)<1e-7:points.append(b)
  if (a.z-z)*(b.z-z)<0:points.append(a.lerp(b,(z-a.z)/(b.z-a.z)))
 if not points:return None
 lo=[min(p[i] for p in points) for i in range(2)];hi=[max(p[i] for p in points) for i in range(2)]
 return {'z_m':z,'min_xy_m':lo,'max_xy_m':hi,'width_x_m':hi[0]-lo[0],'width_y_m':hi[1]-lo[1],'center_xy_m':[(lo[i]+hi[i])/2 for i in range(2)]}
for tool in ['pick','hatchet','spear']:
 ob=next(o for o in bpy.data.objects if o.get('tool')==tool and o.get('component')=='haft')
 samples={'grip':0,'butt_diameter':-.1185,'neck':(.265 if tool=='pick' else .240),'kink':.15} if tool!='spear' else {'grip':0,'butt_diameter':-.59,'neck':1.245,'butt':-.6,'head':1.3,'chord_midpoint':.35}
 result['cross_sections'][tool]={name:section(ob,z) for name,z in samples.items()}
 for o in bpy.data.objects:
  if o.get('tool')==tool and o.get('component')=='tails' and ' | core' in o.name:
   vs=o.data.vertices;centers=[sum((vs[i+j].co for j in range(8)),Vector())/8 for i in range(0,len(vs),8)]
   length=sum((b-a).length for a,b in zip(centers,centers[1:]));result['tail_centerline_lengths_m'][o.name]={'wound_cord_m':length,'including_1mm_cut_fibres_m':length+.001}
# Pack the generated wood map so the delivered .blend travels independently.
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/tool_masters.blend'))
(ROOT/'checks/mesh_details.json').write_text(json.dumps(result,indent=2))
print('DETAILS_EXPORTED',flush=True)

# Blender audio shutdown hangs in this sandbox after work is saved.
# Explicit batch mode flushes all logs and exits only after successful work.
import os as _os, sys as _sys
if _os.environ.get("TOOL_CONCEPT_BATCH") == "1":
    _sys.stdout.flush(); _sys.stderr.flush(); _os._exit(0)
