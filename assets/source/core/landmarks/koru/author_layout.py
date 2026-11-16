import json,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[4]
OUT=ROOT/'content/landmarks/koru-layout.json'
D={'schema':1,'id':'core:koru','frame':{'units':'metres','up':'+Y','forward':'+Z','port':'+X','waterline':0,'yawUnits':'degrees'},
 'evidence':{'published':{'lengthOverall':125,'beam':17.2,'source':'https://www.oceancoyacht.com/fleet/koru/'},'discrepancy':'Lateral title says125m; text says127m/16m. Builder baseline is used.','inferred':['hull stations','draft','mast stations and heights','deck datums','bowsprit proportion'],'original':['all room identities and positions','circulation and stairs','dock access','furniture layout']},
 'dimensions':{'hullMinZ':-54.5,'hullMaxZ':54.5,'bowspritTip':[0,8.5,70.5],'beam':17.2,'lowestKeel':-6.2,'highestMast':70},
 'clearances':{'floorSpacing':3,'floorThickness':.2,'doorWidth':1.6,'doorHeight':2.6,'corridorWidth':1.8,'stairWidth':1.6,'ceilingClear':2.8,'railHeight':1.1},
 'decks':[],'hullStations':[],'rooms':[],'modules':[],'stairs':[],'doors':[],'routes':[],'docking':{},'rig':{},'artBudget':{'levels':6,'totalFineTrianglesTarget':260000,'totalFineTrianglesMaximum':360000,'sharedTextureMegabytesMaximum':96,'materialsPerPieceMaximum':3,'nearFlatLevel':1,'defaultSails':'furled','notes':'Shared tiled marine finishes and bounded room furnishing; no portal culling is assumed.'}}
mods=D['modules']
def clean(v):
 if isinstance(v,float):return round(v,6)
 if isinstance(v,list):return [clean(x) for x in v]
 if isinstance(v,dict):return {k:clean(x) for k,x in v.items()}
 return v

def box(lo,hi):return {'at':[(a+b)/2 for a,b in zip(lo,hi)],'half':[(b-a)/2 for a,b in zip(lo,hi)]}
def corners(b):return [[b['at'][k]+s[k]*b['half'][k] for k in range(3)] for s in [(x,y,z) for x in(-1,1) for y in(-1,1) for z in(-1,1)]]
def add(name,category,boxes=[],hulls=[],origin=None,meta={},color=103,placed=True,opens=None,visual=None,look=[]):
 ps=[p for b in boxes for p in corners(b)]+[p for h in hulls for p in h]
 if visual:ps+=visual
 ps+=[p for b in look for p in corners(b)]
 lo=[min(p[k] for p in ps) for k in range(3)];hi=[max(p[k] for p in ps) for k in range(3)]
 o=origin or [(lo[k]+hi[k])/2 for k in range(3)]
 m={'id':'core:koru_'+name,'mesh':'core:koru_'+name,'category':category,'origin':o,'yaw':0,'color':color,'placed':placed,
    'boxes':[{'at':[b['at'][k]-o[k] for k in range(3)],'half':b['half']} for b in boxes],
    'hulls':[{'points':[[p[k]-o[k] for k in range(3)] for p in h]} for h in hulls],
    'visualBounds':{'min':[lo[k]-o[k] for k in range(3)],'max':[hi[k]-o[k] for k in range(3)]},'art':meta}
 if look:m['look']={'boxes':[{'at':[b['at'][k]-o[k] for k in range(3)],'half':b['half']} for b in look]}
 if opens:m['opens']='core:koru_'+opens
 assert len(boxes)+len(hulls)<=16,name
 assert max(abs(x) for v in m['visualBounds'].values() for x in v)<=16.000001,(name,m['visualBounds'])
 mods.append(clean(m));return m['id']
def slab(x0,x1,z0,z1,y,thick=.2):return box([x0,y-thick,z0],[x1,y,z1])
def ramp_points(x0,x1,z0,z1,y0,y1,thick=.2):
 return [[x,y,z] for z,y in [(z0,y0),(z1,y1)] for x in (x0,x1) for y in (y-thick,y)]
def width(profile,z):
 for (za,wa),(zb,wb) in zip(profile,profile[1:]):
  if za-1e-8<=z<=zb+1e-8:return wa+(wb-wa)*(z-za)/(zb-za)
 raise ValueError(z)
# A raised bow and canoe stern, inferred from the six official photographs. Neither is a flat barge end.
st=[(-54.5,.08,-.2,3.75),(-49,5.7,-2.8,3.75),(-42,7.4,-4.6,3.85),(-32,8.2,-5.6,4.05),(-20,8.6,-6.2,4.35),(-8,8.6,-6.2,4.70),(6,8.3,-6.0,5.4),(20,7.6,-5.6,6.75),(34,6.2,-4.4,7.0),(44,4.2,-3.0,7.35),(51,2.0,-1.2,7.6),(54.5,.06,.15,7.8)]
D['hullStations']=[{'z':z,'halfBeam':w,'keel':k,'sheer':s,'waterHalfBeam':w*.90} for z,w,k,s in st]
def station(z):
 for a,b in zip(st,st[1:]):
  if a[0]<=z<=b[0]:
   t=(z-a[0])/(b[0]-a[0]);return [z]+[a[k]+(b[k]-a[k])*t for k in range(1,4)]
 raise ValueError(z)
zs=sorted(set([p[0] for p in st]+[-25.2,-22.8]))
for i,(za,zb) in enumerate(zip(zs,zs[1:])):
 a,b=station(za),station(zb);hs=[]
 # Below water remains solid; every walkable floor is above this closed underwater volume.
 lower=[]
 for z,w,k,s in (a,b):lower.extend([[0,k,z],[-w*.62,min(0,k*.45),z],[w*.62,min(0,k*.45),z],[-w*.9,0,z],[w*.9,0,z]])
 hs.append(lower)
 for sign in (-1,1):
  side=[]
  for z,w,k,s in(a,b):
   top=min(s,3.75) if sign==1 and za>=-25.2 and zb<=-22.8 else s
   outer=w*.9+(w-w*.9)*top/max(s,.01);inner=max(.015,outer-.24);bottom=max(.01,w*.9-.24)
   side.extend([[sign*w*.9,0,z],[sign*outer,top,z],[sign*inner,top,z],[sign*bottom,0,z]])
  hs.append(side)
 add(f'hull_{i:02}','hull',hulls=hs,meta={'stations':[a,b],'gatePort':za>=-25.2 and zb<=-22.8},color=83)
# The room-circulation core is offset only at stairwells/mast trunks; open lobbies provide generous bypasses.
cores=[('grand',0,0,0,3),('aft',-3.6,-24,0,3),('forward',-2.4,33.2,0,2)]
holes={i:[] for i in range(4)}
for name,cx,cz,low,high in cores:
 for upper in range(low+1,high+1):holes[upper].append({'id':f'{name}_{upper}','x0':cx-2.1,'x1':cx+2.1,'z0':cz-2.3,'z1':cz+2.8,'kind':'stair'})
# Pool sits beyond the aft inhabited lower deck. Its own shallow basin has a real stair exit.
holes[1].append({'id':'pool','x0':-2,'x1':2,'z0':-50,'z1':-43,'kind':'pool'})
profiles=[ [(-46,4.8),(-38,6.5),(26,6.5),(40,4.4)], [(-53.5,.8),(-49,5.3),(-42,7.1),(-32,7.9),(-20,8.25),(6,7.95),(20,7.2),(40,4.7)], [(-40,6.0),(-30,7.2),(19,7.2),(20,7.3),(34,5.9),(44,3.9),(53.5,.6)], [(-28,5.6),(7,5.6)] ]
for level,(lo,hi) in enumerate([(-46,40),(-53.5,40)]):
 cuts=sorted(set([lo,hi]+[a[0] for a in st if lo<a[0]<hi]))
 y=.75+3*level
 profiles[level]=[[z,(lambda a: a[1]*(.9+.1*min(y,a[3])/a[3])-.25)(station(z))] for z in cuts]
for level,profile in enumerate(profiles):
 y=.75+3*level
 deck={'id':['lower','main','upper','sun'][level],'index':level,'floorY':y,'ceilingY':y+2.8 if level<3 else None,'outline':[[z,w] for z,w in profile],'holes':holes[level]}
 D['decks'].append(deck)
 cuts=sorted(set([p[0] for p in profile]+[profile[0][0]+i*8 for i in range(1,math.ceil((profile[-1][0]-profile[0][0])/8))]+[h[k] for h in holes[level] for k in('z0','z1') if profile[0][0]<h[k]<profile[-1][0]]))
 for i,(za,zb) in enumerate(zip(cuts,cuts[1:])):
  active=[h for h in holes[level] if h['z0']<zb-1e-6 and h['z1']>za+1e-6]
  xa=width(profile,za);xb=width(profile,zb);edges=sorted(set([-max(xa,xb),max(xa,xb)]+[h[k] for h in active for k in('x0','x1')]))
  hs=[]
  for l,r in zip(edges,edges[1:]):
   if any(h['x0']<(l+r)/2<h['x1'] for h in active):continue
   vals=[max(l,-xa),min(r,xa),max(l,-xb),min(r,xb)]
   if vals[1]<=vals[0] or vals[3]<=vals[2]:continue
   # Raised foredeck has a gentle final sheer ramp; the usable lower/main decks remain inside the hull.
   ya=y+max(0,za-40)*.065 if level==2 else y;yb=y+max(0,zb-40)*.065 if level==2 else y
   hs.append([[x,yy,z] for z,yy,lo,hi in [(za,ya,vals[0],vals[1]),(zb,yb,vals[2],vals[3])] for x in (lo,hi) for yy in (yy-.2,yy)])
  if hs:add(f'{deck["id"]}_floor_{i:02}','floor',hulls=hs,meta={'deck':level,'woodDirection':'+Z'},color=101)
# Paired dogleg flights: low entry at -Z, a wide turning landing at +Z, upper exit back at -Z.
for name,cx,cz,low,high in cores:
 for d in range(low,high):
  y=.75+3*d;prefix=f'stair_{name}_{d}';flight=[]
  for n,(x0,x1,z0,z1,y0,y1) in enumerate([(cx-1.8,cx-.2,cz-2.3,cz+.7,y,y+1.5),(cx+.2,cx+1.8,cz-2.3,cz+.7,y+3,y+1.5)]):
   hs=[ramp_points(x0,x1,z0,z1,y0,y1,.3)]
   for x in (x0-.08,x1):hs.append(ramp_points(x,x+.08,z0,z1,y0+1.1,y1+1.1,1.1))
   ident=add(prefix+f'_flight{n}','stairs',hulls=hs,meta={'steps':10,'clearWidth':1.6,'treadRun':.3,'riser':.15,'flight':[[x0,y0,z0],[x1,y1,z1]],'slab':.3},color=101)
   flight.append(ident)
  lid=add(prefix+'_landing','stairs',boxes=[slab(cx-2,cx+2,cz+.7,cz+2.7,y+1.5),box([cx-2.08,y+1.5,cz+.7],[cx-2,y+2.6,cz+2.78]),box([cx+2,y+1.5,cz+.7],[cx+2.08,y+2.6,cz+2.78]),box([cx-2,y+1.5,cz+2.7],[cx+2,y+2.6,cz+2.78])],meta={'landing':True,'clearDepth':2.0,'clearWidth':4.0},color=101)
  route=[[cx-1,y,cz-3.1],[cx-1,y,cz-2.3],[cx-1,y+1.5,cz+.7],[cx-1,y+1.5,cz+1.5],[cx+1,y+1.5,cz+1.5],[cx+1,y+1.5,cz+.7],[cx+1,y+3,cz-2.3],[cx+1,y+3,cz-3.1]]
  D['stairs'].append({'id':prefix,'fromDeck':d,'toDeck':d+1,'modules':flight+[lid],'opening':holes[d+1][[h['id'] for h in holes[d+1]].index(f'{name}_{d+1}')],'route':route,'clearHeadroom':2.7})
  D['routes'].append({'id':prefix,'kind':'stairs','anchors':route})
# Bathing feature: permanent shallow basin, with stairs at the forward lip.
add('pool_basin','pool',boxes=[slab(-2,2,-50,-43,2.65,.2),box([-2.18,2.65,-50.18],[-2,3.85,-42.82]),box([2,2.65,-50.18],[2.18,3.85,-42.82]),box([-2,2.65,-50.18],[2,3.85,-50])],meta={'waterY':3.58,'decorativeWater':True,'floorY':2.65},color=87)
for i in range(5):add(f'pool_step_{i}','stairs',boxes=[slab(-.8,.8,-43.3-i*.3,-43-i*.3,3.75-i*.22,.22)],meta={'poolExit':True},color=101)
# Rooms are explicitly an original interpretation; enclosed rooms use real jamb gaps.
def wall(name,x0,z0,x1,z1,y,h=2.8,gap=None):
 thick=.16;along='x' if abs(x1-x0)>abs(z1-z0) else 'z';lo=min(x0,x1) if along=='x' else min(z0,z1);hi=max(x0,x1) if along=='x' else max(z0,z1);bs=[]
 def bit(a,b,ya,yb):
  if b-a<=1e-6:return
  bs.append(box([a,ya,z0-thick/2],[b,yb,z0+thick/2]) if along=='x' else box([x0-thick/2,ya,a],[x0+thick/2,yb,b]))
 if gap:
  c,w=gap;bit(lo,c-w/2,y,y+h);bit(c+w/2,hi,y,y+h);bit(c-w/2,c+w/2,y+2.6,y+h)
 else:bit(lo,hi,y,y+h)
 return add(name,'wall',boxes=bs,meta={'opening':gap,'clearHeight':2.6 if gap else None,'finish':'warm_wood'},color=101)
def room(name,label,level,bounds,entry,enclosed=False,door=None):
 x0,z0,x1,z1=bounds;y=.75+level*3
 r={'id':name,'label':label,'deck':level,'bounds':{'min':[x0,y,z0],'max':[x1,y+2.8,z1]},'entrySide':entry,'routeTarget':[(x0+x1)/2,y,(z0+z1)/2],'enclosed':enclosed,'interpretation':'original'}
 if door:r['door']=door
 D['rooms'].append(r)
 if enclosed:
  # Entry is (side,centre): side0 aft,1 port,+X;2 forward;3 starboard,-X.
  side,c=entry;walls=[(x0,z0,x1,z0),(x1,z0,x1,z1),(x0,z1,x1,z1),(x0,z0,x0,z1)]
  r['walls']=[wall(f'room_{name}_wall{k}',*ends,y,gap=(c,1.6) if k==side else None) for k,ends in enumerate(walls)]
  p=[c,y,z0] if side==0 else [x1,y,c] if side==1 else [c,y,z1] if side==2 else [x0,y,c]
  r['entry']=p
  out=[p[0]+(1 if side==1 else -1 if side==3 else 0),y,p[2]+(1 if side==2 else -1 if side==0 else 0)]
  inside=[p[0]-(1 if side==1 else -1 if side==3 else 0),y,p[2]-(1 if side==2 else -1 if side==0 else 0)]
  route={'id':'room_'+name,'kind':'room','deck':level,'anchors':[out,p,inside,r['routeTarget']]}
  if door:route['requiresOpen']=door
  D['routes'].append(route)
 return r
room('beach_club','Beach club',0,[-5.8,-42,5.8,-32],[0,0])
room('gym','Wellness and gym',0,[1.2,-31,6.2,-24],[3,-27.5],True)
room('laundry','Laundry and linen',0,[-6.2,-20.8,-1.2,-14],[1,-17.5],True)
room('machinery','Machinery gallery',0,[1.2,-23,6.2,-14],[3,-18.5],True)
room('crew_mess','Crew mess',0,[-6.2,-13,6.2,4],[0,0])
for i,(z0,z1) in enumerate([(5,11),(11,17)]):
 for side in(-1,1):room(f'crew_{i}_{"port" if side>0 else "starboard"}','Crew cabin',0,[1.2 if side>0 else -6.2,z0,6.2 if side>0 else -1.2,z1],[3 if side>0 else 1,(z0+z1)/2],True)
room('crew_forelobby','Forward service lobby',0,[-6,17,6,24],[0,0])
room('cold_store','Cold stores',0,[1.6,24,5.7,30],[3,27],True)
room('fore_workshop','Forepeak workshop',0,[-4.2,35,4.2,39],[0,0])
room('aft_pool_deck','Aft pool deck',1,[-5.3,-52,5.3,-40],[0,0])
room('main_salon','Main salon',1,[-6.1,-39,6.1,-28],[0,0])
room('arrival','Arrival lobby',1,[-6.1,-28,7.8,-21],[0,0])
room('dining','Dining salon',1,[-6.1,-21,6.1,-12],[0,0])
room('galley','Galley and pantry',1,[-6,-12,-1.2,-4],[1,-6],True)
room('bar_lounge','Bar and main-mast lounge',1,[1.2,-12,6,-4],[0,0])
room('grand_atrium','Grand stair atrium',1,[-5.8,-4,5.8,5],[0,0])
room('library','Library',1,[-5.8,5,-1.2,15],[1,10],True)
room('music','Music and games salon',1,[1.2,5,5.8,15],[3,10],True)
room('fore_foyer','Foremast foyer',1,[-5.8,15,5.8,23],[0,0])
room('vip_port','Port guest suite',1,[1.2,23,5.8,29],[0,3.5],True,'core:koru_door_vip_port')
room('vip_starboard','Starboard guest suite',1,[-5.8,23,-1.2,29],[0,-3.5],True,'core:koru_door_vip_starboard')
room('forward_service','Forward service stair lobby',1,[-4.5,29,4.5,38],[0,0])
room('aft_terrace','Upper aft terrace',2,[-5.9,-40,5.9,-29],[0,0])
room('owner_suite','Owner suite',2,[-5.2,-29,5.2,-16],[2,0],False,'core:koru_door_owner')
# Owner suite has an open service-stair side; one forward privacy bulkhead can be used independently.
wall('owner_privacy',-5.2,-16,5.2,-16,6.75,gap=(0,1.6))
room('owner_bath','Owner bath and wardrobe',2,[-5.2,-16,-1.2,-10],[1,-13],True)
room('upper_lounge','Upper lounge',2,[1.2,-16,5.2,-10],[0,0])
room('upper_atrium','Upper grand atrium',2,[-5.2,-10,5.2,7],[0,0])
room('bridge','Bridge and chart room',2,[-5.2,7,5.2,18],[0,0])
room('foredeck','Raised forward working deck',2,[-6,19,6,40],[0,0])
room('sun_bar','Canopied sun lounge and bar',3,[-5.2,-27,5.2,-18],[0,0])
room('sun_bathing','Sun terrace',3,[-5.2,-18,5.2,-10],[0,0])
room('sun_navigation','Upper observation terrace',3,[-5.2,-10,5.2,7],[0,0])
# Three optional independent leaves: their hinge origins remain identical between reciprocal states.
for name,cx,z,y,sign in [('vip_port',3.5,23,3.75,1),('vip_starboard',-3.5,23,3.75,1),('owner',0,-16,6.75,-1)]:
 hinge=[cx-.8,y,z];closed=box([cx-.8,y+.02,z-.03],[cx+.8,y+2.58,z+.03]);opened=box([cx-.83,y+.02,min(z,z+sign*1.6)],[cx-.77,y+2.58,max(z,z+sign*1.6)])
 add('door_'+name,'door',boxes=[closed],origin=hinge,opens='door_'+name+'_open',meta={'hinge':hinge,'state':'closed'},color=101)
 add('door_'+name+'_open','door',boxes=[opened],origin=hinge,opens='door_'+name,placed=False,meta={'hinge':hinge,'state':'open'},color=101)
 D['doors'].append({'id':'core:koru_door_'+name,'open':'core:koru_door_'+name+'_open','hinge':hinge,'clearWidth':1.6,'clearHeight':2.6,'angle':sign*90})
# Hull gate, landing, and mooring gangway: dock matches the outer anchor, while the inboard end overlaps the deck.
add('gangway','gangway',boxes=[slab(7.8,20.4,-25,-23,3.75),box([7.8,3.75,-25.08],[20.4,4.85,-25]),box([7.8,3.75,-23],[20.4,4.85,-22.92])],meta={'clearWidth':2,'surface':'teak'},color=101)
D['docking']={'shipLanding':[8.4,3.75,-24],'shoreLanding':[20.4,3.75,-24],'arrival':[0,3.75,-24],'clearWidth':2,'shoreApproach':[23,3.75,-24],'pierConnection':{'xMinimum':20.4,'zMinimum':-25.2,'zMaximum':-22.8},'hullGate':{'side':'port','zMin':-25.2,'zMax':-22.8,'sillY':3.75}}
D['routes'].append({'id':'shore_to_arrival','kind':'boarding','anchors':[[20.3,3.75,-24],[14,3.75,-24],[8.4,3.75,-24],[6,3.75,-24],[0,3.75,-24]]})
# Rig trunks stay out of the circulation through explicit lobby bypasses, and are split below the 32m piece bound.
masts=[{'id':'fore','z':20,'tipY':70,'baseY':.75,'boomY':12.8,'boomAft':20},{'id':'main','z':-8,'tipY':67,'baseY':.75,'boomY':12.8,'boomAft':22},{'id':'mizzen','z':-30,'tipY':64,'baseY':.75,'boomY':10.8,'boomAft':18}]
D['rig']={'masts':masts,'sails':'furled','standingRigging':'authored segments following these stations; no sailing simulation','bowsprit':{'heel':[0,7.7,50],'tip':[0,8.5,70.5]}}
for mast in masts:
 cuts=[.75,15.75,39.75,mast['tipY']]
 for i,(ya,yb) in enumerate(zip(cuts,cuts[1:])):
  r=.52 if i==0 else .40 if i==1 else .27
  add(f'mast_{mast["id"]}_{i}','mast',boxes=[box([-r,ya,mast['z']-r],[r,yb,mast['z']+r])],meta={'mast':mast['id'],'radius':r,'ends':[[0,ya,mast['z']],[0,yb,mast['z']]],'finish':'white_spar'},color=232)
 add('boom_'+mast['id'],'boom',boxes=[box([-.38,mast['boomY']-.38,mast['z']-mast['boomAft']],[.38,mast['boomY']+.38,mast['z']])],meta={'mast':mast['id'],'furledSail':True},color=232)
add('bowsprit','bowsprit',hulls=[[[x,y,z] for z,y in [(50,7.7),(70.5,8.5)] for x in(-.25,.25) for y in(y-.25,y+.25)]],meta=D['rig']['bowsprit'],color=232)
# Baseline ordered promenade/atrium routes; door-suite branches are separate above.
for d in range(3):
 y=.75+3*d
 path=([[2.5,y,-34],[2.5,y,-24],[0,y,-24],[0,y,-12],[2.5,y,-10],[2.5,y,-5],[3,y,-3.2],[3,y,4],[0,y,4],[0,y,16],[2.5,y,18],[2.5,y,22],[0,y,22]] if d<2 else [[2.5,y,-34],[2.5,y,-30],[-1,y,-30],[-1,y,-28.1]])
 if d==0:path=[[2.5,y,-34],[-1.6,y,-32],[-1.6,y,-28.5],[0,y,-28.5],[0,y,-24]]+path[3:]
 if d==2:path=[[2.5,y,-34],[2.5,y,-31.6],[-1.6,y,-31.6],[-1.6,y,-28.1]]
 D['routes'].append({'id':['lower_spine','main_spine','upper_aft'][d],'kind':'circulation','deck':d,'anchors':path})
D['routes'].append({'id':'upper_bridge_foredeck','kind':'circulation','deck':2,'anchors':[[3,6.75,-4],[3,6.75,4],[0,6.75,5],[0,6.75,16],[2.5,6.75,18],[2.5,6.75,23],[1.4,6.75,24],[1.4,6.75,37],[0,6.75,38],[1.2,7.27,48]]})
D['routes'].append({'id':'sun_spine','kind':'circulation','deck':3,'anchors':[[3,9.75,-24],[3,9.75,-12],[2.5,9.75,-10],[2.5,9.75,-5],[3,9.75,-3.2],[3,9.75,4],[0,9.75,6]]})
# Clearly walkable links to every stair foot/exit, keeping the full openings outside the route.
for name,cx,cz,lo,hi in cores:
 for d in range(lo,hi+1):
  y=.75+3*d
  start=[0,y,-24] if name=='aft' else [3,y,-3.2] if name=='grand' else [0,y,22]
  before=[0,y,cz-3.1] if name!='grand' else [3,y,cz-3.1]
  D['routes'].append({'id':f'connector_{name}_{d}','kind':'connector','deck':d,'anchors':[start,before,[cx-1,y,cz-3.1],[cx+1,y,cz-3.1]],'stairCore':name})
# Open-room targets avoid mast trunks, stair voids and the swimming pool.
for r in D['rooms']:
 if r['enclosed']:continue
 p=r['routeTarget'];d=r['deck']
 if any(h['x0']-.6<p[0]<h['x1']+.6 and h['z0']-.6<p[2]<h['z1']+.6 for h in holes[d]):p[0]=3.2
 if any(abs(p[2]-m['z'])<1.5 and abs(p[0])<1.5 for m in masts):p[0]=2.5
 if r['id']=='aft_terrace':p[0]=3.2
 r['entry']=p
 D['routes'].append({'id':'room_'+r['id'],'kind':'room','deck':d,'anchors':[p]})
D['routes'].append({'id':'owner_privacy','kind':'door','deck':2,'requiresOpen':'core:koru_door_owner','anchors':[[0,6.75,-14.8],[0,6.75,-16],[0,6.75,-17.2]]})
# Continuous collision guards on weather-deck edges; visible artwork will be slender posts/rails.
for d in (1,2,3):
 profile=profiles[d];y=.75+3*d
 cuts=sorted(set([p[0] for p in profile]+[-25.2,-22.8] if d==1 else [p[0] for p in profile]))
 for j,(za,zb) in enumerate(zip(cuts,cuts[1:])):
  # Split long straight runs to keep local extents below16m.
  n=max(1,math.ceil((zb-za)/12))
  for part in range(n):
   a=za+(zb-za)*part/n;b=za+(zb-za)*(part+1)/n
   for sign in(-1,1):
    if d==1 and sign==1 and a>=-25.2 and b<=-22.8:continue
    ps=[]
    for z in(a,b):
     w=width(profile,z);floor=y+max(0,z-40)*.065 if d==2 else y
     for x in(sign*w,sign*(w+.08)):
      for yy in(floor,floor+1.1):ps.append([x,yy,z])
    add(f'rail_{d}_{j}_{part}_{"p" if sign>0 else "s"}','rail',hulls=[ps],meta={'deck':d,'openMetalRail':True},color=230)
# Guard the full stair opening on its three closed edges; the -Z face is the clear entry/exit.
for d in(1,2,3):
 y=.75+d*3
 for h in holes[d]:
  if h['kind']!='stair':continue
  edge=min(width(profiles[d],h['z0']),width(profiles[d],h['z1']));bs=[]
  if h['x0']>-edge+.02:bs.append(box([h['x0']-.08,y,h['z0']],[h['x0'],y+1.1,h['z1']]))
  if h['x1']<edge-.02:bs.append(box([h['x1'],y,h['z0']],[h['x1']+.08,y+1.1,h['z1']]))
  bs.append(box([max(-edge,h['x0']),y,h['z1']],[min(edge,h['x1']),y+1.1,h['z1']+.08]))
  add('well_guard_'+h['id'],'rail',boxes=bs,meta={'deck':d,'stairOpening':h['id'],'openMetalRail':True},color=230)

# Additional exterior/furnishing modules are authored in a separate readable source fragment.
exec(compile((HERE/'layout_details.py').read_text(), str(HERE/'layout_details.py'), 'exec'))
D['views']={'arrival':[4,5.37,-24],'lowerInterior':[0,2.37,-12],'mainSalon':[3.2,5.37,-34],'upperBridge':[3,8.37,12],'sunTerrace':[3,11.37,-18],'stairs':[3,5.37,-3.2],'profile':[115,35,-10],'bowQuarter':[75,32,92],'sternQuarter':[65,28,-90]}
D['notes']=['All interior room names/bounds are original interpretation, not an authenticated private layout.','Modules are collision authority. Fine visual bevels/trim must remain within their stated visualBounds or explicitly update this contract.','Window apertures are geometrically clear in near flat artwork; collision may retain a thin glazing pane.','All occupied floor datums remain above seaY0; below-floor tanks/keel volume is closed and inaccessible.','Pools and tubs are visual architectural features; only the surrounding circulation is required for first-delivery traversal.','No individual room portal culling is assumed. Furnishings must leave the published route envelopes clear.']
OUT.write_text(json.dumps(clean(D),indent=2)+'\n')
print('wrote',OUT,'modules',len(mods),'rooms',len(D['rooms']),'stairs',len(D['stairs']),'routes',len(D['routes']))
