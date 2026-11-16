"""Original hull markings fitted to the inferred shell, informed by the archived broadside.

These are shallow closed native solids, not borrowed photograph pixels. The lettering is an
original marine stencil interpretation, not a claim to reproduce the operator's exact logotype.
Dark portholes represent sealed glazing; none is an advertised opening or room entrance.
"""
import math

# Centre-line strokes in an original unit-square alphabet. Small overlaps keep adjacent strokes
# closed individually without coincident end faces in the native six-level solid model.
STROKES = {
 'I': [[(.12,1),(.88,1)],[(.5,1),(.5,0)],[(.12,0),(.88,0)]],
 'C': [[(.93,.82),(.72,1),(.25,1),(0,.75),(0,.25),(.25,0),(.72,0),(.93,.18)]],
 'O': [[(.25,0),(0,.25),(0,.75),(.25,1),(.75,1),(1,.75),(1,.25),(.75,0),(.25,0)]],
 'N': [[(0,0),(0,1),(1,0),(1,1)]],
 'F': [[(0,0),(0,1),(1,1)],[(0,.52),(.78,.52)]],
 'T': [[(0,1),(1,1)],[(.5,1),(.5,0)]],
 'H': [[(0,0),(0,1)],[(1,0),(1,1)],[(0,.5),(1,.5)]],
 'E': [[(1,1),(0,1),(0,0),(1,0)],[(0,.5),(.78,.5)]],
 'S': [[(.95,.84),(.75,1),(.25,1),(0,.78),(0,.62),(.25,.5),(.75,.5),(1,.38),(1,.22),(.75,0),(.25,0),(.05,.16)]],
 'A': [[(0,0),(.5,1),(1,0)],[(.2,.4),(.8,.4)]],
}


def finish(D,p,world,place,box,ys):
 stations=D['hullStations']

 def shell(z,y):
  for a,b in zip(stations,stations[1:]):
   if a['z']<=z<=b['z']:
    w=a['waterHalfBeam']+(b['waterHalfBeam']-a['waterHalfBeam'])*(z-a['z'])/(b['z']-a['z'])
    return w+min(1.5,.08*w)*y/12.8
  raise ValueError(('hull marking outside station range',z))

 def coating(poly,side):
  # The inner face overlaps the white shell by 5 mm; the visible face clears it by 45 mm.
  # All parts remain above water and inside the separate published deckhouse/bridge envelope.
  # A straight stroke spanning a hull-station bend would cut through the white
  # shell. Split at those bends before fitting the actual closed coating solids.
  cuts=sorted(set([min(v[0] for v in poly),max(v[0] for v in poly)]+
                  [s['z'] for s in stations if min(v[0] for v in poly)<s['z']<max(v[0] for v in poly)]))
  pieces=[]
  for lo,hi in zip(cuts,cuts[1:]):
   clipped=poly
   for bound,sign in((lo,1),(hi,-1)):
    result=[]
    for a,b in zip(clipped,clipped[1:]+clipped[:1]):
     ina=(a[0]-bound)*sign>=-1e-9;inb=(b[0]-bound)*sign>=-1e-9
     if ina:result.append(a)
     if ina!=inb:
      t=(bound-a[0])/(b[0]-a[0]);result.append((bound,a[1]+t*(b[1]-a[1])))
    clipped=result
   unique=[]
   for v in clipped:
    if not any(math.dist(v,w)<1e-8 for w in unique):unique.append(v)
   if len(unique)>=3 and abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(unique,unique[1:]+unique[:1])))>1e-9:
    pieces.append([[side*(shell(z,y)+offset),y,z] for offset in(-.005,.045) for z,y in unique])
  return pieces

 def row(name,side,zs,y,w,h):
  hulls=[part for z in zs for part in coating([(z-w/2,y-h/2),(z+w/2,y-h/2),(z+w/2,y+h/2),(z-w/2,y+h/2)],side)]
  q,o=world('hull_glazing','hull_detail',hs=hulls,art={'kind':'solids','finish':'navy'},color=29)
  place(name,q,o,'3','sealed-hull-glazing')

 for side in(-1,1):
  for row_index,(y,w,h,start,end) in enumerate([(10.2,.48,.68,-157,132),(7.65,.46,.48,-148,48)]):
   zs=[start+i*2.25 for i in range(math.floor((end-start)/2.25)+1)]
   for group in range(0,len(zs),12):row(f'hull_glazing_{side}_{row_index}_{group//12}',side,zs[group:group+12],y,w,h)
  # The higher bow portholes follow the photographed taper without adding a fictitious room.
  row(f'bow_ports_{side}',side,[137+i*2.25 for i in range(10)],11.5,.48,.48)

 def word(text,u,y,width,height,side):
  for index,letter in enumerate(text):
   hulls=[]
   for line in STROKES[letter]:
    for a,b in zip(line,line[1:]):
     ax=(u+index*(width+1)+a[0]*width);ay=y+a[1]*height
     bx=(u+index*(width+1)+b[0]*width);by=y+b[1]*height
     dx=bx-ax;dy=by-ay;length=math.hypot(dx,dy);r=height*.048
     dx/=length;dy/=length
     # Square-capped strokes overlap slightly at joints, with no coincident internal caps.
     poly=[(ax-dx*r-dy*r,ay-dy*r+dx*r),(bx+dx*r-dy*r,by+dy*r+dx*r),
           (bx+dx*r+dy*r,by+dy*r-dx*r),(ax-dx*r+dy*r,ay-dy*r-dx*r)]
     hulls.extend(coating([(91-side*z,yy) for z,yy in poly],side))
   for group in range(0,len(hulls),16):
    q,o=world('hull_letter','hull_detail',hs=hulls[group:group+16],art={'kind':'solids','finish':'navy'},color=29)
    place(f'hull_name_{side}_{text}_{index}_{group//16}',q,o,'2','ship-name')

 # In the native camera, an outside starboard viewer sees +Z toward screen-right;
 # port reads toward -Z. The complete name occupies the same forward band on both sides.
 for side in(-1,1):
  word('ICON',-29,2.0,5,6.6,side)
  word('OF',-4.5,5.8,2.1,2.35,side)
  word('THE',-5.1,2.2,1.55,2.35,side)
  word('SEAS',5,2.0,5,6.6,side)
 D['hullDetails']={'evidence':'photo-informed original closed stencil lettering and sealed porthole rhythm',
                   'reference':'ref/profile-corey-seeman-2025.jpg','exactOperatorLogotype':False,
                   'publishedDimensions':False,'advertisedOpenings':False}
