"""Six native representations of the instanced cruise prototype, built from the collision authority.

Original closed solids and original atlas. Glass is represented by clear framed openings and restrained edge
cues; it is never an opaque plane disguised as transparent Blender material. The final neighborhoods follow
the native performance/traversal gate for this full envelope and furnished repeated section.
"""
import json,math
from pathlib import Path
from parts import Mesh
from model_interiors import furniture as public_furniture, wall as public_wall, sign
from model_exterior import lifeboat
from model_aquatheater import aquadome_pod

HERE=Path(__file__).resolve().parent
D=json.loads((HERE.parents[4]/'content/landmarks/cruise-layout.json').read_text())

def extents(b):return ([b['at'][k]-b['half'][k] for k in range(3)],[b['at'][k]+b['half'][k] for k in range(3)])
def drawbox(m,b,tag,bevel=0):m.box(*extents(b),tag,bevel)

def rail(m,lo,hi):
 axis=0 if hi[0]-lo[0]>hi[2]-lo[2] else 2
 a=[(lo[k]+hi[k])/2 for k in range(3)];b=a[:]
 a[axis]=lo[axis]+.035;b[axis]=hi[axis]-.035;a[1]=b[1]=hi[1]-.03
 q=a[:];r=b[:];q[1]=r[1]=lo[1]+.025
 radius=min(.025,(hi[1]-lo[1])/4,(hi[2-axis]-lo[2-axis])/3)
 m.tube([a,b],radius,'steel')
 count=max(1,math.ceil((hi[axis]-lo[axis])/[1.5,2,3,4,6,12][m.level]))
 for i in range(count+1):
  t=i/count;p=[a[k]+(b[k]-a[k])*t for k in range(3)];bottom=p[:];bottom[1]=lo[1]+radius
  m.tube([bottom,p],radius,'steel')
 if m.level<3:
  a[1]=b[1]=lo[1]+(hi[1]-lo[1])*.46;m.tube([a,b],.014,'glass')

def floor(m,p):
 tag=p['art']['finish']
 def slab(lo,hi):
  m.box(lo,hi,'enamel');m.tags[-3]=tag
 for h in p['hulls']:
  pts=h['points'];xs=sorted(set(q[0] for q in pts));zs=sorted(set(q[2] for q in pts));ys=sorted(set(q[1] for q in pts))
  if len(xs)==2 and len(zs)==2 and m.level==0:
   nx=max(1,math.ceil((xs[-1]-xs[0])/4));nz=max(1,math.ceil((zs[-1]-zs[0])/4))
   for i in range(nx):
    for j in range(nz):slab([xs[0]+(xs[-1]-xs[0])*i/nx,ys[0],zs[0]+(zs[-1]-zs[0])*j/nz],
                           [xs[0]+(xs[-1]-xs[0])*(i+1)/nx,ys[-1],zs[0]+(zs[-1]-zs[0])*(j+1)/nz])
  else:
   start=len(m.f);m.convex(pts,'enamel')
   for i in range(start,len(m.f)):
    if all(abs(m.v[v][1]-ys[-1])<1e-5 for v in m.f[i]):m.tags[i]=tag
 for b in p['boxes']:slab(*extents(b))

def staircase(m,p):
 a=p['art'];x0=a['x0'];x1=a['x1'];z0=a['z0'];z1=a['z1'];y0=a['y0'];y1=a['y1']
 if m.level<3:
  n=a['steps']
  for i in range(n):
   za=z0+(z1-z0)*i/n;zb=z0+(z1-z0)*(i+1)/n;ya=y0+(y1-y0)*i/n;yb=y0+(y1-y0)*(i+1)/n
   m.box([x0,max(ya,yb)-.26,za],[x1,max(ya,yb),zb],'stone')
   if m.level==0:
    edge=za if y1>y0 else zb-.024
    m.box([x0+.01,max(ya,yb)-.012,edge],[x1-.01,max(ya,yb)-.002,edge+.024],'steel')
 else:m.convex(p['hulls'][0]['points'],'stone')
 for x in(x0-.04,x1+.04):
  a=[x,y0+1.11,z0+.035];b=[x,y1+1.11,z1-.035];m.tube([a,b],.025,'steel')
  n=3 if m.level<3 else 1
  for i in range(n+1):
   t=i/n;z=z0+.035+(z1-z0-.07)*t;y=y0+(y1-y0)*t
   m.tube([[x,y+.025,z],[x,y+1.11,z]],.025,'steel')

def furnished(m,p):
 for b in p['boxes'][:p['art']['wallCount']]:drawbox(m,b,'enamel')
 for f in p['art']['items']:
  x,y,z=f['at'];sx,sy,sz=f['size'];kind=f['kind']
  def b(ax,ay,az,bx,by,bz,tag,bevel=.02):m.box([x+ax*sx,y+ay*sy,z+az*sz],[x+bx*sx,y+by*sy,z+bz*sz],tag,bevel if m.level<2 else 0)
  if kind=='bed':
   b(-.49,0,-.49,.49,.32,.49,'oak');b(-.5,.32,-.5,.42,.88,.5,'linen',.07)
   b(.42,.32,-.5,.5,1,.5,'carpet',.025)
   if m.level<4:
    b(.19,.88,-.43,.4,.99,-.02,'linen',.045);b(.19,.88,.02,.4,.99,.43,'linen',.045)
    b(-.47,.88,-.49,-.15,.90,.49,'blue',.004)
  elif kind=='sofa':
   if f.get('finish'):
    public_furniture(m,{'art':{'items':[f]}});continue
   b(-.5,0,-.5,.5,.20,.5,'oak');b(-.42,.20,-.5,.42,.55,.25,'carpet',.055)
   b(-.5,.55,.25,.5,1,.5,'carpet',.04)
   b(-.5,.2,-.5,-.42,.78,.25,'carpet');b(.42,.2,-.5,.5,.78,.25,'carpet')
   if m.level<3:b(-.35,.55,-.30,-.05,.79,.12,'coral',.04)
  elif kind=='wardrobe':
   b(-.5,0,-.5,.44 if m.level<3 else .5,1,.5,'oak')
   if m.level<3:
    b(.44,.01,-.49,.48,.99,-.01,'oak',.006);b(.44,.01,.01,.48,.99,.49,'oak',.006)
    b(.48,.44,-.08,.50,.58,-.045,'steel',.004)
    b(.48,.44,.045,.50,.58,.08,'steel',.004)
  elif kind=='desk':
   b(-.5,.88,-.5,.5,1,.5,'oak')
   if m.level<4:
    b(-.45,0,-.45,-.37,.88,.45,'steel');b(.37,0,-.45,.45,.88,.45,'steel')
   else:b(-.45,0,-.45,.45,.88,.45,'oak')
  elif kind=='bath':
   b(-.5,0,-.5,.5,.08,.5,'stone')
   b(-.5,.08,-.5,-.46,1,.5,'enamel');b(-.5,.08,-.5,.5,1,-.46,'enamel');b(.46,.08,-.5,.5,1,.5,'enamel')
   b(-.30,.08,-.15,.30,.26,.33,'enamel',.06);b(-.25,.26,-.15,.25,.31,.25,'stone',.025)
   if m.level<3:b(.4,.5,-.4,.44,.55,-.10,'steel')

def build(m,p):
 kind=p['art']['kind'];finish=p['art'].get('finish','enamel')
 if kind=='floor':floor(m,p)
 elif kind=='stair':staircase(m,p)
 elif kind=='cabin':furnished(m,p)
 elif kind=='furniture':public_furniture(m,p)
 elif kind=='wall':public_wall(m,p)
 elif kind=='sign':sign(m,p)
 elif kind=='lifeboat':lifeboat(m,p)
 elif kind=='aquadome_pod':aquadome_pod(m,p)
 elif kind=='rails':
  for b in p['boxes']:rail(m,*extents(b))
 elif kind=='guard':
  a,b=p['art']['ends'];dx=b[0]-a[0];dz=b[2]-a[2];ln=math.hypot(dx,dz);inset=min(.03,ln/4)
  aa=[a[0]+dx/ln*inset,a[1]+1.12,a[2]+dz/ln*inset];bb=[b[0]-dx/ln*inset,b[1]+1.12,b[2]-dz/ln*inset]
  m.tube([aa,bb],.025,'steel')
  n=max(1,math.ceil(ln/[1.5,2,3,4,6,12][m.level]))
  for i in range(n+1):
   t=i/n;top=[aa[k]+(bb[k]-aa[k])*t for k in range(3)];bot=top[:];bot[1]=a[1]+(b[1]-a[1])*t+.025;m.tube([bot,top],.022,'steel')
  if m.level<3:
   aa[1]=a[1]+.54;bb[1]=b[1]+.54;m.tube([aa,bb],.012,'glass')
 elif kind=='window_wall':
  for i,b in enumerate(p['boxes']):
   if i not in p['art'].get('glassBoxes',[]):drawbox(m,b,'enamel')
 elif kind=='grand_stair':
  a=p['art']['start'];b=p['art']['end'];n=p['art']['steps'] if m.level<3 else 1
  if n==1:m.convex(p['hulls'][0]['points'],'marble')
  else:
   for i in range(n):
    z0=a[2]+(b[2]-a[2])*i/n;z1=a[2]+(b[2]-a[2])*(i+1)/n;y=a[1]+(b[1]-a[1])*(i+1)/n
    m.box([a[0],y-.28,z0],[b[0],y,z1],'marble')
    if m.level==0:m.box([a[0]+.01,y-.012,z0],[b[0]-.01,y-.002,z0+.025],'brass')
 elif kind=='pearl':
  lo,hi=p['art']['angles'];na=[4,3,2,1,1,1][m.level];nz=[4,3,2,1,1,1][m.level]
  for j,(za,zb) in enumerate(zip([-5.6,-3,0,3],[-3,0,3,5.6])):
   for i in range(na):
    a=lo+(hi-lo)*i/na;b=lo+(hi-lo)*(i+1)/na
    for k in range(nz):
     z0=za+(zb-za)*k/nz;z1=za+(zb-za)*(k+1)/nz
     points=[[r*math.cos(t),r*math.sin(t),z] for z in(z0,z1) for t in(a,b) for r in(math.sqrt(7.5**2-z*z)-.20,math.sqrt(7.5**2-z*z))]
     m.convex(points,'ivory' if (i+k+j)%5 else 'marble')
 elif kind=='dome_dense':
  for a,b in p['art']['beams']:m.tube([a,b],.105,'steel',n=[8,6,6,4,4,4][m.level])
  for h in p['art']['roof']:m.convex(h,'dome_glaze')
 elif kind=='slide':
  for h in p['hulls']:
   pts=h['points'];a=[sum(q[k] for q in pts[:4])/4 for k in range(3)];b=[sum(q[k] for q in pts[4:])/4 for k in range(3)]
   m.tube([a,b],p['art'].get('radius',.76),finish,n=[16,12,10,8,6,4][m.level])
 elif kind in('gangway','landing'):
  drawbox(m,p['boxes'][0],finish)
  for b in p['boxes'][1:]:rail(m,*extents(b))
 elif kind=='balcony':
  drawbox(m,p['boxes'][0],'enamel');rail(m,*extents(p['boxes'][1]))
  for b in p['boxes'][2:]:drawbox(m,b,'enamel')
 elif kind=='dome':
  for h in p['hulls']:
   pts=h['points'];a=[sum(q[k] for q in pts[:4])/4 for k in range(3)];b=[sum(q[k] for q in pts[4:])/4 for k in range(3)]
   # Tubes fit inside the box-section native frame, leaving truly clear pane apertures at every level.
   m.tube([a,b],.105,'steel')
 elif kind=='pool':
  for b in p['boxes']:drawbox(m,b,'tile')
  # Decorative contained surface: closed thin geometry, with no water-column physics.
  w=p['art'].get('width',10);l=p['art'].get('length',16)
  m.box([-w/2+.02,p['art']['waterY']-.012,-l/2+.02],[w/2-.02,p['art']['waterY'],l/2-1.52],'water')
 elif kind=='door':
  for b in p['boxes']:drawbox(m,b,'oak',.008)
 elif kind=='funnel':
  n=[32,24,16,12,8,6][m.level]
  levels=[-11.5+i*19.5/12 for i in range(13)] if m.level<3 else [-11.5,-8,5.5,8]
  for j,(ya,yb) in enumerate(zip(levels,levels[1:])):
   rings=[]
   for y in(ya,yb):
    t=(y+11.5)/19.5;rx=6.95+(4.35-6.95)*t;rz=9.95+(6.95-9.95)*t
    rings.append([[rx*math.cos(k*math.tau/n),y,rz*math.sin(k*math.tau/n)+1.5*t] for k in range(n)])
   m.loft(rings,'enamel' if j in(0,len(levels)-2) or (m.level<3 and j%3==0) else 'blue')
  for b in p['boxes']:
   lo,hi=extents(b);c=[b['at'][0],lo[1],b['at'][2]];e=[c[0],hi[1],c[2]]
   m.tube([c,e],.55,'steel')
 elif kind=='mast':
  for b in p['boxes']:
   lo,hi=extents(b);axis=max(range(3),key=lambda k:hi[k]-lo[k]);a=b['at'][:];c=a[:]
   a[axis]=lo[axis];c[axis]=hi[axis];radius=min(b['half'][k] for k in range(3) if k!=axis)
   m.tube([a,c],radius,'enamel')
 else:
  for b in p['boxes']:drawbox(m,b,finish)
  for h in p['hulls']:m.convex(h['points'],finish)

report={'prototypes':[],'totals':[0]*6,'notes':['Six authored native levels of the production reconstruction.','Original materials; reference pixels are not sampled.']}
for i,p in enumerate(D['prototypes']):
 counts=[]
 for level in range(6):
  m=Mesh(level);build(m,p);obj=m.object(p['mesh'][5:]+('' if level==0 else '_LOD'+str(level)),[0,0,0])
  counts.append(len(obj.data.polygons));report['totals'][level]+=counts[-1]
 report['prototypes'].append({'id':p['id'],'triangles':counts})
 if i%50==0:print('cruise authored',i+1,'/',len(D['prototypes']),flush=True)
(HERE/'ref/geometry-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('cruise authored triangles:',report['totals'],flush=True)
