"""Original photograph-informed Koru sail plan; metres, ship-local authored authority."""
import json,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[4]
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def sub(a,b):return [x-y for x,y in zip(a,b)]
def unit(a):return [v/math.sqrt(dot(a,a)) for v in a]
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
sails=[]
for name,z,boom,width,peak,throat,pz in [('fore',20,12.8,19,57.5,42.5,11),('main',-8,12.8,21,56.5,41.5,11),('mizzen',-30,10.8,17,51.5,36.5,9)]:
 anchor=[.62,boom+.42,z-.62];hp=peak-anchor[1];ht=throat-anchor[1]
 sails.append(dict(id=name,mesh='core:koru_sail_'+name,skeleton='koru_sail_'+name,kind='main',anchor=anchor,basis=[[-1,0,0],[0,1,0],[0,0,-1]],polygon=[[0,0],[0,width],[hp,pz],[ht,0]],bandAxis='y',bandSize=.75,foldSign=1,billow=-.09,gaff=dict(bone='gaff',throat=[0,ht,0],peak=[0,hp,pz],lowerThroatY=.12,lowerAngle=math.atan2(hp-ht,pz))))
for name,tack,head,clew,sign in [('outer',[.48,9,69.5],[.48,68.8,20.5],[.48,27,43],1),('inner',[-.48,8.6,51.2],[-.48,57.7,20.6],[-.48,17,29.8],-1)]:
 up=unit(sub(head,tack));normal=[-1,0,0];chord=cross(normal,up);v=sub(clew,tack);length=math.sqrt(dot(sub(head,tack),sub(head,tack)))
 # Headsail folds across the stay; renderer uses local Z as the accordion coordinate and local Y as hinge axis.
 sails.append(dict(id=name,mesh='core:koru_sail_'+name,skeleton='koru_sail_'+name,kind='jib',anchor=tack,basis=[normal,up,chord],polygon=[[0,0],[dot(v,up),dot(v,chord)],[length,0]],bandAxis='z',bandSize=.5,foldSign=sign,billow=-.09*sign))
for s in sails:
 axis=0 if s['bandAxis']=='y' else 1;extent=max(p[axis] for p in s['polygon']);n=math.ceil(extent/s['bandSize']);step=extent/n
 s['stackStep']=.006;s['bones']=['root']+[f'fold_{i:03d}' for i in range(n)]+(['gaff'] if 'gaff'in s else [])
 s['bands']=[dict(bone=f'fold_{i:03d}',index=i+1,lower=round(i*step,9),upper=round((i+1)*step,9)) for i in range(n)]
 # Broad conservative ship-local sphere covers all folded and raised cloth including the independently hoisted gaff.
 s['bounds']={'center':[s['anchor'][0],(min(p[0] for p in s['polygon'])+max(p[0] for p in s['polygon']))/2+s['anchor'][1],s['anchor'][2]],'radius':100}
out=dict(schema=1,id='koru',frame='ship-local metres; +Y up, +Z bow, +X port',duration=18,control={'id':'core:koru_sail_control','origin':[7.45,3.75,-21.8],'aim':[7.45,4.58,-21.8],'approach':[7.45,3.75,-24],'half':[.35,.46,.35]},sails=sails,notes=['Photo-informed original cloth; published ship dimensions remain authoritative.','All five sails are dynamic meshes, excluded from static and far-city geometry.','Rigid fold matrices preserve normals; shared straight hinges have identical rest coordinates.','Gaff-edge cloth follows the separate rigid head spar through a short weighted transition.'])
(ROOT/'content/landmarks/koru-sails.json').write_text(json.dumps(out,indent=2)+'\n')
