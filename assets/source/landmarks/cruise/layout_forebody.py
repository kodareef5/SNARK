"""Photo-scaled raised forebody, original fitted structure beneath the existing bridge.

Only LOA/beam are published. Heights and rake stations here are explicitly inferred
from the actual Meyer sea-trial quarter and the archived Corey Seeman broadside.
The shell stays outside existing public floors and leaves their routes unchanged.
"""
import math

def finish(D,p,world,place,box,ys):
 stations=D['hullStations']
 def water(z):
  for a,b in zip(stations,stations[1:]):
   if a['z']<=z<=b['z']:
    t=(z-a['z'])/(b['z']-a['z']);return a['waterHalfBeam']+(b['waterHalfBeam']-a['waterHalfBeam'])*t
  return stations[-1]['waterHalfBeam']
 def width(z):
  return water(z)+4.65 if z<=172 else (water(172)+4.65)*(182.5-z)/10.5+.04*(z-172)/10.5
 def sheer(z):return 12.8+10.95*min(1,max(0,(z-94)/34))
 def emit(name,category,hulls,finish='enamel',deck='7',measurement='deckhouse'):
  q,at=world('forebody_'+name,category,hs=hulls,art={'kind':'solids','finish':finish,'measurement':measurement},color=29 if finish=='navy' else 232)
  place('forebody_'+name,q,at,deck,'raised-forebody')
 # The raised white side is a closed thin skin, not a solid volume in rooms.
 cuts=sorted(set([94,106,118,128,134,142,150,158,166,172,178,182.5]))
 for sign in(-1,1):
  for j,(za,zb) in enumerate(zip(cuts,cuts[1:])):
   points=[]
   for z in(za,zb):
    lower=water(z)+min(1.5,water(z)*.08);upper=width(z)
    for inset in(0,.20):points.extend([[sign*max(.005,lower-inset),12.8,z],[sign*max(.005,upper-inset),sheer(z),z]])
   if sheer(zb)-12.8>1e-5:emit(f"side_{'port' if sign>0 else 'starboard'}_{j}",'hull_side',[points],measurement='hull')
 # Real roof/foredeck closes the exposed lower bow and covers the entire fitness
 # room. Start at the old deck7 edge: no overlapping coplanar floor-top faces.
 def clip(poly,axis,bound,keep):
  out=[]
  for a,b in zip(poly,poly[1:]+poly[:1]):
   ia=(a[axis]-bound)*keep>=-1e-8;ib=(b[axis]-bound)*keep>=-1e-8
   if ia:out.append(a)
   if ia!=ib:
    t=(bound-a[axis])/(b[axis]-a[axis]);out.append([a[k]+(b[k]-a[k])*t for k in range(2)])
  return out
 for j,(za,zb) in enumerate(zip([150,158,166,172,178],[158,166,172,178,182.5])):
  plan=[[-width(za),za],[width(za),za],[width(zb),zb],[-width(zb),zb]]
  for column,(xl,xr) in enumerate([(-30,-10),(-10,10),(10,30)]):
   poly=clip(clip(plan,0,xl,1),0,xr,-1)
   if len(poly)<3:continue
   unique=[]
   for q in poly:
    if not any(math.dist(q,r)<1e-7 for r in unique):unique.append(q)
   if len(unique)<3:continue
   points=[[x,y,z] for x,z in unique for y in(22.36,22.6)]
   q,at=world('forebody_roof','floor',hs=[points],art={'kind':'floor','finish':'enamel','measurement':'deckhouse'})
   place(f'forebody_roof_{j}_{column}',q,at,'7','raised-forebody')
 # Full 1.15 m bulwark is part of the raised side above the roof. Its narrow
 # forward end closes as a real transom-like strip instead of an open shell.
 emit('stem','hull_side',[[[x,y,z] for x in(-.04,.04) for y in(12.8,23.75) for z in(182.3,182.5)]],measurement='hull')
 # Rounded rectangular front: the two inset dark bands sit in the actual rake,
 # partitioned with pale piers rather than pasted onto a coincident white face.
 # At the bridge its flat central front aligns with the existing glazing Z143.
 def front(x,y):
  t=(y-22.6)/(38.56-22.6);flat=8+8*t;center=166-23*t
  bend=max(0,min(1,(abs(x)-flat)/(27-flat)))
  return 118+(center-118)*math.sqrt(max(0,1-bend*bend))
 xs=[-27+i*54/24 for i in range(25)];rows=[22.6,28.8,30.7,33.5,35.4,38.56]
 for j,(ya,yb) in enumerate(zip(rows,rows[1:])):
  groups={}
  for k,(xa,xb) in enumerate(zip(xs,xs[1:])):
   for part,(a,b,finish) in enumerate([(xa,xb,'enamel')] if j not in(1,3) else [(xa,xa+.16,'enamel'),(xa+.16,xb,'navy')]):
    points=[[x,y,front(x,y)+depth] for x in(a,b) for y in(ya,yb) for depth in(-.18,0)]
    groups.setdefault(finish,[]).append(points)
  for finish,hulls in groups.items():
   batch=[];number=0
   for hull in hulls:
    points=[q for h in batch+[hull] for q in h]
    lo=[min(q[k] for q in points) for k in range(3)];hi=[max(q[k] for q in points) for k in range(3)]
    if batch and (len(batch)>=8 or max(b-a for a,b in zip(lo,hi))>28 or math.hypot(hi[0]-lo[0],hi[2]-lo[2])>28):
     emit(f'rake_{j}_{number}_{finish}','facade',batch,finish);number+=1;batch=[]
    batch.append(hull)
   if batch:emit(f'rake_{j}_{number}_{finish}','facade',batch,finish)
 D['forebody']={'evidence':'inferred from Meyer sea-trial quarter and actual 2025 broadside, not shipyard elevations',
  'raisedSheer':[[94,12.8],[128,23.75],[182.5,23.75]],'roofY':22.6,
  'rakedFront':[[22.6,166],[38.56,143]],'windowBands':[[28.8,30.7],[33.5,35.4]],
  'notes':'Existing public floors/routes unchanged; thin closed skin, real fitness ceiling and guarded foredeck cap.'}
