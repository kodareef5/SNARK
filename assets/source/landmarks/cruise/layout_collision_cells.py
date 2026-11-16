"""Exact native solids partitioned onto the visible landmark's 16 m cell owners.

No collider is invented for an anchor. Every output piece is a closed intersection
of a source convex part and a cell. Logical art/route records remain independent.
Run directly with input/output JSON paths for a diagnostic; the author calls finish
AFTER its ordinary six-decimal source normalization, and must not round again.
"""
import copy,hashlib,itertools,json,math,sys
from pathlib import Path
from collections import defaultdict
from functools import lru_cache

SIDE=16
EPS=1e-10

def sub(a,b):return [x-y for x,y in zip(a,b)]
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def snap(v):return math.floor(v*512+.5)/512

def axes(degrees):
 yaw=math.floor(degrees*65536/360+.5)&65535;q=yaw>>14;a=(yaw&16383)*math.tau/65536
 c=math.floor(math.cos(a)*768+.5);s=math.floor(math.sin(a)*768+.5)
 for _ in range(q):c,s=-s,c
 return c/768,s/768

def worldpoint(point,instance):
 c,s=axes(instance['yaw']);x,y,z=point;at=[snap(v) for v in instance['at']]
 return [at[0]+c*x+s*z,at[1]+y,at[2]-s*x+c*z]

def unique(points):
 out=[]
 for p in points:
  if not any(max(abs(a-b) for a,b in zip(p,q))<EPS for q in out):out.append(p)
 return out

def clean_face(face):
 face=unique(face)
 while len(face)>3:
  removed=False
  for i in range(len(face)):
   a,b,c=face[i-1],face[i],face[(i+1)%len(face)]
   if math.sqrt(dot(cross(sub(b,a),sub(c,b)),cross(sub(b,a),sub(c,b))))<EPS:
    del face[i];removed=True;break
  if not removed:break
 return face if len(face)>=3 else []

def ring(points,normal):
 center=[sum(p[k] for p in points)/len(points) for k in range(3)]
 axis=min(range(3),key=lambda k:abs(normal[k]));unit=[int(k==axis) for k in range(3)]
 u=cross(normal,unit);v=cross(normal,u)
 return sorted(points,key=lambda p:math.atan2(dot(sub(p,center),v),dot(sub(p,center),u)))

@lru_cache(maxsize=None)
def hull_rings(key):
 points=[sub(p,key[0]) for p in key];seen=set();faces=[]
 for i,j,k in itertools.combinations(range(len(points)),3):
  n=cross(sub(points[j],points[i]),sub(points[k],points[i]));length=math.sqrt(dot(n,n))
  if length<EPS:continue
  n=[v/length for v in n];d=dot(n,points[i]);dist=[dot(n,p)-d for p in points]
  if max(dist)>EPS and min(dist)<-EPS:continue
  if max(dist)>EPS:n=[-v for v in n];d=-d
  indices=tuple(j for j,p in enumerate(points) if abs(dot(n,p)-d)<EPS)
  if indices in seen:continue
  seen.add(indices)
  face=clean_face(ring([points[j] for j in indices],n))
  if face:faces.append(tuple(points.index(p) for p in face))
 assert len(faces)>=4,('source part is not solid',points)
 return tuple(faces)

def hull_poly(points):
 return [[list(points[i]) for i in face] for face in hull_rings(tuple(tuple(p) for p in points))]

def volume(poly):
 if not poly:return 0
 o=poly[0][0]
 return abs(sum(dot(sub(f[0],o),cross(sub(f[i],o),sub(f[i+1],o)))/6 for f in poly for i in range(1,len(f)-1)))

def clip(poly,axis,bound,keep):
 """keep=-1 keeps <= bound; keep=1 keeps >= bound. Cap is outward oriented."""
 result=[];cut=[]
 for face in poly:
  out=[]
  for a,b in zip(face,face[1:]+face[:1]):
   da=(a[axis]-bound)*keep;db=(b[axis]-bound)*keep;ia=da>=-EPS;ib=db>=-EPS
   if ia:out.append(a)
   if ia!=ib:
    t=(bound-a[axis])/(b[axis]-a[axis]);p=[a[k]+(b[k]-a[k])*t for k in range(3)];p[axis]=bound
    out.append(p);cut.append(p)
  out=clean_face(out)
  if out:result.append(out)
 cap=unique(cut)
 if len(cap)>=3:
  normal=[-keep if k==axis else 0 for k in range(3)];cap=clean_face(ring(cap,normal))
  if cap:result.append(cap)
 return result

def corners(poly):return unique([p for face in poly for p in face])

def face_pyramids(face,center):
 # Balance the fan before splitting a long cap. A maximum-size first group
 # can leave one almost-collinear triangle as a native-invalid final solid.
 # Every original triangle remains exactly once; no corner or volume is lost.
 count=len(face)-2;groups=(count+8)//9;first=1
 for group in range(groups):
  size=count//groups+(group<count%groups)
  base=[face[0]]+face[first:first+size+1];first+=size
  v=abs(sum(dot(sub(base[0],center),cross(sub(base[i],center),sub(base[i+1],center)))/6 for i in range(1,len(base)-1)))
  if v>1e-12:yield [center]+base,v

def bounded_parts(poly):
 points=corners(poly);v=volume(poly)
 if len(points)<=12 and abs(volume(hull_poly(points))-v)<max(1e-10,v*1e-9):return [(points,v)]
 # A convex solid is exactly the union of face pyramids from its interior
 # centroid. Keep a face together: a fan of skinny triangles can produce a
 # numerically planar tetrahedron even though the whole cap is a sound solid.
 center=[sum(p[k] for p in points)/len(points) for k in range(3)]
 out=[]
 for face in poly:
  out.extend(face_pyramids(face,center))
 return out

def grids(lo,hi):
 return itertools.product(*(range(math.floor(a/SIDE),math.floor((b-EPS)/SIDE)+1) for a,b in zip(lo,hi)))

def fragments(points,box=False):
 lo=[min(p[k] for p in points) for k in range(3)];hi=[max(p[k] for p in points) for k in range(3)]
 if box:
  for grid in grids(lo,hi):
   a=[max(lo[k],grid[k]*SIDE) for k in range(3)];b=[min(hi[k],(grid[k]+1)*SIDE) for k in range(3)]
   if min(y-x for x,y in zip(a,b))>EPS:yield grid,'box',{'at':[(x+y)/2 for x,y in zip(a,b)],'half':[(y-x)/2 for x,y in zip(a,b)]},math.prod(y-x for x,y in zip(a,b))
  return
 original=hull_poly(points)
 for grid in grids(lo,hi):
  poly=original
  for axis in range(3):
   if lo[axis]<grid[axis]*SIDE:poly=clip(poly,axis,grid[axis]*SIDE,1)
   if hi[axis]>(grid[axis]+1)*SIDE:poly=clip(poly,axis,(grid[axis]+1)*SIDE,-1)
   if not poly:break
  if volume(poly)<=1e-12:continue
  for piece,part_volume in bounded_parts(poly):
   if part_volume>1e-12:yield grid,'hull',{'points':piece},part_volume

def finish(D):
 # Older cell authoring cloned an existing logical instance. Undo only those
 # render aliases; source IDs, transforms, doors and triangle provenance remain.
 D['prototypes']=[p for p in D['prototypes'] if 'sourcePrototype' not in p]
 for i in D['instances']:
  if 'sourcePrototype' in i:i['prototype']=i.pop('sourcePrototype')
 byid={p['id']:p for p in D['prototypes']};byinstance={i['id']:i for i in D['instances']}
 physical=defaultdict(list);looks=defaultdict(list);stats={'sourceParts':0,'clippedParts':0,'sourceVolume':0.,'clippedVolume':0.,'maxPartVolumeError':0.}
 for inst in D['instances']:
  if not inst['placed']:continue
  p=byid[inst['prototype']]
  if p['category']=='door':continue
  for mode,parts in [('collision',p),('look',p.get('look',p))]:
   for kind,listed in [('box',parts.get('boxes',[])),('hull',parts.get('hulls',[]))]:
    for part,item in enumerate(listed):
     local=([[item['at'][k]+sign[k]*item['half'][k] for k in range(3)] for sign in itertools.product((-1,1),repeat=3)] if kind=='box' else item['points'])
     points=[worldpoint(q,inst) for q in local];c,s=axes(inst['yaw']);isbox=kind=='box' and (c==0 or s==0)
     source_volume=(math.prod(2*v for v in item['half'])*(c*c+s*s) if kind=='box' else volume(hull_poly(points)))
     sum_volume=0
     for grid,shape,value,v in fragments(points,isbox):
      center=[(k+.5)*SIDE for k in grid]
      if shape=='box':value={'at':[value['at'][k]-center[k] for k in range(3)],'half':value['half']}
      else:value={'points':[[q[k]-center[k] for k in range(3)] for q in value['points']]}
      source={'instance':inst['id'],'prototype':p['id'],'kind':kind,'part':part,
       'floor':p['category']=='floor' or p['art'].get('kind')=='floor',
       'support':p['category']=='floor' or (p['category']=='stairs' and part==0 and (kind=='hull' or p['art'].get('kind')=='landing'))}
      key=(tuple(grid),p['color'],source['floor'],source['support'])
      (physical if mode=='collision' else looks)[key].append((shape,value,source));sum_volume+=v
     error=abs(source_volume-sum_volume)
     assert error<max(1e-7,source_volume*1e-8),('clipped volume changed',inst['id'],kind,part,mode,source_volume,sum_volume)
     if mode=='collision':
      stats['sourceParts']+=1;stats['sourceVolume']+=source_volume;stats['clippedVolume']+=sum_volume;stats['maxPartVolumeError']=max(stats['maxPartVolumeError'],error)
 visual={tuple(c['grid']):c for c in D['cells']}
 # Diagnose look-only groups explicitly; do not create a token/phantom collider.
 missing=[{'grid':list(k[0]),'color':k[1],'floor':k[2],'support':k[3],'parts':len(v)} for k,v in looks.items() if k not in physical]
 if missing:raise ValueError('look groups without real collision: '+json.dumps(missing[:30])+f' ({len(missing)} groups)')
 empty=[{'grid':list(k[0]),'color':k[1],'sources':sorted({q['instance'] for _,_,q in v})} for k,v in physical.items() if not looks.get(k)]
 if empty:raise ValueError('physical groups without original far look: '+json.dumps(empty))
 standalone={p['id'] for p in D['prototypes'] if p['category']=='door' or p['category']=='sign' and not any(i['placed'] and i['prototype']==p['id'] for i in D['instances'])}
 D['collisionPrototypes']=[copy.deepcopy(p) for p in D['prototypes'] if p['id'] in standalone]
 D['collisionInstances']=[copy.deepcopy(i) for i in D['instances'] if i['prototype'] in standalone]
 D['collisionCells']=[];cellparts=defaultdict(list)
 for key,parts in sorted(physical.items()):cellparts[key[0]].append((key,parts))
 for number,(grid,groups) in enumerate(sorted(cellparts.items())):
  center=[(k+.5)*SIDE for k in grid];cell=visual.get(grid);cid=cell['id'] if cell else f'cruise:physical_cell_{number:04}'
  entry={'id':cid,'grid':list(grid),'origin':center,'instances':[]}
  for group,(key,parts) in enumerate(groups):
   far=looks.get(key,[]);count=max(math.ceil(len(parts)/16),math.ceil(len(far)/64))
   assert len(parts)>=count,('not enough real parts for far groups',key,len(parts),len(far))
   for section in range(count):
    batch=parts[section*len(parts)//count:(section+1)*len(parts)//count];drawn=far[section*len(far)//count:(section+1)*len(far)//count]
    assert drawn,('physical module lacks original far look',key,section)
    name=f'collision_{number:04}_{group:02}_{section:02}';ident='cruise:'+name
    def forms(items):return {'boxes':[v for k,v,_ in items if k=='box'],'hulls':[v for k,v,_ in items if k=='hull']}
    forms_here=forms(batch);look=forms(drawn) if drawn else None
    allpoints=[q for k,v,_ in batch+drawn for q in (v['points'] if k=='hull' else [[v['at'][a]+sign[a]*v['half'][a] for a in range(3)] for sign in itertools.product((-1,1),repeat=3)])]
    bounds={'min':[min(q[k] for q in allpoints) for k in range(3)],'max':[max(q[k] for q in allpoints) for k in range(3)]}
    prototype={'id':ident,'mesh':'none','category':'floor' if key[2] else 'collision','color':key[1],**forms_here,'visualBounds':bounds,
     'art':{'kind':'floor' if key[2] else 'collision_cell'},'sourceParts':{'boxes':[q for k,_,q in batch if k=='box'],'hulls':[q for k,_,q in batch if k=='hull']}}
    if look:prototype['look']=look
    source_instances=sorted({q['instance'] for _,_,q in batch});source=byinstance[source_instances[0]]
    instance={'id':name,'prototype':ident,'at':center,'yaw':0,'deck':source['deck'],'section':'collision-cell','placed':True,'cell':cid,'sourceInstances':source_instances}
    D['collisionPrototypes'].append(prototype);D['collisionInstances'].append(instance);entry['instances'].append(name);stats['clippedParts']+=len(batch)
  if cell:
   cell['anchor']=entry['instances'][0];cell['origin']=center;cell['yaw']=0
   next(p for p in D['collisionPrototypes'] if p['id']=='cruise:'+cell['anchor'])['mesh']=cell['id']
  D['collisionCells'].append(entry)
 absent=[c['id'] for grid,c in visual.items() if grid not in cellparts]
 if absent:raise ValueError('visual cells without a real physical part: '+json.dumps(absent))
 D['collisionAudit']=stats
 return stats

def self_test():
 cases=[]
 # Eight adjacent owners share exact faces, with no overlap or missing volume.
 box=[[x,y,z] for x in(-1,1) for y in(-1,1) for z in(-1,1)]
 # Regression: a thin, slightly non-planar authored dome rib crossing Z112.
 # Splitting its cap into skinny tetrahedra made native hullOf call them planar.
 rib=[[27.7176445,48.8968435,112.0110295],[27.7874935,49.0625845,111.8843375],
  [27.9103045,48.8968435,112.1172485],[27.9801535,49.0625845,111.9905555],
  [25.9754845,52.0465315,115.1709825],[26.0453335,52.2122725,115.0442895],
  [26.1681435,52.0465315,115.2772005],[26.2379925,52.2122725,115.1505075]]
 phi=(1+math.sqrt(5))/2
 ico=[[15+3*p[k] for k in range(3)] for p in [(0,a,b) for a in(-1,1) for b in(-phi,phi)]+[(a,b,0) for a in(-1,1) for b in(-phi,phi)]+[(b,0,a) for a in(-1,1) for b in(-phi,phi)]]
 for name,points,isbox in [('box',box,True),('thin-rib',rib,False),('twelve-corner',ico,False)]:
  out=list(fragments(points,isbox));before=8 if isbox else volume(hull_poly(points));after=sum(v for _,_,_,v in out)
  assert abs(before-after)<1e-8,(name,before,after)
  if isbox:assert len(out)==8
  parts=[]
  for grid,kind,part,_ in out:
   center=[(v+.5)*SIDE for v in grid]
   points=part.get('points',[[part['at'][k]+s[k]*part['half'][k] for k in range(3)] for s in itertools.product((-1,1),repeat=3)] if kind=='box' else [])
   assert all(grid[k]*SIDE-EPS<=p[k]<=(grid[k]+1)*SIDE+EPS for p in points for k in range(3))
   parts.append({'grid':list(grid),'points':[[p[k]-center[k] for k in range(3)] for p in points]})
  cases.append({'name':name,'volume':before,'clippedVolume':after,'parts':parts})
 # Actual slide cell cap: a 9+1 fan left a 6.3e-12 m3 tetrahedron whose
 # corners are all on one plane at the unchanged native 1e-9 tolerance.
 center=[-2.72143433680494,-7.77206376388888,-4.655159296768687]
 face=[[-2.4679029117322813,-8,-4.920015426629334],[-2.437386845859791,-8,-4.933166625253477],
  [-2.415469367992465,-8,-4.876224674095994],[-2.3003556378286447,-8,-4.576723326838703],
  [-2.4990150964286393,-8,-4.4914554216449005],[-2.642170862215245,-8,-4.430010884513138],
  [-2.873801397012233,-8,-4.330591786028151],[-3.195239610812603,-8,-4.192625979984058],
  [-3.257020572101677,-8,-4.353251983747526],[-3.3316873575682955,-8,-4.547757991120903],
  [-3.0511276600878254,-8,-4.668668485814408],[-2.7789792428492213,-8,-4.78595375616581]]
 before=abs(sum(dot(sub(face[0],center),cross(sub(face[i],center),sub(face[i+1],center)))/6 for i in range(1,len(face)-1)))
 out=list(face_pyramids(face,center));after=sum(v for _,v in out)
 assert abs(before-after)<1e-16
 cases.append({'name':'slide-cap','volume':before,'clippedVolume':after,
  'parts':[{'grid':[0,0,0],'points':p} for p,_ in out]})
 return cases

if __name__=='__main__':
 if sys.argv[1:] == ['--self-test']:print(json.dumps({'source':'assets/source/landmarks/cruise/layout_collision_cells.py','sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'cases':self_test()},separators=(',',':')))
 else:
  D=json.load(open(sys.argv[1]));report=finish(D)
  with open(sys.argv[2],'w') as f:json.dump(D,f,indent=2);f.write('\n')
  print(json.dumps(report))
