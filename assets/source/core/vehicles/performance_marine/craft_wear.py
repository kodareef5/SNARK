"""Impacts and marina deposits on the three smaller hulls, in metres."""
import numpy as np
from PIL import Image

from abrasion import breach, fracture, mix, score
from craft_finish import DRAFT, SAMPLE, fields
from paint import HERE, Surface, ramp, surface_strips
from wear import ALLOY, FIBRE, QUAY, displayed, fitting_runs, hash_cell, mark_fields, shells, tide_fields, torn_cover


# Bow and stern strikes, fender contact, keel length, and the source of the fire.
EVENTS={
    "riptide": ((.91,.365,.186,.091),(-1.49,.245,.166,.074),(-.28,.278,.66,.032),.98,(.077,-.30,.255,.47)),
    "jon_boat": ((1.29,.315,.233,.110),(-1.73,.347,.233,.135),(-.16,.403,.99,.046),1.36,(-.28,-1.32,.35,.56)),
    "needle": ((3.10,.772,.43,.151),(-4.46,.66,.39,.155),(-.85,.76,1.93,.071),2.92,(-.29,-3.11,.53,.88)),
}
# The first source is at the fire's seat. Its tail bends across the cockpit.
def heat(p,vessel):
    x,y,z=p.T
    cx,cz,w,l=EVENTS[vessel][-1]
    u=(x-cx)/w
    v=(z-cz)/l
    def plume(u,v):
        core=np.exp(-1.36*((u-.21*v+.08*np.sin(2*v))**2+v*v))
        smoke=np.exp(-((u-.31*v+.11*np.sin(3*v))/(.64+.20*np.tanh(v)))**2-((v-.69)/1.72)**2)
        return core,smoke
    core,smoke=plume(u,v)
    if vessel=="needle":
        h,s=plume((x-.055)/.265,(z+.38)/.64)
        core,smoke=np.maximum(core,h*.89),np.maximum(smoke,s)
    if vessel=="riptide":
        h,s=plume((x-.105)/.248,(z-.40)/.43)
        core,smoke=np.maximum(core,.91*h),np.maximum(smoke,.87*s)
    if vessel=="jon_boat":
        h,s=plume((x-.49)/.22,(z+.09)/.29)
        core,smoke=np.maximum(core,h*.68),np.maximum(smoke,s*.76)
    return core,smoke


def burn(m,s,f,vessel):
    top=f["deck"]|f["upholstery"]|f["timber"]|s.on("saddle","transom board","bench","remote","dashboard","scoop","hatch","cowling","console","plinth","pedestal","instrument hood","footboard")
    b=m.take(top)
    x,y,z=b.xyz
    core,soot=heat(b.pos,vessel)
    weight=np.maximum(ramp(.019,.64,core),.82*ramp(.035,.82,soot))
    colour=mix((107,106,99),(143,92,53),ramp(.09,.32,core))
    colour=mix(colour,(23,22,21),ramp(.28,.68,core))
    scale=.026
    u,v=(x+.45*y)/scale,(z+.53*y)/scale
    iu,iv=np.floor(u),np.floor(v)
    r=np.hypot(u-iu-.18-.61*hash_cell(iu,iv,91),v-iv-.18-.61*hash_cell(iu,iv,83))
    bubble=np.exp(-((r-.25)/.076)**2)-.76*np.exp(-(r/.17)**2)
    colour+=((27*bubble*(1-ramp(.54,.82,core))+6*(b.fine-.5))*ramp(.14,.38,core))[:,None]
    slit=np.abs(x-.067*np.sin(11*z)-.008*np.sin(53*z))
    shrunk=f["upholstery"][b.i]*ramp(.043,.007,slit)*ramp(.13,.68,core)
    colour=mix(colour,(9,10,10),shrunk)
    if vessel=="riptide":
        # Across the step the hot skin shrinks away from one side of a tucked seam.
        along=(z+.31)/.30
        seam=x-.028-.074*(z+.31)-.008*np.sin(9*along)
        half=.019*np.maximum(0,1-along**2)
        tear=f["saddle"][b.i]*(abs(along)<1)*ramp(half+.004,half*.61,np.abs(seam))
        lip=tear*ramp(.15,.86,seam/(half+.001))
        colour=mix(colour,(10,11,10),tear)
        colour=mix(colour,(126,104,73),lip*.72)
    arrival=.19+1.93*ramp(.17,.73,core)+.55*(1-ramp(.08,.35,weight))
    b.hit(weight>.066,arrival,mix(b.ground,colour,weight))


def sheet_tear(b,u,v,w,h,seed):
    # Two creases meet at the open fold. The turned lip is dull on one face and bright on the other.
    a,c=u/w,v/h
    k=.19*np.abs(a+.25)-.14-.11*a+.052*np.sin(8*a)
    t=np.maximum(0,1-np.abs(a))
    fold=c-k
    envelope=np.exp(-3*(np.abs(a)**3+.62*fold**2))
    b.hit(envelope>.14,.30+.45*b.flake,mix(b.ground,(91,100,101),envelope*.66))
    for off,slope,span in ((.12,.50,1.35),(-.28,-.35,1.09),(.58,-.15,.71)):
        score(b,u-off*w,v-slope*u-.1*h,span*w,.045*h,.34*h,.46,ALLOY)
    half=.73*t**.67*(.89+.10*np.cos(8*a+seed)+.08*b.flake)
    edge=np.abs(fold)/(half+.008)
    folded=(edge<1.40)&(t>0)
    b.hit(folded,1.08+.38*b.grain,mix((73,79,78),(203,202,188),.37+.41*np.sign(fold)*np.cos(edge*4)+.12*b.fine))
    inside=(t>0)&(edge<.87+.056*np.sin(11*a))
    b.hit(inside,2.05+.14*b.flake,mix((8,12,13),(54,59,55),.63*ramp(.35,.94,edge)))
    lip=folded&(fold>0)&(edge>.83)&(edge<1.09)
    b.hit(lip,1.38+.34*b.flake,mix((136,143,139),(228,224,202),b.grain))


def wound(b,u,v,w,h,vessel,seed):
    if vessel=="jon_boat":
        sheet_tear(b,u,v,w,h,seed)
    else:
        breach(b,u,v,w,h,seed,.14 if vessel=="needle" else -.18)


def hull_damage(m,s,f,vessel):
    bow,stern,quay,keel,_=EVENTS[vessel]
    x,y,z=m.xyz
    skin=f["side"]
    material=ALLOY if vessel=="jon_boat" else FIBRE
    b=m.take(skin&(x>0))
    _,y,z=b.xyz
    zz,yy,w,h=bow
    wound(b,z-zz,y-yy,w,h,vessel,431)
    zz,yy,l,w=quay
    t=(z-zz)/l
    track=y-yy-w*(.64*t+.57*t*t)
    soft=np.maximum(0,1-t*t)
    span=soft*w*(.79+.34*b.flake)
    rubber=ramp(span+.006,span*.45+.001,np.abs(track))*soft
    drag=.70+.22*np.cos(track*210+b.flake*3)
    b.hit(rubber>.055,.22+.43*b.flake,mix(b.ground,(27,29,27),rubber*drag))
    score(b,z-zz,track+.29*w,l*.91,w*.41,w*.41,1.12,material)
    score(b,z-zz-l*.19,track-w*.72,l*.82,w*.125,.22*w,.47,QUAY)
    x,y,z=m.xyz
    zz,yy,w,h=stern
    corner=(f["transom"]|skin|s.on("transom board"))&(x<-.16*f["beam"])&(z<zz+w*2.3)
    b=m.take(corner)
    x,y,z=b.xyz
    u=np.where(f["transom"][b.i],-x-.90*f["beam"][b.i],z-zz)
    wound(b,u-.13*w,y-yy,w,h,vessel,926)
    b=m.take(skin&(m.pos[:,0]<0))
    _,y,z=b.xyz
    for a,v,span in ((.58,.48,.33),(-.66,.87,.48),(-.22,.21,.23)):
        centre=a*keel
        cy=f["chine"][b.i]+v*(f["sheer"][b.i]-f["chine"][b.i])
        score(b,z-centre,y-cy-.021*(z-centre),span*keel,.012+.009*w,.01,.43,QUAY)
    bottom=(f["exterior"]&(s.N[:,1]<-.19))|s.on("strake","sponson")
    b=m.take(bottom)
    x,y,z=b.xyz
    for offset,station,length,width in ((.012,.13,1,.052),(-.065,.55,.63,.024),(.53,.05,.88,.032),
                                       (-.70,-.21,.67,.025),(.75,.68,.55,.021)):
        u=z-station*keel
        v=x-offset*f["beam"][b.i]-.010*np.sin(5*z+.6)
        score(b,u,v,keel*length,width*(.47+.22*keel),.015,.29,material)
        if offset==.012:
            half=(.029+.015*keel)*np.maximum(0,1-(u/keel)**2)
            groove=np.abs(v)<half
            b.hit(groove,1.14+.32*b.flake,mix(material[1],material[2],b.grain))
            slit=np.abs(v+.23*half)<half*.29
            b.hit(groove&slit,2.08+.40*b.grain,mix(material[0],material[1],b.grain*.47))


def cabin_damage(m,s,f,vessel):
    if vessel=="needle":
        b=m.take(f["glass"])
        x,y,z=b.xyz
        u=x+np.sign(x)*np.maximum(0,.33-z)*.62-.23
        v=y-1.337
        fracture(b,u,v,.43,.17,218,.06,glass=True)
        facet=np.maximum.reduce((u/.152+.52*v/.090,-u/.112-v/.112,.52*u/.13-v/.082,v/.12-.33*u/.14))
        b.hit(facet<.67,2.04+.27*b.grain,mix((8,16,19),(53,72,73),ramp(.32,.73,facet)))
        b.hit((facet>=.67)&(facet<.72),1.49+.27*b.flake,mix((82,105,105),(176,190,183),b.grain))
    b=m.take(f["upholstery"])
    x,y,z=b.xyz
    seats=(-.64,-1.80) if vessel=="needle" else (-.25,-.89)
    for k,cz in enumerate(seats):
        torn_cover(b,x+.036+.022*k,z-cz-.41*x,.144 if vessel=="needle" else .096,.021,58+k)
    if vessel=="jon_boat":
        b=m.take(s.on("rolled metal thwart","bench flotation","folded side console"))
        x,y,z=b.xyz
        score(b,x+.16,z+.66-.26*x,.39,.014,.038,.42,ALLOY)
        score(b,x-.09,z-.51+.42*x,.29,.021,.029,1.13,ALLOY)
        a=m.take(f["timber"])
        x,y,z=a.xyz
        score(a,x+.05,y-.45-.19*x,.16,.019,.011,1.04,((64,52,40),(143,114,69),(209,179,125)))
    burn(m,s,f,vessel)
    if vessel=="riptide":
        b=m.take(f["mats"])
        x,y,z=b.xyz
        rubber=((32,34,32),(104,109,98),(150,149,133))
        for cx,cz,lean in ((.38,-.32,.21),(-.35,-.8,-.31),(.24,-1.53,-.51)):
            score(b,z-cz,x-cx-lean*(z-cz),.175,.014,.009,.46,rubber)
        b=m.take(f["glass"])
        x,y,z=b.xyz
        u,v=x-.043,z-.353
        fracture(b,3*u,3*v,.237,.090,639,.18,glass=True)
        wedge=np.maximum.reduce((u/.055+.51*v/.023,-u/.042-.56*v/.035,v/.021-.10*u/.055,-v/.026))
        b.hit(wedge<.84,2.05+.23*b.flake,mix((8,14,15),(51,67,66),ramp(.46,.86,wedge)))
    b=m.take(s.on("leg","gearcase","skeg","nozzle","cowling","remote","switch pod"))
    x,y,z=b.xyz
    scars=np.cos(22*y+31*z)*.21+.42*b.flake+.31*b.grain
    b.hit(scars>.60,.56+.57*b.grain,mix((96,102,98),(186,186,164),b.flake))


def deposits(m,s,f,vessel):
    x,y,z=m.xyz
    dry=f["deck"]|f["side"]|f["transom"]|s.on("scoop","bench","console","cowling","saddle","hood","footboard")
    b=m.take(dry)
    x,y,z=b.xyz
    up=f["top"][b.i]
    exposure=.36*up+.40*b.cloud+.22*b.flake+.19*b.grain
    chalk=ramp(.41,.95,exposure)*(.63+.33*b.flake)
    tone=(172,175,153) if vessel=="jon_boat" else (213,213,195)
    b.age(chalk>.23,1.04+.79*(1-chalk),mix(b.ground,tone,chalk*.79))
    salt=(b.grain>.67)&(b.flake>.59)&(b.cloud>.52)
    b.age(salt,.29+.51*b.grain,mix((163,170,152),(216,216,190),b.fine))
    # The runs start at hardware stations on the deck edge and drip down the exterior.
    fittings={"needle":(-3.81,2.14,.65,-4.02,-3.44,-2.75),
              "jon_boat":(-1.52,-1.10,-.65,-.21,.18,.52,.94,1.40,1.79,1.96),
              "riptide":(-1.32,-1.08,-.78,-.52,.54,.63)}
    for station in fittings[vessel]:
        near=(abs(z-station)<.083)&((f["side"][b.i])|((abs(x)>.71*f["beam"][b.i])&(up>.1)))
        a=b.take(near)
        down=f["sheer"][a.i]-a.pos[:,1]
        fitting_runs(a,a.pos[:,2]-station,down,.31 if vessel=="needle" else .19,.018)
    b=m.take(f["upholstery"]|f["timber"]|f["glass"]|s.where("tread"))
    x,y,z=b.xyz
    stain=.46*b.cloud+.32*b.flake+.22*b.grain
    cover=f["upholstery"][b.i]
    mildew=cover*(.55+.45*np.cos(x*29))*ramp(.45,.68,stain)
    b.age(mildew>.22,1.10+.50*(1-mildew),mix(b.ground,(90,95,74),mildew*.91))
    b.age(cover&(stain>.645),2.11+.42*b.flake,mix((43,52,43),(102,102,73),b.grain))
    wood=f["timber"][b.i]
    fibre=.5+.5*np.cos(365*y+7*b.flake+2*np.sin(23*x))
    b.age(wood&(stain>.42),1.04+.89*b.flake,mix((103,95,79),(185,181,155),.52*b.cloud+.46*fibre))
    glass=f["glass"][b.i]
    spots=np.cos(85*x+17*z+.4*np.sin(32*y))*np.cos(87*y+3*b.flake)
    b.age(glass&(spots+stain>1.07),.26+.49*b.grain,mix(b.ground,(191,198,175),.34+.3*b.fine))
    b.age(glass&(stain>.54),1.31+.37*b.cloud,mix(b.ground,(152,167,157),.3+.37*b.flake))
    if vessel=="needle":
        p=b.take(glass)
        u=p.pos[:,0]+.34
        v=p.pos[:,1]-1.305
        fracture(p,u,v,.29,.16,831,1.42,glass=True,decay=True)
        lost=(u+.65*v<-.08)&(u-.33*v>-.31)&(v>.018)
        p.age(lost,2.22+.35*p.flake,mix((10,20,22),(63,74,70),p.flake))
    if vessel=="riptide":
        a=m.take(f["mats"]|f["saddle"])
        x,y,z=a.xyz
        grooves=.5+.5*np.cos((z-.72*abs(x))*(2*np.pi/.041))
        must=ramp(.47,.78,.49*a.cloud+.28*a.flake+.18*grooves+.12*a.grain)
        a.age(must>.27,1.38+.51*(1-must),mix(a.ground,(91,99,72),must))
        a.age((must>.67)&(a.fine>.43),2.19+.44*a.flake,mix((38,48,37),(80,84,64),a.flake))
        a=m.take(f["saddle"])
        x,y,z=a.xyz
        channel=abs(z+.52-.071*x-.008*np.sin(39*x))
        split=(channel<.008+.01*a.flake)&(abs(x+.032)<.075)
        a.age(split,2.18+.44*a.flake,mix((69,57,39),(153,131,85),a.grain))
    if vessel=="jon_boat":
        flange=f["weld"]+.85*f["washer"]+.65*f["seam"]
        brine=ramp(.34,.74,.50*m.cloud+.33*m.flake+.22*m.grain)
        m.age((flange>.28)&(brine>.25),1.38+.43*m.grain,mix((124,138,124),(216,215,190),brine))
        a=m.take(s.where("aluminium","olive")|s.on("transom","cowling"))
        white=ramp(.48,.73,.43*a.cloud+.35*a.flake+.24*a.grain)
        a.age(white>.32,1.13+.60*(1-white),mix(a.ground,(193,198,178),white))
        a.age((white>.68)&(a.fine>.62),2.05+.54*a.flake,mix((70,81,73),(145,151,131),a.grain))


def water_deposits(m,s,f,height,water):
    b=m.take(f["water_surface"]&(height<water+.16))
    x,_,z=b.xyz
    y=height[b.i]
    under,belt,crust,growth,blades=tide_fields(b,y,water)
    lime=mix((51,69,38),(142,140,68),.59*b.cloud+.31*b.fine)
    b.age(under>.08,2.17-.33*b.cloud,mix((46,61,43),(119,117,66),growth))
    b.age(blades>.13,1.35+.49*b.cloud,mix((39,61,34),(101,119,59),blades))
    b.age(belt>.11,.27+.51*(1-belt),mix(b.ground,lime,belt*.89))
    b.age(crust*(.4+.6*b.grain)>.38,.39+.49*b.grain,mix((150,155,123),(222,218,179),b.grain))
    shells(b,np.where(f["transom"][b.i],x,z),y+.61*abs(x)*np.maximum(0,-s.N[b.i,1]),
           np.clip(2.1*(growth-.28),0,.91)*np.maximum(under,belt*.37))


def shell(vessel):
    folder=HERE.parent/vessel/"tex"
    surface=Surface(folder/"bakes","shell")
    base,mask=[np.asarray(Image.open(folder/f"shell_{role}.png").convert("RGB")).reshape(-1,3) for role in ("base","mask")]
    layers=[np.empty((surface.n,4),np.uint8) for _ in range(2)]
    for section,s in surface_strips(surface):
        f=fields(s,vessel)
        m=mark_fields(s,displayed(base[section],mask[section],SAMPLE[vessel]))
        if vessel=="jon_boat":
            cabin_damage(m,s,f,vessel)
            hull_damage(m,s,f,vessel)
        else:
            hull_damage(m,s,f,vessel)
            cabin_damage(m,s,f,vessel)
        deposits(m,s,f,vessel)
        water_deposits(m,s,f,s.P[:,1],DRAFT[vessel])
        m.decay[m.hurt[:,3]>0]=0
        layers[0][section],layers[1][section]=m.hurt,m.decay
    return [a.reshape(surface.size,surface.size,4) for a in layers]
