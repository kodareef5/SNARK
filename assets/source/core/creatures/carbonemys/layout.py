"""Original Carbonemys dimensions in native metres: x left, y up, z forward."""
from math import pi, sqrt, sin, cos

# Adjacent scutes share clipped boundaries. Slightly different growth centres
# give the medial and paired lateral keratin shields their own worn peaks.
SCUTES = []
for i, z in enumerate([-.79,-.415,-.02,.38,.76]):
    SCUTES.append((.016*sin(i*2.1),z,'spinal',i))
for side in [-1,1]:
    for i,z in enumerate([-.64,-.22,.22,.62]):
        SCUTES.append((side*(.50+.095*(1-abs(z))),z+.012*side*sin(i),'costal',i))
for i in range(24):
    a = 2*pi*(i+.5)/24
    SCUTES.append((.987*sin(a),.987*cos(a),'marginal',i))

def carapace(x,z):
    r=sqrt(x*x+z*z)
    rim=.795+.068*z-.033*z*z
    return (1.245*x*(1-.083*z-.040*z*z),rim+.945*max(0,1-r*r)**.64,-.075+1.70*z)

def height(x,z):
    nz=(z+.075)/1.70
    nx=x/(1.245*(1-.083*nz-.040*nz*nz))
    return carapace(nx,nz)[1]

BONES=[('shell',None,(0,.85,0),(0,.85,.5)),
       ('shell_l','shell',(.65,.97,-.10),(.65,.97,.38)),('shell_r','shell',(-.65,.97,-.10),(-.65,.97,.38)),
       ('plastron','shell',(0,.55,-.10),(0,.55,.35)),
       ('neck_1','shell',(0,.92,1.04),(0,1.04,1.40)),
       ('neck_2','neck_1',(0,1.04,1.40),(0,1.20,1.70)),
       ('neck_3','neck_2',(0,1.20,1.70),(0,1.20,1.96)),
       ('skull','neck_3',(0,1.20,1.96),(0,1.23,2.54)),
       ('jaw','skull',(0,1.155,2.05),(0,1.11,2.55)),
       ('tail_1','shell',(0,.70,-1.10),(.037,.58,-1.57)),
       ('tail_2','tail_1',(.037,.58,-1.57),(.11,.49,-2.13))]
LEGS={}
for side,sign in [('l',1),('r',-1)]:
    for kind,zz in [('fore',.88),('hind',-.84)]:
        hip=(sign*.73,.76,zz)
        knee=(sign*1.115,.435,zz+(-.22 if kind=='fore' else .26))
        ankle=(sign*1.14,.112,zz+(.115 if kind=='fore' else -.115))
        toe=(sign*1.24,.085,ankle[2]+.285)
        key=kind+'_'+side
        LEGS[key]=(hip,knee,ankle,toe)
        for name,parent,a,b in [(kind+'_upper','shell',hip,knee),(kind+'_lower',kind+'_upper_'+side,knee,ankle),(kind+'_foot',kind+'_lower_'+side,ankle,toe)]:
            BONES.append((name+'_'+side,parent,a,b))

# Six instance dyes. Muted natural colours remain separable in ordinary daylight.
DYES=['586345','8e713e','6f482e','a28c51','453a31','bcaa7b']
