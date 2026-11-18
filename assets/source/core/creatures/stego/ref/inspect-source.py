import bpy, bmesh, json, hashlib, os
from mathutils import Vector
from pathlib import Path
root=Path.cwd(); out=root/'var/stego-research'; source=root/'assets/raw/quaternius/dinosaurs/Stegosaurus.fbx'
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source))
scene=bpy.context.scene
report={'source':str(source.relative_to(root)),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'bytes':source.stat().st_size,'blender':bpy.app.version_string,'unit_scale':scene.unit_settings.scale_length,'fps':scene.render.fps,'meshes':[],'armatures':[],'actions':[]}
for obj in list(scene.objects):
 if obj.type=='MESH':
  mesh=obj.data; mesh.calc_loop_triangles(); bm=bmesh.new();bm.from_mesh(mesh)
  coords=[obj.matrix_world@v.co for v in mesh.vertices]
  active=[sum(1 for g in v.groups if g.weight>0) for v in mesh.vertices]
  uv=mesh.uv_layers.active
  report['meshes'].append({'name':obj.name,'vertices':len(mesh.vertices),'triangles':len(mesh.loop_triangles),'polygons':len(mesh.polygons),'bounds_min':[min(v[i] for v in coords) for i in range(3)],'bounds_max':[max(v[i] for v in coords) for i in range(3)],'scale':list(obj.scale),'uv_layers':[(u.name,len(u.data)) for u in mesh.uv_layers],'uv_unique':len(set(tuple(d.uv) for d in uv.data)) if uv else 0,'materials':[m.name if m else None for m in mesh.materials],'boundary_edges':sum(e.is_boundary for e in bm.edges),'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges),'loose_vertices':sum(not v.link_faces for v in bm.verts),'unweighted':sum(n==0 for n in active),'max_influences':max(active),'groups':[g.name for g in obj.vertex_groups]});bm.free()
 if obj.type=='ARMATURE':
  report['armatures'].append({'name':obj.name,'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'head':list(b.head_local),'tail':list(b.tail_local),'deform':b.use_deform} for b in obj.data.bones]})
  obj.data.pose_position='REST'
for action in bpy.data.actions:
 curves=[]
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    curves.extend(bag.fcurves)
 report['actions'].append({'name':action.name,'frames':list(action.frame_range),'curves':len(curves),'animated_bones':sorted(set(c.data_path.split('"')[1] for c in curves if c.data_path.startswith('pose.bones['))),'keyframes':sum(len(c.keyframe_points) for c in curves)})
report['materials']=[{'name':m.name,'diffuse':list(m.diffuse_color),'nodes':[n.bl_idname for n in m.node_tree.nodes] if m.use_nodes else [],'images':[n.image.name for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image] if m.use_nodes else []} for m in bpy.data.materials]
(out/'inspection.json').write_text(json.dumps(report,indent=2))
coords=[o.matrix_world@v.co for o in scene.objects if o.type=='MESH' for v in o.data.vertices]
mins=Vector([min(v[i] for v in coords) for i in range(3)]); maxs=Vector([max(v[i] for v in coords) for i in range(3)]); center=(mins+maxs)/2; size=max(maxs-mins)
scene.render.engine='BLENDER_WORKBENCH';scene.render.resolution_x=1200;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('World');scene.world.color=(.08,.08,.08)
sh=scene.display.shading;sh.light='STUDIO';sh.studio_light='paint.sl';sh.color_type='MATERIAL';sh.show_shadows=True;sh.show_cavity=True;sh.cavity_type='BOTH';sh.background_type='WORLD'
camdata=bpy.data.cameras.new('review');cam=bpy.data.objects.new('review',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.type='ORTHO';camdata.ortho_scale=size*1.15;camdata.clip_end=size*20
for name, direction in [('threequarter',(1.2,-1.6,.8)),('side',(1,0,.1)),('front',(0,-1,.1)),('top',(0,0,1))]:
 cam.location=center+Vector(direction).normalized()*size*3;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
print('STEGO_INSPECTION',json.dumps({'meshes':report['meshes'],'actions':[{'name':a['name'],'frames':a['frames']} for a in report['actions']],'bones':[(a['name'],len(a['bones'])) for a in report['armatures']],'materials':report['materials'],'sha256':report['sha256']}))
