"""Render isolated part masks and record independent raster extents.
Run in Blender after build_concepts.py. All dimensional comparisons use pixels.
"""
import bpy,json,math,os,sys
from pathlib import Path
from mathutils import Vector,Matrix
R=Path(__file__).resolve().parent;os.chdir(R)
bpy.ops.wm.open_mainfile(filepath=str(R/'concept_models.blend'))
g=json.loads((R/'checks/geometry.json').read_text());s=bpy.context.scene;s.cycles.samples=16
out=R/'checks/part_renders';out.mkdir(exist_ok=True)
# id, group, names prefix, camera axis, ppm, center Z, target extents horizontal/vertical (m)
TASKS=[
 ('grenade_body_side','grenade',['iron_body'],'side',6000,0,[.09,.076]),
 ('grenade_body_top','grenade',['iron_body'],'top',6000,0,[.09,.076]),
 ('grenade_body_front','grenade',['iron_body'],'front',6000,0,[.076,.076]),
 ('grenade_band_side','grenade',['hide_grip_band'],'side',6000,0,[.03,.082]),
 ('grenade_band_top','grenade',['hide_grip_band'],'top',6000,0,[.03,.082]),
 ('grenade_cap_side','grenade',['brass_fuse_cap'],'side',6000,0,[.021,.026]),
 ('grenade_cap_top','grenade',['brass_fuse_cap'],'top',6000,0,[.021,.026]),
 ('grenade_cap_front','grenade',['brass_fuse_cap'],'front',6000,0,[.026,.026]),
 ('grenade_ring_top','grenade',['steel_pull_ring'],'top',6000,0,[.028,.028]),
 ('grenade_ring_side','grenade',['steel_pull_ring'],'side',6000,0,[.028,.004]),
 ('grenade_lever_top','grenade',['steel_spoon_lever'],'top',6000,0,[.084,.014]),
 ('bola_pouch_side','bola_pouch',['weight_closeup_hide_pouch'],'side',6000,0,[.080,.068]),
 ('bola_pouch_front','bola_pouch',['weight_closeup_hide_pouch'],'front',6000,0,[.068,.068]),
 ('bola_knot_front','bola_held',['central_knot'],'front',6000,0,[.030,None]),
 ('arrow_head_top','arrow',['flint_leaf'],'top',6000,0,[.055,.024]),
 ('arrow_head_side','arrow',['flint_leaf'],'side',6000,0,[.055,.006]),
 ('arrow_head_front','arrow',['flint_leaf'],'front',6000,0,[.024,.006]),
 ('arrow_shaft_side','arrow',['wood_shaft'],'side',1500,-.36,[.720,.011]),
 ('arrow_shaft_top','arrow',['wood_shaft'],'top',1500,-.36,[.720,.011]),
 ('arrow_shaft_section','arrow',['wood_shaft'],'front',6000,0,[.011,.011]),
 ('arrow_binding_side','arrow',['hide_head_binding'],'side',6000,0,[.035,.013]),
 ('arrow_binding_top','arrow',['hide_head_binding'],'top',6000,0,[.035,.013]),
 ('arrow_vane_side','arrow',['leather_vane_1'],'side',6000,-.66,[.100,.018]),
 ('arrow_vane_top','arrow',['leather_vane_1'],'top',6000,-.66,[.100,.002]),
 ('dart_needle_side','dart',['bevelled_steel_needle'],'side',6000,0,[.014,.003]),
 ('dart_needle_top','dart',['bevelled_steel_needle'],'top',6000,0,[.014,.003]),
 ('dart_collar_side','dart',['steel_needle_collar'],'side',6000,0,[.010,.015]),
 ('dart_collar_top','dart',['steel_needle_collar'],'top',6000,0,[.010,.015]),
 ('dart_barrel_side','dart',['brass_drug_barrel'],'side',6000,-.05,[.080,.013]),
 ('dart_barrel_top','dart',['brass_drug_barrel'],'top',6000,-.05,[.080,.013]),
 ('dart_endcap_side','dart',['steel_tail_cap'],'side',6000,-.095,[.010,.014]),
 ('dart_fringe_side','dart',['hide_fringe_strip'],'side',6000,-.1325,[.065,.030]),
 ('dart_fringe_top','dart',['hide_fringe_strip'],'top',6000,-.1325,[.065,.030]),
 ('dart_fringe_front','dart',['hide_fringe_strip'],'front',6000,0,[.030,.030]),
]
mat=bpy.data.materials.new('measurement white emission');mat.use_nodes=True;n=mat.node_tree.nodes;n.clear();e=n.new('ShaderNodeEmission');o=n.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(e.outputs[0],o.inputs[0]);s.view_layers[0].material_override=mat
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
results=json.loads((R/'checks/part_tasks.json').read_text()) if args else []
for key,group,prefix,axis,ppm,cz,target in TASKS:
 if args and key not in args: continue
 results=[r for r in results if r['id']!=key]
 selected=[name for name in g['groups'][group]['parts'] if any(name.startswith(p) for p in prefix)]
 for o in s.objects:
  if o.type=='MESH':o.hide_render=o.name not in selected
 right,up,normal=[Vector(x) for x in g['basis'][axis]];c=s.camera;c.location=Vector((0,0,cz))+normal*2;c.rotation_euler=Matrix((-right,up,normal)).transposed().to_euler();c.data.ortho_scale=1254/ppm
 s.render.filepath=str(out/(key+'.png'));bpy.ops.render.render(write_still=True)
 points=[v.co for name in selected for v in bpy.data.objects[name].data.vertices]
 lengths=[max(p.dot(a) for p in points)-min(p.dot(a) for p in points) for a in [right,up]]
 results.append(dict(id=key,group=group,parts=selected,axis=axis,ppm=ppm,center_z=cz,target_m=target,geometry_extent_m=lengths))
(R/'checks/part_tasks.json').write_text(json.dumps(results,indent=2))

# Renders and saves are synchronous; bypass a host audio shutdown hang.
import sys
sys.stdout.flush(); sys.stderr.flush(); os._exit(0)
