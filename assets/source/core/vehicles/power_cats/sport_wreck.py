"""Settled mud, salt and surviving finishes on the swamped sport cat."""
import numpy as np

from paint import fade,noise,wave
from wear import cells
from sport_wear import acrylic,pane_uv


def swamp(coat,m,form,height,up,decay):
    f=m.f
    x,y,z=f.x,f.y,f.z
    water=height-form.water
    wet=fade(.16,-.24,water)
    sun=np.maximum(up,0)*f.ao
    chalk=fade(-.06,.70,m.cloud+.33*m.mottle+.44*sun)
    shade=1-f.ao
    # Sound enamel persists in sheltered recesses above the long-standing tide.
    coat.rough+=(1-coat.rough)*(.13+.21*sun)
    coat.lay(f.gelcoat*(.16+.62*chalk)*(.90-.32*wet),(202,204,191),.74,grain=m.tone*.32)
    old=decay[:,3]
    rust=(decay[:,0].astype('i2')-decay[:,2]>40)&(decay[:,0]>95)&(old>0)
    coat.lay(rust*(.49+.37*shade)*(1-.66*wet),decay[:,:3],.78,grain=m.grit*3)
    seat=f.upholstery
    cloth=fade(-.35,.52,m.cloud+.58*m.mottle+.50*shade)
    hem=np.minimum(y-f.low[1],f.high[1]-y)
    coat.lay(seat*(.26+.30*sun+.19*cloth),(176,173,150),.84,grain=m.tone*.48)
    damp=seat*cloth*(.28+.39*fade(.105,.009,hem)+.29*wet)
    coat.lay(damp,(83,87,64),.71,grain=m.tone*.71)
    _,_,speck,_=cells((x+z*.33)*62,(y+.57*z)*66,995)
    coat.lay(damp*fade(1.1,.37,speck),(53,59,44),.81,grain=4*m.grit)
    motor=f.on("outboard cowling")|f.on("gear leg")|f.on("intake grille")|f.on("cavitation plate")
    coat.lay(motor*(.22+.46*chalk),(109,115,105),.67,grain=m.tone*.59)
    grime=fade(-.31,.55,noise(z*3+x*21,y*.91,z*1.8,2)+.41*m.cloud)
    coat.lay(motor*wet*grime,(66,75,57),.55,grain=m.tone*.61)
    steel=f.is_tag("metal")
    coat.lay(steel*(.13+.58*shade+.17*wet)*(.61+.48*grime),(130,122,95),.53,.50,grain=m.tone*.43)
    glass=f.glass
    u,v,key=pane_uv(f)
    drip=noise(x*21+z*18,y*1.47,z*.53,0)
    haze=fade(-.29,.63,.68*m.cloud+.38*m.mottle+.49*drip+shade*.4)
    coat.lay(glass*(.24+.60*haze),(143,155,144),.48,grain=m.tone*.32)
    crust=fade(.018,.002,abs(v-.71+.032*drip+.13*u))
    coat.lay(glass*crust*(.37+.31*haze),(171,174,151),.77)
    # The low quarter pane has broken inward, away from the open passage to the bow.
    for pane in (81,86):
        ix=np.flatnonzero(glass&(key==pane))
        if not ix.size: continue
        frost,aperture=acrylic(pane,False)
        h,w=frost.shape
        coords=(np.minimum((v[ix]*h).astype(int),h-1),np.minimum((u[ix]*w).astype(int),w-1))
        frost_map=np.zeros_like(y);frost_map[ix]=frost[coords]
        coat.lay(frost_map,(185,199,186),.56)
        hole=np.zeros_like(y);hole[ix]=(aperture[coords]==255)
        coat.lay(hole,(25,33,31),.84,grain=m.cloud*6+9*(v>.83))
        coat.ao*=1-hole*.44
    screen=f.is_tag("chart")
    edge=np.minimum.reduce((u,v,1-u,1-v))
    coat.lay(screen,(35,46,45),.36,grain=3*drip)
    coat.lay(screen*fade(.33,.015,edge)*(.32+.43*haze),(100,111,100),.51,grain=m.tone*.40)
    cockpit=f.on("tunnel bridge and cockpit sole")|f.on("aft bench storage")|f.on("seat pedestal")|f.on("boarding intermediate step")
    drift=noise(x*3+z*.75,y*1.6,z*4.6,1)
    mud=fade(.20,-.19,water+.13*m.cloud)*(.36+.50*sun+.22*shade)
    coat.lay(cockpit*mud,(113,105,79),.71,grain=14*drift+m.tone*.60)
    comb=wave(19*(z+x*.21)+.95*drift+.21*m.mottle)
    coat.lay(cockpit*mud*fade(.41,.90,comb)*.69,(146,136,98),.76,grain=m.tone*.56)


def flooded_teak():
    from scipy.ndimage import gaussian_filter
    from paint import teak_fields,byte
    board,caulk,lip,bung,tone,grain=teak_fields()
    v,u=(np.indices(board.shape,np.float32)+.5)/len(board)
    rng=np.random.default_rng(69121)
    def field(sy,sx):
        a=gaussian_filter(rng.normal(size=u.shape).astype(np.float32),(sy,sx),mode="wrap")
        return a/max(.001,a.std())
    pool=field(54,38)
    thread=field(38,3)
    grit=field(2,1)
    luma=.76*grain+.87*tone+3*thread
    rgb=np.stack((153+luma,150+luma,130+luma),-1)
    damp=fade(-1.06,.94,pool+.26*thread+.15*wave(board*.373))*(.60+.34*lip)
    def wash(coverage,rgb_value,texture):
        rgb[:] += (np.asarray(rgb_value)+texture[...,None]-rgb)*coverage[...,None]
    wash(damp,(85,94,72),grain*.7+3*grit)
    wash(caulk*.93,(53,59,46),3*grit)
    pale=fade(-.05,1.17,-pool+.52*thread+.23*grit)
    rake=wave(22*v+u*4+.22*wave(2*u)+pool*.31)
    wash(pale*(.24+.21*rake),(165,152,117),grain*.4+2*grit)
    # Narrow strands hooked on caulk. Each blade wraps on the same deck square.
    weed=np.zeros_like(u)
    for _ in range(6):
        ud,vd=rng.random(2)
        for _ in range(4):
            x=(u-ud-rng.uniform(-.025,.025)+.5)%1-.5
            y=(v-vd-rng.uniform(-.026,.026)+.5)%1-.5
            angle=rng.uniform(-1.2,1.2)
            along=x*np.sin(angle)+y*np.cos(angle)
            across=x*np.cos(angle)-y*np.sin(angle)
            t=along/rng.uniform(.024,.063)
            bend=.008*t*t+.003*np.sin(3*t)
            blade=fade(.0027,.0006,abs(across-bend))*fade(1,.58,abs(t))
            weed=np.maximum(weed,blade)
    wash(weed*(.68+.19*fade(-.6,.4,grit)),(56,67,40),grit*3)
    rough=.71+.043*grit-.17*damp+.10*caulk-.10*weed
    ao=1-.15*caulk-.045*lip
    base=byte(np.dstack((rgb,np.full_like(v,255))))
    packed=byte(np.stack((ao,rough,np.zeros_like(v)),-1)*255)
    return base,packed,np.zeros_like(packed)
