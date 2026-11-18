"""Measure breathing landmarks and trunk-only displaced volume; no visual claim.

The cross-section integral excludes limbs, plates and saddle. It is a conservative
trunk estimate for choosing a plausible waterline, not a hydrodynamic simulation.
"""
import sys,json,math
from pathlib import Path
import bpy,numpy as np
root=Path.cwd();folder=root/'assets/source/core/creatures/stego';sys.path.insert(0,str(folder))
bpy.ops.wm.open_mainfile(filepath=str(root/'var/stego-review/stego.blend'))
import rig
import clips

out={'groundEye':1.32,'nostrilSource':list(rig.SOCKETS['breath_l'][1]),'poses':{},'trunkOnlyDisplacementM3':{}}
for name,func in [('rest',lambda t,f:None),('swim',clips.swim),('swim_idle',clips.swim_idle),('startled_swim',clips.startled_swim),('land_swim',clips.land_swim),('torpor_out_swim',clips.torpor_out_swim),('torpor_idle',clips.torpor_idle)]:
 rows=[]
 for tick in range(61):
  clips.reset();func(tick/60,tick)
  if name=='torpor_idle':clips.ground_skin()
  bpy.context.view_layer.update()
  bone=rig.armature().pose.bones['skull'];p=rig.B(out['nostrilSource'])
  at=rig.E(bone.matrix@bone.bone.matrix_local.inverted()@p)
  rows.append(list(at))
 out['poses'][name]={'minimumNostrilY':min(p[1]for p in rows),'maximumNostrilY':max(p[1]for p in rows),'frame0':rows[0]}

table=np.array(rig.BODY);zs=np.linspace(table[0,0],table[-1,0],4097)
cy,rx,up,down=[np.interp(zs,table[:,0],table[:,i])for i in range(1,5)]
zz=np.array([rig.shape((0,0,z))[2]for z in zs])
def integral(t):
 t=np.clip(t,-1,1);return t*np.sqrt(np.maximum(0,1-t*t))+np.arcsin(t)
for water in [1.18,1.32,1.6,1.75,1.8,1.9,2,2.1,2.2,2.3]:
 lower=rx*down*(integral((water-cy)/down)+math.pi/2)
 area=np.where(water<cy,lower,rx*down*math.pi/2+rx*up*integral((water-cy)/up))
 out['trunkOnlyDisplacementM3'][str(water)]=float(np.trapezoid(area,zz))
out['totalTrunkM3']=float(np.trapezoid(math.pi*rx*(up+down)/2,zz))
path=root/'var/stego-review/swim-measures.json';path.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
