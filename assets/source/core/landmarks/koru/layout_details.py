"""Bounded Koru exterior, original furnishings and stowed rig; executed by author_layout.py.

All route and solid geometry changes are emitted to the shared JSON before Blender consumes it.
"""
D['windows']=[]
# Framed deckhouses. Visual clear apertures are separate from their solid safety-glazing collider.
# Longitudinal facades have dedicated open doors at arrival; end facades have circulation portals.
def facade(name,level,axis,fixed,start,end,portals=[]):
 y=.75+3*level;n=max(1,math.ceil((end-start)/5));span=(end-start)/n
 for i in range(n):
  a=start+i*span;b=start+(i+1)*span
  cuts=sorted(set([a,b]+[v for c,w in portals for v in(c-w/2,c+w/2) if a<v<b]))
  for j,(lo,hi) in enumerate(zip(cuts,cuts[1:])):
   door=any(lo>=c-w/2-.001 and hi<=c+w/2+.001 for c,w in portals)
   def solid(t0,t1,v0,v1):return box([fixed-.09,v0,t0],[fixed+.09,v1,t1]) if axis=='z' else box([t0,v0,fixed-.09],[t1,v1,fixed+.09])
   bs=[solid(lo,hi,y+2.6,y+2.8)] if door else [solid(lo,hi,y,y+2.8)]
   aid=add(f'facade_{name}_{i}_{j}','facade',boxes=bs,meta={'deck':level,'axis':axis,'fixed':fixed,'range':[lo,hi],'floorY':y,'portal':door,'sill':.75,'head':2.35,'windowSpacing':1.55,'finish':'cream_mahogany'},color=232)
   if not door and hi-lo>.65:
    count=max(1,round((hi-lo)/1.55));w=(hi-lo)/count
    for k in range(count):
     t0=lo+k*w+.13;t1=lo+(k+1)*w-.13
     if t1-t0<.28:continue
     center=[fixed,y+1.55,(t0+t1)/2] if axis=='z' else [(t0+t1)/2,y+1.55,fixed]
     D['windows'].append({'module':aid,'center':center,'normal':[1,0,0] if axis=='z' else [0,0,1],'clearWidth':t1-t0,'clearHeight':1.6,'bottomY':y+.75,'topY':y+2.35,'range':[t0,t1],'solidGlazing':True})
for level,x,zlo,zhi in [(1,6.38,-38,19),(2,5.48,-29,19)]:
 for sign in(-1,1):facade(f'{level}_{"port" if sign>0 else "starboard"}',level,'z',sign*x,zlo,zhi,[(-24,2.2)] if level==1 and sign>0 else [])
 facade(f'{level}_aft',level,'x',zlo,-x,x,[(3.2,2.0)] if level==1 else [(-1.6,2.2)])
 facade(f'{level}_fore',level,'x',zhi,-x,x,[(2.5,1.8)])
# Roof endings close the upper bridge and owner cabin without extending the usable sun-deck outline.
for name,z0,z1 in [('bridge',7,19.25),('owner_aft',-29.25,-28)]:
 add('roof_'+name,'roof',boxes=[slab(-5.65,5.65,z0,z1,9.75,.2)],meta={'finish':'cream','roofCap':True},color=232)
# Ends of upper exposed decks have guards; wide portals keep the aft terrace and foredeck transitions continuous.
for name,y,z,x0,x1 in [('sun_aft',9.75,-28,-5.6,5.6),('sun_fore',9.75,7,-5.6,5.6),('upper_aft',6.75,-40,-6,6)]:
 add('rail_'+name,'rail',boxes=[box([x0,y,z-.04],[x1,y+1.1,z+.04])],meta={'openMetalRail':True},color=230)
# Bounded aft sun shade, with slender columns outside all published stair/room paths.
add('sun_canopy','canopy',boxes=[box([x-.05,9.75,z-.05],[x+.05,12.8,z+.05]) for x in(-5.05,5.05) for z in(-27.4,-18.3)]+[slab(-5.35,5.35,-27.7,-18,12.95,.15)],meta={'finish':'cream','columns':True},color=232)

# Fixed furniture groups: collision uses the important solids; ornamental small details share a sparse look proxy.
# Tables and sofas preserve their undercuts in artwork; their sturdy occupied volumes are practical colliders.
def furnish(name,room,items):
 bs=[];art=[]
 for kind,x,y,z,sx,sy,sz in items:
  bs.append(box([x-sx/2,y,z-sz/2],[x+sx/2,y+sy,z+sz/2]));art.append({'kind':kind,'at':[x,y,z],'size':[sx,sy,sz]})
 add('furniture_'+name,'furniture',boxes=bs,meta={'room':room,'items':art},color=101)
 return art
F=.75
furnish('beach_club','beach_club',[('sofa',-4.6,F,-37,1.5,.95,3.0),('cabinet',4.9,F,-38,1.0,1.1,4),('table',-2.8,F,-37,1.0,.56,1.8)])
furnish('gym','gym',[('treadmill',5.2,F,-29,1.15,1.4,1.8),('treadmill',5.2,F,-26,1.15,1.4,1.8),('weights',2.8,F,-30.3,2.0,.9,.55)])
furnish('laundry','laundry',[('laundry',-5.55,F,-17.5,1.0,1.0,4.5),('cabinet',-3.5,F,-20.25,2.2,1.8,.7)])
furnish('machinery','machinery',[('machinery',4.8,F,-21,2.0,1.6,2.2),('machinery',4.8,F,-16.1,2.0,1.6,2.2)])
furnish('crew_mess','crew_mess',[('table',-4.4,F,-8,2.1,.75,3.6),('table',4.5,F,-7.5,1.6,.75,3.4),('bench',-5.8,F,-8,.5,.55,3.6),('bench',-2.9,F,-8,.5,.55,3.6),('bench',5.6,F,-7.5,.45,.55,3.4)])
for i,(z0,z1) in enumerate([(5,11),(11,17)]):
 for sign in(-1,1):
  name=f'crew_{i}_{"port" if sign>0 else "starboard"}'
  furnish(name,name,[('bunk',sign*5.25,F,z0+2.0,1.35,1.9,2.1),('desk',sign*4.1,F,z1-.6,2.8,.78,.8),('wardrobe',sign*5.3,F,z1-2,1.1,2.35,.9)])
furnish('cold_store','cold_store',[('cold_store',4.9,F,27,1.3,2.25,4.8)])
furnish('workshop','fore_workshop',[('workbench',-3,F,37.5,1.4,.9,2.4),('tools',3,F,38.2,1.2,1.8,.5)])
F=3.75
furnish('main_salon','main_salon',[('sofa',-5.25,F,-34,1.4,.92,4.8),('sofa',5.25,F,-34,1.4,.92,4.8),('table',-3.6,F,-34,1.1,.48,2.1),('cabinet',-3.5,F,-37.4,3.5,.8,.7)])
furnish('arrival','arrival',[('console',5.1,F,-21.6,2.2,.9,.6),('planter',5.25,F,-26.8,.7,1.3,.7)])
furnish('dining','dining',[('dining',-3.7,F,-16.5,1.5,.78,5.0),('dining',3.7,F,-16.5,1.5,.78,5.0),('chairs',-5.1,F,-16.5,.6,.95,4.5),('chairs',-2.3,F,-16.5,.6,.95,4.5),('chairs',5.1,F,-16.5,.6,.95,4.5),('chairs',2.3,F,-16.5,.6,.95,4.5)])
furnish('galley','galley',[('galley',-5.3,F,-8,1.2,1.05,6.2),('cold_store',-3.4,F,-11.2,2.4,2.25,.9)])
furnish('bar','bar_lounge',[('bar',5.35,F,-8,.9,1.1,5.4),('stools',4.35,F,-8,.5,.85,4.2)])
furnish('library','library',[('books',-5.4,F,10,.6,2.4,8.6),('armchair',-3.5,F,7.2,1.0,.98,1.0),('armchair',-3.5,F,12.8,1.0,.98,1.0),('table',-3.5,F,13.9,.65,.55,.6)])
furnish('music','music',[('piano',4.7,F,12.9,1.5,1.15,1.8),('bench',3.45,F,12.9,.6,.5,1.1),('sofa',4.4,F,6.2,2.3,.95,1.0)])
for sign in(-1,1):
 name='vip_'+('port' if sign>0 else 'starboard')
 furnish(name,name,[('bed',sign*3.6,F,27.7,2.2,.75,2.1),('nightstand',sign*5.05,F,28.2,.55,.65,.65),('wardrobe',sign*5.15,F,24.8,.7,2.4,1.8)])
F=6.75
furnish('aft_terrace','aft_terrace',[('lounger',4.8,F,-35.5,1.0,.55,2.3),('lounger',2.9,F,-37.4,1.0,.55,2.3),('tub',-4.3,F,-35,2.5,.95,2.7)])
furnish('owner','owner_suite',[('bed',3.6,F,-23.5,2.6,.8,2.6),('nightstand',4.7,F,-25.35,.65,.6,.55),('wardrobe',4.7,F,-19.0,.7,2.4,3.0),('sofa',-3.8,F,-18.2,2.2,.95,1.0)])
furnish('owner_bath','owner_bath',[('bath',-4.1,F,-14.8,1.7,.7,1.2),('vanity',-4.1,F,-10.65,1.9,.9,.7)])
furnish('upper_lounge','upper_lounge',[('sofa',4.35,F,-13,1.1,.95,4.3),('table',2.4,F,-14.7,.7,.5,1.0)])
furnish('bridge','bridge',[('helm',-3.4,F,16.1,3.5,1.45,1.2),('helm',3.4,F,16.1,3.5,1.45,1.2),('chart',-4.2,F,9.1,1.8,1.0,2.5),('helm_chair',-3.4,F,14.0,.85,1.6,.85),('helm_chair',3.4,F,14.0,.85,1.6,.85)])
F=9.75
furnish('sun_bar','sun_bar',[('bar',-4.6,F,-19.5,.8,1.1,2.0),('sofa',-2.3,F,-18.8,2.0,.95,1.0)])
furnish('sun_bathing','sun_bathing',[('tub',-3.7,F,-14.2,2.7,.95,2.7),('tub',4.5,F,-17.3,1.8,.95,2.6),('lounger',-4.2,F,-10.8,1.0,.55,2.3)])
furnish('sun_observation','sun_navigation',[('lounger',4.5,F,3.9,1.0,.55,2.0),('lounger',-4.5,F,3.9,1.0,.55,2.0),('compass',-1.3,F,5.8,.35,1.1,.35)])

# Original understated deck/room signs are geometry on real walls; no developer identifiers are shown in-world.
D['signs']=[]
for r in D['rooms']:
 if not r['enclosed']:continue
 p=r['entry'];side=r['entrySide'][0];axis='x' if side in(0,2) else 'z'
 # Sign is on the wall beside its doorway, never across the 2.6m clear lintel.
 at=[p[0]+.95 if axis=='x' else p[0],p[1]+1.65,p[2]+.95 if axis=='z' else p[2]]
 D['signs'].append({'room':r['id'],'label':r['label'],'at':at,'axis':axis})

# Standing rigging is split into <=24m segments so every visual and collider remains inside the native +/-16m bound.
# Rope colliders are thin physical fittings, never an opaque room-covering proxy.
def stay(name,a,b,r=.025):
 length=math.dist(a,b);n=max(1,math.ceil(length/24))
 for k in range(n):
  aa=[a[j]+(b[j]-a[j])*k/n for j in range(3)];bb=[a[j]+(b[j]-a[j])*(k+1)/n for j in range(3)]
  v=[bb[j]-aa[j] for j in range(3)];length=math.sqrt(sum(x*x for x in v));d=[x/length for x in v]
  up=[0,1,0] if abs(d[1])<.9 else [1,0,0]
  u=[d[1]*up[2]-d[2]*up[1],d[2]*up[0]-d[0]*up[2],d[0]*up[1]-d[1]*up[0]];l=math.sqrt(sum(x*x for x in u));u=[x/l for x in u]
  w=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]]
  ps=[[p[j]+r*(sx*u[j]+sy*w[j]) for j in range(3)] for p in(aa,bb) for sx in(-1,1) for sy in(-1,1)]
  add(f'rig_{name}_{k}','rigging',hulls=[ps],meta={'ends':[aa,bb],'radius':r,'finish':'steel'},color=230)
for mast in masts:
 z=mast['z'];tip=mast['tipY'];deck=6.75 if z>=19 else 3.75
 anchor=7 if z>=19 else 7.7 if z>-20 else 7.6
 for sign in(-1,1):
  for dz in(-3,3):stay(f'{mast["id"]}_shroud_{sign}_{dz}',[sign*anchor,deck,z+dz],[0,tip-2,z],.025)
 for frac,halfspan in[(.31,3.8),(.55,2.7),(.77,1.8)]:
  y=14+(tip-14)*frac
  add(f'spreader_{mast["id"]}_{int(frac*100)}','spreader',boxes=[box([-halfspan,y-.08,z-.12],[halfspan,y+.08,z+.12])],meta={'ends':[[-halfspan,y,z],[halfspan,y,z]],'radius':.08},color=232)
  for sign in(-1,1):stay(f'{mast["id"]}_diamond_{int(frac*100)}_{sign}',[sign*halfspan,y,z],[0,min(tip,y+17),z],.018)
stay('forestay_outer',[0,8.5,70.5],[0,69,20],.042)
stay('forestay_inner',[0,7.8,52],[0,58,20],.038)
stay('main_interstay',[0,68.8,20],[0,65.8,-8],.024)
stay('mizzen_interstay',[0,65.8,-8],[0,62.8,-30],.024)
stay('mizzen_backstay',[0,62.8,-30],[0,4.8,-51.5],.028)
# Running lines tie booms back to their actual mast/working deck rather than floating disconnected.
for mast in masts:
 stay('topping_'+mast['id'],[0,mast['boomY'],mast['z']-mast['boomAft']],[0,mast['tipY']-3,mast['z']],.022)
# Sparse bow ornament and transom flag attach to physical fittings; they do not change published hull/bowsprit extent.
add('bow_scroll','ornament',boxes=[box([-.12,6.7,52.8],[.12,7.2,53.4])],look=[box([-1.8,6.7,49.4],[1.8,7.45,53.8])],meta={'kind':'gilded_scroll'},color=51)
add('stern_flag','flag',boxes=[box([-.025,3.7,-51.5],[.025,6.0,-51.45])],look=[box([0,4.6,-53.1],[.85,5.9,-51.4])],meta={'kind':'maritime_ensign'},color=232)

D['routes'].append({'id':'aft_pool_access','kind':'circulation','deck':1,'anchors':[[2.5,3.75,-34],[3.2,3.75,-36],[3.2,3.75,-38],[3.2,3.75,-40],[3.2,3.75,-46]]})
