import json,math,sys,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
args=sys.argv[sys.argv.index('--')+1:]
if len(args)!=3:raise ValueError('expected SOURCE_DIR OUTPUT_DIR PRIOR_WITNESSES_JSON')
S=Path(args[0]).resolve();O=Path(args[1]).resolve();W=Path(args[2]).resolve()
records=json.loads((O/'native-records.json').read_text())
layout=json.loads((S.parents[3]/'content/landmarks/cruise-layout.json').read_text())
def triangles(flat,origin=(0,0,0)):
 return [[tuple(flat[i+j+k]+origin[k]for k in range(3))for j in(0,3,6)]for i in range(0,len(flat),9)]
def tree(ts):return BVHTree.FromPolygons([p for t in ts for p in t],[(3*i,3*i+1,3*i+2)for i in range(len(ts))],all_triangles=True)
def distances(ts,bvh):
 values=[bvh.find_nearest(Vector(p))[3]for t in ts for p in [*t,tuple(sum(p[k]for p in t)/3 for k in range(3))]]
 values.sort();return {'samples':len(values),'p95':values[int(len(values)*.95)],'max':values[-1]}
rows=[];worldFine=[];worldCoarse=[]
for row in records:
 a,b=triangles(row['fine']),triangles(row['coarse']);near,far=tree(a),tree(b)
 rows.append({'cell':row['cell'],'forward':distances(a,far),'reverse':distances(b,near)})
 worldFine.extend(triangles(row['fine'],row['origin']));worldCoarse.extend(triangles(row['coarse'],row['origin']))
near,far=tree(worldFine),tree(worldCoarse)
nativeBounds={'min':[min(p[k]for t in worldCoarse for p in t)for k in range(3)],'max':[max(p[k]for t in worldCoarse for p in t)for k in range(3)]}
crown=[]
for direction,source,target in [('forward',worldFine,far),('reverse',worldCoarse,near)]:
 values=[{'point':list(p),'error':target.find_nearest(Vector(p))[3]}for t in source for p in [*t,tuple(sum(q[k]for q in t)/3 for k in range(3))] if p[1]>62]
 values.sort(key=lambda r:r['error']);crown.append({'direction':direction,'samples':len(values),'p95':values[int(len(values)*.95)]['error'],'max':values[-1]})
old=json.loads(W.read_text());native=json.loads((O/'native-check.json').read_text())
assert old['layoutSHA256']==native['layoutSHA256'] and old['rawIndexSHA256']==native['rawIndexSHA256'], 'Prior witnesses/native baseline mismatch'
old['badVisible']=[w for row in old['witnesses'] for w in [row]*row['occurrences']]
witnesses=[{'cell':w['cell'],'owner':w['owner'],'point':w['point'],'oldError':w['error'],'newError':far.find_nearest(Vector(w['point']))[3]}for w in old['badVisible']]
route=next(r for r in layout['routes']if r['id']=='aquadome_access')
minimum={'fine':(1e9,None),'candidate':(1e9,None)};count=0
for a,b in zip(route['anchors'],route['anchors'][1:]):
 d=Vector(b)-Vector(a);n=max(1,math.ceil(d.length/.25));side=Vector((d.z,0,-d.x)).normalized()
 for i in range(n+1):
  for j in range(7):
   for k in range(19):
    p=Vector(a)+d*(i/n)+side*(-.6+j*.2)+Vector((0,.4+k*.1,0));count+=1
    for key,bvh in [('fine',near),('candidate',far)]:
     distance=bvh.find_nearest(p)[3]
     if distance<minimum[key][0]:minimum[key]=(distance,list(p))
cover=math.sqrt(.125**2+.1**2+.05**2)
report={'scope':'Actual serialized shared-bound dome-owner geometry. Bidirectional vertices and triangle-centroid P95; original visible witnesses checked against the complete candidate dome. Entrance route capsule-center volume is uniformly sampled with a Lipschitz coverage reserve, radius.4 and full height2.6; physical colliders and near geometry are unchanged.',
 'nativeBounds':nativeBounds,'nativeWidth':nativeBounds['max'][0]-nativeBounds['min'][0],'nativeHeight':nativeBounds['max'][1]-nativeBounds['min'][1],'crownAbove62m':crown,'rows':rows,'oldWitnesses':len(witnesses),'oldWitnessesStillAbove06':sum(w['newError']>.06 for w in witnesses),'maxOldWitnessError':max(w['newError']for w in witnesses),
 'remainingWitnessYRange':[min((w['point'][1] for w in witnesses if w['newError']>.06),default=None),max((w['point'][1] for w in witnesses if w['newError']>.06),default=None)],'remainingBaseRim':sum(w['newError']>.06 and w['point'][1]<45.85 for w in witnesses),'worstWitnesses':sorted(witnesses,key=lambda w:-w['newError'])[:12],
 'entrance':{'route':route['id'],'samples':count,'capsuleRadius':.4,'coverageReserve':cover,'minimumSurfaceDistance':minimum,'clear':all(v[0]-cover>.4 for v in minimum.values())}}
(O/'metrics.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'maxForwardP95':max(r['forward']['p95']for r in rows),'maxReverseP95':max(r['reverse']['p95']for r in rows),'maxOldWitnessError':report['maxOldWitnessError'],'oldWitnessesStillAbove06':report['oldWitnessesStillAbove06'],'entrance':report['entrance']}))

assert all(r[d]['p95']<=.06 for r in rows for d in('forward','reverse')), 'Owner P95 gate'
assert report['entrance']['clear'] and not report['oldWitnessesStillAbove06'], 'Entrance/witness gate'
assert abs(report['nativeWidth']-57)<.001 and abs(report['nativeHeight']-17)<.001, 'Native published dimensions'
assert all(r['p95']<=.06 for r in crown), 'Crown transition P95'
