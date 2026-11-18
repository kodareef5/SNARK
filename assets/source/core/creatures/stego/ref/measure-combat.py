"""Measure authored tail contacts in engine metres and degrees from forward."""
import sys,json,math
from pathlib import Path
import bpy
root=Path.cwd();folder=root/'assets/source/core/creatures/stego';sys.path.insert(0,str(folder))
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.render.fps=30
import rig
rig.build()
import clips
out={}
for name,side in [('attack',1),('attack_right',-1)]:
 rows=[]
 for tick in range(10,24):
  clips.reset();clips.attack(tick/34,tick,side);bpy.context.view_layer.update()
  row={'tick':tick}
  for socket in ['tail_tip','impale']:
   bone,p=rig.SOCKETS[socket];b=rig.armature().pose.bones[bone]
   q=rig.E(b.matrix@b.bone.matrix_local.inverted()@rig.B(p))
   row[socket]={'position':list(q),'bearing':math.degrees(math.atan2(q.x,q.z)),'distance':math.hypot(q.x,q.z)}
  rows.append(row)
 out[name]=rows
for name,func,frames,window in [('impale_in',clips.impale_in,30,range(23,30)),('impale_hold',clips.impale_hold,60,range(0,61,15))]:
 rows=[]
 for tick in window:
  clips.reset();func(tick/frames,tick);bpy.context.view_layer.update();row={'tick':tick}
  for socket in ['tail_tip','impale']:
   bone,p=rig.SOCKETS[socket];b=rig.armature().pose.bones[bone]
   q=rig.E(b.matrix@b.bone.matrix_local.inverted()@rig.B(p))
   row[socket]={'position':list(q),'bearing':math.degrees(math.atan2(q.x,q.z)),'distance':math.hypot(q.x,q.z)}
  rows.append(row)
 out[name]=rows
path=root/'var/stego-review/combat-measures.json';path.write_text(json.dumps(out,indent=2));print(json.dumps(out))
