"""Koru from the layout author_layout.py writes: each 16 m cell of the ship one mesh in its anchor's frame, each door and
each sail part one of its own. A cell has five levels, all made here, since a cell is hundreds of separate solids the
pipeline's simplifier cannot thin (asset.ts states their errors): 0, everything, and 1, what is seen from outside, both
drawn with the atlas; 2 and 3, what is seen from outside at its plainest, flat in each finish's far colour, which are
the far mesh's two levels and so the yacht from the hand-over to the horizon; 4, a stand-in for the boot file.

Nothing here is taken from the reference photographs but proportions and finishes."""
import json,math
from pathlib import Path
from parts import AVG,FINISH,Mesh,cross,sub,unit
HERE=Path(__file__).resolve().parent
D=json.loads((HERE.parents[3]/'content/landmarks/koru-layout.json').read_text())
MODS=D['modules'];BYID={m['id']:m for m in MODS};WINDOWS={}
for w in D['windows']:WINDOWS.setdefault(w['module'],[]).append(w)
CLOTH={'sail':FINISH['sail']['rgb']};SPAR={'white':FINISH['white']['rgb']}
# The first level drawn flat, the stand-in level, and the sides round a mast or the bowsprit at each level.
FLAT=2;STAND_IN=4;SIDES=[24,12,8,6,4]
# A wire's radius on levels 0, 1 and 2: on level 0 the least, as on the rest.
RIG=[.03,.09,.2]

def worldbox(b,o):return ([o[k]+b['at'][k]-b['half'][k] for k in range(3)],[o[k]+b['at'][k]+b['half'][k] for k in range(3)])
def worldhull(h,o):return [[p[k]+o[k] for k in range(3)] for p in h['points']]
ST=D['hullStations']
def station(z):
 for a,b in zip(ST,ST[1:]):
  if a['z']-1e-7<=z<=b['z']+1e-7:
   t=(z-a['z'])/(b['z']-a['z']);return {k:a[k]+t*(b[k]-a[k]) for k in a}
 return ST[0] if z<ST[0]['z'] else ST[-1]
def hullwidth(z,y):
 a=station(z);return a['halfBeam']*(.9+.1*y/a['sheer'])
# The hull's half beam is straight between stations; its slope is shaded as the mean of the two either side at each
# station and eased between, so the glossy side shows no facets.
_G=[(b['halfBeam']-a['halfBeam'])/(b['z']-a['z']) for a,b in zip(ST,ST[1:])]
SLOPE=[_G[0]]+[(p+q)/2 for p,q in zip(_G,_G[1:])]+[_G[-1]]
def slope(z):
 for i,(a,b) in enumerate(zip(ST,ST[1:])):
  if a['z']-1e-7<=z<=b['z']+1e-7:return SLOPE[i]+(z-a['z'])/(b['z']-a['z'])*(SLOPE[i+1]-SLOPE[i])
 return SLOPE[0] if z<ST[0]['z'] else SLOPE[-1]
# Below the sheer the hull is sheared back from the plumb stem and stern into a raked clipper bow and an overhanging
# canoe stern, as the layout's hull is (author_layout.py `rakes`). Decks and rails keep the layout's ends.
RAKES=D['rakes']
def rake(z,y):
 d=0
 for z0,z1,r,p in RAKES:
  t=min(1,(z-z0)/(z1-z0))
  if t>0:d+=(r if z1<0 else -r)*t*t*(3-2*t)*max(0,1-y/station(z)['sheer'])**p
 return d
def raked(m,start):
 """The points made since `start` sheared by `rake`, and their normals with them."""
 for i in range(start,len(m.v)):
  x,y,z=m.v[i];d=rake(z,y)
  if d==0:continue
  m.v[i]=(x,y,z+d);n=m.n[i]
  if n is None or n==AVG:continue
  e=1e-3;a=(rake(z,y+e)-rake(z,y-e))/(2*e);b=1+(rake(z+e,y)-rake(z-e,y))/(2*e)
  m.n[i]=unit([n[0],n[1]-a/b*n[2],n[2]/b])
def on_hull(z,y,sign,off=.03):
 """A point `off` out from the hull's side at z and y, where the drawn hull is."""
 return [sign*(hullwidth(z,y)+off),y,z+rake(z,y)]

# The hull: an underbody, and each side a shell 24 cm thick, its outer face smooth, with round glazed ports. Between two
# stations a hull is straight fore and aft, so a coarser level loses no shape by dropping the columns between. The red
# boot stripe at the waterline is BOOT high, enough to show from 150 m.
PORT_R,PORT_Y,PORT_H,BOOT=.3,2.28,.45,.25
PORT_SIDES=[16,8,8,4,4]
def zipper(m,o,i,tag,out):
 """Two columns of points, outer and inner, bottom to top, joined by triangles."""
 s=m.add(o+i);a=b=0;tris=[]
 while a<len(o)-1 or b<len(i)-1:
  if b==len(i)-1 or (a<len(o)-1 and o[a+1][1]<=i[b+1][1]):tris.append((s+a,s+a+1,s+len(o)+b));a+=1
  else:tris.append((s+a,s+len(o)+b+1,s+len(o)+b));b+=1
 m.faces(0,tris,tag,out=out)
def hull(m,mod):
 a,b=mod['art']['stations'];za,zb=a[0],b[0];L=m.level
 k=max(1,round((zb-za)/3.4));ports=[za+(i+.5)*(zb-za)/k for i in range(k)] if L<STAND_IN and za>=-49 and zb<=44 and (zb-za)/k>.9 else []
 sides=PORT_SIDES[L]
 # A port of four sides is a square of the round one's area.
 radius,turn=(PORT_R*math.sqrt(math.pi/2),math.pi/4) if sides==4 else (PORT_R,0)
 cols={round(c+d,6) for c in ports for d in(-PORT_H,PORT_H)}|{za,zb}
 # Where the hull is raked, columns close enough for its curve.
 n=math.ceil((zb-za)/[1,1.5,2.5,3.5,5][L])
 cols=sorted(cols|{round(z,6) for z in [za+i*(zb-za)/n for i in range(1,n)] if rake(z,0)!=0 and all(abs(z-c)>PORT_H+.1 for c in ports)})
 first=len(m.v)
 # The stem rises to the sea at the bow; the underbody keeps a shallow V there.
 m.loft([[[-w*.9,0,z],[-w*.62,kk*.45,z],[0,kk,z],[w*.62,kk*.45,z],[w*.9,0,z]] for z in cols for w,kk in [(station(z)['halfBeam'],min(-.05,station(z)['keel']))]],'red')
 for sign in(-1,1):
  gate=sign>0 and mod['art']['gatePort']
  top=lambda z:min(station(z)['sheer'],3.75) if gate else station(z)['sheer']
  def x(z,y,inner):return sign*max(.01,hullwidth(z,y)-(.24 if inner else 0))
  def normal(z,y,inner):
   s=station(z);v=unit([sign,-.1*s['halfBeam']/s['sheer'],-slope(z)*(.9+.1*y/s['sheer'])])
   return [-c for c in v] if inner else v
  def port(z):return next((c for c in ports if abs(z-c)<PORT_H-1e-6),None)
  outer=[lambda z:[0,BOOT,PORT_Y-PORT_H,PORT_Y+PORT_H,top(z)-.09,top(z)-.055,top(z)],lambda z:[0,BOOT,PORT_Y-PORT_H,PORT_Y+PORT_H,top(z)-.06,top(z)],lambda z:[0,BOOT,PORT_Y-PORT_H,PORT_Y+PORT_H,top(z)],lambda z:[0,BOOT,top(z)]][max(0,L-1)]
  sheets=[(False,outer,[['red','navy','navy','navy','brass','teak'],['red','navy','navy','navy','teak'],['red','navy','navy','navy'],['red','navy']][max(0,L-1)],2)]
  sheets.append((True,(lambda z:[0,PORT_Y-PORT_H,PORT_Y+PORT_H,top(z)]) if L==0 else (lambda z:[0,top(z)]),['cream']*3,1 if L==0 else -1))
  for inner,rows,tags,band in sheets:
   out=(-sign if inner else sign,0,0)
   grid=[[[x(z,y,inner),y,z] for y in rows(z)] for z in cols]
   start=m.add([p for col in grid for p in col],[normal(p[2],p[1],inner) for col in grid for p in col]);R=len(grid[0])
   at=lambda c,r:start+c*R+r
   quads=[];qtags=[]
   for c in range(len(cols)-1):
    centre=port((cols[c]+cols[c+1])/2)
    for r in range(R-1):
     if centre is not None and r==band:continue
     quads.append((at(c,r),at(c+1,r),at(c+1,r+1),at(c,r+1)));qtags.append(tags[r])
   m.faces(0,quads,qtags,out=out)
   for c in range(len(cols)-1):
    centre=port((cols[c]+cols[c+1])/2)
    if centre is None or band<0:continue
    ring=[[x(centre+radius*math.cos(turn+i*math.tau/sides),PORT_Y+radius*math.sin(turn+i*math.tau/sides),inner),PORT_Y+radius*math.sin(turn+i*math.tau/sides),centre+radius*math.cos(turn+i*math.tau/sides)] for i in range(sides)]
    rs=m.add(ring,[normal(p[2],p[1],inner) for p in ring])
    corner={'ur':at(c+1,band+1),'ul':at(c,band+1),'ll':at(c,band),'lr':at(c+1,band)}
    q=sides//4;tris=[]
    for i in range(sides):tris.append((rs+i,rs+(i+1)%sides,corner[['ur','ul','ll','lr'][i//q]]))
    for side,(p0,p1) in enumerate([('lr','ur'),('ur','ul'),('ul','ll'),('ll','lr')]):tris.append((corner[p0],corner[p1],rs+side*q))
    m.faces(0,tris,tags[band],out=out)
    if inner:continue
    if L>0:
     # Off the quay a port is its glass on the shell, in the shell's own points.
     m.faces(0,[tuple(rs+i for i in range(sides))],'port',out=out);continue
    m.poly(ring,'port',out=out)
    inside=[[x(p[2],p[1],True),p[1],p[2]] for p in ring];bore=m.add(ring+inside)
    m.faces(bore,[(i,(i+1)%sides,sides+(i+1)%sides,sides+i) for i in range(sides)],'brass',
     out=lambda i:[0,-math.sin((i+.5)*math.tau/sides),-math.cos((i+.5)*math.tau/sides)])
  # Cap rail, the strip at the waterline, and the two ends.
  for y,tag,up in [(top,'teak',1),(lambda z:0,'navy',-1)]:
   strip=m.add([[x(z,y(z),inner),y(z),z] for z in cols for inner in(False,True)])
   m.faces(strip,[(2*c,2*c+2,2*c+3,2*c+1) for c in range(len(cols)-1)],tag,out=(0,up,0))
  for z,end in [(za,-1),(zb,1)]:zipper(m,[[x(z,y,False),y,z] for y in outer(z)],[[x(z,y,True),y,z] for y in sheets[1][1](z)],'navy',(0,0,end))
 raked(m,first)

# Decks: a slab whose top is laid in 2 m tiles of the teak picture, planks fore and aft, over a painted ceiling.
TEAK=2.0
def clip(poly,axis,value,keep):
 out=[]
 for p,q in zip(poly,poly[1:]+poly[:1]):
  ip=keep*(p[axis]-value)>=-1e-9;iq=keep*(q[axis]-value)>=-1e-9
  if ip:out.append(p)
  if ip!=iq:
   t=(value-p[axis])/(q[axis]-p[axis]);r=[p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])];r[axis]=value;out.append(tuple(r))
 return [p for i,p in enumerate(out) if p!=out[i-1]]
def slab(m,ps,thick=.2):
 za=min(p[2] for p in ps);zb=max(p[2] for p in ps)
 ya=max(p[1] for p in ps if abs(p[2]-za)<1e-5);yb=max(p[1] for p in ps if abs(p[2]-zb)<1e-5)
 xa=sorted({p[0] for p in ps if abs(p[2]-za)<1e-5});xb=sorted({p[0] for p in ps if abs(p[2]-zb)<1e-5})
 outline=[(xa[0],za),(xa[-1],za),(xb[-1],zb),(xb[0],zb)]
 # The outline cut wherever a tile's edge crosses it, so the tiles, the edges and the ceiling share every point.
 border=[]
 for p,q in zip(outline,outline[1:]+outline[:1]):
  cuts=[0]
  for axis in(0,1):
   if abs(q[axis]-p[axis])<1e-9:continue
   for g in range(math.floor(min(p[axis],q[axis])/TEAK)+1,math.ceil(max(p[axis],q[axis])/TEAK)):
    cuts.append((g*TEAK-p[axis])/(q[axis]-p[axis]))
  for t in sorted(set(cuts)):
   r=[p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]
   for axis in(0,1):
    g=round(r[axis]/TEAK)*TEAK
    if abs(r[axis]-g)<1e-7:r[axis]=g
   if not border or tuple(r)!=border[-1]:border.append(tuple(r))
 border=[p for i,p in enumerate(border) if p!=border[i-1]]
 y=lambda z:ya+(yb-ya)*(z-za)/(zb-za)
 for i in range(math.floor(min(p[0] for p in border)/TEAK),math.ceil(max(p[0] for p in border)/TEAK)):
  for j in range(math.floor(za/TEAK),math.ceil(zb/TEAK)):
   cell=border
   for axis,value,keep in [(0,i*TEAK,1),(0,(i+1)*TEAK,-1),(1,j*TEAK,1),(1,(j+1)*TEAK,-1)]:
    cell=clip(cell,axis,value,keep)
    if len(cell)<3:break
   if len(cell)<3 or abs(sum(p[0]*q[1]-q[0]*p[1] for p,q in zip(cell,cell[1:]+cell[:1])))<1e-6:continue
   uv=lambda p:((p[0]-i*TEAK)/TEAK,(p[1]-j*TEAK)/TEAK)
   if len(cell)==4 and all(abs(p[0]/TEAK-round(p[0]/TEAK))<1e-9 and abs(p[1]/TEAK-round(p[1]/TEAK))<1e-9 for p in cell):
    m.poly([[p[0],y(p[1]),p[1]] for p in cell],'teak',uv=[uv(p) for p in cell],out=(0,1,0))
   else:
    c=(sum(p[0] for p in cell)/len(cell),sum(p[1] for p in cell)/len(cell));pts=[c]+cell;s=m.add([[p[0],y(p[1]),p[1]] for p in pts])
    m.faces(s,[(0,k,k%len(cell)+1) for k in range(1,len(cell)+1)],'teak',uvs=[[uv(c),uv(cell[k-1]),uv(cell[k%len(cell)])] for k in range(1,len(cell)+1)],out=(0,1,0))
 n=len(border);s=m.add([[p[0],y(p[1]),p[1]] for p in border]+[[p[0],y(p[1])-thick,p[1]] for p in border])
 c=[sum(p[0] for p in border)/n,(ya+yb)/2-thick/2,sum(p[1] for p in border)/n]
 m.faces(s,[(k,(k+1)%n,n+(k+1)%n,n+k) for k in range(n)],'white',away=c)
 cb=(sum(p[0] for p in border)/n,sum(p[1] for p in border)/n);b=m.add([[cb[0],y(cb[1])-thick,cb[1]]]+[[p[0],y(p[1])-thick,p[1]] for p in border])
 m.faces(b,[(0,k,k%n+1) for k in range(1,n+1)],'ceiling',out=(0,-1,0))

def prism(m,ps,top='teak'):
 """A floor span as one solid: the eight points of its collider, its top in `top`."""
 c=[sum(p[k] for p in ps)/len(ps) for k in range(3)];s=m.add(ps)
 za=min(p[2] for p in ps);zb=max(p[2] for p in ps);xs=lambda z,hi:sorted([i for i,p in enumerate(ps) if abs(p[2]-z)<1e-5],key=lambda i:(ps[i][0],ps[i][1]))
 a=xs(za,0);b=xs(zb,0)
 # At each end, low and high x, each bottom then top.
 a0,a1,a2,a3=a;b0,b1,b2,b3=b
 m.faces(s,[(a1,a3,b3,b1),(a0,a2,b2,b0),(a0,a1,b1,b0),(a2,a3,b3,b2),(a0,a1,a3,a2),(b0,b1,b3,b2)],[top,'ceiling','white','white','white','white'],away=c)

def tube(m,points,r,tag,n=6):m.tube(points,r,tag,n)
def rail_segment(m,a,b,bottomA,bottomB,r=.023,mid=True,spacing=2):
 tube(m,[a,b],r,'chrome',6 if m.level==0 else 4)
 if mid:tube(m,[[a[k]*.45+bottomA[k]*.55 for k in range(3)],[b[k]*.45+bottomB[k]*.55 for k in range(3)]],.012,'chrome',4)
 if m.level>0:return
 n=max(1,math.ceil(math.dist(a,b)/spacing))
 for i in range(n+1):
  t=i/n;tube(m,[[bottomA[k]+(bottomB[k]-bottomA[k])*t for k in range(3)],[a[k]+(b[k]-a[k])*t-(.02 if k==1 else 0) for k in range(3)]],.02,'chrome',4)
def rails(m,mod,mid=True):
 # Rails are wires: drawn with the atlas, and none on a flat level.
 if m.level>=FLAT:return
 o=mod['origin']
 for b in mod['boxes']:
  lo,hi=worldbox(b,o);axis=0 if hi[0]-lo[0]>hi[2]-lo[2] else 2;a=[(lo[k]+hi[k])/2 for k in range(3)];c=a[:];a[axis]=lo[axis]+.025;c[axis]=hi[axis]-.025;a[1]=c[1]=hi[1]-.025;qa=a[:];qc=c[:];qa[1]=qc[1]=lo[1];rail_segment(m,a,c,qa,qc,mid=mid,spacing=2.2 if mid else 3.5)
 for h in mod['hulls']:
  ps=worldhull(h,o);ends=[]
  for z in(min(p[2] for p in ps),max(p[2] for p in ps)):
   e=[p for p in ps if abs(p[2]-z)<1e-4];x=(min(p[0] for p in e)+max(p[0] for p in e))/2;ends.append(([x,max(p[1] for p in e)-.025,z],[x,min(p[1] for p in e),z]))
  rail_segment(m,ends[0][0],ends[1][0],ends[0][1],ends[1][1],mid=mid,spacing=2.2 if mid else 3.5)

def flight(m,x0,x1,za,ya,zb,yb,n,thick=.3):
 """A flight of n steps from (za,ya) to (zb,yb), one closed solid: treads, risers, stringers and a sloped soffit."""
 if ya>yb:za,ya,zb,yb=zb,yb,za,ya
 run=(zb-za)/n;rise=(yb-ya)/n;sgn=1 if run>0 else -1;foot=(za,ya-.2);soffit=(zb,yb-thick)
 nose=[(za+i*run,ya+i*rise) for i in range(n+1)];up=[(za+i*run,ya+(i+1)*rise) for i in range(n)]
 for x,side in [(x0,-1),(x1,1)]:
  s=m.add([(x,p[1],p[0]) for p in [foot,soffit]+nose+up])
  m.faces(0,[(s,s+1,s+2)]+[(s+1,s+2+i,s+3+i) for i in range(n)]+[(s+2+i,s+3+n+i,s+3+i) for i in range(n)],'mahogany',out=(side,0,0))
 edges=[(foot,nose[0],'white',(0,0,-sgn))]
 for i in range(n):edges+=[(nose[i],up[i],'white',(0,0,-sgn)),(up[i],nose[i+1],'teak',(0,1,0))]
 edges+=[(nose[-1],soffit,'white',(0,0,sgn)),(soffit,foot,'ceiling',(0,-1,0))]
 for p,q,tag,out in edges:m.poly([(x0,p[1],p[0]),(x1,p[1],p[0]),(x1,q[1],q[0]),(x0,q[1],q[0])],tag,out=out)
def ramp(m,x0,x1,za,ya,zb,yb,thick=.3):
 """A flight far off: a sloped solid along its nosings."""
 if ya>yb:za,ya,zb,yb=zb,yb,za,ya
 m.convex([(x,y,z) for x in(x0,x1) for z,y in [(za,ya),(za,ya-.2),(zb,yb),(zb,yb-thick)]],'teak')
def staircase(m,mod):
 art=mod['art'];o=mod['origin']
 if 'flight' not in art:
  if art.get('poolExit'):
   for b in mod['boxes']:m.box(*worldbox(b,o),'teak')
  else:
   m.box(*worldbox(mod['boxes'][0],o),'white',top='teak')
   if m.level==0:rails(m,{**mod,'boxes':mod['boxes'][1:],'hulls':[]},mid=False)
  return
 (x0,y0,z0),(x1,y1,z1)=art['flight']
 if m.level>=FLAT:ramp(m,x0,x1,z0,y0,z1,y1);return
 flight(m,x0,x1,z0,y0,z1,y1,art['steps'])
 for x in(x0-.04,x1+.04):rail_segment(m,[x,y0+1.075,z0],[x,y1+1.075,z1],[x,y0,z0],[x,y1,z1],mid=False,spacing=3.5)
def steps(m,mod):
 art=mod['art'];o=mod['origin'];(x0,y0,z0),(x1,y1,z1)=art['flight']
 if m.level>=FLAT:
  m.convex(worldhull(mod['hulls'][0],o),'teak');m.box(*worldbox(mod['boxes'][0],o),'white',top='teak');return
 flight(m,x0,x1,z0,y0,z1,y1,round((y1-y0)/art['riser']))
 m.box(*worldbox(mod['boxes'][0],o),'white',top='teak')
 zg=art['guardFromZ'];yg=y0+(y1-y0)*(zg-z0)/(z1-z0)
 for x in(x0-.04,x1+.04):
  rail_segment(m,[x,yg+1.075,zg],[x,y1+1.075,z1],[x,yg,zg],[x,y1,z1]);rail_segment(m,[x,y1+1.075,z1],[x,y1+1.075,-53.55],[x,y1,z1],[x,y1,-53.55])
  # A strut from the stern post carries the flight.
  tube(m,[[x*.1,.3,-54.45+rake(-54.45,.3)],[x*.6,y0+(y1-y0)*(-58.6-z0)/(z1-z0)-.35,-58.6]],.06,'chrome',6 if m.level==0 else 4)

def facade(m,mod):
 """A deckhouse wall, one solid: white, its windows dark glass seen from outside only, clear from within. Off the quay
 the glass is flush in the wall's outer face, the inner face is plain, and an open doorway is shut with glass, which is
 how it looks from outside."""
 a=mod['art'];y=a['floorY'];lo,hi=a['range'];axis=a['axis'];fixed=a['fixed'];d=.09;L=m.level
 o=(1 if fixed>0 else -1) if axis=='z' else (-1 if '_aft_' in mod['id'] else 1)
 def P(t,yy,side):return [fixed+side*d,yy,t] if axis=='z' else [t,yy,fixed+side*d]
 def along(v):return (0,0,v) if axis=='z' else (v,0,0)
 across=(o,0,0) if axis=='z' else (0,0,o)
 wins=sorted(WINDOWS.get(mod['id'],[]),key=lambda w:w['range'][0])
 if L>0:
  rows=[y,y+2.6,y+2.8] if a['portal'] else [y,y+.75,y+2.35,y+2.8] if wins else [y,y+2.8]
  cuts=[lo]+[v for w in wins for v in w['range']]+[hi]
  grid=[[P(t,yy,o) for yy in rows] for t in cuts];R=len(rows);s=m.add([p for col in grid for p in col])
  at=lambda c,r:s+c*R+r;quads=[];tags=[]
  for c in range(len(cuts)-1):
   for r in range(R-1):
    quads.append((at(c,r),at(c+1,r),at(c+1,r+1),at(c,r+1)));tags.append('glass' if (a['portal'] and r==0) or (R==4 and r==1 and c%2==1) else 'white')
  m.faces(0,quads,tags,out=across)
  # The rest of the solid shares the outer face's edges: the top and bottom fanned from the inner corners, the ends
  # likewise, and the inner face one quad.
  inner=m.add([P(lo,y,-o),P(hi,y,-o),P(hi,y+2.8,-o),P(lo,y+2.8,-o)])
  m.faces(inner,[(0,1,2,3)],'cream',out=[-v for v in across])
  for r,k,up in [(0,0,-1),(R-1,3,1)]:
   m.faces(0,[(inner+k,at(c,r),at(c+1,r)) for c in range(len(cuts)-1)]+[(inner+k,at(len(cuts)-1,r),inner+(1 if k==0 else 2))],'white',out=(0,up,0))
  for c,(b,t),v in [(0,(0,3),-1),(len(cuts)-1,(1,2),1)]:
   m.faces(0,[(inner+b,at(c,r),at(c,r+1)) for r in range(R-1)]+[(inner+b,at(c,R-1),inner+t)],'white',out=along(v))
  return
 if a['portal']:rows=[y+2.6,y+2.8]
 else:rows=[y,y+.75,y+2.35,y+2.8] if wins else [y,y+2.8]
 cuts=[lo]+[v for w in wins for v in w['range']]+[hi]
 band=len(rows)==4
 def glass(c):return band and c%2==1
 for side,tag in [(o,'white'),(-o,'cream')]:
  grid=[[P(t,yy,side) for yy in rows] for t in cuts];R=len(rows);s=m.add([p for col in grid for p in col])
  at=lambda c,r:s+c*R+r;quads=[];tags=[]
  for c in range(len(cuts)-1):
   for r in range(R-1):
    if glass(c) and r==1:continue
    quads.append((at(c,r),at(c+1,r),at(c+1,r+1),at(c,r+1)));tags.append(tag)
  m.faces(0,quads,tags,out=[v*side*o for v in across])
  if side==o:
   for c in range(len(cuts)-1):
    if glass(c):m.faces(0,[(at(c,1),at(c+1,1),at(c+1,2),at(c,2))],'glass',out=across)
 for c in range(len(cuts)-1):
  for yy,up in [(rows[0],-1),(rows[-1],1)]:m.poly([P(cuts[c],yy,o),P(cuts[c+1],yy,o),P(cuts[c+1],yy,-o),P(cuts[c],yy,-o)],'white',out=(0,up,0))
  if glass(c):
   for yy,up in [(rows[1],1),(rows[2],-1)]:m.poly([P(cuts[c],yy,o),P(cuts[c+1],yy,o),P(cuts[c+1],yy,-o),P(cuts[c],yy,-o)],'white',out=(0,up,0))
   for t,v in [(cuts[c],1),(cuts[c+1],-1)]:m.poly([P(t,rows[1],o),P(t,rows[2],o),P(t,rows[2],-o),P(t,rows[1],-o)],'white',out=along(v))
 for t,v in [(lo,-1),(hi,1)]:
  for r in range(len(rows)-1):m.poly([P(t,rows[r],o),P(t,rows[r+1],o),P(t,rows[r+1],-o),P(t,rows[r],-o)],'white',out=along(v))
def wall(m,mod):
 for part in mod['boxes']:
  lo,hi=worldbox(part,mod['origin']);axis=0 if hi[0]-lo[0]<hi[2]-lo[2] else 2
  if hi[1]-lo[1]>1:
   top=min(hi[1],lo[1]+.85);h=hi[:];h[1]=top;m.box(lo,h,'mahogany')
   a=lo[:];b=hi[:];a[1]=top;a[axis]+=.012;b[axis]-=.012;m.box(a,b,'cream')
  else:m.box(lo,hi,'cream')
def bulkhead(m,mod):
 for h in mod['hulls']:m.convex(worldhull(h,mod['origin']),'cream')
 z0,z1=mod['art']['z'];face,side=(z1,1) if z1<0 else (z0,-1);w=hullwidth(face,.75)-.4
 m.box([-w,.75,min(face,face+side*.012)],[w,1.6,max(face,face+side*.012)],'mahogany')

def furniture(m,mod):
 for item in mod['art']['items']:
  kind=item['kind'];x,y,z=item['at'];sx,sy,sz=item['size']
  def b(ax,ay,az,bx,by,bz,tag='mahogany',top=None):m.box([x+ax*sx,y+ay*sy,z+az*sz],[x+bx*sx,y+by*sy,z+bz*sz],tag,top=top)
  def cushion(ax,az,bx,bz,ay=.28,by=.54):b(ax,ay,az,bx,by,bz,'fabric')
  if m.level>1:
   b(-.5,0,-.5,.5,1,.5,{'winch':'chrome','cleat':'chrome','tub':'cream','lounger':'fabric','sofa':'fabric','compass':'brass','bar':'mahogany','deck_hatch':'teak'}.get(kind,'mahogany'));continue
  if kind in('winch','cleat','deck_hatch'):
   if kind=='deck_hatch':b(-.5,0,-.5,.5,.7,.5,'steel');b(-.46,.7,-.46,.46,1,.46,'teak')
   elif kind=='winch':
    for ya,yb,r,tag in[(0,.15,.49,'chrome'),(.15,.78,.30,'navy'),(.78,1,.42,'chrome')]:m.tube([[x,y+sy*ya,z],[x,y+sy*yb,z]],min(sx,sz)*r,tag,12)
   else:
    b(-.4,0,-.25,.4,.12,.25,'chrome')
    for ax in(-.24,.24):m.tube([[x+ax*sx,y+sy*.1,z],[x+ax*sx,y+sy*.7,z]],.045,'chrome',6)
    m.tube([[x-sx*.45,y+sy*.7,z],[x+sx*.45,y+sy*.7,z]],.055,'chrome',6)
  elif kind in('table','dining','desk','chart','workbench','vanity'):
   b(-.5,.88,-.5,.5,.96 if kind in('chart','dining') else 1,.5,'slate' if kind=='workbench' else 'mahogany')
   for ax in(-.39,.39):
    for az in(-.39,.39):b(ax-.035,0,az-.035,ax+.035,.88,az+.035)
   if kind in('desk','workbench','vanity'):b(-.48,.15,-.45,-.18,.86,.45);b(.18,.15,-.45,.48,.86,.45)
   if kind=='chart':b(-.44,.96,-.43,.44,1,.43,'mahogany',top='screen')
  elif kind in('sofa','armchair','bench','lounger','helm_chair'):
   b(-.46,0,-.46,.46,.42,.46);cushion(-.49,-.47,.49,.46,.39,.63)
   if kind=='lounger':b(-.47,.58,.15,.47,1,.46,'fabric')
   elif kind=='helm_chair':b(-.48,.50,-.48,.48,1,-.25,'fabric');b(-.5,.5,-.3,-.37,.65,.32);b(.37,.5,-.3,.5,.65,.32)
   elif kind!='bench':
    if sz>sx:
     a,bx=(.29,.5) if x>0 else(-.5,-.29)
     b(a,.45,-.5,bx,1,.5,'fabric');b(-.48,.45,-.5,.48,.84,-.37,'fabric');b(-.48,.45,.37,.48,.84,.5,'fabric')
    else:b(-.5,.45,.28,.5,1,.5,'fabric');b(-.5,.45,-.45,-.36,.84,.4,'fabric');b(.36,.45,-.45,.5,.84,.4,'fabric')
  elif kind in('bed','bunk'):
   b(-.49,0,-.49,.49,.35,.49);b(-.48,.34,-.48,.48,.67,.48,'white');b(-.49,.67,-.48,.49,.75,.18,'rug');b(-.5,.2,.42,.5,1,.5)
   cushion(-.41,.21,-.02,.42,.68,.85);cushion(.02,.21,.41,.42,.68,.85)
   if kind=='bunk':
    b(-.49,.65,-.49,.49,.69,.49);b(-.48,.69,-.48,.48,.83,.48,'white')
    for ax in(-.47,.47):b(ax-.025,.35,.445,ax+.025,1,.495)
  elif kind in('chairs','stools'):
   n=max(2,round(sz/1.3))
   for i in range(n):
    zz=z-sz/2+(i+.5)*sz/n;w=min(sx,.62);d=min(.62,sz/n*.8)
    m.box([x-.04,y,zz-.04],[x+.04,y+sy*.58,zz+.04],'brass');m.box([x-w/2,y+sy*.58,zz-d/2],[x+w/2,y+sy*.76,zz+d/2],'fabric')
    if kind=='chairs':m.box([x-w/2,y+sy*.7,zz+d*.29],[x+w/2,y+sy,zz+d*.49],'mahogany')
  elif kind=='tub':
   b(-.5,0,-.5,.5,.15,.5,'cream');b(-.5,.12,-.5,-.38,1,.5,'cream',top='teak');b(.38,.12,-.5,.5,1,.5,'cream',top='teak')
   b(-.38,.12,-.5,.38,1,-.38,'cream',top='teak');b(-.38,.12,.38,.38,1,.5,'cream',top='teak');b(-.38,.40,-.38,.38,.43,.38,'pool')
  elif kind=='helm':
   b(-.48,0,.12,.48,.82,.47);b(-.5,.78,-.5,.5,.9,.5)
   for i in range(3):
    cx=x+sx*(-.32+i*.32);m.box([cx-sx*.12,y+sy*.87,z-sz*.49],[cx+sx*.12,y+sy,z-sz*.33],'dark',top='screen')
   m.tube([[x,y+sy*.68,z-sz*.40],[x,y+sy*.68,z-sz*.36]],.2,'mahogany',12)
  elif kind=='treadmill':b(-.5,0,-.5,.5,.22,.5,'dark');b(-.47,.18,.32,-.40,.86,.44,'steel');b(.40,.18,.32,.47,.86,.44,'steel');b(-.48,.82,.25,.48,1,.46,'dark')
  elif kind=='machinery':
   b(-.49,0,-.49,.49,.84,.49,'cream');b(-.38,.84,-.36,.38,1,.36,'slate')
   for i in range(4):b(-.44,.22+i*.11,-.50,.44,.25+i*.11,-.49,'dark')
  elif kind in('weights','tools'):
   b(-.46,0,-.45,.46,.96,.45)
   for i in range(4):b(-.44,.15+i*.2,-.5,.44,.19+i*.2,-.46,'steel')
  elif kind=='piano':
   b(-.5,0,-.2,.5,.66,.48,'navy');b(-.5,.2,-.48,.5,.58,-.2,'navy');b(-.5,.6,.25,.5,1,.5,'navy');b(-.45,.58,-.5,.45,.64,-.24,'white')
  elif kind=='planter':
   b(-.38,0,-.38,.38,.43,.38,'cream',top='dark')
   # A clipped shrub: three overlapping leafy masses.
   for dx,dy,dz,r in[(0,.62,0,.34),(.12,.82,.06,.24),(-.1,.9,-.08,.2)]:
    cx,cy,cz=x+dx*sx,y+dy*sy,z+dz*sz
    m.convex([[cx+r*math.cos(i*2.39996)*math.sin(math.acos(1-2*(i+.5)/14)),cy+r*(1-2*(i+.5)/14),cz+r*math.sin(i*2.39996)*math.sin(math.acos(1-2*(i+.5)/14))] for i in range(14)],'green')
  elif kind=='compass':
   b(-.3,0,-.3,.3,.85,.3);m.tube([[x,y+sy*.82,z],[x,y+sy,z]],sx*.48,'brass',12);m.tube([[x,y+sy-.02,z],[x,y+sy-.005,z]],sx*.36,'screen',12)
  else:
   tag='cream' if kind in('laundry','galley','cold_store','bath') else 'mahogany'
   b(-.47,0,-.5,.47,1,.5,tag,top='slate' if kind=='galley' else None)
   if kind=='books':
    for shelf in range(4):
     for i in range(4):b(.47,.08+shelf*.23,-.46+i*.23,.5,.25+shelf*.23,-.25+i*.23,['navy','red','teak','green'][(i+shelf)%4])
   else:
    a,bx=(-.5,-.47) if x>0 else(.47,.5)
    for zz in(-.28,.28):b(a,.42,zz-.025,bx,.60,zz+.025,'brass')

# On the farthest level no length of mast is under 80 cm across: a third of a pixel at 2 km on a 1,080-row screen, more
# than the quarter of a pixel a card's four samples always catch, so a mast reads as a line and not as dashes.
FAR_MAST=.4
def mast(m,mod):
 a=mod['art'];aa,bb=a['ends'];r=max(a['radius'],FAR_MAST) if m.level>=3 else a['radius'];m.tube([aa,bb],r,'white',SIDES[m.level])
 if m.level:return
 z=aa[2]
 for y in [aa[1]+.12,bb[1]-.12]:m.tube([[0,y-.02,z],[0,y+.02,z]],r+.02,'chrome',16)
 m.box([-.016,aa[1]+.03,z-r-.012],[.016,bb[1]-.03,z-r+.02],'chrome')
# A boom and the cover its sail furls into, one smooth solid along it: round below as the boom, its sides rising to a
# round top over the furled sail and its gaff. Metres from the boom's line: the boom's radius, how high the top's centre
# stands, and the top's radius.
BOOM_R,COVER_Y,COVER_R=.38,1.05,.32
def boom(m,mod):
 lo,hi=worldbox(mod['boxes'][0],mod['origin']);y=(lo[1]+hi[1])/2;z0,z1=lo[2]+.12,hi[2]-.12;n=max(8,SIDES[m.level])
 under=n//2;over=n-under-2
 def ring(z,s):
  pts=[(BOOM_R*math.cos(-math.pi*k/under),BOOM_R*math.sin(-math.pi*k/under)) for k in range(under+1)]
  pts+=[(COVER_R*math.cos(math.pi-math.pi*k/over),COVER_Y+COVER_R*math.sin(math.pi-math.pi*k/over)) for k in range(over+1)]
  return [[s*px,y+s*py,z] for px,py in pts]
 # Its after end rounds off; its forward end meets the mast.
 ends=[(z0,.45),(z0+.15,.8),(z0+.45,.96),(z0+1,1),(z1,1)] if m.level==0 else [(z0,.6),(z0+.4,1),(z1,1)] if m.level==1 else [(z0,1),(z1,1)]
 m.loft([ring(z,s) for z,s in ends],'white',smooth=m.level<FLAT)
def door(m,mod):
 lo,hi=worldbox(mod['boxes'][0],mod['origin']);axis=0 if hi[0]-lo[0]<hi[2]-lo[2] else 2;along=2 if axis==0 else 0
 a=lo[:];b=hi[:];a[axis]+=.006;b[axis]-=.006;m.box(a,b,'mahogany')
 for sign in(-1,1):
  p=lo[:];q=hi[:];p[1]+=.18;q[1]-=.18;p[along]+=.1;q[along]-=.1
  if sign<0:p[axis]=a[axis]-.004;q[axis]=a[axis]
  else:p[axis]=b[axis];q[axis]=b[axis]+.004
  m.box(p,q,'teak')

DOME_R=.9
def dome(m,c):
 """A radome: a sphere, smooth in rings near and a few flat faces far."""
 rows,n=[(8,16),(4,8),(3,6),(2,4)][m.level]
 rings=[[[c[0]+DOME_R*math.sin(math.pi*(i+1)/(rows+1))*math.cos(k*math.tau/n),c[1]-DOME_R*math.cos(math.pi*(i+1)/(rows+1)),c[2]+DOME_R*math.sin(math.pi*(i+1)/(rows+1))*math.sin(k*math.tau/n)] for k in range(n)] for i in range(rows)]
 if m.level<FLAT:m.loft(rings,'white',smooth=True)
 else:m.convex([p for r in rings for p in r]+[[c[0],c[1]-DOME_R,c[2]],[c[0],c[1]+DOME_R,c[2]]],'white')
def plaque(m,lo,hi,label):m.box(lo,hi,'sign:'+label)
def smallparts(m,mod):
 cat=mod['category'];o=mod['origin'];a=mod['art'];L=m.level
 if cat=='sail_control':
  x,y,z=o;m.box([x-.25,y,z-.25],[x+.25,y+.66,z+.25],'cream')
  if L:return
  m.tube([[x,y+.66,z],[x,y+.87,z]],.31,'brass',12);m.tube([[x,y+.87,z],[x,y+.90,z]],.28,'white',12)
  for xx,tag in [(-.12,'green'),(.12,'red')]:m.tube([[x+xx,y+.90,z-.10],[x+xx,y+.92,z-.10]],.055,tag,8)
  plaque(m,[x-.2,y+.68,z-.262],[x+.2,y+.84,z-.25],'SAILS');return
 if cat=='rigging':
  # The rig thins and pales as it goes off, and is gone by the third level, with no step: on each level a wire is about
  # two thirds of a pixel across where that level is last drawn on high, which no wire below a pixel's width is at four
  # samples a pixel without breaking into dashes, and as much paler as it is wider than the wire, so it shows about as
  # much as the wire would. Near it is dark against the sky, as photographed. The diamonds go first, then the shrouds,
  # toppings and interstays; the forestays and the mizzen backstays, the long diagonals of the schooner, go last.
  heavy=any(k in mod['id'] for k in('forestay','backstay'))
  if L==0:m.tube(a['ends'],max(a['radius'],RIG[0]),'slate',6)
  elif L==1 and 'diamond' not in mod['id']:m.tube(a['ends'],RIG[1],'wire',4)
  elif L==2 and heavy:m.tube(a['ends'],RIG[2],'wire_far',4)
  return
 if cat=='spreader':
  m.tube(a['ends'],a['radius'],'white',[8,4,4,3,3][L])
  # The fore and mizzen masts carry a pair of white radomes on their lowest spreaders, as photographed.
  if mod['id'].endswith('_31') and '_main_' not in mod['id'] and L<STAND_IN:
   (x0,y,z),(x1,_,_)=a['ends']
   for x in(x0*.58,x1*.58):dome(m,[x,y+a['radius']+DOME_R,z])
  return
 if cat=='bowsprit':
  n=SIDES[L];m.loft([[[.245*math.cos(k*math.tau/n),p[1]+.245*math.sin(k*math.tau/n),p[2]] for k in range(n)] for p in(a['heel'],a['tip'])],'white',smooth=L<FLAT);return
 if cat=='ornament':
  # Gilded fern scrolls on the bow under the cap rail, an original reading of the photographed carving: a waved stem
  # with fronds curling off it, and a pair curled at the stem head. Far off, the band they make.
  if L==3:return
  for sign in(-1,1):
   sheer=lambda z:station(z)['sheer']
   stem=[(z,sheer(z)-.62+.1*math.sin((z-46.6)*1.3)) for z in [46.6+i*(53.9-46.6)/(23 if L==0 else 9) for i in range((24 if L==0 else 10))]]
   if L==2:m.tube([on_hull(z,y,sign,.05) for z,y in stem[::3]],.09,'brass',3,across=(sign,0,0));continue
   m.tube([on_hull(z,y,sign) for z,y in stem],.045,'brass',6 if L==0 else 4,across=(sign,0,0))
   for k,(zc,up) in enumerate([(47.6,1),(49.2,-1),(50.8,1),(52.3,-1),(53.8,1)]):
    yc=sheer(zc)-.62+.1*math.sin((zc-46.6)*1.3)+up*.2;r0=.24 if k<4 else .2;turn=-1 if k==4 else 1
    curl=[(zc+turn*r0*(1-t/(3*math.pi))*math.sin(t),yc-up*r0*(1-t/(3*math.pi))*math.cos(t)) for t in [i*2.2*math.pi/(17 if L==0 else 7) for i in range(18 if L==0 else 8)]]
    m.tube([on_hull(z,y,sign) for z,y in curl],.03,'brass',6 if L==0 else 4,across=(sign,0,0))
  return
 if cat=='flag':
  sx,sy,sz=a['staff'];m.tube([[sx,sy,sz],[sx,5.975,sz]],.024,'mahogany',[6,4,3,3][L])
  rings=[]
  for i in range(9 if L<FLAT else 2):
   t=i/(8 if L<FLAT else 1);x=sx-.7*t;z=sz-1.5*t+.06*math.sin(t*math.tau*2);ya=5.82-.22*t;yb=4.9-.1*t
   rings.append([[x-.008,ya,z],[x+.008,ya,z],[x+.008,yb,z],[x-.008,yb,z]])
  m.loft(rings,'red');return
 if cat=='pool':
  for b in mod['boxes']:m.box(*worldbox(b,o),'cream',top='teak')
  m.box([-1.98,a['waterY']-.025,-49.98],[1.98,a['waterY'],-43.02],'pool');return
 if cat=='canopy':
  for i,b in enumerate(mod['boxes']):
   if i==len(mod['boxes'])-1:m.box(*worldbox(b,o),'canvas')
   elif L<3:lo,hi=worldbox(b,o);m.tube([[(lo[0]+hi[0])/2,lo[1],(lo[2]+hi[2])/2],[(lo[0]+hi[0])/2,hi[1],(lo[2]+hi[2])/2]],.05,'white',8 if L<FLAT else 4)
  return
 if cat=='gangway':
  if L>2:return
  m.box(*worldbox(mod['boxes'][0],o),'white',top='teak');rails(m,{**mod,'boxes':mod['boxes'][1:],'hulls':[]});return
 if cat=='roof':
  for b in mod['boxes']:m.box(*worldbox(b,o),'white')
  return
 if cat=='floor':
  for h in mod['hulls']:(slab if L==0 else prism)(m,worldhull(h,o))
  return
 for b in mod['boxes']:m.box(*worldbox(b,o),'cream')
 for h in mod['hulls']:m.convex(worldhull(h,o),'cream')

def plaques(m,mod):
 if m.level:return
 if mod['category']=='wall':
  for sign in D['signs']:
   room=next(r for r in D['rooms'] if r['id']==sign['room'])
   if mod['id']!=f"koru:room_{room['id']}_wall{room['entrySide'][0]}":continue
   p=sign['at'];axis=0 if sign['axis']=='z' else 2;along=2 if axis==0 else 0
   for side in(-1,1):
    lo=p[:];hi=p[:];lo[along]-=.30;hi[along]+=.30;lo[1]-=.12;hi[1]+=.12;lo[axis]+=side*.08-.004;hi[axis]+=side*.08+.004
    plaque(m,lo,hi,sign['label'])
 if mod['category']=='facade':
  a=mod['art'];lo,hi=a['range']
  if a['deck']==2 and a['axis']=='z' and lo<=-20<hi:
   c=max(lo+.77,min(hi-.77,-20));p=[a['fixed'],a['floorY']+.42,c];plaque(m,[p[0]-.1,p[1]-.15,c-.75],[p[0]+.1,p[1]+.15,c+.75],'KORU')
 if mod['category']=='mast' and mod['art']['mast']=='main' and mod['art']['ends'][0][1]<1:
  for deck in D['decks']:
   y=deck['floorY']+1.65;z=mod['art']['ends'][0][2]-mod['art']['radius']
   plaque(m,[-.3,y-.12,z-.012],[.3,y+.12,z+.03],['LOWER DECK','MAIN DECK','UPPER DECK','SUN DECK'][deck['index']])

# The coarser levels draw what is seen from outside: behind the white walls and the dark glass the rooms are not. A
# stair is drawn where its well opens on an open deck, so the well is not a hole.
OPEN={r['id'] for r in D['rooms'] if r['deck']==3 or r['id'] in('aft_pool_deck','aft_terrace','foredeck')}
def open_well(mod):
 a=mod['art'];o=mod['origin']
 top=max(a['flight'][0][1],a['flight'][1][1]) if 'flight' in a else o[1]+1.05
 return top>9.7 or (top>6.7 and o[2]>19)
def outside(mod):
 cat,a=mod['category'],mod['art']
 if cat in('wall','bulkhead'):return False
 if cat=='stairs':return a.get('poolExit',False) or open_well(mod)
 if cat=='furniture':return a['room'] in OPEN
 if cat=='rail':return 'stairOpening' not in a or a['deck']==3 or a['stairOpening']=='forward_2'
 if cat=='floor':return a['deck']>0
 return True
def stand_in(m,members):
 """The coarsest level, the one a landmark's boot file holds, drawn only until the others have come: per deck a
 deckhouse block and a deck slab, and the hull, masts, booms and bowsprit at their plainest."""
 for d in(1,2):
  fs=[x for x in members if x['category']=='facade' and x['art']['deck']==d]
  if not fs:continue
  xs=[abs(x['art']['fixed']) for x in fs if x['art']['axis']=='z'];zs=[v for x in fs for v in (x['art']['range'] if x['art']['axis']=='z' else [x['art']['fixed']])]
  w=max(xs) if xs else max(abs(v) for x in fs for v in x['art']['range']);y=fs[0]['art']['floorY']
  m.box([-w-.09,y,min(zs)-.09],[w+.09,y+2.8,max(zs)+.09],'white')
 for d in(1,2,3):
  ps=[p for x in members if x['category']=='floor' and x['art']['deck']==d for h in x['hulls'] for p in worldhull(h,x['origin'])]
  if not ps:continue
  ends=[]
  for z in(min(p[2] for p in ps),max(p[2] for p in ps)):
   e=[p for p in ps if abs(p[2]-z)<1e-5];w=max(abs(p[0]) for p in e);y=max(p[1] for p in e);ends+=[[x,yy,z] for x in(-w,w) for yy in(y-.2,y)]
  prism(m,ends)
 for x in members:
  if x['category'] in('hull','mast','boom','bowsprit','roof','canopy','steps'):DRAW.get(x['category'],smallparts)(m,x)

DRAW={'hull':hull,'facade':facade,'wall':wall,'stairs':staircase,'steps':steps,'rail':lambda m,x:rails(m,x,'stairOpening' not in x['art']),'furniture':furniture,'mast':mast,'boom':boom,'bulkhead':bulkhead}
PALETTE={k:v['rgb'] for k,v in FINISH.items()}
for cell in D['cells']:
 members=[x for x in MODS if x.get('cell')==cell['id']];name=cell['id'][5:];origin=BYID[cell['anchor']]['origin']
 for level in range(STAND_IN+1):
  m=Mesh(flat=PALETTE if level>=FLAT else None);m.level=level
  if level==STAND_IN:stand_in(m,members)
  else:
   for x in members:
    if level==0 or outside(x):DRAW.get(x['category'],smallparts)(m,x);plaques(m,x)
  obj=m.object(name+(f'_LOD{level}' if level else ''),origin)
  print('koru',cell['id'],'level',level,len(obj.data.polygons),'triangles',flush=True)
for x in MODS:
 if x['category']=='door':m=Mesh();m.level=0;door(m,x);m.object(x['id'][5:],x['origin'])

# Sails: each part about its pivot, in the frame of its set placement. A sheet is drawn from both sides.
def qrotate(q,v):
 x,y,z,w=q;t=[2*(y*v[2]-z*v[1]),2*(z*v[0]-x*v[2]),2*(x*v[1]-y*v[0])]
 return [v[0]+w*t[0]+y*t[2]-z*t[1],v[1]+w*t[1]+z*t[0]-x*t[2],v[2]+w*t[2]+x*t[1]-y*t[0]]
CONTROL=BYID[D['motion']['static']]['origin']
PLACE={p['mesh']:p['to'] for p in D['motion']['parts']}
def pivot(mesh,p):
 to=PLACE[mesh];q=to.get('turn',[0,0,0,1]);d=[p[k]-CONTROL[k]-to['at'][k] for k in range(3)]
 return qrotate([-q[0],-q[1],-q[2],q[3]],d)
def sheet(m,grid,out,camber,batten=None):
 """Rows of points across a sail, cambered along `out`, as two faces back to back. Drawn with the atlas, each row is a
 panel of sailcloth, and a row `batten` names carries a batten."""
 rows=len(grid);cols=len(grid[0])
 pts=[[p[k]+out[k]*camber(i,j) for k in range(3)] for i,row in enumerate(grid) for j,p in enumerate(row)]
 def normal(i,j):
  at=lambda a,b:pts[a*cols+b]
  du=sub(at(i,min(cols-1,j+1)),at(i,max(0,j-1)));dv=sub(at(min(rows-1,i+1),j),at(max(0,i-1),j));n=unit(cross(du,dv))
  return n if sum(a*b for a,b in zip(n,out))>0 else [-a for a in n]
 ns=[normal(i,j) for i in range(rows) for j in range(cols)]
 cells=[(i,j) for i in range(rows-1) for j in range(cols-1)]
 quads=[(i*cols+j,i*cols+j+1,(i+1)*cols+j+1,(i+1)*cols+j) for i,j in cells]
 for side in(1,-1):
  s=m.add(pts,[[side*c for c in n] for n in ns])
  if m.flat:m.faces(s,quads,'sail',out=[side*c for c in out]);continue
  m.faces(s,quads,['batten' if batten and batten(i) else 'sail' for i,j in cells],uvs=[[(j/(cols-1),0),((j+1)/(cols-1),0),((j+1)/(cols-1),1),(j/(cols-1),1)] for i,j in cells],out=[side*c for c in out])
# A sail's levels: drawn with the atlas near, then two flat. Rows and columns of a gaff sail, rows of a jib.
GAFF_GRIDS=[(9,25),(6,9),(4,6)];JIB_ROWS=[18,8,5]
for s in D['rig']['sails']:
 if s['kind']=='gaff':
  corners=[pivot(s['sheet'],s[k]) for k in('tack','clew','throat','peak')]
  for level,(ns,nt) in enumerate(GAFF_GRIDS):
   grid=[[[(1-t)*((1-u)*corners[0][k]+u*corners[1][k])+t*((1-u)*corners[2][k]+u*corners[3][k]) for k in range(3)] for u in [j/(ns-1) for j in range(ns)]] for t in [i/(nt-1) for i in range(nt)]]
   m=Mesh(flat=CLOTH if level else None);sheet(m,grid,[-1,0,0],lambda i,j:s['camber']*16*(j/(ns-1))*(1-j/(ns-1))*(i/(nt-1))*(1-i/(nt-1)),lambda i:i%6==5)
   m.object(s['sheet'][5:]+(f'_LOD{level}' if level else ''),[0,0,0])
  peak=pivot(s['gaff'],s['peak'])
  a=unit(peak);e=[0,a[2],-a[1]]
  for level,n in enumerate([16,6]):
   m=Mesh(flat=SPAR if level else None)
   m.loft([[[q[0]+r*math.cos(k*math.tau/n),q[1]+r*math.sin(k*math.tau/n)*e[1],q[2]+r*math.sin(k*math.tau/n)*e[2]] for k in range(n)] for q,r in [([0,0,0],.2),(peak,.12)]],'white',smooth=True)
   m.object(s['gaff'][5:]+(f'_LOD{level}' if level else ''),[0,0,0])
 else:
  t,c,h=[pivot(s['sheet'],s[k]) for k in('tack','clew','head')]
  for level,n in enumerate(JIB_ROWS):
   grid=[[[t[k]+(i/n)*(h[k]-t[k])+(j/n)*(c[k]-t[k]) for k in range(3)] for j in range(n-i+1)] for i in range(n+1)]
   m=Mesh(flat=CLOTH if level else None);pts=[];idx={}
   for i,row in enumerate(grid):
    for j,p in enumerate(row):idx[i,j]=len(pts);a,b=j/n,i/n;pts.append([p[0],p[1],p[2]-s['camber']*27*a*b*(1-a-b)])
   up=[((i,j),(i,j+1),(i+1,j)) for i in range(n) for j in range(n-i)];down=[((i,j+1),(i+1,j+1),(i+1,j)) for i in range(n) for j in range(n-i-1)]
   tris=[tuple(idx[q] for q in tri) for tri in up+down]
   norm={}
   for a,b,cc in tris:
    nn=cross(sub(pts[b],pts[a]),sub(pts[cc],pts[a]))
    if nn[2]>0:nn=[-v for v in nn]
    for v in(a,b,cc):norm[v]=[x+y for x,y in zip(norm.get(v,[0,0,0]),nn)]
   for side in(1,-1):
    st=m.add(pts,[[side*x for x in unit(norm[v])] for v in range(len(pts))])
    if level:m.faces(st,tris,'sail',out=[0,0,-side])
    else:m.faces(st,tris,'sail',uvs=[[(q[1]/n,q[0]-tri[0][0]) for q in tri] for tri in up+down],out=[0,0,-side])
   m.object(s['sheet'][5:]+(f'_LOD{level}' if level else ''),[0,0,0])
