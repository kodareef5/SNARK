"""Supported exterior closures and real guards at exposed circulation edges."""
import math

def finish(D,p,world,place,box,ys,beam):
 def inside(poly,x,z):
  yes=False
  for a,b in zip(poly,poly[1:]+poly[:1]):
   if (a[1]>z)!=(b[1]>z) and x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]:yes=not yes
  return yes
 def supported(d,x,z):return any(inside(poly,x,z) for poly in d['outlines']) and not any(inside(v['polygon'],x,z) for v in d['voids'])
 def crossing(a,b,y):
  vx=b[0]-a[0];vz=b[1]-a[1];length=math.hypot(vx,vz)
  for route in D['routes']:
   for q,r in zip(route['anchors'],route['anchors'][1:]):
    if min(abs(q[1]-y),abs(r[1]-y))>.08:continue
    dx=r[0]-q[0];dz=r[2]-q[2];ln=math.hypot(dx,dz)
    if ln<.01 or abs((dx*vx+dz*vz)/(ln*length))>.65:continue
    mx=(a[0]+b[0])/2;mz=(a[1]+b[1])/2;t=max(0,min(1,((mx-q[0])*dx+(mz-q[2])*dz)/(ln*ln)))
    if math.hypot(mx-q[0]-t*dx,mz-q[2]-t*dz)<1.5:return True
  return False
 def guard(name,a,b,y,deck):
  dx=b[0]-a[0];dz=b[1]-a[1];ln=math.hypot(dx,dz)
  if ln<.08:return
  nx=-dz/ln*.04;nz=dx/ln*.04
  pts=[[x+sign*nx,yy,z+sign*nz] for x,z in(a,b) for sign in(-1,1) for yy in(y,y+1.15)]
  art={'kind':'guard','finish':'steel'}
  if name.startswith('bridge_'):art['measurement']='bridge'
  q,o=world('edge_guard','guard',hs=[pts],art=art,color=91)
  pr=next(t for t in D['prototypes'] if t['id']==q)
  pr['art']['ends']=[[a[0]-o[0],y-o[1],a[1]-o[2]],[b[0]-o[0],y-o[1],b[1]-o[2]]]
  place(name,q,o,deck,'edge-protection')
 # All open upper edges get collision, not decorative rails alone. Boundary tests remove internal outline seams.
 for d in D['decks']:
  if int(d['id'])<5:continue
  y=d['floorY'];edges=[]
  for poly in d['outlines']:
   for a,b in zip(poly,poly[1:]+poly[:1]):edges.append((a,b,'outside'))
  for v in d['voids']:
   if v['kind']=='basin':continue
   for a,b in zip(v['polygon'],v['polygon'][1:]+v['polygon'][:1]):
    if v['kind']=='stair' and a[1]==b[1] and a[1]==min(q[1] for q in v['polygon']):continue
    if v['id']=='pearl' and d['id']=='6' and a[1]==b[1]==7:
     edges.extend([(a,[16.4,7],v['id']),([11.6,7],b,v['id'])]);continue
    edges.append((a,b,v['id']))
  for ei,(a,b,role) in enumerate(edges):
   dx=b[0]-a[0];dz=b[1]-a[1];ln=math.hypot(dx,dz);n=max(1,math.ceil(ln/1.5));pending=None
   for j in range(n):
    aa=[a[0]+dx*j/n,a[1]+dz*j/n];bb=[a[0]+dx*(j+1)/n,a[1]+dz*(j+1)/n];mx=(aa[0]+bb[0])/2;mz=(aa[1]+bb[1])/2
    left=supported(d,mx-dz/ln*.12,mz+dx/ln*.12);right=supported(d,mx+dz/ln*.12,mz-dx/ln*.12)
    use=left!=right
    # Repeated balcony rails and promenade glazing already close these side edges.
    if role=='outside' and -155<mz<111 and abs(mx)>26 and int(d['id'])<=14:use=False
    if role=='outside' and d['id']=='5' and mx>27 and abs(mz+24)<2:use=False
    if crossing(aa,bb,y):use=False
    if use:
     if pending is None:pending=aa
     if math.dist(pending,bb)>=10 or j==n-1:
      guard(f'guard_{d["id"]}_{ei}_{j}',pending,bb,y,d['id']);pending=None
    elif pending is not None:guard(f'guard_{d["id"]}_{ei}_{j}',pending,aa,y,d['id']);pending=None
 # Framed public promenade enclosure follows the actual tapered side outline. Clear window apertures stay clear visually.
 for deck in('5','6'):
  d=next(q for q in D['decks'] if q['id']==deck);y=ys[deck];height=d['ceilingY']-y
  poly=d['outlines'][0]
  for side in(-1,1):
   for j in range(83):
    z=-153.6+j*3.2
    if deck=='5' and side>0 and abs(z+24)<3.3:continue
    # Author same-height side panels from the true polygon boundary, with a restrained inset.
    hits=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
     if a[1]!=b[1] and min(a[1],b[1])<=z<=max(a[1],b[1]):hits.append(a[0]+(b[0]-a[0])*(z-a[1])/(b[1]-a[1]))
    x=(max(hits) if side>0 else min(hits))-side*.18
    bs=[box([-.10,0,-1.6],[.10,.65,1.6]),box([-.10,height-.50,-1.6],[.10,height,1.6]),
        box([-.10,.65,-1.6],[.10,height-.50,-1.46]),box([-.10,.65,1.46],[.10,height-.50,1.6]),
        box([-.025,.65,-1.46],[.025,height-.50,1.46])]
    q=p('promenade_frame','facade',bs,art={'kind':'window_wall','finish':'enamel','glassBoxes':[4]},color=232)
    place(f'promenade_frame_{deck}_{side}_{j}',q,[x,y,z],deck,'promenade-enclosure')
 # Explicit ceiling for the upper suite, which has open sky instead of a full deck above.
 q,o=world('suite_ceiling','ceiling',[box([11,56.16,39.8],[19,56.4,46.2])],art={'kind':'floor','finish':'enamel'},color=232)
 place('suite_ceiling',q,o,'17','suite')
 # Pearl's low structural root is closed machinery space on deck4, not a falsely full-height casino aisle.
 q,o=world('pearl_root','superstructure',[box([10,9.8,-13.6],[18,14,-2.4])],art={'kind':'wall','finish':'marble'},color=104)
 place('pearl_root',q,o,'4','pearl-structure')
 casino=next(r for r in D['rooms'] if r['id']=='casino')
 casino['footprint']={'polygons':[[[-17,-56],[17,-56],[17,36],[-17,36]]],'holes':[[[10,-13.6],[17,-13.6],[17,-2.4],[10,-2.4]]]}
 # The forward bridge is beyond the next deck's outline, so it has a real independent roof.
 for xi,(x0,x1) in enumerate([(-20,-8),(-8,4),(4,16),(16,20)]):
  for zi,(z0,z1) in enumerate([(119,131),(131,143)]):
   q,o=world('bridge_roof','ceiling',[box([x0,41.76,z0],[x1,42,z1])],art={'kind':'floor','finish':'enamel','measurement':'bridge'},color=232)
   place(f'bridge_roof_{xi}_{zi}',q,o,'12','bridge')
 for side in(-1,1):
  xa,xb=(24,32.9) if side>0 else(-32.9,-24)
  q,o=world('wing_roof','ceiling',[box([xa,41.76,120],[xb,42,134])],art={'kind':'floor','finish':'enamel','measurement':'bridge'},color=232)
  place(f'wing_roof_{side}',q,o,'12','bridge')
  ga,gb=(24.04,32.86) if side>0 else(-32.86,-24.04)
  for j,(a,b) in enumerate([([ga,120],[gb,120]),([ga,134],[gb,134]),([side*32.86,120],[side*32.86,134])]):
   guard(f'bridge_wing_guard_{side}_{j}',a,b,38.8,'12')
 # Closed transverse supports carry the blue funnel bases while leaving the outer circulation aisles clear.
 for side in(-1,1):
  q,o=world('funnel_support','superstructure',[box([side*11-7,49.6,-82],[side*11+7,51.5,-60])],art={'kind':'solids','finish':'enamel'},color=232)
  place(f'funnel_support_{side}',q,o,'16','machinery-casing')
 # Inner AquaTheater uses its own semantic group, separate from the published outer dome envelope.
 podhulls=[]
 for i in range(12):
  a=-2.57+5.14*i/12;b=-2.57+5.14*(i+1)/12
  podhulls.append({'points':[[rx*math.sin(t),y,-.12+rz*math.cos(t)] for t in(a,b) for rx,rz in[(1.12,.43),(2.4,1.61)] for y in(.08,1.16)]})
 podboxes=[box([x-.4,.07,-1],[x+.4,.61,-.4]) for x in(-.6,.6)]+[box([-1.5,.04,1.53],[1.5,.31,1.93])]
 podlook={'hulls':podhulls,'boxes':podboxes+[box([-2.5,.1,-.3],[-2.3,1.2,.3]),box([2.3,.1,-.3],[2.5,1.2,.3]),box([-1.5,.31,1.5],[1.5,1.6,2])]}
 pod=p('aquadome_pod','furniture',podboxes,podhulls,art={'kind':'aquadome_pod','finish':'purple'},color=32,look=podlook)
 for side in(-1,1):
  for i,z in enumerate([100,112,124]):place(f'aquadome_pod_{side}_{i}',pod,[side*13,45.6,z],'15','aquatheater',90 if side>0 else 270)
 q=p('aquatheater_stage','furniture',[box([-7,0,-4],[7,.55,4])],art={'kind':'furniture','wallCount':0,'items':[{'kind':'stage','at':[0,0,0],'size':[14,.55,8],'finish':'navy'}]},color=29)
 place('aquatheater_stage',q,[0,45.6,132],'15','aquatheater')
 # Suspended architectural performance ring; original static interpretation of the public theater photographs.
 arch=[]
 for i in range(9):
  a=math.pi*i/8;arch.append([8*math.cos(a),46.2+7*math.sin(a),137])
 for i,(a,b) in enumerate(zip(arch,arch[1:])):
  q,o=world('aquatheater_arch','theater',hs=[beam(a,b,.18)],art={'kind':'slide','finish':'steel','radius':.17},color=91)
  place(f'aquatheater_arch_{i}',q,o,'15','aquatheater')
 # The dry room beneath the prototype pool is a finished service lounge, not an empty test cavity.
 for i,z in enumerate([-13,2]):
  q=p('pool_lounge_sofa','furniture',[box([-1.5,0,-.5],[1.5,.95,.5])],art={'kind':'furniture','wallCount':0,'items':[{'kind':'sofa','at':[0,0,0],'size':[3,.95,1],'finish':'linen'}]},color=105)
  place('pool_lounge_sofa_'+str(i),q,[23,42,z],'14','pool-service-lounge',90)
 q=p('pool_lounge_table','furniture',[box([-.6,0,-.6],[.6,.7,.6])],art={'kind':'furniture','wallCount':0,'items':[{'kind':'table','at':[0,0,0],'size':[1.2,.7,1.2],'finish':'oak'}]},color=172)
 place('pool_lounge_table',q,[21,42,-10],'14','pool-service-lounge')
 for deck in D['decks']:
  if int(deck['id'])>19:continue
  q=p('deck_wayfinding','sign',[box([-.65,1.3,-.06],[.65,1.85,.06]),box([-.035,0,-.035],[.035,1.3,.035])],
      art={'kind':'sign','board':0,'label':'DECK '+deck['id']},color=29)
  place('deck_wayfinding_'+deck['id'],q,[-4.3,deck['floorY'],64],deck['id'],'wayfinding')
 q=p('ship_name','sign',[box([-2.3,1.4,-.06],[2.3,2.3,.06]),box([-2,0,-.05],[-1.92,1.4,.05]),box([1.92,0,-.05],[2,1.4,.05])],
     art={'kind':'sign','board':0,'label':'ICON OF THE SEAS'},color=29)
 place('arrival_ship_name',q,[24,14,-34],'5','wayfinding')
 # Both sides of the broad Pearl stair and its elevated bridge have real lateral protection.
 for side,x in enumerate([11.62,16.38]):
  for j,(a,b) in enumerate([([x,14,-18],[x,18.4,-3]),([x,18.4,-3],[x,18.4,7])]):
   pts=[[q[0]+s*.04,q[1]+h,q[2]] for q in(a,b) for s in(-1,1) for h in(0,1.15)]
   q,o=world('pearl_guard','guard',hs=[pts],art={'kind':'guard','finish':'steel'},color=91)
   proto=next(t for t in D['prototypes'] if t['id']==q);proto['art']['ends']=[[v[k]-o[k] for k in range(3)] for v in(a,b)]
   place(f'pearl_guard_{side}_{j}',q,o,'5' if j==0 else '6','pearl')
 # Public outdoor destinations have explicit usable polygons and genuine deck holes, not advertised rectangular overhangs.
 def clip(poly,axis,limit,keep):
  out=[]
  for a,b in zip(poly,poly[1:]+poly[:1]):
   ai=(a[axis]-limit)*keep>=-1e-8;bi=(b[axis]-limit)*keep>=-1e-8
   if ai:out.append(a)
   if ai!=bi:
    t=(limit-a[axis])/(b[axis]-a[axis]);out.append([a[k]+t*(b[k]-a[k]) for k in range(2)])
  return out
 openrooms={'aquadome','pool_edge','central_park','surfside','chill','hideaway','thrill','cloud','grove','grove_upper','waterpark','promenade','arrival'}
 for r in D['rooms']:
  if r['id'] not in openrooms:continue
  d=next(q for q in D['decks'] if q['id']==r['deck']);lo=r['bounds']['min'];hi=r['bounds']['max'];polys=[]
  for poly in d['outlines']:
   for axis,limit,keep in[(0,lo[0],1),(0,hi[0],-1),(1,lo[2],1),(1,hi[2],-1)]:
    if poly:poly=clip(poly,axis,limit,keep)
   if len(poly)>2:polys.append(poly)
  if r['id']=='aquadome':
   polys=[[[23.5*math.cos(i*math.tau/32),112+30*math.sin(i*math.tau/32)] for i in range(32)]]
   r['bounds']['min']=[-23.5,45.6,82];r['bounds']['max']=[23.5,62.6,142]
  holes=[]
  for v in d['voids']:
   poly=v['polygon']
   for axis,limit,keep in[(0,lo[0],1),(0,hi[0],-1),(1,lo[2],1),(1,hi[2],-1)]:
    if poly:poly=clip(poly,axis,limit,keep)
   if len(poly)>2 and abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))>.001:holes.append(poly)
  if r['id']=='thrill':r['entry']=[24,49.6,-94]
  r['footprint']={'polygons':polys,'holes':holes}
