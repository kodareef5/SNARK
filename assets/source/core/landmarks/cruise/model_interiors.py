"""Original economical fittings for the cruise public rooms; closed solids at all six levels."""
import math

def furniture(m,p):
 for f in p['art']['items']:
  x,y,z=f['at'];sx,sy,sz=f['size'];kind=f['kind'];finish=f.get('finish','oak')
  def b(ax,ay,az,bx,by,bz,tag=finish,bevel=.02):
   m.box([x+ax*sx,y+ay*sy,z+az*sz],[x+bx*sx,y+by*sy,z+bz*sz],tag,bevel if m.level<2 else 0)
  def post(ax,az,lo,hi,r=.035,tag='steel'):
   m.tube([[x+ax*sx,y+lo*sy,z+az*sz],[x+ax*sx,y+hi*sy,z+az*sz]],min(sx,sz)*r,tag)
  def legs(top=.86):
   for ax in(-.39,.39):
    for az in(-.38,.38):b(ax-.025,0,az-.025,ax+.025,top,az+.025,'steel',.005)
  if kind in('table','workbench','desk'):
   b(-.5,.88,-.5,.5,1,.5,'steel' if kind=='workbench' else finish)
   if m.level<4:legs(.88)
   else:b(-.08,0,-.3,.08,.88,.3,'steel',0)
   if kind=='workbench':
    b(-.46,.04,-.43,-.18,.86,.43,'oak');b(.18,.04,-.43,.46,.86,.43,'oak')
  elif kind in('chair','lounger'):
   legs(.45);b(-.5,.45,-.5,.5,.58,.28 if kind=='chair' else .13,finish,.04)
   b(-.5,.45,.28 if kind=='chair' else .13,.5,1,.5,finish,.04)
   if kind=='chair' and m.level<3:
    b(-.5,.59,-.3,-.44,.74,.28,'oak');b(.44,.59,-.3,.5,.74,.28,'oak')
  elif kind=='sofa':
   b(-.5,0,-.5,.5,.20,.5,'oak');b(-.42,.20,-.5,.42,.55,.25,finish,.055)
   b(-.5,.55,.25,.5,1,.5,finish,.04)
   b(-.5,.2,-.5,-.42,.78,.25,finish);b(.42,.2,-.5,.5,.78,.25,finish)
   if m.level<3:b(-.35,.55,-.3,-.05,.79,.12,'ivory',.04)
  elif kind=='seating_row':
   count=max(1,round(sx/.72)) if m.level<4 else max(1,round(sx/2))
   for i in range(count):
    a=-.5+i/count+.014;b0=-.5+(i+1)/count-.014
    b(a,.24,-.48,b0,.58,.23,finish,.035);b(a,.58,.23,b0,1,.48,finish,.035)
    if m.level<2:b(a,.44,-.40,a+.025,.69,.23,'oak',.008)
   b(-.48,0,-.25,.48,.24,.32,'steel')
  elif kind in('counter','console','gaming_table'):
   body='oak' if kind=='gaming_table' else ('navy' if kind=='console' else 'enamel')
   b(-.46,0,-.44,.46,.83,.44,body);b(-.5,.83,-.5,.5,.94,.5,finish)
   if kind=='console':
    for ax in(-.30,0,.30):b(ax-.12,.94,-.35,ax+.12,1,.22,'screen',.008)
   elif kind=='gaming_table':b(-.45,.94,-.45,.45,1,.45,'leaf',.01)
   else:
    b(-.45,.94,-.40,.45,1,.40,'marble',.008)
    if m.level<2:
     for ax in(-.30,.30):b(ax-.065,.96,-.13,ax+.065,1,.13,'steel',.01)
  elif kind=='slots':
   count=max(1,round(sx/.8))
   for i in range(count):
    a=-.5+i/count+.01;c=-.5+(i+1)/count-.01
    b(a,0,-.40,c,.48,.4,'rubber');b(a,.48,-.32,c,1,.48,finish)
    b(a+.035,.55,-.5,c-.035,.89,-.32,'screen',.004)
    b(a+.02,.42,-.5,c-.02,.48,-.4,'steel',.004)
  elif kind in('stage','screen'):
   b(-.5,0,-.5,.5,1,.5,finish,.0)
  elif kind=='gym':
   b(-.48,0,-.5,.48,.14,.5,'rubber');b(-.36,.14,-.44,.36,.16,.35,'steel',.004)
   for ax in(-.42,.42):b(ax-.035,.14,.30,ax+.035,.90,.37,'steel',.005)
   b(-.45,.88,.29,.45,1,.43,'screen')
  elif kind=='medical':
   b(-.45,.10,-.45,.45,.40,.45,'enamel');b(-.49,.40,-.47,.49,.57,.35,'linen',.04)
   b(-.49,.57,.35,.49,.90,.48,'linen',.04)
   for ax in(-.48,.48):b(ax-.015,.57,-.42,ax+.015,.74,.28,'steel',.005)
   b(-.3,.90,.39,.3,1,.47,'blue',.01)
  elif kind=='laundry':
   b(-.5,0,-.41,.5,1,.5,'enamel')
   n=max(1,round(sx/.85))
   for i in range(n):
    xx=x+(-.5+(i+.5)/n)*sx;r=min(sx/n*.32,sy*.24)
    m.tube([[xx,y+sy*.48,z-sz*.49],[xx,y+sy*.48,z-sz*.415]],r,'rubber')
    if m.level<3:m.ring([xx,y+sy*.48,z-sz*.49],[1,0,0],[0,1,0],r,r,.018,'steel')
   b(-.45,.82,-.5,.45,.91,-.41,'screen',.005)
  elif kind=='engine':
   b(-.5,0,-.5,.5,.16,.5,'steel');b(-.37,.16,-.43,.37,.82,.43,'blue')
   n=4 if m.level<3 else 2
   for i in range(n):
    zz=-.38+(i+.5)*.76/n;b(-.43,.82,zz-.06,.43,1,zz+.06,'steel',.006)
  elif kind=='planter_tree':
   b(-.5,0,-.5,.5,.16,.5,'stone',.06);b(-.45,.16,-.45,.45,.18,.45,'rubber')
   post(0,0,.18,.65,.045,'oak')
   n=[8,7,6,5,4,4][m.level];rings=[]
   for yy,r in[(.40,.12),(.62,.48),(.82,.44),(1,.04)]:
    rings.append([[x+sx*r*math.cos(i*math.tau/n),y+sy*yy,z+sz*r*math.sin(i*math.tau/n)] for i in range(n)])
   m.loft(rings,'leaf')
  elif kind=='play_structure':
   b(-.48,0,-.48,.48,.10,.48,'blue')
   for ax in(-.38,.38):
    for az in(-.35,.35):post(ax,az,.10,.87,.025,'yellow')
   b(-.45,.48,-.42,.45,.56,.42,'coral');b(-.5,.87,-.5,.5,1,.5,'yellow')
   if m.level<3:
    for yy in(.15,.25,.35,.45):b(-.38,yy,-.39,.0,yy+.025,-.33,'enamel',.005)
  else:
   b(-.5,0,-.5,.5,1,.5,finish)

def wall(m,p):
 for b in p['boxes']:
  lo=[b['at'][k]-b['half'][k] for k in range(3)];hi=[b['at'][k]+b['half'][k] for k in range(3)]
  if p['art'].get('label'):
   axis=0 if hi[0]-lo[0]>hi[2]-lo[2] else 2;c=(lo[axis]+hi[axis])/2;ya=lo[1]+1.45;yb=lo[1]+1.85
   a=hi[:];a[1]=ya;m.box(lo,a,'oak');a=lo[:];a[1]=yb;m.box(a,hi,'enamel')
   for left,right in[(lo[axis],c-.75),(c+.75,hi[axis])]:
    a=lo[:];b=hi[:];a[axis]=left;b[axis]=right;a[1]=ya;b[1]=yb;m.box(a,b,'enamel')
   a=lo[:];b=hi[:];a[axis]=c-.75;b[axis]=c+.75;a[1]=ya;b[1]=yb;m.box(a,b,'navy')
   m.tags[-6+p['art']['labelFace']]='sign:'+p['art']['label'];continue
  if hi[1]-lo[1]>.8:
   split=lo[1]+min(.75,(hi[1]-lo[1])*.3);a=hi[:];a[1]=split;m.box(lo,a,'oak')
   a=lo[:];a[1]=split;m.box(a,hi,p['art'].get('finish','enamel'))
  else:m.box(lo,hi,p['art'].get('finish','enamel'))

def sign(m,p):
 for i,b in enumerate(p['boxes']):
  lo=[b['at'][k]-b['half'][k] for k in range(3)];hi=[b['at'][k]+b['half'][k] for k in range(3)]
  m.box(lo,hi,'navy' if i==p['art']['board'] else 'steel')
  if i==p['art']['board']:m.tags[-2]='sign:'+p['art']['label']
