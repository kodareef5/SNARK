import sys,json,math,struct,time,hashlib
from pathlib import Path
from collections import defaultdict
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
S=SOURCE;A=S.parents[3];R=S/'ref/raw-cells';C=CANDIDATE
D=json.loads((A/'content/landmarks/cruise-layout.json').read_text());I=json.loads((R/'index.json').read_text());J=json.loads((C/'diagnostic-index.json').read_text());P={p['id']:p for p in D['prototypes']};dtype=np.dtype([('owner','<u4'),('p','<f4',(3,3))]);began=time.time()
changed={m['id']:m for m in J['meshes']}
assert hashlib.sha256((A/'content/landmarks/cruise-layout.json').read_bytes()).hexdigest()==I['layoutSHA256']==J['layoutSHA256'],'stale source/raw/candidate layout'
selected={n for n,i in enumerate(D['instances']) if i['section']=='aquatheater' and P[i['prototype']]['category']=='furniture'}
def raw(m,stage,folder):
 l=[l for l in m['levels'] if l['authoredLevel']<=stage][-1];r=np.fromfile(folder/l['file'],dtype=dtype)
 return r['owner'],r['p'].astype(np.float64)+np.array(m['origin'])[None,None,:],np.fromfile(folder/l['clearFile'],dtype=np.uint8)
class Scene:
 def __init__(self,stage):
  vs=[];fs=[];clears=[];self.parts=defaultdict(list)
  for m in I['meshes']:
   use=changed[m['id']] if stage and m['id'] in changed else m;folder=C if use is not m else R
   owners,ps,clear=raw(use,stage,folder);off=len(vs);vs.extend(map(tuple,ps.reshape(-1,3)));fs.extend((off+i*3,off+i*3+1,off+i*3+2) for i in range(len(ps)));clears.extend(clear)
   for owner in set(owners)&selected:self.parts[int(owner)].extend(ps[owners==owner])
  self.tree=BVHTree.FromPolygons(vs,fs,all_triangles=True);self.clear=clears
  self.owner_trees={o:BVHTree.FromPolygons([tuple(q)for p in ps for q in p],[(i*3,i*3+1,i*3+2)for i in range(len(ps))],all_triangles=True) for o,ps in self.parts.items()}
  print('SCENE',stage,len(fs),round(time.time()-began,1),flush=True)
 def blocked(self,eye,point):
  d=point-eye;distance=d.length;d.normalize();travelled=0
  for _ in range(1024):
   hit,n,face,t=self.tree.ray_cast(eye+d*travelled,d,distance-travelled-.002)
   if hit is None:return False
   if not self.clear[face] and n.dot(d)<-1e-7:return True
   travelled+=max(t,0)+.00001
   if travelled>=distance-.002:return False
  raise ValueError('Unresolved grazing ray; no visibility certificate accepted')

def points(tris):
 # Same native sample set: every source position and each triangle centroid.
 unique=np.unique(np.array(tris).reshape(-1,3),axis=0)
 return [Vector(p)for p in unique]+[sum((Vector(v)for v in p),Vector())/3 for p in tris]

def eyes(point,min_distance):
 center=Vector((0,46.8,112));distance=250 if min_distance<300 else 500
 for elev in(-2,0,2,5,10,20,35,50,70,90):
  e=math.radians(elev)
  for az in range(0,360,15):
   a=math.radians(az);eye=center+Vector((distance*math.cos(e)*math.cos(a),distance*math.sin(e),distance*math.cos(e)*math.sin(a)))
   if (abs(eye.x)>30 or eye.z>183 or eye.z< -183 or eye.y>75) and (eye-point).length>=min_distance:yield eye
 # Rays through the actual rear entrance, broad enough to include both sides.
 a=D['aquadome'];rx=a['outerBeam']/2-.105;rz=a['length']/2-.105;ry=a['outerHeight']-.21;base=a['baseY']+.105
 for x in(-7,-4,0,4,7):
  for y in(46.2,47.2,48.2):
   t=1-(x/rx)**2-((y-base)/ry)**2
   if t>0:
    gate=Vector((x,y,a['centerZ']-rz*math.sqrt(t)));yield gate+(gate-point).normalized()*distance
 for route in D['routes']:
  for p in route['anchors']:
   if p[1]>=35:
    eye=Vector((p[0],p[1]+1.7,p[2]))
    if (eye-point).length>=min_distance:yield eye
near=Scene(0);rows=[];rays=0
for stage in(3,):
 coarse=Scene(stage);limit={3:.0595,4:.1295}[stage];minimum={3:200,4:440}[stage]
 for owner in sorted(selected):
  if not D['instances'][owner]['id'].startswith('aquadome_pod_'):continue
  name=D['instances'][owner]['id'];row={'owner':name,'stage':stage,'directions':{}}
  for direction,source,target in(('fineToCoarse',near,coarse),('coarseToFine',coarse,near)):
   # Use complete destination scene for retained deck surfaces beneath a removed65mm plinth.
   samples=points(source.parts[owner]);bad=[];good=[]
   for point in samples:
    error=target.tree.find_nearest(point)[3]
    (bad if error>limit+1e-5 else good).append((error,point))
   bad.sort(key=lambda p:-p[0]);visible=[];unresolved=0
   for error,point in bad:
    for eye in eyes(point,minimum):
     rays+=1;hit=source.blocked(eye,point)
     if hit is None:unresolved+=1;continue
     if not hit:
      visible.append({'error':error,'point':list(point),'eye':list(eye)});break
   # Sufficient constructive lower bound: 19 good visible for each bad visible.
   needed=19*len(visible)+1;goodvisible=0
   for error,point in good:
    for eye in eyes(point,minimum):
     rays+=1
     if source.blocked(eye,point) is False:goodvisible+=1;break
    if goodvisible>=needed:break
   result={'samples':len(samples),'allBadSamples':len(bad),'badVisible':len(visible),'goodVisibleLowerBound':goodvisible,'unresolvedRays':unresolved,'maximumVisibleBad':max((v['error'] for v in visible),default=0),'witnesses':visible[:8],'sampledVisibleP95Pass':goodvisible>=needed}
   row['directions'][direction]=result;print(name,stage,direction,{k:v for k,v in result.items()if k!='witnesses'},'seconds',round(time.time()-began,1),flush=True)
  rows.append(row)
  OUTPUT.write_text(json.dumps({'scope':'Bidirectional sampled exterior-visible P95 for stage3 pods only. All over-.0595m points are surveyed against opaque front faces of the entire source/target ship, with clear atlas faces skipped. Positive visible in-tolerance samples establish a lower bound of19 good per bad plus1. The .0005m reserve covers two native16m-cell quantization displacements. The recorded maximum is not bounded by .06m. This finite camera survey is not an exhaustive visibility theorem and must be repeated when layout/occluders change.', 'layoutSHA256':I['layoutSHA256'],'rawIndexSHA256':hashlib.sha256((R/'index.json').read_bytes()).hexdigest(),'candidateIndexSHA256':hashlib.sha256((C/'diagnostic-index.json').read_bytes()).hexdigest(),'rays':rays,'seconds':time.time()-began,'rows':rows},indent=2))

assert len(rows)==6 and all(d['sampledVisibleP95Pass'] and not d['unresolvedRays'] for r in rows for d in r['directions'].values()),'visible P95 fixture gate failed'
