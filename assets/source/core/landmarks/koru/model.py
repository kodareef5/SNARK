"""Koru reference-led exterior and original interior, built exclusively from the shared metre contract.

Six authored representations retain actual stair openings and transparent window apertures. No OEM geometry or
photographic textures are imported. Run through the repository's normal PiecesAsset/Blender/native-pack pipeline.
"""
import json,math,os
from pathlib import Path
from mathutils import Vector
from parts import Mesh,LOOK
HERE=Path(__file__).resolve().parent
D=json.loads((HERE.parents[4]/'content/landmarks/koru-layout.json').read_text())
MODS=D['modules'];WINDOWS=D.get('windows',[])

def worldbox(b,o):return ([o[k]+b['at'][k]-b['half'][k] for k in range(3)],[o[k]+b['at'][k]+b['half'][k] for k in range(3)])
def worldhull(h,o):return [[p[k]+o[k] for k in range(3)] for p in h['points']]
def station(z):
 st=D['hullStations']
 for a,b in zip(st,st[1:]):
  if a['z']-1e-7<=z<=b['z']+1e-7:
   t=(z-a['z'])/(b['z']-a['z']);return {k:a[k]+t*(b[k]-a[k]) for k in a}
 return st[0] if z<st[0]['z'] else st[-1]
def hullwidth(z,y):
 a=station(z);return a['halfBeam']*(.9+.1*y/a['sheer'])
def box(m,b,o,tag='cream',bevel=0):
 lo,hi=worldbox(b,o);m.box(lo,hi,tag,bevel)
def hullsurface(m,za,zb,sign,ylo,yhi,tag='navy'):
 # A thin closed wall patch, with independent outer and inner surfaces and no plane spanning the interior.
 def point(z,y,inner):return [sign*max(.01,hullwidth(z,y)-(.24 if inner else 0)),y,z]
 ya=ylo(za) if callable(ylo) else ylo;yb=ylo(zb) if callable(ylo) else ylo
 ta=yhi(za) if callable(yhi) else yhi;tb=yhi(zb) if callable(yhi) else yhi
 if min(ta-ya,tb-yb)<.0001:return
 m.loft([[point(za,ya,k),point(zb,yb,k),point(zb,tb,k),point(za,ta,k)] for k in(0,1)],tag)
def porthole(m,za,zb,sign,cy=2.28):
 # A true annular solid through the shell; clear through the near-flat representation too.
 zc=(za+zb)/2;radius=min(.30,(zb-za)*.25);bottom=1.65;top=2.95
 angles=[i*math.tau/[20,12,8,4,4,4][m.level] for i in range([20,12,8,4,4,4][m.level])]
 angles+= [math.atan2(y-cy,z-zc)%math.tau for z,y in((za,bottom),(zb,bottom),(zb,top),(za,top))]
 angles=sorted(set(round(a,8) for a in angles));rings=[]
 for inner in(0,1):
  outer=[];hole=[]
  for a in angles:
   dz,dy=math.cos(a),math.sin(a);limits=[]
   if dz>1e-7:limits.append((zb-zc)/dz)
   if dz<-.0000001:limits.append((za-zc)/dz)
   if dy>1e-7:limits.append((top-cy)/dy)
   if dy<-.0000001:limits.append((bottom-cy)/dy)
   t=min(limits);z,y=zc+t*dz,cy+t*dy;outer.append([sign*max(.01,hullwidth(z,y)-inner*.24),y,z])
   z,y=zc+radius*dz,cy+radius*dy;hole.append([sign*(hullwidth(z,y)-inner*.24),y,z])
  rings.extend([outer,hole])
 n=len(angles);verts=sum(rings,[]);faces=[]
 for i in range(n):
  j=(i+1)%n;faces.extend([(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),(i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)])
 m.indexed(verts,faces,'navy')
 if m.level<4:m.ring([sign*(hullwidth(zc,cy)-.012),cy,zc],[0,0,1],[0,1,0],radius+.018,radius+.018,.022,'brass')
def hull(m,mod):
 a,b=mod['art']['stations'];za,zb=a[0],b[0];segments=max(1,math.ceil((zb-za)/[1.8,3,4,8,16,32][m.level]));zs=[za+(zb-za)*i/segments for i in range(segments+1)]
 # The closed underbody follows an original smooth canoe/V section inside the collision envelope.
 rings=[]
 for z in zs:
  s=station(z);w=s['halfBeam'];k=s['keel'];rings.append([[-w*.9,0,z],[-w*.62,min(0,k*.45),z],[0,k,z],[w*.62,min(0,k*.45),z],[w*.9,0,z]])
 m.loft(rings,'navy')
 for sign in(-1,1):
  top=lambda z:min(station(z)['sheer'],3.75) if sign>0 and mod['art']['gatePort'] else station(z)['sheer']
  for z0,z1 in zip(zs,zs[1:]):
   hullsurface(m,z0,z1,sign,0,.16,'navy');hullsurface(m,z0,z1,sign,.16,.235,'cream');hullsurface(m,z0,z1,sign,.235,1.65,'navy')
  # Window rhythm is local to actual hull sections; no opaque dark patches pretend to be holes.
  n=max(1,round((zb-za)/3.4));edges=[za+(zb-za)*i/n for i in range(n+1)]
  for z0,z1 in zip(edges,edges[1:]):
   if za>=-49 and zb<=44 and z1-z0>.9:porthole(m,z0,z1,sign)
   else:hullsurface(m,z0,z1,sign,1.65,2.95)
   hullsurface(m,z0,z1,sign,2.95,lambda z:top(z)-.09,'navy')
   hullsurface(m,z0,z1,sign,lambda z:top(z)-.09,lambda z:top(z)-.055,'brass')
   hullsurface(m,z0,z1,sign,lambda z:top(z)-.055,top,'teak')

def rail_segment(m,a,b,bottomA,bottomB,thickness=.023):
 m.tube([a,b],thickness,'steel')
 if m.level<4:
  middleA=[a[k]*.45+bottomA[k]*.55 for k in range(3)];middleB=[b[k]*.45+bottomB[k]*.55 for k in range(3)];m.tube([middleA,middleB],.012,'steel',6 if m.level<2 else 4)
 distance=math.dist(a,b);n=max(1,math.ceil(distance/[1.6,2,3,4,6,20][m.level]))
 for i in range(n+1):
  t=i/n;p=[a[k]+(b[k]-a[k])*t for k in range(3)];q=[bottomA[k]+(bottomB[k]-bottomA[k])*t for k in range(3)];m.tube([p,q],thickness,'steel')
def rails(m,mod):
 o=mod['origin']
 for b in mod['boxes']:
  lo,hi=worldbox(b,o);axis=0 if hi[0]-lo[0]>hi[2]-lo[2] else 2;a=[(lo[k]+hi[k])/2 for k in range(3)];b=a[:];a[axis]=lo[axis]+.025;b[axis]=hi[axis]-.025;a[1]=b[1]=hi[1]-.025;qa=a[:];qb=b[:];qa[1]=qb[1]=lo[1]+.025;rail_segment(m,a,b,qa,qb)
 for h in mod['hulls']:
  ps=worldhull(h,o);z0=min(p[2] for p in ps);z1=max(p[2] for p in ps);a=[];b=[]
  for z in(z0,z1):
   ends=[p for p in ps if abs(p[2]-z)<1e-4];x=(min(p[0] for p in ends)+max(p[0] for p in ends))/2;lo=min(p[1] for p in ends);hi=max(p[1] for p in ends)
   a.append([x,hi-.025,z]);b.append([x,lo+.025,z])
  rail_segment(m,a[0],a[1],b[0],b[1])
def staircase(m,mod):
 art=mod['art'];o=mod['origin']
 if 'flight' not in art:
  if art.get('poolExit'):
   for b in mod['boxes']:box(m,b,o,'teak',.006)
  else:
   box(m,mod['boxes'][0],o,'teak');rails(m,{**mod,'boxes':mod['boxes'][1:]})
  return
 (x0,y0,z0),(x1,y1,z1)=art['flight'];n=art['steps'] if m.level<3 else 1
 if n==1:m.convex(worldhull(mod['hulls'][0],o),'teak')
 else:
  for i in range(n):
   za=z0+(z1-z0)*i/n;zb=z0+(z1-z0)*(i+1)/n;ya=y0+(y1-y0)*i/n;yb=y0+(y1-y0)*(i+1)/n;top=max(ya,yb)
   m.box([x0,top-.3,za],[x1,top,zb],'teak')
   if m.level==0:m.box([x0+.01,top-.014,(za if y1>y0 else zb-.025)],[x1-.01,top-.003,(za+.025 if y1>y0 else zb)],'brass')
 for x in(x0-.04,x1+.04):rail_segment(m,[x,y0+1.075,z0],[x,y1+1.075,z1],[x,y0,z0],[x,y1,z1])
def facade(m,mod):
 a=mod['art'];y=a['floorY'];lo,hi=a['range'];axis=a['axis'];fixed=a['fixed']
 def part(t0,t1,y0,y1,tag='cream',depth=.18):
  if t1-t0<1e-6 or y1-y0<1e-6:return
  m.box([fixed-depth/2,y0,t0],[fixed+depth/2,y1,t1],tag) if axis=='z' else m.box([t0,y0,fixed-depth/2],[t1,y1,fixed+depth/2],tag)
 if a['portal']:
  part(lo,hi,y+2.6,y+2.8);return
 windows=[w for w in WINDOWS if w['module']==mod['id']]
 if not windows:
  part(lo,hi,y,y+2.8);return
 part(lo,hi,y,y+.06,depth=.15);part(lo,hi,y+.06,y+.12,'mahogany',.15);part(lo,hi,y+.12,y+.73,depth=.15);part(lo,hi,y+.73,y+.75,'mahogany',.15)
 part(lo,hi,y+2.35,y+2.38,'mahogany');part(lo,hi,y+2.38,y+2.52);part(lo,hi,y+2.52,y+2.57,'mahogany');part(lo,hi,y+2.57,y+2.8)
 cursor=lo
 for w in windows:
  l,r=w['range'];part(cursor,l,y+.75,y+2.35,'mahogany',.15);cursor=r
  # Deep polished jambs and glass edge cues never obscure the actual view aperture.
  if m.level<3:
   part(l-.025,l,y+.75,y+2.35,'brass');part(r,r+.025,y+.75,y+2.35,'brass')
 part(cursor,hi,y+.75,y+2.35,'mahogany',.15)
 # Frame/wood/enamel faces are partitioned, with no coplanar overlays.
def wall(m,mod):
 o=mod['origin']
 for part in mod['boxes']:
  lo,hi=worldbox(part,o);axis=0 if hi[0]-lo[0]<hi[2]-lo[2] else 2
  if hi[1]-lo[1]>1:
   top=min(hi[1],lo[1]+.85);h=hi[:];h[1]=top;m.box(lo,h,'mahogany')
   a=lo[:];b=hi[:];a[1]=top;a[axis]+=.012;b[axis]-=.012;m.box(a,b,'cream')
  else:m.box(lo,hi,'cream')


def furniture(m,mod):
 for item in mod['art']['items']:
  kind=item['kind'];x,y,z=item['at'];sx,sy,sz=item['size']
  def b(ax,ay,az,bx,by,bz,tag='mahogany',rounding=.025):m.box([x+ax*sx,y+ay*sy,z+az*sz],[x+bx*sx,y+by*sy,z+bz*sz],tag,rounding if m.level<2 else 0)
  def feet():
   if m.level>3:return
   for a in(-.39,.39):
    for c in(-.39,.39):b(a-.035,0,c-.035,a+.035,.19,c+.035,'brass',.008)
  def cushion(ax,az,bx,bz,ay=.28,by=.54):b(ax,ay,az,bx,by,bz,'fabric',.06)
  if m.level==5 and kind not in('tub','bed','bunk','sofa','lounger','helm'):
   b(-.5,0,-.5,.5,1,.5,'cream' if kind in('cold_store','laundry','galley') else 'mahogany',0);continue
  if kind in('table','dining','desk','chart','workbench','vanity'):
   feet();b(-.5,.88,-.5,.5,.96 if kind in('chart','dining') else 1,.5,'slate' if kind=='workbench' else 'mahogany',.025)
   if kind in('desk','workbench','vanity'):
    b(-.48,.15,-.45,-.18,.86,.45,'mahogany');b(.18,.15,-.45,.48,.86,.45,'mahogany')
   if kind=='chart':b(-.44,.96,-.43,.44,1,.43,'screen',0)
   if kind=='dining' and m.level<3:
    for dz in(-.32,0,.32):
     for dx in(-.29,.29):
      m.tube([[x+dx*sx,y+sy*.96,z+dz*sz],[x+dx*sx,y+sy*.99,z+dz*sz]],min(.16,sx*.1),'white',16 if m.level==0 else 8)
  elif kind in('sofa','armchair','bench','lounger','helm_chair'):
   feet();b(-.46,.15,-.46,.46,.42,.46,'mahogany')
   cushion(-.49,-.47,.49,.46,.39,.63)
   # Seating follows the long axis, with a broad calm cushion and a genuine back/arm silhouette.
   if kind=='lounger':
    b(-.47,.58,.15,.47,1,.46,'fabric',.07)
   elif kind=='helm_chair':
    b(-.48,.50,-.48,.48,1,-.25,'fabric',.07);b(-.5,.5,-.3,-.37,.65,.32,'mahogany');b(.37,.5,-.3,.5,.65,.32,'mahogany')
   elif kind!='bench':
    if sz>sx:
     side=1 if x>0 else -1;a,bx=(.29,.5) if side>0 else(-.5,-.29)
     b(a,.45,-.5,bx,1,.5,'fabric',.06);b(-.48,.45,-.5,.48,.84,-.37,'fabric',.05);b(-.48,.45,.37,.48,.84,.5,'fabric',.05)
    else:
     b(-.5,.45,.28,.5,1,.5,'fabric',.06);b(-.5,.45,-.45,-.36,.84,.4,'fabric',.05);b(.36,.45,-.45,.5,.84,.4,'fabric',.05)
  elif kind in('bed','bunk'):
   feet();b(-.49,.12,-.49,.49,.35,.49,'mahogany');b(-.48,.34,-.48,.48,.67,.48,'white',.055)
   b(-.49,.67,-.48,.49,.75,.18,'fabric',.025);b(-.5,.2,.42,.5,1,.5,'mahogany',.025)
   cushion(-.41,.21,-.02,.42,.68,.85);cushion(.02,.21,.41,.42,.68,.85)
   if kind=='bunk':
    b(-.49,.65,-.49,.49,.69,.49,'mahogany');b(-.48,.69,-.48,.48,.83,.48,'white',.025)
    for ax in(-.47,.47):
     for az in(-.47,.47):b(ax-.025,0,az-.025,ax+.025,1,az+.025,'mahogany',.005)
  elif kind in('chairs','stools'):
   n=max(2,round(sz/1.3))
   for i in range(n):
    zz=z-sz/2+(i+.5)*sz/n;w=min(sx,.62);d=min(.62,sz/n*.8)
    m.tube([[x,y,zz],[x,y+sy*.63,zz]],.05,'brass')
    m.box([x-w/2,y+sy*.58,zz-d/2],[x+w/2,y+sy*.76,zz+d/2],'fabric',.04)
    if kind=='chairs':m.box([x-w/2,y+sy*.7,zz+d*.29],[x+w/2,y+sy,zz+d*.49],'mahogany',.02)
  elif kind=='tub':
   b(-.5,0,-.5,.5,.15,.5,'cream')
   b(-.5,.12,-.5,-.38,1,.5,'cream',.045);b(.38,.12,-.5,.5,1,.5,'cream',.045)
   b(-.38,.12,-.5,.38,1,-.38,'cream',.045);b(-.38,.12,.38,.38,1,.5,'cream',.045)
   b(-.38,.40,-.38,.38,.43,.38,'pool',0)
   if m.level<3:
    for ax in(-.42,.42):b(ax-.025,.92,-.44,ax+.025,1,.44,'teak',.005)
  elif kind=='helm':
   b(-.48,0,.12,.48,.82,.47,'mahogany',.04);b(-.5,.78,-.5,.5,.9,.5,'mahogany',.04)
   n=3 if m.level<3 else 2
   for i in range(n):
    cx=x+sx*(-.32+i*.64/(n-1));m.box([cx-sx*.12,y+sy*.87,z-sz*.49],[cx+sx*.12,y+sy,z-sz*.33],'dark',.015)
    if m.level<3:m.box([cx-sx*.105,y+sy*.9,z-sz*.495],[cx+sx*.105,y+sy*.98,z-sz*.49],'screen')
   if m.level<4:
    m.ring([x,y+sy*.68,z-sz*.38],[1,0,0],[0,1,0],.20,.20,.024,'mahogany')
    for ang in(0,math.tau/3,math.tau*2/3):m.tube([[x,y+sy*.68,z-sz*.38],[x+.19*math.cos(ang),y+sy*.68+.19*math.sin(ang),z-sz*.38]],.012,'brass')
  elif kind in('machinery','treadmill','weights','tools'):
   if kind=='treadmill':
    b(-.5,0,-.5,.5,.22,.5,'dark');b(-.47,.18,.32,-.40,.86,.44,'steel');b(.40,.18,.32,.47,.86,.44,'steel');b(-.48,.82,.25,.48,1,.46,'dark')
   elif kind=='machinery':
    b(-.49,0,-.49,.49,.84,.49,'cream',.08);b(-.38,.84,-.36,.38,1,.36,'slate',.035)
    if m.level<3:
     for i in range(8):b(-.44,.22+i*.055,-.50,.44,.24+i*.055,-.49,'dark',0)
   else:
    b(-.46,0,-.45,.46,.96,.45,'mahogany')
    if m.level<3:
     for i in range(5):b(-.44,.15+i*.15,-.5,.44,.19+i*.15,-.46,'steel',.005)
  elif kind=='piano':
   feet();b(-.5,.2,-.2,.5,.66,.48,'navy',.04);b(-.5,.2,-.48,.5,.58,-.2,'navy',.025);b(-.5,.6,.25,.5,1,.5,'navy',.04);b(-.45,.58,-.5,.45,.64,-.24,'white',0)
   if m.level<3:
    for i in range(18):b(-.43+i*.049,.64,-.41,-.411+i*.049,.67,-.26,'dark',0)
  elif kind=='planter':
   b(-.38,0,-.38,.38,.43,.38,'cream',.04)
   m.tube([[x,y+sy*.35,z],[x,y+sy*.96,z]],.025,'mahogany')
   n=10 if m.level<2 else 5
   for i in range(n):
    ang=i*2.4;yy=y+sy*(.45+.045*i);r=sx*.38
    m.tube([[x,yy,z],[x+r*math.cos(ang),yy+sy*.16,z+r*math.sin(ang)]],.08 if m.level<3 else .12,'green',6 if m.level<2 else 4)
  elif kind=='compass':
   b(-.3,0,-.3,.3,.85,.3,'mahogany');m.tube([[x,y+sy*.82,z],[x,y+sy,z]],sx*.48,'brass');m.tube([[x,y+sy-.02,z],[x,y+sy-.005,z]],sx*.36,'screen')
  else:
   tag='cream' if kind in('laundry','galley','cold_store','bath') else 'mahogany'
   b(-.47,0,-.5,.47,1,.5,tag,.025)
   if m.level<3:
    if kind=='books':
     for shelf in range(4):
      for i in range(max(3,int(sz*5))):
       zz=-.46+i*.92/max(3,int(sz*5));b(.48,.08+shelf*.23,zz,.5,.25+shelf*.23,zz+.02,['navy','red','teak','green','cream'][i%5],0)
    else:
     for zz in(-.28,.28):
      front=-1 if x>0 else 1;a,bx=(-.5,-.47) if front<0 else(.47,.5);b(a,.42,zz-.025,bx,.60,zz+.025,'brass',.004)

def mast(m,mod):
 a=mod['art'];aa,bb=a['ends'];r=a['radius'];m.tube([aa,bb],r,'white', [20,12,8,6,4,4][m.level])
 if m.level<3:
  y0,y1=aa[1],bb[1];z=aa[2]
  for y in [y0+.12,y1-.12]:m.ring([0,y,z],[1,0,0],[0,0,1],r*.96,r*.96,.018,'steel')
  # A narrow luff track and fairlead details occupy the existing spar envelope.
  m.tube([[0,y0+.03,z-r*.96],[0,y1-.03,z-r*.96]],.016,'steel')
def boom(m,mod):
 lo,hi=worldbox(mod['boxes'][0],mod['origin']);y=(lo[1]+hi[1])/2
 m.tube([[0,y,lo[2]+.12],[0,y,hi[2]-.12]],.25,'white',[16,10,8,6,4,4][m.level])
 # Original stitched sail bundles lashed along the boom, kept inside the measured .76m beam.
 z0=lo[2]+.25;z1=hi[2]-.25;n=max(3,int((z1-z0)/1.4)) if m.level<3 else 2
 for i in range(n):
  za=z0+(z1-z0)*i/n;zb=z0+(z1-z0)*(i+1)/n;m.box([-.31,y+.08,za],[.31,hi[1]-.015,zb-.035],'fabric',.1)
  if m.level<2:m.box([-.32,y+.06,za+.08],[.32,hi[1]-.005,za+.15],'dark',.015)
def door(m,mod):
 lo,hi=worldbox(mod['boxes'][0],mod['origin']);axis=0 if hi[0]-lo[0]<hi[2]-lo[2] else 2;a=lo[:];b=hi[:];a[axis]+=.006;b[axis]-=.006;m.box(a,b,'mahogany',.008)
 if m.level<3:
  axis=0 if hi[0]-lo[0]<hi[2]-lo[2] else 2;along=2 if axis==0 else 0
  for sign in(-1,1):
   a=lo[:];b=hi[:];a[1]+=.18;b[1]-=.18;a[along]+=.1;b[along]-=.1
   if sign<0:b[axis]=a[axis]+.004
   else:a[axis]=b[axis]-.004
   m.box(a,b,'teak',.008)

def smallparts(m,mod):
 cat=mod['category'];o=mod['origin'];a=mod['art']
 if cat in('rigging','spreader'):m.tube(a['ends'],a['radius'],'steel' if cat=='rigging' else 'white');return
 if cat=='bowsprit':
  n=[20,12,8,6,4,4][m.level];m.loft([[[.245*math.cos(k*math.tau/n),p[1]+.245*math.sin(k*math.tau/n),p[2]] for k in range(n)] for p in(a['heel'],a['tip'])],'white');return
 if cat=='ornament':
  # Gilded intertwined fern scrolls at the bow, a compact original interpretation of the photographed ornament.
  for sign in(-1,1):
   points=[]
   for i in range(28 if m.level<2 else 12):
    t=i/(27 if m.level<2 else 11);points.append([sign*(1.65*(1-t)+.1),7.0+.26*math.sin(t*math.tau*1.5),49.6+4*t])
   m.tube(points,.028 if m.level<3 else .045,'brass')
  m.box([-.1,6.72,52.85],[.1,7.18,53.35],'brass',.04);return
 if cat=='flag':
  m.tube([[0,3.72,-51.475],[0,5.975,-51.475]],.024,'mahogany')
  n=10 if m.level<2 else 3;rings=[]
  for i in range(n+1):
   t=i/n;x=.7*t;z=-51.48-1.5*t+.06*math.sin(t*math.tau*2);ya=5.82-.22*t;yb=4.9-.1*t
   rings.append([[x-.008,ya,z],[x+.008,ya,z],[x+.008,yb,z],[x-.008,yb,z]])
  m.loft(rings,'red');return
 if cat=='pool':
  for b in mod['boxes']:box(m,b,o,'cream',.025)
  m.box([-1.98,a['waterY']-.025,-49.98],[1.98,a['waterY'],-43.02],'pool');return
 if cat=='canopy':
  for i,b in enumerate(mod['boxes']):box(m,b,o,'white' if i<len(mod['boxes'])-1 else 'cream',.02)
  return
 if cat=='gangway':
  box(m,mod['boxes'][0],o,'teak');rails(m,{**mod,'boxes':mod['boxes'][1:]});return
 if cat=='roof':
  for b in mod['boxes']:box(m,b,o,'cream',.03)
  return
 if cat=='floor':
  for h in mod['hulls']:
   ps=worldhull(h,o)
   if m.level==0:tiled_floor(m,ps)
   else:m.convex(ps,'teak')
  return
 for b in mod['boxes']:box(m,b,o,'cream')
 for h in mod['hulls']:m.convex(worldhull(h,o),'cream')

def tiled_floor(m,ps):
 # Four-metre physical repeat prevents a whole16m deck face stretching one teak tile.
 xz=list(set((p[0],p[2]) for p in ps));cx=sum(p[0] for p in xz)/len(xz);cz=sum(p[1] for p in xz)/len(xz)
 xz.sort(key=lambda p:math.atan2(p[1]-cz,p[0]-cx));za=min(p[2] for p in ps);zb=max(p[2] for p in ps)
 ya=max(p[1] for p in ps if abs(p[2]-za)<1e-5);yb=max(p[1] for p in ps if abs(p[2]-zb)<1e-5)
 def clip(poly,axis,value,sign):
  out=[]
  for p,q in zip(poly,poly[1:]+poly[:1]):
   ip=sign*(p[axis]-value)>=-1e-8;iq=sign*(q[axis]-value)>=-1e-8
   if ip:out.append(p)
   if ip!=iq:
    t=(value-p[axis])/(q[axis]-p[axis]);out.append(tuple(p[k]+t*(q[k]-p[k]) for k in range(2)))
  return out
 for xx in range(math.floor(min(p[0] for p in xz)/4),math.ceil(max(p[0] for p in xz)/4)):
  for zz in range(math.floor(za/4),math.ceil(zb/4)):
   poly=xz
   for axis,value,sign in[(0,xx*4,1),(0,(xx+1)*4,-1),(1,zz*4,1),(1,(zz+1)*4,-1)]:
    poly=clip(poly,axis,value,sign)
    if len(poly)<3:break
   if len(poly)<3:continue
   area=sum(p[0]*q[1]-q[0]*p[1] for p,q in zip(poly,poly[1:]+poly[:1]))
   if abs(area)<1e-6:continue
   verts=[[x,ya+(yb-ya)*(z-za)/(zb-za)-d,z] for d in(.2,0) for x,z in poly];m.convex(verts,'teak')

def plaques(m,mod):
 if mod['category']=='wall':
  for sign in D.get('signs',[]):
   room=next(r for r in D['rooms'] if r['id']==sign['room'])
   if mod['id']!=f"core:koru_room_{room['id']}_wall{room['entrySide'][0]}":continue
   p=sign['at'];axis=0 if sign['axis']=='z' else 2;along=2 if axis==0 else 0
   for side in(-1,1):
    lo=p[:];hi=p[:];lo[along]-=.30;hi[along]+=.30;lo[1]-=.125;hi[1]+=.125
    lo[axis]+=side*.075-.004;hi[axis]+=side*.075+.004
    m.box(lo,hi,'sign:'+sign['label'])
 if mod['category']=='facade':
  a=mod['art'];lo,hi=a['range']
  if a['deck']==2 and a['axis']=='z' and lo<=-20<hi:
   p=[a['fixed'],a['floorY']+.42,-20]
   m.box([p[0]-.088,p[1]-.15,p[2]-.75],[p[0]+.088,p[1]+.15,p[2]+.75],'sign:KORU')
 if mod['category']=='mast' and mod['art']['mast']=='main' and mod['art']['ends'][0][1]<1:
  for deck in D['decks']:
   y=deck['floorY']+1.65
   m.box([-.36,y-.11,-8.51],[.36,y+.11,-8.49],'sign:'+['LOWER DECK','MAIN DECK','UPPER DECK','SUN DECK'][deck['index']])

report={'modules':[],'totals':[0]*6,'notes':['Shared contract is authoritative; photos are references only.','Six authored levels retain clear circulation.']}
for k,mod in enumerate(MODS):
 counts=[]
 for level in range(6):
  m=Mesh(level);cat=mod['category']
  {'hull':hull,'facade':facade,'wall':wall,'stairs':staircase,'rail':rails,'furniture':furniture,'mast':mast,'boom':boom,'door':door}.get(cat,smallparts)(m,mod)
  plaques(m,mod)
  obj=m.object(mod['mesh'][5:]+('' if level==0 else '_LOD'+str(level)),mod['origin']);count=len(obj.data.polygons);counts.append(count);report['totals'][level]+=count
 report['modules'].append({'id':mod['id'],'triangles':counts})
 if k%50==0:print('koru authored',k+1,'/',len(MODS),flush=True)
(HERE/'ref/geometry-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('koru authored triangles:',report['totals'],flush=True)
