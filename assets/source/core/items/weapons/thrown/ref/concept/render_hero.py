"""Perspective hero from the same models; soft daylight and a neutral ground plane."""
import bpy,json,math,os
from pathlib import Path
from mathutils import Vector,Matrix
R=Path(__file__).resolve().parent;os.chdir(R);bpy.ops.wm.open_mainfile(filepath=str(R/'concept_models.blend'))
s=bpy.context.scene;g=json.loads((R/'checks/geometry.json').read_text())
for o in s.objects:
 if o.type=='MESH':o.hide_render=True
placements={'bola_lying':((-.12,0,-.02),0),'grenade':((.18,.045,.15),-.35),'arrow':((.44,.013,-.37),math.pi/2),'dart':((.40,.015,.16),.45)}
for group,(pos,angle) in placements.items():
 rot=Matrix.Rotation(angle,4,'Y');transform=Matrix.Translation(Vector(pos))@rot
 for name in g['groups'][group]['parts']:
  o=bpy.data.objects[name];o.hide_render=False;o.visible_shadow=True;o.matrix_world=transform
# World is neutral soft daylight. All surfaces are matte diffuse.
s.world.node_tree.nodes.get('Background').inputs[1].default_value=.40
for o in s.objects:
 if o.type=='LIGHT':bpy.data.objects.remove(o,do_unlink=True)
ld=bpy.data.lights.new('large daylight source','AREA');lo=bpy.data.objects.new('large daylight source',ld);s.collection.objects.link(lo);lo.location=(-.6,1.6,.8);lo.rotation_euler=(-lo.location).to_track_quat('-Z','Y').to_euler();ld.energy=100;ld.size=1.8
m=bpy.data.materials.new('neutral warm grey ground');m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.58,.568,.54,1);bs.inputs['Roughness'].default_value=1;bs.inputs['Specular IOR Level'].default_value=0
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,-.001,0),rotation=(math.pi/2,0,0));bpy.context.object.data.materials.append(m)
c=s.camera;c.data.type='PERSP';c.data.lens=52;c.location=(.82,1.45,1.10);target=Vector((0,0,-.03));c.rotation_euler=(target-c.location).to_track_quat('-Z','Y').to_euler();c.data.clip_end=1000
s.render.resolution_x=2400;s.render.resolution_y=2000;s.cycles.samples=64;s.cycles.use_denoising=True;s.render.film_transparent=False
s.render.filepath=str(R/'checks/hero_geometry.png');bpy.ops.render.render(write_still=True)

# Renders and saves are synchronous; bypass a host audio shutdown hang.
import sys
sys.stdout.flush(); sys.stderr.flush(); os._exit(0)
