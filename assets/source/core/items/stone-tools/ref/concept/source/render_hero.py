"""Pose the exact masters on a neutral plane; render with soft daylight."""
import bpy, math
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/tool_masters.blend'))
sc=bpy.context.scene
sc.render.engine='CYCLES';sc.cycles.samples=128;sc.cycles.use_denoising=True
sc.render.resolution_x=1254;sc.render.resolution_y=1254;sc.render.resolution_percentage=100
sc.render.film_transparent=False
sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast';sc.view_settings.exposure=-.8
for m in bpy.data.materials:
 if m.use_nodes and m.node_tree.nodes.get('HERO_SWITCH'):m.node_tree.nodes['HERO_SWITCH'].inputs[0].default_value=1
# Original +X becomes vertical for pick/hatchet. Original +Y becomes vertical for spear.
poses={'pick':(-.40,.50,-.22),'hatchet':(.28,.48,.16),'spear':(.04,-.56,.08)}
for tool,(tx,ty,a) in poses.items():
 obs=[o for o in bpy.data.objects if o.get('tool')==tool]
 if tool=='spear':rot=Matrix(((-1,0,0),(0,0,1),(0,1,0)))
 else:rot=Matrix(((0,1,0),(0,0,1),(1,0,0)))
 rot=Matrix.Rotation(a,3,'Z')@rot
 low=min((rot@v.co).z for ob in obs for v in ob.data.vertices)
 for ob in obs:
  ob.hide_render=False;ob.matrix_world=rot.to_4x4();ob.location=(tx,ty,-low+.0008)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001))
plane=bpy.context.object;plane.name='Neutral matte presentation surface'
m=bpy.data.materials.new('Neutral warm grey hero surface');m.diffuse_color=(.58,.57,.54,1);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.58,.57,.54,1);bs.inputs['Roughness'].default_value=.95;plane.data.materials.append(m)
world=sc.world;world.use_nodes=True;world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.76,.80,.84,1);world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.45
for name,location,power,size in [('Broad soft daylight',(-1.0,1.4,2.9),300,3.5),('Soft neutral fill',(2,-1,2),130,3.0)]:
 bpy.ops.object.light_add(type='AREA',location=location);light=bpy.context.object;light.name=name;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
cam=sc.camera;cam.data.type='PERSP';cam.data.lens=50;cam.data.clip_end=250
cam.location=(.22,1.50,1.10);target=Vector((0,.55,0));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.file.pack_all()
sc.render.filepath=str(ROOT/'hero.png');sc.render.image_settings.color_mode='RGB';bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/hero_scene.blend'));bpy.ops.render.render(write_still=True)

# Blender audio shutdown hangs in this sandbox after work is saved.
# Explicit batch mode flushes all logs and exits only after successful work.
import os as _os, sys as _sys
if _os.environ.get("TOOL_CONCEPT_BATCH") == "1":
    _sys.stdout.flush(); _sys.stderr.flush(); _os._exit(0)
