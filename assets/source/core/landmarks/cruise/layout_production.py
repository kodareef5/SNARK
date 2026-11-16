"""Reference-led public neighborhoods and reusable accommodation, authored in the shared metre frame."""
import math

COLORS={'enamel':232,'navy':29,'teal':9,'deck':122,'carpet':85,'linen':105,'oak':172,'stone':1,
        'steel':91,'tile':9,'glass':5,'coral':58,'blue':53,'yellow':6,'leaf':196,'rubber':82,
        'purple':32,'brass':167,'marble':104,'screen':29,'water':9,'ivory':105,'orange':3,'red':233}

def dome(D,p,place,beam):
 """64 bounded, triangulated pane groups; source glass has collision but deliberately clear visual apertures."""
 D['aquadome']={'outerBeam':57,'outerHeight':17,'baseY':45.6,'centerZ':112,'length':70,
                'published':['outerBeam','outerHeight'],'inferred':['baseY','centerZ','length'],
                'authority':'https://www.wilsonbutler.com/project/icon-of-the-seas/'}
 D['sources'].append({'id':'designer-aquadome','url':D['aquadome']['authority'],'kind':'original-architect-dimensions'})
 def point(t,a):return [28.395*math.cos(t)*math.cos(a),45.705+16.79*math.sin(t),112+34.895*math.cos(t)*math.sin(a)]
 def normal(t,a):
  v=[math.cos(t)*math.cos(a)/28.395,math.sin(t)/16.79,math.cos(t)*math.sin(a)/34.895]
  l=math.sqrt(sum(x*x for x in v));return [x/l for x in v]
 for sector in range(16):
  for band in range(4):
   cells=[];frames=[];collision=[];proxy=[]
   for ai in range(sector*4,sector*4+4):
    for ti in range(band*2,band*2+2):
     if ti==0 and 45<=ai<=50:continue
     a0=ai*math.tau/64;a1=(ai+1)*math.tau/64;t0=ti*math.pi/16;t1=(ti+1)*math.pi/16
     corners=[point(t,a) for t,a in[(t0,a0),(t0,a1),(t1,a1),(t1,a0)]]
     norms=[normal(t,a) for t,a in[(t0,a0),(t0,a1),(t1,a1),(t1,a0)]]
     pane=[[q[k]+sign*n[k] for k in range(3)] for sign in(-.03,.105) for q,n in zip(corners,norms)]
     collision.append(pane)
     roof=ti>=4
     if roof:proxy.append(pane);cells.append(pane)
     for aa,bb in[(corners[0],corners[1]),(corners[0],corners[3]),(corners[0],corners[2])]:
      if math.dist(aa,bb)<.01:continue
      frames.append([aa,bb]);proxy.append(beam(aa,bb,.11))
   if not collision:continue
   allpts=[q for h in collision+proxy for q in h]
   lo=[min(q[k] for q in allpts) for k in range(3)];hi=[max(q[k] for q in allpts) for k in range(3)];o=[(a+b)/2 for a,b in zip(lo,hi)]
   local=lambda q:[q[k]-o[k] for k in range(3)]
   hs=[{'points':[local(q) for q in h]} for h in collision]
   look={'hulls':[{'points':[local(q) for q in h]} for h in proxy]}
   art={'kind':'dome_dense','finish':'steel','beams':[[local(q) for q in line] for line in frames],
        'roof':[[local(q) for q in cell] for cell in cells]}
   ident=p('dome_sector','dome',[],hs,art,91,look)
   place(f'aquadome_{sector}_{band}',ident,o,'15','aquadome')

def finish(D,p,raw,world,place,box,node,route,rect,ys,beam):
 D['phase']='production-review';D['prototypeScope']={'complete':True,'notes':'Prototype gate accepted. Production layout is authored; native route, art and image acceptance remain required.'}
 nodes=lambda ident:next(n['at'] for n in D['graph']['nodes'] if n['id']==ident)
 def furniture(kind,size,finish='oak',extra=None):
  sx,sy,sz=size
  bs=[box([-sx/2,0,-sz/2],[sx/2,sy,sz/2])]
  art={'kind':'furniture','wallCount':0,'items':[{'kind':kind,'at':[0,0,0],'size':size,'finish':finish,**(extra or {})}]}
  return p('furniture_'+kind,'furniture',bs,art=art,color=COLORS[finish])
 def furnish(name,kind,at,size,deck,finish='oak',yaw=0,extra=None):
  return place(name,furniture(kind,size,finish,extra),at,deck,'furnished-'+deck,yaw)
 def wall(name,a,b,y,height,gap=None,finish='enamel',label=None):
  axis=0 if a[0]!=b[0] else 2;start=min(a[axis],b[axis]);end=max(a[axis],b[axis]);fixed=a[2-axis]
  glazed=name.startswith('bridge_') and not name.endswith('_aft')
  if name in('bridge_port','bridge_starboard'):gap=(128,4.4)
  span=3.2 if glazed else 12
  cuts=sorted(set([start,end]+[start+i*span for i in range(1,math.ceil((end-start)/span))]+([gap[0]-gap[1]/2,gap[0]+gap[1]/2] if gap else [])))
  labelPlaced=False
  for i,(lo,hi) in enumerate(zip(cuts,cuts[1:])):
   if hi<=start or lo>=end:continue
   if gap and gap[0]-gap[1]/2<(lo+hi)/2<gap[0]+gap[1]/2:continue
   lower=[lo,y,fixed-.10] if axis==0 else [fixed-.10,y,lo]
   upper=[hi,y+height,fixed+.10] if axis==0 else [fixed+.10,y+height,hi]
   if glazed:
    def pane(aa,bb,ya,yb,depth=.1):return box([aa,ya,fixed-depth] if axis==0 else [fixed-depth,ya,aa],[bb,yb,fixed+depth] if axis==0 else [fixed+depth,yb,bb])
    boxes=[pane(lo,hi,y,y+.65),pane(lo,hi,y+height-.35,y+height),pane(lo,lo+.10,y+.65,y+height-.35),pane(hi-.10,hi,y+.65,y+height-.35),pane(lo+.1,hi-.1,y+.65,y+height-.35,.025)]
    q,o=world('bridge_glazing','wall',boxes,art={'kind':'window_wall','glassBoxes':[4],'finish':finish,'measurement':'bridge'},color=232)
   else:
    art={'kind':'wall','finish':finish}
    if name.startswith('bridge_'):art['measurement']='bridge'
    if label and not labelPlaced and hi-lo>=1.8:
     art.update(label=label,labelFace=4 if axis==0 else 0);labelPlaced=True
    q,o=world('room_wall','wall',[box(lower,upper)],art=art,color=COLORS[finish])
   place(f'{name}_{i}',q,o,str(next(d['id'] for d in D['decks'] if abs(d['floorY']-y)<.001)),'public-interior')
 def room(ident,label,deck,bounds,target,start,via=(),enclosed=False,height=None,entry=None):
  y=ys[deck];x0,z0,x1,z1=bounds;entry=entry or [target[0],y,z0]
  node(ident,target,deck,'room');anchors=[nodes(start),*via,target]
  route(ident+'_access','room',start,ident,anchors,2.0)
  D['rooms'].append({'id':ident,'node':ident,'label':label,'deck':deck,'section':ident,
                     'bounds':{'min':[x0,y,z0],'max':[x1,y+(height or 2.96),z1]},'entry':entry,
                     'routeTarget':target,'evidence':'original-fitted-interior-informed-by-public-plan'})
  if enclosed:
   h=height or next(d for d in D['decks'] if d['id']==deck)['ceilingY']-y
   wall(ident+'_aft',[x0,y,z0],[x1,y,z0],y,h,(entry[0],4.4) if abs(entry[2]-z0)<.01 else None,label=label)
   wall(ident+'_fore',[x0,y,z1],[x1,y,z1],y,h,(entry[0],4.4) if abs(entry[2]-z1)<.01 else None)
   wall(ident+'_port',[x1,y,z0],[x1,y,z1],y,h,(entry[2],4.4) if abs(entry[0]-x1)<.01 else None)
   wall(ident+'_starboard',[x0,y,z0],[x0,y,z1],y,h,(entry[2],4.4) if abs(entry[0]-x0)<.01 else None)
  return ident
 # Opaque accommodation banks behind the balcony openings. These closed facade cells are NOT advertised rooms.
 facadeboxes=[box([-4.05,0,-1.6],[-3.91,2.96,1.6]),box([-4.05,0,-1.6],[4.05,2.96,-1.49]),
              box([-4.05,0,1.49],[4.05,2.96,1.6]),box([3.91,0,-1.49],[4.05,.60,1.49]),
              box([3.91,2.60,-1.49],[4.05,2.96,1.49]),box([3.91,.60,-1.49],[4.05,2.60,-1.34]),
              box([3.91,.60,1.34],[4.05,2.60,1.49])]
 facade=p('accommodation_cell','facade',facadeboxes,art={'kind':'solids','finish':'enamel','walkableRoom':False,'measurement':'deckhouse'},color=232)
 for deck in ['7','8','9','10','11','12','14']:
  for side in(-1,1):
   for j in range(-48,35):
    z=j*3.2
    if side==1 and 91.2<z<110.4:continue
    place(f'facade_{deck}_{side}_{j+48}',facade,[side*23.05,ys[deck],z],deck,'accommodation-facade',0 if side>0 else 180)
 # Furnished cabin types remain honest playable samples, with generous original fitting for native bodies.
 standard=next(q for q in D['prototypes'] if q['category']=='cabin')
 for kind,label,deck,x,z in [('interior','Interior stateroom','4',7,44),('ocean','Ocean-view stateroom','5',22,87),('suite','Owner suite','17',15,43)]:
  bs=list(standard['boxes']);art=dict(standard['art']);art['sampleType']=kind
  if kind=='interior':bs=bs[:5]+[box([3.86,0,-3.06],[4,2.96,3.06])]+bs[9:];art['wallCount']=6
  if kind=='suite':art['items']=[{**f,'finish':'purple' if f['kind']=='sofa' else f.get('finish','oak')} for f in art['items']]
  q=p('cabin_'+kind,'cabin',bs,art=art,color=232);place('sample_'+kind,q,[x,ys[deck],z],deck,'playable-cabin-samples')
  outside=[x-5.4,ys[deck],z];target=[x-1,ys[deck],z-.5]
  start='fore_'+deck;via=[[x-5.4,ys[deck],59.4],outside,[x-2,ys[deck],z]]
  room('sample_'+kind,label,deck,[x-4,z-3.2,x+4,z+3.2],target,start,via,entry=[x-4,ys[deck],z])
 # Pearl: a 15 m hollow structural sphere with opposed circular openings and a real broad stair through it.
 D['pearl']={'diameter':15,'center':[14,19.6,-8],'publishedChosen':'builder-delivery',
             'discrepancy':'Original architect states 53 ft (~16.154 m); builder states 15 m. Builder baseline retained.'}
 for az in range(16):
  angles=[az*math.tau/16,(az+1)*math.tau/16];hs=[]
  for za,zb in zip([-5.6,-3,0,3],[-3,0,3,5.6]):
   hs.append({'points':[[r*math.cos(a),r*math.sin(a),z] for z in(za,zb) for a in angles for r in(math.sqrt(7.5**2-z*z)-.20,math.sqrt(7.5**2-z*z))]})
  q=p('pearl_shell','pearl',[],hs,{'kind':'pearl','angles':angles,'finish':'ivory'},105)
  place(f'pearl_shell_{az}',q,[14,19.6,-8],'5','royal-promenade')
 ramp=[[x,y,z] for z,y in[(-18,14),(-3,18.4)] for x in(11.6,16.4) for y in(y-.28,y)]
 q,o=world('pearl_stairs','stairs',hs=[ramp],art={'kind':'grand_stair','start':[11.6,14,-18],'end':[16.4,18.4,-3],'steps':28},color=104)
 # Art coordinates are local, like every other prototype; the source keeps exact world anchors separately.
 pp=next(t for t in D['prototypes'] if t['id']==q);pp['art']['start']=[pp['art']['start'][k]-o[k] for k in range(3)];pp['art']['end']=[pp['art']['end'][k]-o[k] for k in range(3)]
 parts=[place('pearl_through_stair',q,o,'5','royal-promenade')]
 q,o=world('pearl_bridge','floor',[box([11.6,18.16,-3],[16.4,18.4,8])],art={'kind':'floor','finish':'marble'},color=104)
 parts.append(place('pearl_upper_bridge',q,o,'6','royal-promenade'))
 node('pearl_lower',[12.7,14,-18],'5','stair-lobby');node('pearl_upper',[12.7,18.4,8],'6','stair-lobby')
 route('pearl_arrival','room','arrival','pearl_lower',[[20,14,-24],[12.7,14,-24],[12.7,14,-18]],2.0)
 route('pearl_through','stairs','pearl_lower','pearl_upper',[[12.7,14,-18],[12.7,18.4,-3],[12.7,18.4,8]],2.0)
 route('pearl_upper_access','corridor','pearl_upper','fore_6',[[12.7,18.4,8],[3,18.4,8],[3,18.4,59.4],[-1.1,18.4,59.4]],2.0)
 D['stairs'].append({'id':'pearl_through','fromDeck':'5','toDeck':'6','instances':parts,'route':'pearl_through',
                     'opening':{'min':[6,18.16,-23],'max':[28.9,18.4,7]},'clearHeadroom':2.6})
 room('pearl','The Pearl','5',[6,-23,22,8],[12.7,14,-18],'pearl_lower',entry=[12.7,14,-18])
 # Main public destinations. Furniture deliberately leaves the named centre/side aisles open.
 room('promenade','Royal Promenade','5',[-18,-65,28,58],[0,14,22],'fore_5',[[0,14,59.4]])
 room('main_bar','Main Bar','5',[-14,-36,-3,-15],[-5,14,-25],'arrival',[[0,14,-24]])
 furnish('main_bar_counter','counter',[-10,14,-25],[4,1.1,12],'5','brass')
 for z in[-33,-28,-23,-18]:furnish('main_bar_chair_'+str(z),'chair',[-6.8,14,z],[.85,1.1,.85],'5','purple')
 room('pearl_cafe','Pearl Cafe','6',[7,10,27,40],[14,18.4,18],'pearl_upper',[[12.7,18.4,10]])
 for i,z in enumerate([17,26,35]):
  furnish('cafe_sofa_'+str(i),'sofa',[23,18.4,z],[3.0,.95,1.0],'6','linen',90)
  furnish('cafe_table_'+str(i),'table',[20.5,18.4,z],[1.1,.72,1.1],'6','marble')
 room('giovanni','Giovanni\u2019s','6',[-14,8,-3,35],[-5,18.4,20],'fore_6',[[-5,18.4,59.4]])
 for i,z in enumerate([14,23,31]):
  furnish('giovanni_table_'+str(i),'table',[-10,18.4,z],[3,.76,2],'6','oak')
  for dx in(-2,2):furnish(f'giovanni_chair_{i}_{dx}','chair',[-10+dx,18.4,z],[.8,1,.8],'6','red')
 room('casino','Casino Royale','4',[-17,-56,17,36],[0,9.8,0],'fore_4',[[0,9.8,59.4]])
 for i,z in enumerate(range(-44,33,11)):
  for side in(-1,1):
   furnish(f'casino_table_{i}_{side}','gaming_table',[side*7,9.8,z],[3,.95,2],'4','leaf')
   furnish(f'casino_slots_{i}_{side}','slots',[side*12.5,9.8,z],[2.4,1.9,.7],'4','purple')
 for deck in ['3','4','5']:
  y=ys[deck];room('dining_'+deck,'Dining Room',deck,[-21,-154,21,-101],[0,y,-123],'aft_'+deck,[[-1.1,y,-96]],True,entry=[0,y,-101])
  for i,z in enumerate(range(-145,-104,10)):
   for x in(-14,-7,7,14):
    furnish(f'dining_table_{deck}_{i}_{x}','table',[x,y,z],[3,.76,2],deck,'marble')
    for dz in(-1.6,1.6):furnish(f'dining_chair_{deck}_{i}_{x}_{dz}','chair',[x,y,z+dz],[.8,1,.8],deck,'carpet')
 # Theater and ice arena are genuine multi-deck voids, not stacks of intervening opaque floors.
 room('theater','Royal Theater','4',[-18,100,18,140],[0,9.8,116],'fore_4',[[5,9.8,59.4],[5,9.8,96],[0,9.8,96]],True,12.56,entry=[0,9.8,100])
 for row,z in enumerate(range(106,129,3)):
  for side in(-1,1):furnish(f'theater_bench_{row}_{side}','seating_row',[side*9,9.8,z],[12,1.1,1.35],'4','red')
 furnish('theater_stage','stage',[0,9.8,134],[26,.8,10],'4','oak')
 furnish('theater_screen','screen',[0,11,139.3],[26,7,.20],'4','navy')
 room('absolute_zero','Absolute Zero','4',[-18,-175.7,18,-156],[0,9.8,-166],'aft_4',[[-22,9.8,-76.6],[-22,9.8,-155],[0,9.8,-155]],True,8.36,entry=[0,9.8,-156])
 furnish('ice_arena','stage',[0,9.8,-167],[20,.02,16],'4','ivory')
 for side in(-1,1):
  for j,z in enumerate([-161,-166,-171]):furnish(f'ice_bench_{side}_{j}','seating_row',[side*14.3,9.8,z],[4.2,1.1,1.4],'4','blue',90)
 room('fitness','Fitness Center','6',[-8,160,8,171],[0,18.4,164],'fore_6',[[22,18.4,59.4],[22,18.4,96],[19,18.4,143],[0,18.4,143],[0,18.4,158]],True,entry=[0,18.4,160])
 for side in(-1,1):
  for i,z in enumerate([163,166,169]):furnish(f'fitness_{side}_{i}','gym',[side*5,18.4,z],[2,1.7,2],'6','rubber')
 room('spa','Vitality Spa','14',[-16,80,16,106],[0,42,94],'fore_14',[[5,42,59.4],[5,42,76],[0,42,76]],True,entry=[0,42,80])
 for side in(-1,1):
  for i,z in enumerate([86,96,102]):furnish(f'spa_{side}_{i}','lounger',[side*9,42,z],[1.2,.85,2.5],'14','linen')
 room('bridge','Bridge and lookout','12',[-20,119,20,143],[0,38.8,131],'fore_12',[[5,38.8,59.4],[5,38.8,114],[0,38.8,114]],True,entry=[0,38.8,119])
 for x in[-12,-6,0,6,12]:furnish('bridge_console_'+str(x),'console',[x,38.8,139],[4.5,1.25,2],'12','navy')
 for side in(-1,1):furnish('bridge_chart_'+str(side),'table',[side*12,38.8,124],[4,.9,2.3],'12','oak')
 for side in(-1,1):
  ident='bridge_lookout_'+str(side);target=[side*28,38.8,128]
  node(ident,target,'12','lookout');route(ident,'room','bridge',ident,[[0,38.8,131],[0,38.8,128],target],2.0)
  D['rooms'].append({'id':ident,'node':ident,'label':'Bridge lookout','deck':'12','section':'bridge',
    'bounds':{'min':[24 if side>0 else -32.9,38.8,120],'max':[32.9 if side>0 else -24,41.76,134]},
    'entry':[side*20,38.8,128],'routeTarget':target,'evidence':'original-fitted-public-lookout'})
 # Service and medical spaces remain fitted and connected, with no below-water inhabited fiction.
 for ident,label,deck,bounds,target,start,via,kind in[
  ('medical','Medical Center','3',[-17,91,1,114],[-8,6.2,102],'fore_3',[[-8,6.2,59.4],[-8,6.2,87]],'medical'),
  ('crew','Crew mess','2',[-16,-36,16,-12],[0,3,-24],'fore_2',[[0,3,59.4]],'table'),
  ('laundry','Laundry','2',[-17,4,-3,25],[-8,3,14],'fore_2',[[-8,3,59.4]],'laundry'),
  ('galley','Galley','3',[-17,-92,17,-77],[0,6.2,-85],'aft_3',[],'counter'),
  ('engine','Engine gallery','2',[-16,30,16,52],[0,3,40],'fore_2',[[0,3,59.4]],'engine'),
  ('workshop','Workshop','2',[3,4,17,25],[8,3,14],'fore_2',[[8,3,59.4]],'workbench')]:
  room(ident,label,deck,bounds,target,start,via,False)
  y=ys[deck];x0,z0,x1,z1=bounds
  for i,z in enumerate([z0+4,z1-4]):
   for x in[x0+3,x1-(5 if ident=='workshop' else 3)]:furnish(f'{ident}_fit_{i}_{x}',kind,[x,y,z],[3,1.6 if kind not in('table','counter') else .9,2.2],deck,'enamel' if ident in('medical','laundry','galley') else 'steel')
 # Neighborhood parks and terraces: clear central circulation, planted edges and recognizable grouped seating.
 room('central_park','Central Park','8',[-8.6,-66,8.6,58],[0,26,12],'fore_8',[[0,26,59.4]])
 room('surfside','Surfside','7',[-11,-165,11,-86],[0,22.6,-128],'aft_7',[[-1.1,22.6,-92]])
 for deck,x,zs in [('8',5.5,range(-55,56,11)),('7',8,range(-155,-94,12))]:
  for i,z in enumerate(zs):
   for side in(-1,1):furnish(f'plant_{deck}_{i}_{side}','planter_tree',[side*x,ys[deck],z],[2.8,3.7,2.8],deck,'leaf')
   if i%2==0:furnish(f'park_bench_{deck}_{i}','sofa',[x-1.4,ys[deck],z+(2 if z==55 else 4.5)],[2.5,.9,.85],deck,'oak')
 for i,x in enumerate([-7,7]):furnish('surfside_play_'+str(i),'play_structure',[x,22.6,-143],[4,3,5],'7','coral')
 room('chill','Chill Island','15',[-28,-45,28,58],[19,45.6,45],'fore_15',[[19,45.6,59.4]])
 room('hideaway','The Hideaway','15',[-23,-180,23,-156],[12,45.6,-169],'aft_15',[[25,45.6,-76.6],[25,45.6,-158],[12,45.6,-158]])
 room('thrill','Thrill Island','16',[-27,-178,27,-94],[24,49.6,-150],'aft_16',[[-1.1,49.6,-88],[24,49.6,-88]])
 room('cloud','Cloud 17','17',[10,-60,27,20],[20,53.2,0],'fore_17',[[24,53.2,59.4],[24,53.2,0]])
 room('grove','The Grove','18',[-25,48,25,77],[12,56.8,55],'fore_18',[[12,56.8,59.4]])
 room('grove_upper','The Grove','19',[-22,48,22,76],[12,60,55],'fore_19',[[12,60,59.4]])
 room('waterpark','Category 6','20',[10,-142,26,-116],[21,63.2,-130],'launch_20',[[21,63.2,-132.6]])
 room('windjammer','Windjammer','15',[8,-152,27,-97],[17,45.6,-120],'aft_15',[[23,45.6,-76.6],[23,45.6,-94],[17,45.6,-94]])
 for deck,spots in [('15',[(x,z) for x in(-27,27) for z in range(-40,55,10)]+[(x,-162) for x in(-19,-17,17,19)]),
                    ('17',[(20,z) for z in(-45,-30,-15,12)]),('18',[(x,53) for x in(-20,-14,18,23)])]:
  for i,(x,z) in enumerate(spots):furnish(f'lounger_{deck}_{i}','lounger',[x,ys[deck],z],[1.0,.85,2.4],deck,'linen')
 for i,z in enumerate([-105,-115,-125,-138]):
  furnish('windjammer_table_'+str(i),'table',[22,45.6,z],[3,.76,2],'15','oak')
  furnish('windjammer_buffet_'+str(i),'counter',[10,45.6,z],[3,1.1,2],'15','enamel')
 # Original shallow basins with steps remain decorative geometry above real dry rooms.
 for ident,deck,x,z,w,l in [('waters_edge','7',0,-171,12,10),('royal_bay','15',-18,-7,12,24),('hideaway_pool','15',0,-171,10,10)]:
  bs=[box([-w/2,-.94,-l/2],[w/2,-.74,l/2]),box([-w/2-.18,-.74,-l/2-.18],[-w/2,.18,l/2+.18]),
      box([w/2,-.74,-l/2-.18],[w/2+.18,.18,l/2+.18]),box([-w/2,-.74,-l/2-.18],[w/2,.18,-l/2]),box([-w/2,-.74,l/2],[w/2,.18,l/2+.18])]
  for i in range(5):bs.append(box([-1,-.74+i*.148,l/2-1.5+i*.3],[1,-.592+i*.148,l/2-1.2+i*.3]))
  q=p('decorative_pool','pool',bs,art={'kind':'pool','waterY':-.18,'width':w,'length':l,'finish':'tile','decorativeWater':True},color=9)
  place(ident,q,[x,ys[deck],z],deck,'pool')
 # Lifeboats and davits preserve the conspicuous yellow rhythm below the accommodation banks.
 D['lifeboats']={'length':15,'beam':5.5,'height':4.2,'basis':'Palfinger Marine MPC49 published product-family envelope',
                  'authority':'https://assets.palfinger.com/cache-buster-1574941498/importdata/marine/events/marintec/palfinger-marine-boats-and-davits-brochure.pdf',
                  'fitting':'Original interpretation of public close photographs; not a manufacturer fitting drawing.'}
 life=p('lifeboat','lifeboat',[box([-2.75,-2.1,-7.5],[2.75,2.1,7.5])],art={'kind':'lifeboat','finish':'yellow'},color=6)
 for side in(-1,1):
  for i,z in enumerate([-140,-120,-100,-80,-50,20,40,60,80]):
   place(f'lifeboat_{side}_{i}',life,[side*28,16.1,z],'5','lifesaving',0 if side>0 else 180)
   for dz in(-5,5):
    hs=[beam([side*25,14.4,z+dz],[side*27.8,18.6,z+dz],.17),beam([side*27.8,18.6,z+dz],[side*29.2,18.6,z+dz],.17)]
    q,o=world('davit','fitting',hs=hs,art={'kind':'solids','finish':'enamel'})
    place(f'davit_{side}_{i}_{dz}',q,o,'5','lifesaving')
 # Six colored enclosed slide courses are decorative; their launch decks and surrounding paths are walkable.
 for si,finish in enumerate(['coral','leaf','blue','yellow','purple','orange']):
  path=[]
  for j in range(17):
   t=j/16;angle=t*math.tau*(1.25+si*.10)+si*.8
   path.append([(-4 if si<3 else 8)+8*math.sin(angle),68.4-12.6*t,-128-39*t+6*math.cos(angle)])
  path[0]=[12+si*2.3,68.4,-117.3]
  for j,(a,b) in enumerate(zip(path,path[1:])):
   hs=[beam(a,b,.78)];q,o=world('slide_'+finish,'waterpark',hs=hs,art={'kind':'slide','finish':finish},color=COLORS[finish])
   place(f'slide_{si}_{j}',q,o,'16','category-6')
   if j and j%4==0:
    q,o=world('slide_support','fitting',hs=[beam([a[0],49.6,a[2]],a,.10)],art={'kind':'solids','finish':'enamel'})
    place(f'slide_support_{si}_{j}',q,o,'16','category-6')
 # Strong photographed stern arch, kept outside the protected routes and within the published hull length.
 arch=[[-16,23,-178],[-12,36,-178],[0,42,-176],[12,36,-178],[16,23,-178]]
 for j,(a,b) in enumerate(zip(arch,arch[1:])):
  q,o=world('stern_arch','fitting',hs=[beam(a,b,.48)],art={'kind':'solids','finish':'enamel'})
  place('stern_arch_'+str(j),q,o,'7','stern')
 # Readable external port boards are definitions only; the port fixture owns their placements.
 D['portSigns']=[]
 for suffix,label in [('arrival','CRUISE PORT'),('boarding','BOARDING - DECK 5'),('lower_berths','KORU + UTILITY LAUNCH')]:
  bs=[box([-1.2,1.3,-.06],[1.2,2.1,.06]),box([-.95,0,-.04],[-.87,1.3,.04]),box([.87,0,-.04],[.95,1.3,.04])]
  q=raw('port_'+suffix,'sign',bs,art={'kind':'sign','label':label,'board':0},color=29)
  D['portSigns'].append({'id':q,'label':label,'front':[0,0,-1],'groundOrigin':True,'width':2.4,'height':.8})
 # Bounded review list: public identities plus one representative furnished cabin, rather than a view per repeated cell.
 wanted=['promenade','pearl_cafe','central_park','surfside','theater','dining_5','bridge','grove','thrill','hideaway','medical','sample_interior','sample_suite']
 keep=[v for v in D['views'] if v['id'] in('cabin_9','dome_inside','pool_under')]
 for ident in wanted:
  r=next(r for r in D['rooms'] if r['id']==ident);at=r['routeTarget'];target=[at[0],at[1]+1.4,at[2]+7]
  keep.append({'id':ident,'at':at,'target':target,'deck':r['deck'],'section':r['section'],'mode':'walk'})
 D['views']=keep
