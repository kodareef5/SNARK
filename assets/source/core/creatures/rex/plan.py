"""Original adult coastal Tyrannosaurus in metres. X left, Y up, Z forward."""
from mathutils import Vector

FPS=30
def to_blender(v):return Vector((v[0],-v[2],v[1]))
def to_animal(v):return Vector((v[0],v[2],-v[1]))
def point_blender(v):return to_blender((v[0],v[1]-.036,v[2]))

# Axial stations give depth above and below each centre independently. The
# gastral basket is deepest forward of the hip; the raised tail balances the head.
# z, centre height, half-width, dorsal and ventral depths.
BODY=[
 (-7.12,1.51,.012,.018,.017),(-6.66,1.55,.058,.074,.061),(-6.08,1.62,.101,.125,.110),
 (-5.35,1.79,.166,.187,.165),(-4.52,2.05,.224,.257,.232),(-3.76,2.34,.305,.328,.303),
 (-3.08,2.60,.392,.425,.37),(-2.48,2.83,.468,.51,.49),(-1.91,3.00,.555,.585,.56),
 (-1.43,3.075,.641,.710,.68),(-.94,3.09,.767,.838,.84),(-.48,3.075,.832,.888,.939),
 (.04,3.035,.844,.861,.967),(.58,3.018,.786,.828,.984),(1.06,3.01,.725,.788,.910),
 (1.47,3.08,.594,.666,.76),(1.81,3.16,.483,.566,.59),(2.16,3.25,.405,.529,.50),
 (2.49,3.44,.408,.487,.454),(2.77,3.57,.439,.428,.441),(3.02,3.64,.469,.413,.423),
 (3.22,3.68,.423,.331,.337),(3.39,3.66,.333,.287,.245)]
# z, half-width, lip/cutting edge, cranial roof.
SKULL=[(2.80,.20,3.47,3.86),(2.98,.436,3.38,4.06),(3.20,.548,3.40,4.245),
 (3.38,.586,3.43,4.27),(3.57,.548,3.46,4.205),(3.77,.477,3.47,4.16),
 (4.00,.435,3.455,4.135),(4.24,.396,3.44,4.09),(4.46,.354,3.455,4.035),
 (4.66,.304,3.47,3.98),(4.82,.219,3.49,3.91),(4.94,.106,3.54,3.82),(4.979,.015,3.62,3.72)]
# z, half width, dorsal lip and lower dentary edge.
JAW=[(2.94,.21,3.46,3.24),(3.12,.427,3.49,3.13),(3.34,.485,3.51,3.04),
 (3.57,.478,3.515,2.992),(3.81,.411,3.49,3.012),(4.08,.365,3.472,3.077),
 (4.36,.316,3.475,3.14),(4.62,.253,3.49,3.218),(4.79,.162,3.51,3.29),(4.889,.046,3.55,3.40)]
EYE=(.523,4.015,3.493)
LEGS=[(.62,3.02,-.74),(.72,1.94,.04),(.64,.940,-.87),(.64,.146,-.46)]
ARM=[(.51,2.93,1.64),(.64,2.55,1.42),(.70,2.525,1.86)]
SEAT=(0,4.12,.49)
def mirror(p,sign):return (sign*p[0],p[1],p[2])
BONES=[]
def bone(n,parent,a,b):BONES.append((n,parent,a,b))
bone("pelvis",None,(0,3.02,-.74),(0,3.03,.28))
bone("chest","pelvis",(0,3.03,.28),(0,3.10,1.64))
bone("neck_1","chest",(0,3.10,1.64),(0,3.36,2.36))
bone("neck_2","neck_1",(0,3.36,2.36),(0,3.63,3.04))
bone("skull","neck_2",(0,3.63,3.04),(0,3.7,4.90))
bone("jaw","skull",(0,3.43,3.08),(0,3.40,4.86))
tail=[(0,3.02,-.74),(0,2.89,-2.13),(0,2.47,-3.43),(0,2.05,-4.64),(0,1.72,-5.86),(0,1.51,-7.12)]
for i,(a,b) in enumerate(zip(tail,tail[1:])):bone('tail_'+str(i+1),'pelvis' if i==0 else 'tail_'+str(i),a,b)
for side,sign in [('l',1),('r',-1)]:
 def paired(n,parent,a,b):bone(n+'_'+side,parent,mirror(a,sign),mirror(b,sign))
 for i,n in enumerate(('thigh','shank','metatarsus')):
  paired(n,'pelvis' if i==0 else ('thigh','shank')[i-1]+'_'+side,LEGS[i],LEGS[i+1])
 paired('toes','metatarsus_'+side,LEGS[-1],(.65,.075,.24))
 paired('humerus','chest',ARM[0],ARM[1]);paired('forearm','humerus_'+side,ARM[1],ARM[2])
 paired('manus','forearm_'+side,ARM[2],(.71,2.42,2.06))
 paired('eye','skull',EYE,(EYE[0],EYE[1],EYE[2]+.081))
 paired('lid','skull',EYE,(EYE[0],EYE[1]+.051,EYE[2]+.03))
