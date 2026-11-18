"""Paint staged damage and decay on a small craft and its shared fittings."""
import argparse
import sys

sys.dont_write_bytecode = True

import numpy as np
from PIL import Image

from paint import HERE, Surface, noise, ramp, surface_strips, teak_fields, thunderbolt_fields
from abrasion import Marks, breach, fracture, mix, score
from fitting_wear import hardware_wear


QUAY = ((57,60,57),(159,157,138),(218,207,175))
FIBRE = ((92,83,64),(201,183,145),(239,232,207))
ALLOY = ((41,46,45),(137,144,139),(217,214,193))
UPHOLSTERY = ((72,61,51),(165,145,113),(211,192,154))


def group_scores(b, u, v, tracks, colors):
    for along, across, span, width, slope, bend, stage in tracks:
        along = u-along
        score(b, along, v-across-slope*along, span, width, bend, stage, colors)


def hull_hurt(m, s, f):
    x,y,z = m.xyz
    outer = f["hull"] & ~f["transom"] & (y<f["sheer"]-.012) & (np.abs(x)>.60*f["beam"])
    for port in (True,False):
        b = m.take(outer & ((x>0)==port))
        _,y,z = b.xyz
        sheer = f["sheer"][b.i]
        if port:
            # Black fender rubber burnishes a long oval, with a single ploughed groove.
            along = (z+.94)/2.35
            center = 1.025+.062*along+.041*along**2
            across = y-center
            taper = np.maximum(0,1-along**2)
            half = .102*taper*(.91+.20*b.flake)
            smear = ramp(half+.009,half*.55+.001,np.abs(across))*taper
            contact = (.75+.25*np.cos(across*88+.7*np.sin(z*3)))
            b.hit(smear>.055,.26+.29*b.flake,mix(b.ground,(21,24,25),smear*contact))
            u = (z+1.12)/1.62
            track = across+.051-.020*u-.006*np.sin(7*u)
            half = .071*np.maximum(0,1-u*u)*(.78+.42*b.flake)
            groove = np.abs(track)<half
            b.hit(groove,1.12+.47*np.abs(u),mix((106,90,65),(214,198,159),.30+.43*b.grain))
            b.hit(groove&(track<half*.18)&(track>-half*.63),2.02+.30*b.grain,
                  mix((26,24,22),(75,58,40),.53*b.flake))
            chip=groove&(track>.52*half)&(.63+.24*np.cos(4*u)+.20*b.flake>.66)
            b.hit(chip,1.25+.28*b.flake,mix((141,128,94),(227,215,175),.28+.47*b.grain))
            group_scores(b,z,y-sheer,[(-.14,-.066,2.23,.018,-.003,.013,.30)],QUAY)
            # One opening above the chine. The rest of the bow carries its stress cracks.
            breach(b,z-4.68,y-1.094,.71,.233,830,.135,.81*ramp(.91,1.27,y))
            group_scores(b,z,y,[(3.78,.989,.43,.019,.08,.019,.37)],QUAY)
        else:
            group_scores(b,z,y,[(-4.85,.91,.90,.040,.065,.041,.14),(-3.86,1.04,.51,.020,.085,.03,.49),
                                (1.32,1.12,.44,.012,-.02,.01,.56)],QUAY)
            fracture(b,z+4.23,y-.93,.32,.16,204,.37)
            group_scores(b,z,y-sheer,[(-4.98,-.074,.69,.021,.016,.02,.22)],QUAY)
    # Unfold the aft starboard corner so that one crushed opening turns onto the transom.
    x,y,z = m.xyz
    corner = (f["transom"] | (outer & (x<0))) & (z<-4.75) & (x<-.30)
    b = m.take(corner)
    x,y,z = b.xyz
    through = np.where(f["transom"][b.i],-1.17-x,z+5.87)
    breach(b,through-.07,y-.94,.56,.237,717,.16,.65*ramp(.89,1.18,y))
    fracture(b,through+.43,y-.88,.27,.14,892,.36)
    bottom = (f["hull"] & (s.N[:,1]<-.24) & ~f["transom"]) | s.on("lifting strake")
    b = m.take(bottom)
    x,_,z = b.xyz
    beam = f["beam"][b.i]
    group_scores(b,z,x,[(.29,.012,3.83,.045,.013,.10,.14),(1.22,-.071,2.91,.021,.018,.074,.35),
                        (2.54,.095,1.82,.029,-.053,.085,.49),(-2.82,-.045,2.34,.025,.021,.041,.91)],FIBRE)
    for side,frac,at,span in ((1,.52,-.71,3.22),(-1,.76,-2.07,2.56),(1,.78,2.52,2.07),(-1,.51,2.30,1.68)):
        group_scores(b,z,x-side*frac*beam,[(at,.004,span,.038,.008,.02,.33),
                                          (at+.47,.047,span*.65,.015,.006,.013,.70)],FIBRE)
    # A rock planes away a flat in the V before the keel splits.
    t = (z-1.20)/2.35
    offset = x-.023-.061*np.sin(1.65*z)-.018*t
    patch = np.maximum(0,1-t*t)*(.105+.115*b.cloud)+.035*(b.flake-.5)
    peeled = (np.abs(t)<1)&(np.abs(offset)<patch)&(.56*b.flake+.44*b.grain>.30)
    fibres = .5+.5*np.cos(265*offset+2*np.sin(z*8)+3*b.grain)
    b.hit(peeled,1.19+.52*np.abs(t),mix((101,82,58),(195,165,111),.46*b.grain+.46*fibres))
    slit = peeled&(np.abs(offset+.026)<patch*.26)&(b.flake>.29)
    b.hit(slit,2.16+.39*b.grain,mix((38,39,35),(122,99,64),.38*b.grain+.41*fibres))
    shoulder = peeled&(np.abs(offset)>patch*.73)
    b.hit(shoulder,.76+.52*b.flake,mix((169,160,135),(236,231,208),.33+.49*b.grain))
    # The bow rides up the obstruction. The keel loses a long strip of gelcoat.
    group_scores(b,z,x,[(3.47,.005,1.64,.096,.029,.033,.22),(3.28,.13,1.08,.031,.10,.059,.55)],FIBRE)


def torn_cover(b,u,v,span,width,seed):
    t = u/span
    edge = .010*np.sin(7*t+seed)+.022*t*t+.008*(b.flake-.5)
    d = v-edge
    half = width*np.maximum(0,1-t*t)*(.75+.45*b.grain)
    inside = np.abs(t)<1
    line = inside & (np.abs(d)<half+.009)
    b.hit(line,.55+.63*t*t,mix((78,67,58),(161,146,117),b.flake))
    b.hit(inside & (np.abs(d)<half),1.22+.60*t*t,mix((54,43,34),(110,81,49),b.grain))
    foam = (d>-.56*half) & (d<.32*half) & (np.abs(t)<.80)
    b.hit(foam,1.57+.52*b.flake,mix((130,93,52),(216,183,123),.70*b.grain+.30*b.fine))
    b.hit(line & (d>half*.56),1.31+.42*b.flake,mix((158,143,128),(227,209,172),b.grain))


def glass_hurt(m,s,f):
    for roof in (False,True):
        b = m.take(f["glass"] & (s.on("skylight lid")==roof))
        x,y,z = b.xyz
        # Unfold the swept sides around the nose of the deflector.
        u = x if roof else x+np.sign(x)*np.maximum(0,.84-z)*.88
        v = z if roof else y
        strikes = ((-.13,2.43,.40,.32,36),(.115,3.62,.23,.27,85)) if roof else (
            (.48,1.745,.69,.31,827),(-.98,1.59,.55,.27,398),(1.52,1.59,.40,.12,701))
        for cx,cy,w,h,seed in strikes:
            a,c = (u-cx)/w,(v-cy)/h
            fracture(b,u-cx,v-cy,w,h,seed,.06,glass=True)
            # Whole angular shards release inside a larger field of radial crazing.
            shifted = np.maximum.reduce((1.4*(a-.30)+.55*(c+.11),-1.2*(a-.30)-.86*(c+.11),
                                         .2*(a-.30)-1.43*(c+.11),.81*(c+.11)-.63*(a-.30)))
            b.hit(shifted<.32,1.40+.23*b.flake,mix((64,91,96),(143,162,160),.40+.32*np.sin(6*a-3*c)))
            b.hit(shifted<.27,2.03+.17*b.flake,mix((7,14,17),(31,46,48),ramp(.09,.30,shifted)))
            # A compact crushed contact remains bright where the neighbouring facet dropped.
            polar=np.arctan2(c,a)
            splinter=.50+.50*np.sin(9*polar+seed+4*b.grain)
            radial=np.hypot(a+.19*c,c*.90)/(.056+.077*splinter)
            frost=np.exp(-1.6*radial**2)*(.45+.55*b.fine)
            b.hit((frost>.26)&(shifted>=.27),.24+.24*b.flake,mix((115,143,143),(224,230,216),frost))
            if seed==398:
                # The upper corner of the swept sheet has broken away in one piece.
                edge = .29*a+.27*np.abs(a-.1)+c+.13*np.sin(9*a)
                lost = (np.abs(a+.16)<.78)&(edge>.28)
                b.hit(lost,2.04+.35*b.grain,mix((17,30,34),(45,61,64),b.cloud))
                b.hit(lost&(edge<.34),1.57+.31*b.grain,mix((114,141,141),(177,190,175),b.fine))


def heat_fields(p):
    """Heat and wind-carried soot over the engine hatch and helm, in the mould frame."""
    x,y,z = p.T
    height = y-1.15
    heat = np.zeros_like(x)
    soot = np.zeros_like(x)
    for cx,cz,w,h in ((-.30,-3.97,.63,.95),(.51,.37,.42,.58),(-.36,-2.72,.25,.32)):
        v = z-cz
        u = x-cx-.19*v+.08*np.sin(3*v)
        core = np.exp(-((u/w)**2+((v-.12*height)/h)**2)*1.62)
        heat = np.maximum(heat,core)
        trail = v-.36*height
        spread = w*(.56+.27*np.tanh(trail))
        finger = np.exp(-((u-.19*trail-.09*np.sin(3.2*trail))/(spread+.05))**2)
        plume = np.exp(-((trail-.46)/(h*1.49))**2)*finger
        soot = np.maximum(soot,plume)
    return heat,soot


def fire_hurt(b,soft_cover):
    x,y,z=b.xyz
    heat,smoke=heat_fields(b.pos)
    strength=np.maximum(ramp(.035,.64,heat),.79*ramp(.028,.68,smoke))
    amber=mix((145,114,77),(102,65,37),ramp(.13,.52,heat))
    ink=mix((98,96,88),amber,ramp(.085,.28,heat))
    ink=mix(ink,(21,19,18),ramp(.29,.66,heat))
    ink=mix(ink,(11,13,13),ramp(.60,.89,heat))
    scale=.051
    iu,iv=np.floor(x/scale),np.floor((z+.45*y)/scale)
    a=x/scale-iu-.25-.49*hash_cell(iu,iv,483)
    c=(z+.45*y)/scale-iv-.25-.49*hash_cell(iu,iv,201)
    r=np.hypot(a,c)/(.12+.19*hash_cell(iu,iv,741))
    bubbles=np.exp(-((r-.76)/.28)**2)*(.43+.45*b.flake)
    blister=ramp(.17,.39,heat)*(1-ramp(.55,.74,heat))
    ink+=((bubbles*30-7*np.exp(-(r/.62)**2))*blister)[:,None]
    slit=np.abs(x+.16+.31*(z+3.9)-.033*np.sin(9*z))
    crease=soft_cover*ramp(.051,.007,slit)*ramp(.29,.68,heat)
    ink=mix(ink,(7,8,8),crease)
    # Heat has shrunk the vinyl skin across a seam. The rolled lip catches pale ash.
    for cx,cz,lean,span in ((-.30,-3.99,.11,.58),(-.55,-3.72,-.21,.42),(.54,-.28,.10,.18)):
        along=(z-cz)/span
        side=x-cx-lean*(z-cz)-.013*np.sin(9*along+.6)-.007*np.sin(14*along)
        half=.043*np.maximum(0,1-along**2)
        mouth=soft_cover*ramp(half+.009,half*.65,np.abs(side))*ramp(.09,.48,heat)*(np.abs(along)<1)
        lip=mouth*ramp(.24,.85,side/(half+.0002))
        ink=mix(ink,(9,8,7),mouth)
        ink=mix(ink,mix((95,69,43),(169,141,95),b.grain),lip*.83)
    # Small deposits of pale ash settle in the broken black skin.
    ash=ramp(.49,.78,heat)*(.085+.10*np.sin(13*x+2*np.sin(5*z))+.105*b.flake)
    ink=mix(ink,(135,130,114),ash)
    # Deposit a smooth coat from its own substrate. Alpha orders appearance only.
    arrival=.39+1.73*ramp(.16,.69,heat)+.19*(1-smoke)+.81*(1-ramp(.12,.40,strength))
    b.hit(strength>.078,arrival,mix(b.ground,ink,strength))


def cabin_hurt(m,s,f,wood):
    cover = f["upholstery"] | s.where("tobacco")
    for backs in (True,False):
        b = m.take(cover & (s.on("aft backrest","wraparound bucket")==backs))
        x,y,z = b.xyz
        if backs:
            for cx,cy,slope,seed in ((.57,1.57,-.53,15),(-.69,1.72,.25,46),(-.45,1.43,.52,88)):
                allowed = (z<-1.2) if seed==88 else (z>-1.2)
                t = b.take(allowed)
                torn_cover(t,x[allowed]-cx,(y-cy-slope*(x-cx))[allowed],.16,.024,seed)
        else:
            for cx,cz,slope,span,width in ((.68,-4.85,.42,.23,.034),(-.58,-3.61,-.76,.21,.029),
                    (-.31,-2.28,.24,.24,.030),(.64,-.32,.44,.17,.017),(.08,-4.23,.61,.20,.021)):
                torn_cover(b,x-cx,z-cz-slope*(x-cx),span,width,int((cz+6)*91))
    b = m.take(wood[0])
    x,_,z = b.xyz
    for cx,cz,span in ((-.96,-6.11,.35),(1.045,-6.27,.20),(.37,-1.63,.54),(-.08,-.61,.25)):
        group_scores(b,z-cz,x-cx,[(0,0,span,.018,.10,.012,.33),(.058,.032,.69*span,.009,.076,.008,.71)],FIBRE)
        ends = np.maximum(0,1-((z-cz)/span)**2)
        splinter = np.abs(x-cx-.10*(z-cz)) < ends*.021*(.25+b.grain)
        b.hit(splinter,1.52+.57*b.flake,mix((70,48,31),(209,165,101),.53*b.grain+.36*np.sin(x*510)**2))
    x,y,z = m.xyz
    upper = cover | s.on("engine cover gasket","moulded dashboard","port glove box","lounge base","cushion shell") | (
        f["hull"] & (s.N[:,1]>-.10) & (y>.66) & (np.abs(x)<f["beam"]*.96))
    b = m.take(upper)
    x,y,z = b.xyz
    fire_hurt(b,cover[b.i])
    # A diagonal buckle in the foredeck starts at the aft skylight corner.
    b = m.take(f["foredeck"])
    x,_,z = b.xyz
    t = (x-.30)/.90
    line = z-2.055+.56*(x-.30)-.035*np.sin(11*x)-.041*np.abs(np.sin(16*x))
    width = .021*np.maximum(0,1-np.abs(2*t-1))*(.77+.49*b.flake)
    b.hit(np.abs(line)<width,.40+.52*b.grain,mix((102,98,83),(161,152,125),b.grain))
    b.hit((line<width*.2)&(line>-width*1.39),1.35+.36*b.grain,mix((70,70,61),(134,122,97),b.flake))
    b.hit((line<-width*.60)&(line>-width*1.68),2.19+.36*b.grain,mix((144,123,86),(206,183,141),b.fine))
    glass_hurt(m,s,f)


def running_gear(m,s):
    b = m.take(s.on("hydrodynamic leg","torpedo gearcase","transom gimbal","skeg","ventilation plate"))
    x,y,z = b.xyz
    edge = np.sin(14*z+9*y+24*np.abs(x))*.22+.41*b.flake+.24*b.grain
    struck = (edge>.56) | ((x<0)&(edge>.42)&(y<.64))
    b.hit(struck,.34+.62*b.grain,mix((87,94,91),(157,164,154),b.flake))
    crease = np.abs(y+.42*(z+6.02)-.43-.036*np.sin(z*24))<.026
    b.hit(crease,1.42+.48*b.grain,mix((43,46,45),(182,177,153),b.flake))
    b.hit(struck & (edge>.66),2.11+.57*b.cloud,mix((75,76,66),(176,157,117),b.grain))
    salts = b.cloud*.43+b.flake*.38+b.grain*.18
    b.age(salts>.49,.78+1.47*(1-salts),mix((115,118,106),(185,182,151),b.grain))
    b.age((salts>.59)&(y<.59),1.86+.55*b.flake,mix((49,61,53),(100,120,94),b.grain))


def hash_cell(ix,iy,seed):
    n = (ix.astype(np.int64)*1597334677 ^ iy.astype(np.int64)*3812015801 ^ seed) & 0xffffffff
    n = ((n^(n>>16))*2246822519) & 0xffffffff
    return ((n^(n>>13)) & 65535).astype(np.float32)/65535


def shells(b,u,v,density):
    # Cones of three sizes cluster around the oldest growth.
    for pitch,seed in ((.083,4681),(.049,9167),(.152,1771)):
        across,up = u/pitch+.31, v/pitch-.17
        ix,iy = np.floor(across),np.floor(up)
        cx,cy = hash_cell(ix,iy,seed),hash_cell(ix,iy,seed+4)
        du,dv = across-ix-.25-.50*cx, up-iy-.25-.50*cy
        radius = .13+.17*hash_cell(ix,iy,seed+13)
        a = np.arctan2(dv,du)
        r = np.hypot(du,dv)/(radius*(1+.099*np.cos(5*a+cx)))
        colony = np.maximum(0,density-.42)*1.36 if pitch>.1 else density
        use = (r<1.18)&(hash_cell(ix,iy,seed+9)<colony)
        when = np.clip(2.34-.90*density+.68*cy,.99,2.92)
        b.age(use,when,mix((65,69,57),(125,133,104),b.flake))
        ribs = .5+.5*np.cos(8*a+cx)
        b.age(use&(r<.97),when,mix((146,143,113),(223,214,174),.38*ribs+.29*b.grain+.17*np.sin(a)))
        b.age(use&(r<.43),when+.12,mix((66,66,54),(129,116,84),b.grain))


def tide_fields(b,height,water):
    """Algal stain, salt rim, submerged growth and suspended weed at a water height."""
    x,_,z=b.xyz
    relative=height-water
    wavy=relative-.029*np.sin(2.6*z+.6*x)-.019*np.sin(6*z+1.7*x)-.027*(b.flake-.5)
    under=ramp(.025,-.135,wavy)
    belt=ramp(.159,.039,wavy)*ramp(-.245,-.083,wavy)
    crust=np.exp(-((wavy-.129)/(.010+.016*b.flake))**2)
    pasture=.52*b.cloud+.30*b.flake+.18*b.grain
    fronds=.5+.5*np.cos(41*z+2.5*np.sin(14*relative+z)+2.4*b.flake)
    blades=ramp(.53,.91,fronds)*ramp(.25,.64,pasture)*under
    return under,belt,crust,pasture,blades


def sea_decay(m,s,f,height=None,water=.58,immersible=None):
    if height is None:
        height=s.P[:,1]
    if immersible is None:
        immersible=f["water_surface"]
    wet=immersible&(height<water+.23)
    b=m.take(wet)
    x,_,z=b.xyz
    y=height[b.i]
    under,belt,crust,growth,blades=tide_fields(b,y,water)
    earth=mix((56,93,27),(158,137,47),.19+.55*b.flake)
    earth=mix(earth,(106,148,43),.61*b.cloud+.13*b.fine)
    b.age(under>.08,2.25-.61*b.cloud,mix((46,67,42),(119,126,66),.32*b.grain+.50*b.flake))
    b.age(blades>.12,1.34+.33*b.flake,mix((46,68,40),(114,130,65),blades))
    b.age(belt>.08,.22+.54*(1-belt),mix(b.ground,earth,ramp(.02,.80,belt)))
    b.age(crust*(.46+.54*b.grain)>.32,.49+.35*b.grain,mix((152,158,126),(224,218,182),crust*b.fine))
    density=np.clip(2.6*(growth-.25),0,.97)*np.maximum(under,belt*.45)
    n=s.N[b.i]
    u=np.where(f["transom"][b.i],x,z)
    v=y+np.where(f["transom"][b.i],0,np.abs(x)*np.maximum(0,-n[:,1])*.66)
    # Draped weed fronds stay attached at the tide mark and split near the tip.
    down = water+.008-y
    for station,reach,lean in ((-5.21,.24,-.23),(-4.73,.17,.31),(-2.92,.26,.18),
                               (-.83,.20,.29),(1.24,.17,-.25),(2.73,.19,.14)):
        for slip,portion in ((0,1),(.054,.73),(-.081,.57)):
            t = down/(reach*portion)
            stem = z-station-slip-lean*down-.025*np.sin(8*t+station)
            width = .020*(1-np.clip(t,0,1))*(.62+.94*b.grain)
            tongue = np.minimum(np.abs(stem),np.abs(stem-.09*np.maximum(down-.063,0)))
            frond = (tongue<width)&(t>0)&(t<1)&(np.abs(x)>.65)
            b.age(frond,1.46+.59*t,mix((50,61,42),(117,122,74),.42*b.flake+.42*b.fine))
    shells(b,u,v,density)


def fitting_runs(b,across,down,length,width):
    wander = .012*np.sin(12*down)+.018*(b.flake-.5)+.055*down*down
    width = width*(1.24-.99*np.clip(down/length,0,1))
    dist = np.abs(across+wander)/width
    tail = down/length+.21*(b.flake-.5)
    use = (dist<1.7)&(tail<1)&(down>-.012)&((tail<.64)|(b.grain>.33))
    wick = np.exp(-.9*dist**1.4)*ramp(1.12,.06,tail)
    ochre=mix((129,72,35),(196,146,83),.38+.44*b.flake)
    b.age(use,.39+.39*np.clip(tail,0,1)+.15*b.grain,mix(b.ground,ochre,.21+.76*wick))
    rust = use & (dist<.63+.23*b.grain) & (tail<.78)
    b.age(rust,1.18+.47*b.grain,mix((104,52,27),(190,122,63),.43*b.flake+.34*b.fine))


def deck_decay(m,s,f,sky=None):
    b = m.take(f["gelcoat"]|f["side"]|(f["upper_pin"]>.05)|(f["lower_pin"]>.05))
    x,y,z = b.xyz
    n = s.N[b.i,1] if sky is None else sky[b.i]
    exposure = .28*(n+.4) + .47*b.cloud+.29*b.flake+.15*b.grain
    fade = (exposure>(.650+.095*np.maximum(n,0)))&(y>.69)
    dyed = s.where("gel","midnight")[b.i] | (f["deck_stripe"][b.i]>.2)
    chalk = np.clip((exposure-.67)*3.45+.19*b.fine,0,1)
    oxidised = mix((120,133,136),(220,220,199),chalk)
    warm = mix((177,177,158),(221,217,191),.54*b.flake+.26*b.grain)
    veil=ramp(.51,.92,exposure)*(.53+.44*b.cloud)
    b.age(fade,1.09+.64*b.grain,mix(b.ground,np.where(dyed[:,None],oxidised,warm),veil))
    chips = np.maximum.reduce([f[k][b.i] for k in ("upper_pin","lower_pin","flash_tracer","name","deck_tracer")])>.2
    chips &= (b.cloud*.52+b.flake*.31+b.grain*.17>.57)
    b.age(chips,1.32+.69*b.grain,mix((94,91,76),(200,181,136),b.fine))
    # Mineral rings collect on exposed gel while dirt settles at cut-outs.
    dry = (y>.62)&((n>.08)|(f["side"][b.i]))
    salt = (b.grain>.72)&(b.flake>.62)&(b.cloud>.54)
    b.age(dry&salt,.44+.44*b.fine,mix((166,171,157),(219,216,189),b.fine))
    side = f["side"][b.i]
    high = f["sheer"][b.i]
    foot = np.abs(np.abs(x)-(f["beam"][b.i]-.070))
    for zz,length,width in ((-5.13,.42,.027),(3.12,.54,.023),(1.11,.21,.012),(1.65,.33,.014),
                           (3.075,.28,.013),(4.50,.35,.018),(-4.91,.25,.015),(-4.27,.23,.012)):
        a = z-zz
        down = np.where(side,high-y+foot*.25,foot)
        near = (np.abs(a)<.16)&(side|((foot<.145)&(n>.2)))&(y>high-.58)
        p = b.take(near)
        fitting_runs(p,a[near],down[near],length,width)
    t = b.take(f["transom"][b.i])
    x,y,_ = t.xyz
    for xx,yy in ((.91,.88),(1.035,.725)):
        fitting_runs(t,np.abs(x)-xx,yy-y,.29,.024)
    for cx,cz,scale in ((-.72,1.69,1),(.34,2.98,.77),(.12,4.56,1.20),(-1.16,-4.80,.66),(-.15,5.03,.48)):
        a,v = b.pos[:,0]-cx,b.pos[:,2]-cz
        for dx,dz,r in ((0,0,.043),(.018,-.057,.020),(-.033,.035,.013),(.054,.01,.009)):
            dist = np.hypot((a-dx)/r,(v-dz)/(r*1.54))/(scale*(.64+.64*b.grain))
            b.age((dist<1)&(n>.41),.23+.51*b.flake,mix((176,178,158),(227,225,202),b.fine))
            b.age((dist<.47)&(n>.41),.39+.51*b.flake,mix((86,92,73),(172,171,143),b.grain))


def hardware_bedding(m,s,f):
    # Sealant wicks tea-coloured moisture out from the clamped edge.
    b = m.take(f["foredeck"]|s.on("skylight lid","stern platform","teak platform","moulded dashboard"))
    x,y,z = b.xyz
    footprint = np.full(len(x),4.,np.float32)
    for cz,half in ((2.355,.39),(3.72,.285)):
        perimeter = np.maximum(np.abs(x)-half,np.abs(z-cz)-.325)
        pull = np.maximum(np.abs(x)-.052,np.abs(z-cz+.214)-.022)
        footprint = np.minimum(footprint,np.minimum(np.abs(perimeter),np.abs(pull)))
    for cx in (1.05,1.31):
        footprint=np.minimum(footprint,np.hypot((x-cx)*.72,z+6.08)-.019)
    leach = (footprint<.027*(.39+.8*b.flake))&(b.cloud*.52+b.grain*.48>.48)
    b.age(leach,.40+.53*b.grain,mix((134,113,80),(194,179,139),.57*b.flake+.32*b.fine))
    b.age(leach&(footprint<.008)&(b.grain>.46),1.04+.53*b.flake,mix((104,83,58),(169,133,91),b.fine))
    p = b.take(s.on("moulded dashboard")[b.i])
    x,y,_=p.xyz
    for cx,cy in ((.23,1.615),(1.05,1.615),(.64,1.62),(-.66,1.62)):
        fitting_runs(p,x-cx,cy-y,.081,.010)
    p = m.take(f["hull"] & (np.abs(np.abs(m.pos[:,0])-1.19)<.14) & (m.pos[:,1]<1.47))
    x,y,z=p.xyz
    for station in (-1.78,-1.13):
        fitting_runs(p,z-station,1.442-y,.225,.013)


def cabin_decay(m,s,f,wood):
    timber,platform,grain,fleck,plank,joint = wood
    b = m.take(timber)
    g,fl,p,seam = (a[b.i] for a in (grain,fleck,plank,joint))
    balance = b.cloud*.41+b.flake*.34+.14*(g*.5+.5)+.11*b.grain
    b.age((seam>.30)&(balance>.34),1.17+.48*b.grain,mix((51,56,43),(103,107,76),b.flake))
    b.age((balance>.44)&(seam<.39),2.07+.63*(1-balance),
          mix((114,109,94),(196,191,165),.39+.24*g+.13*p+.16*b.grain+.06*fl))
    b.age((seam>.61)&(balance>.44),2.16+.57*b.grain,mix((34,39,35),(82,82,65),b.grain))
    b = m.take(f["upholstery"]|s.where("tobacco"))
    x,y,z = b.xyz
    damp = .42*b.cloud+.42*b.flake+.16*b.grain+.16*(1-s.AO[b.i])
    b.age((damp>.54)&(b.fine>.42),1.08+.57*b.grain,mix((126,123,100),(183,179,144),b.flake))
    pockets=np.exp(-((x-.70*np.round(x/.70))/.235)**4)
    damp+=.09*(1-pockets)+.040*np.cos(z*19+4*b.cloud)
    fungus = (damp>.605)&(b.grain>.33)
    b.age(fungus,2.02+.62*b.grain,mix((43,53,42),(113,119,83),.55*b.flake+.26*b.fine))
    for cx,cz in ((.13,-4.76),(-.75,-2.27)):
        dx,dz=x-cx,z-cz
        slit = (np.abs(dx-.24*dz-.011*np.sin(23*dz))<.021*(.41+b.grain))&(np.abs(dz)<.21)
        b.age(slit,2.36+.36*b.grain,mix((70,64,46),(152,135,81),b.grain))
    b = m.take(f["glass"])
    x,y,z = b.xyz
    sky = s.on("skylight lid")[b.i]
    u = x+np.where(sky,0,np.sign(x)*np.maximum(0,.84-z)*.88)
    v = np.where(sky,z,y)
    scale=.094
    ix,iy = np.floor(u/scale),np.floor(v/scale)
    a,c=u/scale-ix-.26-.47*hash_cell(ix,iy,17),v/scale-iy-.27-.45*hash_cell(ix,iy,26)
    r=np.hypot(a,c*.92)
    ring = (np.abs(r-(.11+.13*hash_cell(ix,iy,30)))<.035)&(b.flake>.42)
    b.age(ring,.20+.64*b.grain,mix((122,144,141),(192,197,179),b.grain))
    haze = .46*b.cloud+.39*b.flake+.15*b.grain
    b.age(haze>.58,1.18+.53*b.grain,mix((97,121,122),(156,172,161),b.flake))
    # Released corners run to the outer edge of the pane.
    edge=np.where(sky, np.maximum((x+.27)*-2,(v-3.82)*2.6),(-u-1.14)*1.4+(1.60-v)*2.2)
    b.age((edge>.32)&(haze>.41),2.18+.53*b.grain,mix((24,37,40),(75,87,82),b.flake))
    p=b.take((~sky)&(u<-.72))
    a,c=u[(~sky)&(u<-.72)],v[(~sky)&(u<-.72)]
    fracture(p,a+1.30,c-1.62,.49,.19,848,1.51,glass=True,decay=True)


def displayed(base,mask,paint=(17,56,95)):
    """Resolve the sample livery under thin deposits, in the renderer's linear colour space."""
    rgb=base[:,:3].astype(np.float32)/255
    light=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    dye=np.ones_like(light)
    for channel,colour in enumerate((paint,(212,207,196))):
        tone=np.array(colour,np.float32)/255
        linear=np.where(tone<=.04045,tone/12.92,((tone+.055)/1.055)**2.4)
        dye+=mask[:,channel:channel+1]/255*(linear/.4461-1)
    result=np.maximum(0,light*dye)
    return np.clip(255*np.where(result<=.0031308,12.92*result,1.055*result**(1/2.4)-.055),0,255)


def mark_fields(s,ground):
    grains = [np.clip(.5+.78*noise(s.P,scale,seed),0,1)
              for scale,seed in ((.014,270),(.078,807),(.39,357),(.007,574))]
    return Marks(s.P,*grains,ground=ground)


def shell_layers(surface,folder=None):
    if folder is None:
        folder=HERE.parent/"thunderbolt/tex"
    base=np.asarray(Image.open(folder/"shell_base.png").convert("RGB")).reshape(-1,3)
    mask=np.asarray(Image.open(folder/"shell_mask.png").convert("RGB")).reshape(-1,3)
    layers = [np.empty((surface.n,4),np.uint8) for _ in range(2)]
    for section,s in surface_strips(surface):
        m = mark_fields(s,displayed(base[section],mask[section]))
        f,wood = thunderbolt_fields(s),teak_fields(s)
        hull_hurt(m,s,f)
        cabin_hurt(m,s,f,wood)
        deck_decay(m,s,f)
        sea_decay(m,s,f)
        cabin_decay(m,s,f,wood)
        hardware_bedding(m,s,f)
        running_gear(m,s)
        m.decay[m.hurt[:,3]>0] = 0
        layers[0][section],layers[1][section] = m.hurt,m.decay
    return [a.reshape(surface.size,surface.size,4) for a in layers]


def save_pair(folder,material,pair):
    for role,data in zip(("hurt","decay"),pair):
        Image.fromarray(data).save(folder/f"{material}_{role}.png",compress_level=6)


def thunderbolt():
    tex = HERE.parent/"thunderbolt/tex"
    save_pair(tex,"shell",shell_layers(Surface(tex/"bakes","shell"),tex))


def main():
    from craft_finish import REGISTRATIONS
    from craft_wear import shell
    boats = ("thunderbolt",*REGISTRATIONS)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("boat",choices=boats)
    boat=parser.parse_args().boat
    if boat=="thunderbolt":
        thunderbolt()
    else:
        save_pair(HERE.parent/boat/"tex","shell",shell(boat))
    save_pair(HERE/"tex","hardware",hardware_wear())


if __name__=="__main__":
    main()
