from PIL import Image,ImageDraw
from pathlib import Path
import json, math
ROOT=Path(__file__).resolve().parent
BG=(214,212,206); IV='#E9E4D8'; CH='#2E3134'; OR='#C8662E'; UP='#56677A'; DN='#7D8A94'
SP={'shoulder':[.15,.80,0], 'elbow':[.45,.88,.07], 'wrist':[.97,.96,.03], 'knuckle':[1.52,1.01,.05], 'wingtip':[3.48,.67,-.73], 'hip':[.08,.72,-.60], 'ankle':[.20,.47,-1.08], 'toe_tip':[.22,.42,-1.22], 'neck_base':[0,.86,.10], 'skull_hinge':[0,1.33,.63], 'eye':[.07,1.36,.83], 'beak_tip':[0,1.31,1.55], 'crest_tip':[0,1.90,.23]}
FO={'shoulder':[.15,.96,-.10], 'elbow':[.24,.67,.10], 'wrist':[.32,.08,.40], 'knuckle':[.36,.39,-.06], 'wingtip':[.40,1.30,-1.25], 'hip':[.08,.50,-.49], 'ankle':[.16,.13,-.45], 'toe_tip':[.20,.015,-.25], 'neck_base':[0,1.03,-.02], 'skull_hinge':[0,1.82,.15], 'eye':[.07,1.85,.35], 'beak_tip':[0,1.80,1.07], 'crest_tip':[0,2.39,-.25]}
class Canvas:
 def __init__(self,name):
  self.name=name; self.fold='folded' in name; self.lm=FO if self.fold else SP
  self.wide=name in ['top','underside','front']; self.size=(3200,1600) if self.wide else (1600,1600)
  if name=='head_side': self.size=(1800,1300)
  if name=='head_front': self.size=(1200,1300)
  self.im=Image.new('RGB',self.size,BG);self.d=ImageDraw.Draw(self.im)
 def p(self,v):
  x,y,z=v;n=self.name
  if n in ['top','underside']: return (1600+x*400,860-z*400)
  if n=='head_side': return (1650-z*1000,2050-y*1000)
  if n=='head_front':return(600+x*1000,2050-y*1000)
  if 'front' in n:return((1600 if self.wide else 800)+x*400,(1400 if self.wide else 1450)-y*400)
  return(900-z*400,1450-y*400)
 def poly(self,vs,fill): self.d.polygon([self.p(v) for v in vs], fill=fill)
 def line(self,vs,fill,width):self.d.line([self.p(v) for v in vs],fill=fill,width=width,joint='curve')
 def ball(self,v,r,fill):
  x,y=self.p(v); s=1000 if 'head' in self.name else 400
  self.d.ellipse((x-r*s,y-r*s,x+r*s,y+r*s),fill=fill)
 def curve(self,ps,fill,width):
  out=[]
  for i in range(0,len(ps)-1,3):
   if i+3>=len(ps):break
   for j in range(31):
    t=j/30;out.append(tuple((1-t)**3*ps[i][k]+3*(1-t)**2*t*ps[i+1][k]+3*(1-t)*t*t*ps[i+2][k]+t**3*ps[i+3][k] for k in range(3)))
  self.line(out,fill,width)
 def save(self):self.im.save(ROOT/'guides'/f'{self.name}.png')
def mul(p,s):return[p[0]*s,p[1],p[2]]
def bez(a,b,c,d,n=30):return [tuple((1-t)**3*a[k]+3*(1-t)**2*t*b[k]+3*(1-t)*t*t*c[k]+t**3*d[k] for k in range(3)) for t in [j/n for j in range(n+1)]]
def head(c):
 # One invariant head profile, translated in folded pose.
 dy=.49 if c.fold else 0; dz=-.48 if c.fold else 0
 def h(x,y,z):return(x,y+dy,z+dz)
 # head shell, skull and the neck join
 c.poly([h(-.07,1.39,.91),h(-.085,1.45,.77),h(-.06,1.42,.62),h(-.05,1.27,.60),h(-.06,1.25,.74),h(-.06,1.28,.87),h(.06,1.28,.87),h(.085,1.45,.77)],IV)
 # profile face for side views
 if c.name in ['side','folded_side','head_side']:
  c.poly([h(.07,1.43,.91),h(.08,1.45,.76),h(.04,1.40,.62),h(.03,1.29,.61),h(.06,1.25,.74),h(.07,1.29,.88)],IV)
 # Single sabre crest, very thin transverse blade.
 crest=[h(0,1.42,.83),h(0,1.52,.65),h(0,1.67,.48),h(0,1.90,.23),h(0,1.885,.21),h(0,1.63,.35),h(0,1.43,.55),h(0,1.37,.66)]
 if c.name in ['side','folded_side','head_side']:c.poly(crest,OR);c.poly([h(0,1.747,.396),h(0,1.802,.337),h(0,1.740,.285),h(0,1.674,.322)],CH)
 else:
  c.poly([h(-.018,1.42,.80),h(-.014,1.62,.49),h(0,1.9,.23),h(.014,1.62,.49),h(.018,1.42,.80)],OR)
  c.line([h(-.011,1.76,.34),h(.011,1.76,.34)],CH,9 if 'head' not in c.name else 18)
 # Horn continuous from the beak onto skull into blade.
 if c.name in ['side','folded_side','head_side']:
  c.poly([h(.03,1.31,1.55),h(.04,1.33,1.44),h(.06,1.41,.96),h(.07,1.44,.87),h(.06,1.44,.73),h(.06,1.37,.64),h(.06,1.33,.86),h(.04,1.26,.93)],OR)
  c.line([h(.045,1.298,1.51),h(.055,1.297,.91),h(.065,1.30,.85)],'#895338',2 if 'head' not in c.name else 3)
  c.line([h(.063,1.35,1.0),h(.063,1.353,.966)],'#423329',3 if 'head' not in c.name else 5)
  c.poly([h(.079,1.39,.86),h(.08,1.39,.79),h(.064,1.35,.62),h(.05,1.30,.62),h(.08,1.34,.80),h(.08,1.34,.86)],CH)
  c.ball(h(.085,1.36,.83),.013,'#8E5C25');c.ball(h(.085,1.36,.83),.006,'#151516')
 else:
  c.poly([h(0,1.31,1.55),h(-.065,1.40,.91),h(-.04,1.44,.73),h(.04,1.44,.73),h(.065,1.40,.91)],OR)
  for s in [-1,1]:
   c.line([h(s*.073,1.38,.88),h(s*.08,1.36,.83),h(s*.054,1.34,.62)],CH,9 if 'head' not in c.name else 20)
   c.ball(h(s*.08,1.36,.83),.012,'#8E5C25')
def make(name):
 c=Canvas(name); L=c.lm; side=name in ['side','folded_side','head_side']; front='front' in name; fold=c.fold
 if 'head' in name:
  c.curve([(0,.88,.14),(0,1.03,.44),(0,1.1,.53),(0,1.33,.63)],IV,160)
  head(c);c.save();return
 # membrane as triangulated surfaces in 3D so projections agree
 for s in [-1,1]:
  if fold:
   pts=[L['wrist'],L['knuckle'],L['wingtip'],(.29,.48,-.80),L['ankle'],(.17,.58,-.48),L['shoulder'],L['elbow']]
   c.poly([mul(p,s) for p in pts],UP)
   c.line([mul(L[k],s) for k in ['wrist','knuckle','wingtip']],IV,7)
   c.line([mul(p,s) for p in [(.37,1.22,-1.18),(.3,.53,-.65),(.27,.18,.15)]],CH,5)
  else:
   lead=[L[k] for k in ['shoulder','elbow','wrist','knuckle']]+[(2.18,.96,-.08),(2.76,.86,-.27),(3.2,.75,-.49),L['wingtip']]
   trail=bez(L['wingtip'],(2.48,.64,-.46),(.88,.53,-.38),L['ankle'])
   c.poly([mul(p,s) for p in lead+trail[1:]+[L['hip']]],DN if name=='underside' or front else UP)
   c.poly([mul(p,s) for p in [(2.79,.85,-.285),(3.2,.75,-.49),L['wingtip'],(2.78,.62,-.59)]],CH)
   c.line([mul(p,s) for p in lead[:-1]],IV,8)
  c.line([mul(L[k],s) for k in ['shoulder','elbow','wrist']],IV,13)
  # clawed wrist hands
  wx,wy,wz=L['wrist']
  for j in range(3):
   a=(s*(wx+.013*j),wy-.015*j,wz+.025);b=(s*(wx+.026*j),wy-(.06 if fold else .025),wz+.075+j*.011)
   c.line([a,b],OR,5);c.line([b,(b[0],b[1]-.012,b[2]-.016)],CH,3)
 # legs visible, consistent landmarks
 for s in [-1,1]:
  knee=(.13,.30,-.53) if fold else (.15,.58,-.80)
  c.line([mul(L['hip'],s),mul(knee,s),mul(L['ankle'],s)],IV,16)
  c.ball(mul(L['hip'],s),.06,IV)
  ax,ay,az=L['ankle']
  for j in range(4):
   dx=(j-1.3)*.033; end=(s*(ax+dx),(.025 if fold else ay-.06),az+(.17 if fold else -.13)+(abs(j-1)*-.02))
   c.line([mul(L['ankle'],s),end],OR,5)
   c.line([end,(end[0],end[1]-(.01 if fold else .024),end[2]-(.035 if not fold else -.03))],CH,4)
 # torso
 if side:
  if fold: body=[(0,1.06,-.12),(0,.91,.10),(0,.62,-.05),(0,.30,-.49),(0,.48,-.69),(0,.72,-.48)]
  else: body=[(0,.92,.02),(0,.85,.22),(0,.63,.20),(0,.48,-.04),(0,.49,-.30),(0,.64,-.68),(0,.81,-.56)]
  c.poly(body,IV)
  c.line([body[-1],body[0]],CH,15)
 elif front:
  sh=L['shoulder'];hip=L['hip']
  c.poly([(-.18,sh[1]+.10,0),(.18,sh[1]+.10,0),(.19,sh[1]-.13,0),(.12,hip[1]-.13,-.6),(-.12,hip[1]-.13,-.6),(-.19,sh[1]-.13,0)],IV)
 else:
  c.poly([(-.14,.86,.22),(.14,.86,.22),(.18,.80,0),(.12,.72,-.60),(0,.69,-.70),(-.12,.72,-.60),(-.18,.80,0)],IV)
  if name=='top':c.poly([(-.13,.9,.04),(.13,.9,.04),(.10,.8,-.53),(0,.7,-.67),(-.10,.8,-.53)],CH)
 if fold: neck=[(0,1.03,-.02),(0,1.25,.12),(0,1.30,.34),(0,1.49,.23),(0,1.61,.15),(0,1.72,.09),(0,1.82,.15)]
 else:neck=[(0,.86,.10),(0,1.03,.28),(0,1.04,.51),(0,1.16,.48),(0,1.23,.46),(0,1.29,.55),(0,1.33,.63)]
 c.curve(neck,IV,50 if side or front else 48)
 c.ball(neck[0],.095,IV)
 if side:c.curve([(x,y+.014,z-.047) for x,y,z in neck],CH,9)
 if name=='top':c.curve(neck,CH,9)
 head(c);c.save()
for name in ['top','underside','front','side','folded_side','folded_front','head_side','head_front']:make(name)
plan={'units':'metres','pixels_per_metre':400,'span':6.96,'standing_crest_height':2.39,'spread':SP,'folded':FO,'palette':{'background':BG,'ivory':IV,'charcoal':CH,'horn':OR,'membrane_upper':UP,'membrane_lower':DN},'note':'Guide targets, not claimed measurements of generated paintings. Positive x landmarks have matching negative x counterpart.'}
(ROOT/'checks'/'geometry_plan.json').write_text(json.dumps(plan,indent=2))
