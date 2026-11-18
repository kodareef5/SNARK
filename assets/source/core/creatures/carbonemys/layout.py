"""Original Carbonemys dimensions in native metres: x left, y up, z forward."""
from math import pi, sqrt, sin, cos, exp, atan2

# Adjacent scutes share clipped boundaries. Slightly different growth centres
# give the medial and paired lateral keratin shields their own worn peaks.
SCUTES = []
for i, z in enumerate([-.79,-.415,-.02,.38,.76]):
    SCUTES.append((.046*sin(i*2.1),z,'spinal',i))
for side in [-1,1]:
    for i,z in enumerate([-.64,-.22,.22,.62]):
        SCUTES.append((side*(.48+.129*(1-abs(z))),z+.044*side*sin(i*1.63+.47),'costal',i))
for i in range(24):
    a = 2*pi*(i+.5)/24
    SCUTES.append((.987*sin(a),.987*cos(a),'marginal',i))

def smooth(a,b,t):
    q=max(0,min(1,(t-a)/(b-a)))
    return q*q*(3-2*q)

def width_at(z):
    return 1.265*(1-.077*z-.047*z*z+.075*exp(-((z+.43)/.34)**2)-.07*exp(-((z-.74)/.23)**2))

def carapace(x,z):
    ang=atan2(x,z);r=sqrt(x*x+z*z)
    boundary=smooth(.70,.99,r)
    # The anterior nuchal opening recedes between paired epiplastral shoulders.
    notch=.255*smooth(.53,.94,z)*exp(-(x/.205)**2)
    rear=smooth(.16,.88,-z)
    # Irregular, swept posterior marginals. Scallops lift and flare with the
    # keratin shields; the front rim remains rounded above the retracted neck.
    scallop=(.5+.5*cos(24*ang+.66*sin(5*ang)+.33*sin(3*ang)))**2.2
    skirt=boundary*(.013+.106*rear)*scallop*(.50+.50*(.5+.5*sin(5*ang-.73)))
    X=x*(width_at(z)+skirt)
    Z=-.075+1.70*z-notch+z*skirt*(1+.46*rear)
    arc=.14*exp(-((abs(x)-.69)/.25)**2-((z-.66)/.30)**2)
    arc+=.075*exp(-((abs(x)-.82)/.28)**2-((z+.56)/.28)**2)
    rim=.790+.065*z-.034*z*z+boundary*(arc-.081*rear*scallop)+.46*notch
    oblong=max(0,1-r*r)
    vault=(.848+.051*exp(-((z+.36)/.43)**2))*oblong**.66
    # A long vertebral buttress flows continuously under successive scutes,
    # steep on the rear quarter and worn low towards the riding position.
    crest=(.047+.191*exp(-((z+.34)/.64)**2))*exp(-((x-.026*sin(4*z))/.265)**2)*oblong
    flank=.088*exp(-((abs(x)-.53-.065*z-.018*sin(5*z))/.17)**2)*oblong*(1-.34*z)
    return X,rim+vault+crest+flank,Z

def shell_parameters(x,z):
    nz=(z+.075)/1.7
    for _ in range(5):
        nx=x/width_at(nz)
        X,Y,Z=carapace(nx,nz)
        nz+=(z-Z)/1.7
    return x/width_at(nz),nz

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
