"""Reproducible original model review. Run from repository root in Blender."""
import sys,runpy,json,math
from pathlib import Path
import bpy,bmesh
from mathutils import Vector,Quaternion
root=Path.cwd();folder=root/'assets/source/core/creatures/stego';sys.path.insert(0,str(folder));out=root/'var/stego-review';out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.render.fps=30
for script in ['rig.py','model.py','saddle.py']:
 runpy.run_path(str(folder/script),run_name='__main__')
import rig
scene=bpy.context.scene;report={'meshes':[]}
for ob in scene.objects:
 if ob.type=='MESH':
  ob.data.calc_loop_triangles();bm=bmesh.new();bm.from_mesh(ob.data)
  report['meshes'].append({'name':ob.name,'triangles':len(ob.data.loop_triangles),'boundary':sum(e.is_boundary for e in bm.edges),'nonmanifold':sum(not e.is_manifold for e in bm.edges) });bm.free()
for m in bpy.data.materials:
 color=(.24,.32,.22,1) if m.name=='stego_skin' else (.49,.28,.15,1);m.diffuse_color=color
scene.render.engine='BLENDER_WORKBENCH';scene.render.resolution_x=1400;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('World');scene.world.color=(.09,.09,.09);sh=scene.display.shading;sh.light='STUDIO';sh.studio_light='paint.sl';sh.color_type='SINGLE';sh.single_color=(.53,.53,.53);sh.show_shadows=True;sh.show_cavity=True;sh.cavity_type='BOTH';sh.background_type='WORLD'
camdata=bpy.data.cameras.new('review');cam=bpy.data.objects.new('review',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.type='ORTHO';camdata.ortho_scale=10.7;camdata.clip_end=100
center=rig.B((0,1.92,-1.50))
for name,direction in [('threequarter',(1.1,-1.5,.8)),('side',(1,0,.06)),('front',(0,-1,.07)),('rear',(0,1,.1)),('top',(0,0,1))]:
 camdata.ortho_scale=7.3 if name in ('front','rear') else 10.7
 cam.location=center+Vector(direction).normalized()*25;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
 if name=='top':cam.rotation_euler.z+=math.pi/2
 scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
# A close anatomical view makes eyelids, cheek planes and beak attachment reviewable.
face_center=rig.B((0,1.28,2.46));camdata.ortho_scale=1.7
cam.location=face_center+Vector((1.2,-1.5,.35)).normalized()*10;cam.rotation_euler=(face_center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/'face.png');bpy.ops.render.render(write_still=True)
def jaw_pose(degrees):
 p=rig.armature().pose.bones['jaw'];r=p.bone.matrix_local.to_quaternion();p.rotation_quaternion=r.inverted()@Quaternion((1,0,0),math.radians(degrees))@r;bpy.context.view_layer.update()
jaw_pose(23);scene.render.filepath=str(out/'mouth.png');bpy.ops.render.render(write_still=True);jaw_pose(0)
for name,at,direction,span in [('plate',(-.35,3.20,-.70),(1,-.45,.10),2.8),('forelimb',(.75,.85,1.0),(1,-.7,.15),1.7),('neck',(.10,1.45,1.65),(1,-.35,.10),2.4)]:
 focus=rig.B(at);camdata.ortho_scale=span;cam.location=focus+Vector(direction).normalized()*10;cam.rotation_euler=(focus-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
# Neutral photographic material review, distinct from the geometry sheet above.
scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.18,.20,.23,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.25
for name,loc,power,size in [('key',(5,-6,9),1200,7),('fill',(-5,-2,5),650,6),('rim',(1,6,7),1000,5)]:
 ld=bpy.data.lights.new(name,'AREA');ld.energy=power;ld.shape='DISK';ld.size=size;lo=bpy.data.objects.new(name,ld);scene.collection.objects.link(lo);lo.location=loc;lo.rotation_euler=(center-lo.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,0));floor=bpy.context.object;floor.name='review_floor';mat=bpy.data.materials.new('review_floor');mat.diffuse_color=(.14,.16,.17,1);floor.data.materials.append(mat)
camdata.ortho_scale=10.7
cam.location=center+Vector((1.1,-1.5,.8)).normalized()*25;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/'material.png');bpy.ops.render.render(write_still=True)
camdata.ortho_scale=1.7
cam.location=face_center+Vector((1.2,-1.5,.35)).normalized()*10;cam.rotation_euler=(face_center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/'face_material.png');bpy.ops.render.render(write_still=True)
jaw_pose(23);scene.render.filepath=str(out/'mouth_material.png');bpy.ops.render.render(write_still=True);jaw_pose(0)
# Quantified armature rest-chain slack.
for kind,points in rig.LEGS.items():
 a,b,c=[Vector(p)for p in points[:3]];chain=(b-a).length+(c-b).length;report[kind+'_rest_slack']=1-(c-a).length/chain
report['bones']=len(rig.BONES);report['sockets']=rig.socket_offsets();(out/'geometry.json').write_text(json.dumps(report,indent=2));print('STEGO_REVIEW',json.dumps(report))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'stego.blend'))
