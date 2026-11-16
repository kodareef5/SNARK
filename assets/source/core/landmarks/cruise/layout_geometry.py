"""Prototype geometry: full envelope and repeated furnished vertical slice, in engine metres.

This is deliberately a gate before the final neighborhoods, lifeboats and fitted public rooms.
"""
import hashlib,json,math

def populate(D,prototype,instance,box,node):
 D['prototypes'].clear();D['instances'].clear();D['rooms'].clear();D['portals'].clear()
 D['routes'].clear();D['graph']['nodes'].clear();D['views'].clear()
 cache={};bydeck={d['id']:d for d in D['decks']};ys={k:d['floorY'] for k,d in bydeck.items()}
 def canonical(v):
  if isinstance(v,float):return round(v,6)
  if isinstance(v,list):return [canonical(q) for q in v]
  if isinstance(v,dict):return {k:canonical(q) for k,q in v.items()}
  return v
 def p(name,cat,bs,hs=None,art=None,color=232,look=None):
  bs,hs,art,look=canonical([bs,hs,art,look])
  if cat in('hull','hull_side'):art={**art,'measurement':'hull'}
  if cat=='balcony':art={**art,'measurement':'deckhouse'}
  if cat=='bridge':art={**art,'measurement':'bridge'}
  key=json.dumps([cat,bs,hs,art,color,look],sort_keys=True)
  if key in cache:return cache[key]
  ident=prototype(name+'_'+hashlib.sha1(key.encode()).hexdigest()[:10],cat,bs,hulls=hs,art=art,color=color,look=look)
  cache[key]=ident;return ident
 def world(name,cat,bs=None,hs=None,art=None,color=232):
  bs=bs or [];hs=hs or [];points=[q for h in hs for q in h]
  for b in bs:
   points += [[b['at'][k]+s[k]*b['half'][k] for k in range(3)] for s in [(x,y,z) for x in(-1,1) for y in(-1,1) for z in(-1,1)]]
  lo=[min(q[k] for q in points) for k in range(3)];hi=[max(q[k] for q in points) for k in range(3)];o=[(a+b)/2 for a,b in zip(lo,hi)]
  localbs=[{'at':[b['at'][k]-o[k] for k in range(3)],'half':b['half']} for b in bs]
  localhs=[{'points':[[q[k]-o[k] for k in range(3)] for q in h]} for h in hs]
  return p(name,cat,localbs,localhs,art,color),o
 def place(name,proto,at,deck='2',section='envelope',yaw=0):return instance(name,proto,at,deck,section,yaw)
 def rect(x0,z0,x1,z1):return [[x0,z0],[x1,z0],[x1,z1],[x0,z1]]
 def route(ident,kind,start,end,anchors,width=1.8,family=None):
  item={'id':ident,'kind':kind,'from':start,'to':end,'anchors':anchors,'clearWidth':width,'clearHeight':2.6}
  if family:item['family']=family
  D['routes'].append(item);return item
 def section(z):return 'fore' if z>70 else 'aft' if z< -70 else 'midship'
 # Cross-sections of the closed underwater shell; above-water side walls are separate so interiors stay empty.
 stations=[(-182.5,17.0,-3.8),(-170,22.5,-7.0),(-146,24.25,-9.0),(-122,24.25,-9.3),
           (-98,24.25,-9.3),(-74,24.25,-9.3),(-50,24.25,-9.3),(-26,24.25,-9.3),(-2,24.25,-9.3),
           (22,24.25,-9.3),(46,24.25,-9.3),(70,24.25,-9.2),(94,24.0,-8.9),(118,22.5,-8.2),
           (142,18.0,-6.8),(160,11.8,-4.8),(174,5.4,-2.7),(182.5,.04,-.7)]
 D['hullStations']=[{'z':z,'waterHalfBeam':w,'keelY':k,'evidence':'inferred-profile-at-published-envelope'} for z,w,k in stations]
 def waterwidth(z):
  for (a,wa,_),(b,wb,_) in zip(stations,stations[1:]):
   if a<=z<=b:return wa+(wb-wa)*(z-a)/(b-a)
  return stations[0][1] if z<stations[0][0] else stations[-1][1]
 sections=[]
 for a,b in zip(stations,stations[1:]):
  n=math.ceil((b[0]-a[0])/12)
  sections.extend([([a[k]+(b[k]-a[k])*i/n for k in range(3)],[a[k]+(b[k]-a[k])*(i+1)/n for k in range(3)]) for i in range(n)])
 for j,(a,b) in enumerate(sections):
  for sign in(-1,1):
   ps=[]
   for z,w,k in(a,b):ps += [[0,k,z],[sign*w*.70,k*.75,z],[sign*w,0,z],[0,0,z]]
   q,o=world('hull_under','hull',hs=[ps],art={'kind':'solids','finish':'navy'},color=83)
   place(f'hull_under_{j}_{sign}',q,o)
   # Thin, closed shell above the water. The boarding level is above this white hull band.
   side=[]
   for z,w,k in(a,b):side += [[sign*w,0,z],[sign*(w+min(1.5,w*.08)),12.8,z],
                            [sign*max(.01,w+min(1.5,w*.08)-.24),12.8,z],[sign*max(.01,w-.24),0,z]]
   q,o=world('hull_side','hull_side',hs=[side],art={'kind':'solids','finish':'enamel'},color=232)
   place(f'hull_side_{j}_{sign}',q,o)
 # Closed above-water transom: three bounded sections preserve the published stern station without a dry-shell gap.
 for i in range(3):
  pts=[[(-1+2*(i+edge)/3)*(17+1.36*y/12.8),y,z] for edge in(0,1) for y in(0,12.8) for z in(-182.5,-182.26)]
  q,o=world('transom','hull_side',hs=[pts],art={'kind':'solids','finish':'enamel'},color=232);place('transom_'+str(i),q,o)
 pts=[[sign*(waterwidth(z)+min(1.5,waterwidth(z)*.08)*y/12.8),y,z] for z in(182.26,182.5) for sign in(-1,1) for y in(0,12.8)]
 q,o=world('stem','hull_side',hs=[pts],art={'kind':'solids','finish':'enamel'},color=232);place('stem_closure',q,o)
 # Actual floor outlines remain stepped and retain the two open neighborhoods through their upper decks.
 cores=[('fore',0,64,0,16),('aft',0,-72,0,14),('launch',16,-128,13,17)]
 for i,d in enumerate(D['decks']):
  label=d['id'];y=d['floorY'];n=int(label)
  if n<=4:spans=[(-176,164,24.0)]
  elif n<=8:spans=[(-180,{5:168,6:172,7:150,8:140}[n],28.9)]
  elif n<=14:spans=[(-178,{9:134,10:128,11:124,12:146,14:112}[n],28.9)]
  elif n==15:spans=[(-180,147,28.9)]
  elif n==16:spans=[(-178,112,28.9)]
  elif n==17:spans=[(30,100,25.0)]
  elif n==18:spans=[(48,100,27.5),(-136,-122,12.0)]
  elif n==19:spans=[(48,76,22.0),(-136,-122,12.0)]
  else:spans=[(-142,-116,14.0)]
  outlines=[]
  for z0,z1,w in spans:
   if n>=18 and z0<0:outlines.append(rect(10,z0,22 if n<20 else 26,z1));continue
   zcuts=sorted(set([z0,z1]+[s[0] for s in stations if z0<s[0]<z1]+[z for z in (112,130,140) if n>=15 and z0<z<z1]))
   def dw(z):
    if n>=17:return w
    if n==15:return min(w,waterwidth(z)+4.65) if z<=112 else min(w,28.5*math.sqrt(max(0,1-((z-112)/35)**2))+.2)
    # Deckhouse reaches its independently published beam; bow and rounded stern taper honestly.
    return min(w,waterwidth(z)+(4.65 if n>=5 else -.25))
   outlines.append([[-dw(z),z] for z in zcuts]+[[dw(z),z] for z in reversed(zcuts)])
  if n==17:
   outlines += [rect(10,-72,27.5,30),rect(-27.5,-72,-20,30),rect(-26,-142,26,-72)]
  if n==16:
   # Dome volume is open above its deck15 floor, not bisected by an upper slab.
   pass
  voids=[]
  if n>=9 and n<=17:voids.append({'id':'central_park','kind':'atrium','polygon':rect(-8.6,-66,8.6,57.5)})
  if n>=8 and n<=14:voids.append({'id':'surfside','kind':'atrium','polygon':rect(-11,-174,11,-86)})
  if n in(15,16,17):voids.append({'id':'aft_canyon','kind':'atrium','polygon':rect(-7,-151,7,-96)})
  if n>=16 and n<=18:voids.append({'id':'aquadome','kind':'atrium','polygon':rect(-29,77,29,174)})
  if n in(6,7,8):voids.append({'id':'pearl','kind':'atrium','polygon':rect(6,-23,28.9,7)})
  if n in(5,6):voids.append({'id':'royal_theater','kind':'atrium','polygon':rect(-18,100,18,140)})
  if n==5:voids.append({'id':'absolute_zero','kind':'atrium','polygon':rect(-18,-178,18,-157)})
  if n==7:voids.append({'id':'waters_edge','kind':'basin','polygon':rect(-6,-176,6,-166)})
  if n==15:
   voids.append({'id':'royal_bay','kind':'basin','polygon':rect(-24,-19,-12,5)})
   voids.append({'id':'hideaway','kind':'basin','polygon':rect(-5,-176,5,-166)})
  for cname,cx,cz,low,high in cores:
   if low<i<=high:voids.append({'id':f'stair_{cname}_{label}','kind':'stair','polygon':rect(cx-2.4,cz-3.6,cx+2.4,cz+3.4)})
  # The shallow decorative pool reserves 2.66 m beneath its actual slab over an occupied room.
  if label=='15':voids.append({'id':'prototype_basin','kind':'basin','polygon':rect(13,-14,23,2)})
  d['outlines']=outlines;d['voids']=voids
  if n>=15:d['ceilingY']=None
  # Slabs are segmented on a shared 12 m lattice, plus precise opening edges. Equal rectangles instance one mesh.
  for oi,poly in enumerate(outlines):
   z0=min(q[1] for q in poly);z1=max(q[1] for q in poly)
   cuts=sorted(set([z0,z1]+[q[1] for q in poly]+[z for z in range(-180,181,12) if z0<z<z1]+
                   [q[1] for h in voids for q in h['polygon'] if z0<q[1]<z1]))
   def edges(z):
    xs=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
     if a[1]==b[1]:
      if abs(z-a[1])<1e-7:xs += [a[0],b[0]]
     elif min(a[1],b[1])-1e-7<=z<=max(a[1],b[1])+1e-7:xs.append(a[0]+(b[0]-a[0])*(z-a[1])/(b[1]-a[1]))
    return min(xs),max(xs)
   for zi,(za,zb) in enumerate(zip(cuts,cuts[1:])):
    la,ra=edges(za);lb,rb=edges(zb);active=[h for h in voids if min(q[1] for q in h['polygon'])<(za+zb)/2<max(q[1] for q in h['polygon'])]
    xcuts=sorted(set([min(la,lb),max(ra,rb)]+[x for x in range(-24,25,12) if min(la,lb)<x<max(ra,rb)]+[q[0] for h in active for q in h['polygon']]))
    for xi,(xl,xr) in enumerate(zip(xcuts,xcuts[1:])):
     mid=(xl+xr)/2
     if any(min(q[0] for q in h['polygon'])<mid<max(q[0] for q in h['polygon']) for h in active):continue
     # Clip the entire trapezoid. A closing end still leaves a supported triangular prism;
     # dropping it would punch a real hole into tapered outer decks.
     plan=[[la,za],[ra,za],[rb,zb],[lb,zb]]
     for boundary,sign in[(xl,1),(xr,-1)]:
      clipped=[]
      for a,b in zip(plan,plan[1:]+plan[:1]):
       ina=(a[0]-boundary)*sign>=-1e-8;inb=(b[0]-boundary)*sign>=-1e-8
       if ina:clipped.append(a)
       if ina!=inb:
        t=(boundary-a[0])/(b[0]-a[0]);clipped.append([boundary,a[1]+t*(b[1]-a[1])])
      plan=clipped
      if not plan:break
     unique=[]
     for a in plan:
      if not any(math.dist(a,b)<1e-7 for b in unique):unique.append(a)
     if len(unique)<3 or abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(unique,unique[1:]+unique[:1])))<1e-7:continue
     pts=[[x,yy,z] for x,z in unique for yy in(y-.24,y)]
     q,o=world('deck','floor',hs=[pts],art={'kind':'floor','finish':'deck' if n>=7 else 'stone'},color=101 if n>=7 else 232)
     place(f'd{label}_floor_{oi}_{zi}_{xi}',q,o,label,section((za+zb)/2))
 # Continuous repeated doglegs with 1.8 m flights, 4.4×2.2 m clear turn landings and genuine upper floor holes.
 for cname,cx,cz,low,high in cores:
  for i in range(low,high):
   lower=D['decks'][i];upper=D['decks'][i+1];label=lower['id'];ulabel=upper['id'];y=lower['floorY'];dy=upper['floorY']-y
   names=[];run=4.4;z0=-3.6;z1=.8
   for side in(-1,1):
    x0,x1=(-2,-.2) if side<0 else(.2,2);ya,yb=(0,dy/2) if side<0 else(dy,dy/2)
    def ramp(a,b):return [[x,yy,z] for z,yy in [(z0,ya),(z1,yb)] for x in(a,b) for yy in(yy-.26,yy)]
    hs=[{'points':ramp(x0,x1)}]
    for x in(x0-.08,x1):hs.append({'points':[[x+dx,yy,z] for z,base in[(z0,ya),(z1,yb)] for dx in(0,.08) for yy in(base,base+1.15)]})
    q=p('stair_flight','stairs',[],hs,{'kind':'stair','x0':x0,'x1':x1,'z0':z0,'z1':z1,'y0':ya,'y1':yb,'steps':math.ceil(dy/.32)},101)
    names.append(place(f'stair_{cname}_{label}_flight{side}',q,[cx,y,cz],label,cname))
   bs=[box([-2.2,dy/2-.24,.8],[2.2,dy/2,3]),box([-2.28,dy/2,.8],[-2.2,dy/2+1.15,3.08]),
       box([2.2,dy/2,.8],[2.28,dy/2+1.15,3.08]),box([-2.2,dy/2,3],[2.2,dy/2+1.15,3.08])]
   q=p('stair_landing','stairs',bs,art={'kind':'landing','finish':'deck'},color=101)
   names.append(place(f'stair_{cname}_{label}_landing',q,[cx,y,cz],label,cname))
   foot=f'{cname}_{label}';top=f'{cname}_{ulabel}'
   if not any(n['id']==foot for n in D['graph']['nodes']):node(foot,[cx-1.1,y,cz-5.0],label,'stair-lobby')
   if not any(n['id']==top for n in D['graph']['nodes']):node(top,[cx-1.1,y+dy,cz-5.0],ulabel,'stair-lobby')
   anchors=[[cx-1.1,y,cz-5.0],[cx-1.1,y,cz-3.6],[cx-1.1,y+dy/2,cz+.8],[cx-1.1,y+dy/2,cz+1.9],
            [cx+1.1,y+dy/2,cz+1.9],[cx+1.1,y+dy/2,cz+.8],[cx+1.1,y+dy,cz-3.6],[cx+1.1,y+dy,cz-5.0],[cx-1.1,y+dy,cz-5.0]]
   rid=f'stair_{cname}_{label}';route(rid,'stairs',foot,top,anchors)
   D['stairs'].append({'id':rid,'fromDeck':label,'toDeck':ulabel,'instances':names,'route':rid,
                       'opening':{'min':[cx-2.4,y+dy-.24,cz-3.6],'max':[cx+2.4,y+dy,cz+3.4]},'clearHeadroom':2.6})
 # Main cross-deck circulation lies outside both open neighborhoods, then joins aligned fore/aft cores.
 for i,d in enumerate(D['decks'][:15]):
  label=d['id'];y=d['floorY'];a=f'fore_{label}';b=f'aft_{label}'
  if any(n['id']==a for n in D['graph']['nodes']) and any(n['id']==b for n in D['graph']['nodes']):
   aisle=-15.5 if label in('4','5','6','7','8') else 24 if label=='17' else 25 if int(label)>=15 else 15.5
   anchors=[[-1.1,y,-77.0],[aisle,y,-77.0],[aisle,y,59.0],[-1.1,y,59.0]]
   if int(label)>=16:anchors=[[-1.1,y,-77.0],[-1.1,y,-88],[aisle,y,-88],[aisle,y,59.0],[-1.1,y,59.0]]
   route('spine_'+label,'corridor',b,a,anchors,1.8 if label=='17' else 2.4)
 # Exterior arrival, clear of the outer white hull, opens directly to the promenade.
 gp=p('gangway','gangway',[box([-7.4,-.24,-1.4],[7.4,0,1.4]),box([-7.4,0,-1.48],[7.4,1.15,-1.4]),
                         box([-7.4,0,1.4],[7.4,1.15,1.48])],art={'kind':'gangway','finish':'deck'},color=122)
 for i,x in enumerate([35.8,50.6]):place('port_gangway_'+str(i),gp,[x,14,-24],'5','arrival')
 node('quay',[58,14,-24],'5','docking');node('arrival',[20,14,-24],'5','lobby')
 route('board','docking','quay','arrival',[[58,14,-24],[28.9,14,-24],[20,14,-24]],2.8)
 route('arrival_fore','corridor','arrival','fore_5',[[20,14,-24],[0,14,-24],[0,14,-12],[-15.5,14,-12],[-15.5,14,59.0],[-1.1,14,59.0]],2.4)
 route('launch_access','corridor','aft_16','launch_16',[[-1.1,49.6,-77.0],[-1.1,49.6,-88],[20.5,49.6,-88],[20.5,49.6,-133.0],[14.9,49.6,-133.0]],2.0)
 D['rooms'].append({'id':'arrival','node':'arrival','label':'Royal Promenade arrival','deck':'5','section':'arrival',
                   'bounds':{'min':[10,14,-35],'max':[28.9,18.16,-10]},'entry':[28.9,14,-24],
                   'routeTarget':[20,14,-24],'evidence':'original-fit-within-public-plan'})
 D['portals'].append({'id':'boarding','from':'quay','to':'arrival','at':[28.9,14,-24],'normal':[1,0,0],
                     'clearWidth':2.8,'clearHeight':4.16,'kind':'open'})
 # Reusable furnished cabin prototype: open entry and balcony glazing, actual furniture collision.
 walls=[box([-4,0,-3.2],[4,2.96,-3.06]),box([-4,0,3.06],[4,2.96,3.2]),
        box([-4,0,-3.06],[-3.86,2.96,-1]),box([-4,0,1],[-3.86,2.96,3.06]),box([-4,2.64,-1],[-3.86,2.96,1]),
        box([3.86,0,-3.06],[4,.55,3.06]),box([3.86,2.6,-3.06],[4,2.96,3.06]),
        box([3.86,.55,-3.06],[4,2.6,-2.84]),box([3.86,.55,2.84],[4,2.6,3.06])]
 furniture=[{'kind':'bed','at':[2.1,0,1.6],'size':[2.3,.68,2.0]},
            {'kind':'sofa','at':[-.75,0,2.55],'size':[2.1,.86,.85]},
            {'kind':'wardrobe','at':[-3.25,0,2.05],'size':[.9,2.45,1.8]},
            {'kind':'desk','at':[2.9,0,-2.3],'size':[1.2,.78,1.2]},
            {'kind':'bath','at':[-2.65,0,-2.2],'size':[2.1,2.35,1.65]}]
 fbs=[box([f['at'][k]-f['size'][k]/2 if k!=1 else 0 for k in range(3)],
          [f['at'][k]+f['size'][k]/2 if k!=1 else f['size'][k] for k in range(3)]) for f in furniture]
 cabin=p('cabin_balcony','cabin',walls+fbs,art={'kind':'cabin','wallCount':len(walls),'items':furniture},color=232)
 for label in ['7','8','9','10','11','12','14']:
  y=ys[label]
  x=19.25 if label in('3','4') else 23
  for ci,z in enumerate([76,82.4,88.8] if label in('3','4') else [94.4,100.8,107.2]):
   ident=f'cabin_{label}_{ci}';place(ident,cabin,[x,y,z],label,'playable-cabins')
   entry=[x-4,y,z];target=[x-1,y,z-.5];outside=[x-5.4,y,z]
   node(ident,target,label,'room');node(ident+'_entry',outside,label,'corridor')
   route(ident+'_door','room',ident+'_entry',ident,[outside,entry,[x-1,y,z],target],family='balcony-cabin-ingress')
   route(ident+'_access','corridor',f'fore_{label}',ident+'_entry',[[-1.1,y,59.0],[x-5.4,y,59.0],outside],2.4)
   D['rooms'].append({'id':ident,'node':ident,'label':'Balcony stateroom','deck':label,'section':'prototype-cabins',
                     'bounds':{'min':[x-4,y,z-3.2],'max':[x+4,y+2.96,z+3.2]},'entry':entry,'routeTarget':target,'evidence':'original-fitted-room'})
   D['portals'].append({'id':ident+'_portal','from':ident+'_entry','to':ident,'at':entry,'normal':[-1,0,0],
                       'clearWidth':1.8,'clearHeight':2.6,'kind':'open'})
 # Two independent physical cabin leaves share a reciprocal prototype pair, rather than swapping entire rooms.
 closed=p('door_cabin_closed','door',[box([-.03,.02,0],[.03,2.58,2.08])],art={'kind':'door','finish':'oak'},color=101)
 opened=p('door_cabin_open','door',[box([0,.02,-.03],[2.08,2.58,.03])],art={'kind':'door','finish':'oak'},color=101)
 for proto in D['prototypes']:
  if proto['id']==closed:proto['opens']=opened
  if proto['id']==opened:proto['opens']=closed
 for i,z in enumerate([94.4,100.8]):
  door=f'door_cabin_9_{i}';hinge=[19.07,ys['9'],z-1.04];place(door,closed,hinge,'9','prototype-cabins')
  D['doors'].append({'id':door,'instanceId':door,'closedPrototype':closed,'openPrototype':opened,
                     'hinge':hinge,'clearWidth':1.8,'clearHeight':2.6})
  next(r for r in D['routes'] if r['id']==f'cabin_9_{i}_door')['requiresOpen']=door
 # Full accommodation outline uses repeated six-metre balcony/frame bays without filling the window apertures.
 balcony=p('balcony_3_2','balcony',[box([-1.8,-.18,-1.6],[0,0,1.6]),box([-.09,0,-1.6],[0,1.15,1.6]),
                                box([-1.8,0,-1.6],[-.09,2.96,-1.52]),box([-1.8,2.96,-1.6],[0,3.12,1.6])],
           art={'kind':'balcony','finish':'enamel'},color=232)
 for label in ['7','8','9','10','11','12','14']:
  for side in(-1,1):
   for j,z in enumerate(i*3.2 for i in range(-48,35)):
    place(f'balcony_{label}_{side}_{j}',balcony,[side*28.9,ys[label],z],label,section(z),0 if side>0 else 180)
 # Independently measured bridge wing envelope, clear framed front rather than an opaque dark plane.
 for side in(-1,1):
  q,o=world('bridge_wing','bridge',[box([side*24 if side>0 else -32.9,38.56,120],
                                    [32.9 if side>0 else -24,38.8,134])],art={'kind':'floor','finish':'enamel'})
  place('bridge_wing_'+str(side),q,o,'12','bridge')
 # Flattened ellipsoidal AquaDome framing: closed ribs and sparse pane-edge cues, all panes are clear apertures.
 def beam(a,b,r):
  v=[b[k]-a[k] for k in range(3)];length=math.sqrt(sum(x*x for x in v));v=[x/length for x in v]
  u=[v[2],0,-v[0]];l=math.sqrt(sum(x*x for x in u));u=[x/l for x in u] if l>1e-5 else [1,0,0]
  w=[v[1]*u[2]-v[2]*u[1],v[2]*u[0]-v[0]*u[2],v[0]*u[1]-v[1]*u[0]]
  return [[q[k]+r*(su*u[k]+sw*w[k]) for k in range(3)] for q in(a,b) for su,sw in[(-1,-1),(-1,1),(1,-1),(1,1)]]
 from layout_production import dome as production_dome,finish as production_finish
 production_dome(D,p,place,beam)
 # Side-by-side aft funnel housings are a distinctive photographed feature, not two longitudinal stacks.
 funnelh=[{'points':[[x,y,z] for y,rx,rz,shift in[(-11.5,7.2,10.2,0),(8,4.6,7.2,1.5)] for x in(-rx,rx) for z in(-rz+shift,rz+shift)]}]
 funnelboxes=[box([x-.65,7.8,z-.65],[x+.65,12,z+.65]) for x in(-1.4,1.4) for z in(-1.0,2.5)]
 fp=p('funnel','funnel',funnelboxes,funnelh,{'kind':'funnel','finish':'blue'},53)
 for side in(-1,1):place('funnel_'+str(side),fp,[side*11,63,-72],'17','funnel')
 mast=p('signal_mast','mast',[box([-.22,-8.65,-.22],[.22,8.65,.22]),
                             box([-3.2,4.4,-.1],[3.2,4.6,.1]),box([-2.4,6.4,-.1],[2.4,6.6,.1])],
        art={'kind':'mast','finish':'enamel'})
 place('forward_signal_mast',mast,[0,61.85,72],'17','aerial')
 # Pool prototype: real recessed basin and shallow stair-out above an occupied dry room; no map-water semantics.
 basin=[box([-5,-.94,-8],[5,-.74,8]),box([-5.2,-.74,-8.2],[-5,0.18,8.2]),box([5,-.74,-8.2],[5.2,.18,8.2]),
        box([-5,-.74,-8.2],[5,.18,-8]),box([-5,-.74,8],[5,.18,8.2])]
 for j in range(5):basin.append(box([-1,-.74+j*.148,6.5+j*.3],[1,-.592+j*.148,6.8+j*.3]))
 q=p('pool_basin','pool',basin,art={'kind':'pool','waterY':-.18,'finish':'tile','decorativeWater':True},color=87)
 place('prototype_pool',q,[18,ys['15'],-6],'15','pool-prototype')
 for ident,label,title,at,anchors,bounds in [
  ('aquadome','15','AquaDome',[0,45.6,112],[[-1.1,45.6,59.0],[5,45.6,59.0],[5,45.6,90],[0,45.6,112]],([-24,45.6,78],[24,62.6,147])),
  ('pool_under','14','Pool service lounge',[18,42,-6],[[-1.1,42,59.0],[15.5,42,59.0],[15.5,42,-6],[18,42,-6]],([12,42,-18],[27,44.66,6])),
  ('pool_edge','15','Pool terrace',[25,45.6,-6],[[-1.1,45.6,59.0],[25,45.6,59.0],[25,45.6,-6]],([23,45.6,-18],[28.9,48.6,6]))]:
  node(ident,at,label,'room');route(ident+'_access','room',f'fore_{label}',ident,anchors,2.0)
  D['rooms'].append({'id':ident,'node':ident,'label':title,'deck':label,'section':ident,
                     'bounds':{'min':bounds[0],'max':bounds[1]},'entry':at,'routeTarget':at,'evidence':'original-fit-within-public-plan'})
 # Comparison routes and reproducible initial reviews. These are physical floor positions, not hidden teleports.
 for label in ['3','9','14']:
  D['views'].append({'id':'cabin_'+label,'at':[22,ys[label],93.9],'target':[25,ys[label]+1.2,96],
                     'deck':label,'section':'prototype-cabins','mode':'walk'})
 D['views'] += [{'id':'arrival','at':[20,14,-24],'target':[0,16,-24],'deck':'5','section':'arrival','mode':'walk'},
               {'id':'dome_inside','at':[0,45.6,112],'target':[0,59,140],'deck':'15','section':'aquadome','mode':'walk'},
               {'id':'pool_under','at':[18,42,-6],'target':[18,44,-1],'deck':'14','section':'pool-prototype','mode':'walk'},
               {'id':'pool_edge','at':[25,45.6,-6],'target':[18,45.4,-6],'deck':'15','section':'pool-prototype','mode':'walk'},
               {'id':'profile','at':[260,40,0],'target':[0,32,0],'deck':'5','section':'envelope','mode':'spectator'}]
 D['prototypeScope']={'complete':False,'notes':'Full envelope, repeated cabin slice, continuous stair cores, framed dome and decorative basin. Funnels, public-room finishes, lifesaving equipment and final neighborhoods follow native prototype acceptance.'}
 production_finish(D,p,prototype,world,place,box,node,route,rect,ys,beam)
 from layout_edges import finish as finish_edges
 finish_edges(D,p,world,place,box,ys,beam)
