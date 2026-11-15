"""Render material-independent component IDs and export projected geometry evidence."""
import bpy,json,sys
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/tool_masters.blend'))
sc=bpy.context.scene;sc.cycles.samples=4;sc.cycles.use_denoising=False
views=json.loads((ROOT/'checks/cameras.json').read_text())
colors={'haft':(1,0,0,1),'head':(0,0,1,1),'binding':(0,1,0,1),'tails':(1,0,1,1),'bark':(1,1,0,1),'stub':(0,1,1,1),'knot':(.5,0,1,1)}
material=bpy.data.materials.new('Audit component ID');material.use_nodes=True;t=material.node_tree;t.nodes.clear();info=t.nodes.new('ShaderNodeObjectInfo');em=t.nodes.new('ShaderNodeEmission');t.links.new(info.outputs['Color'],em.inputs['Color']);out=t.nodes.new('ShaderNodeOutputMaterial');t.links.new(em.outputs[0],out.inputs[0]);sc.view_layers[0].material_override=material
objects=[o for o in bpy.data.objects if o.get('tool')]
for ob in objects:ob.color=colors[ob['component']]
allproj={}
for name,s in views.items():
 v=s['view'];ppm=s['ppm'];col=s['col'];row=s['row'];zr=s['zref'];cam=sc.camera
 if v=='side':right=Vector((0,0,-1));up=Vector((0,1,0));back=Vector((1,0,0));cc=1254-col
 elif v=='edge':right=Vector((0,0,1));up=Vector((1,0,0));back=Vector((0,1,0));cc=col
 else:right=Vector((1,0,0));up=Vector((0,1,0));back=Vector((0,0,1));cc=col
 center=Vector((0,0,zr))+right*((627-cc)/ppm)+up*((row-627)/ppm)
 cam.matrix_world=Matrix(((right.x,up.x,back.x,0),(right.y,up.y,back.y,0),(right.z,up.z,back.z,0),(0,0,0,1)));cam.location=center+back*4;cam.data.ortho_scale=1254/ppm;cam.data.clip_end=2.90 if s['tool']=='spear' and v=='end' else 10
 projected={}
 for ob in objects:
  ob.hide_render=ob['tool']!=s['tool']
  if ob.hide_render:continue
  kind=ob['component'];q=[]
  for p in ob.data.vertices:
   x,y,z=p.co
   if v=='side':u=col+ppm*(z-zr);w=row-ppm*y
   elif v=='edge':u=col+ppm*(z-zr);w=row-ppm*x
   else:u=col+ppm*x;w=row-ppm*y
   q.append((u,w))
  item=projected.setdefault(kind,{'min_col':1e9,'min_row':1e9,'max_col':-1e9,'max_row':-1e9,'objects':[]})
  item['min_col']=min(item['min_col'],min(p[0] for p in q));item['max_col']=max(item['max_col'],max(p[0] for p in q));item['min_row']=min(item['min_row'],min(p[1] for p in q));item['max_row']=max(item['max_row'],max(p[1] for p in q));item['objects'].append(ob.name)
  if kind=='head':
   item['vertices_px']=q;item['faces']=[list(p.vertices) for p in ob.data.polygons]
 allproj[name]=projected
 sc.render.filepath=str(ROOT/'checks'/f'{name}_ids_raw.png');bpy.ops.render.render(write_still=True)
(ROOT/'checks/projected_geometry.json').write_text(json.dumps(allproj,indent=2))
print('AUDIT_EXPORTED',flush=True)

# Blender audio shutdown hangs in this sandbox after work is saved.
# Explicit batch mode flushes all logs and exits only after successful work.
import os as _os, sys as _sys
if _os.environ.get("TOOL_CONCEPT_BATCH") == "1":
    _sys.stdout.flush(); _sys.stderr.flush(); _os._exit(0)
