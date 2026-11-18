"""Paint a small craft on its baked layout and refresh the shared fittings."""
import argparse
from copy import copy
from functools import lru_cache
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "marine"))
from surface import Surface
from graphics import artwork, save_originals
from fittings import fittings


def ramp(a,b,x):
    t = np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)


def ridge(distance,width,foot):
    return ramp(width+foot, np.maximum(0,width-foot), np.abs(distance))


def rounded_box(x,y,half_x,half_y,radius):
    dx,dy = np.abs(x)-half_x+radius,np.abs(y)-half_y+radius
    return np.hypot(np.maximum(0,dx),np.maximum(0,dy))+np.minimum(np.maximum(dx,dy),0)-radius


def periodic(v,spacing):
    return np.abs(v-spacing*np.floor(v/spacing+.5))


@lru_cache(None)
def lattice(seed):
    return np.random.default_rng(seed).uniform(-1,1,(97,97,97)).astype(np.float32)


def noise(p,scale,seed):
    return ndimage.map_coordinates(lattice(seed),(p/scale).T,order=1,mode="grid-wrap",prefilter=False)


def poly(x,y,points,foot):
    """A polygon in a projection plane, with a texel-wide filtered edge."""
    inside = np.zeros(x.shape,bool)
    distance = np.full(x.shape,1e6,np.float32)
    for (a,b),(c,d) in zip(points,points[1:]+points[:1]):
        dx,dy = c-a,d-b
        if dy:
            inside ^= ((y>b)!=(y>d)) & (x<a+(y-b)*dx/dy)
        t = np.clip(((x-a)*dx+(y-b)*dy)/(dx*dx+dy*dy),0,1)
        distance = np.minimum(distance,(x-a-t*dx)**2+(y-b-t*dy)**2)
    signed = np.where(inside,1,-1)*np.sqrt(distance)
    return ramp(-foot,foot,signed).astype(np.float32)


@lru_cache(None)
def transfer_image(name,keyline):
    if name in ("name","registration","port"):
        master=artwork()[name]
    else:
        from craft_finish import graphic
        master=graphic(name)
    arr = np.asarray(master,np.float32)/255
    pad = 18
    arr = np.pad(arr,pad)
    if keyline:
        arr = ndimage.maximum_filter(arr,size=13)
    return ndimage.gaussian_filter(arr,1.0),pad


def transfer(name,u,v,valid,w,h,foot,keyline=False):
    """Project a transfer in metres with a four-sample texel footprint."""
    img,pad = transfer_image(name,keyline)
    rows,cols = img.shape
    cw,ch = cols-2*pad,rows-2*pad
    use = valid & (np.abs(u)<w*.54+.015)&(np.abs(v)<h*.66+.015)
    out = np.zeros(len(u),np.float32)
    px = ((u[use]/w+.5)*cw+pad-.5)
    py = ((.5-v[use]/h)*ch+pad-.5)
    fx,fy = foot[use]*cw/w*.245, foot[use]*ch/h*.245
    for dx,dy in ((-1,-1),(1,-1),(-1,1),(1,1)):
        out[use] += .25*ndimage.map_coordinates(img,[py+dy*fy,px+dx*fx],order=1,mode="constant")
    return out


# Sheer, chine and half beam at the mould stations, in metres.
STATIONS = np.array([
    (-5.87,1.18,.52,1.19),(-5.44,1.26,.55,1.31),(-4.36,1.34,.57,1.405),
    (-3.11,1.37,.57,1.438),(-2.82,1.385,.57,1.443),(-.18,1.41,.59,1.45),
    (.55,1.43,.60,1.439),(.82,1.455,.62,1.422),(1.60,1.48,.66,1.355),
    (2.74,1.495,.74,1.17),(3.86,1.50,.84,.93),(4.85,1.52,.97,.665),
    (5.78,1.54,1.16,.34),(6.38,1.55,1.40,.062),(6.50,1.55,1.51,.014)
],np.float32)


def thunderbolt_fields(s):
    """Material, waterline, transfer and inlay masks on a shell Surface, flattened in bake order."""
    x,y,z = s.P.T
    ax = np.abs(x)
    sheer,chine,beam = (np.interp(z,STATIONS[:,0],STATIONS[:,i]).astype(np.float32) for i in (1,2,3))
    depth = np.maximum(sheer-chine,.04)
    q = (y-chine)/depth
    foot = np.clip(s.MPT,.002,.03)
    hull = s.on("warped V hull")
    transom = hull & (z< -5.8695) & (s.N[:,2]<-.8)
    side = hull & ~transom & (ax>beam*.918) & (y<sheer) & (np.abs(s.N[:,0])>.45)
    foredeck = hull & s.where("pearl") & (z>.89) & (s.N[:,1]>.5)
    # Long broken flash below the belt, with a fine return on its lower edge.
    def flank(points):
        return side*poly(z,q,points,foot/depth)
    flash = flank([(-5.875,.244),(-3.55,.277),(-1.98,.310),(-.77,.598),(-1.48,.553),
                   (1.14,.764),(3.58,.862),(4.96,.881),(3.94,.611),(1.24,.557),
                   (-.56,.434),(.06,.456),(-1.82,.081),(-4.49,.047),(-5.875,.046)])
    blade = flank([(-5.875,.214),(-2.04,.260),(-.95,.473),(-1.58,.439),
                   (-.54,.521),(-1.89,.137),(-5.875,.124)])
    tracer = flank([(-5.70,.043),(-1.76,.089),(.31,.445),(-1.71,.067)])
    name_ground = side*poly(z,sheer-y,[(-5.88,.055),(-3.14,.050),(-2.37,.063),
                                      (-2.93,.147),(-3.13,.239),(-5.88,.234)],foot*.60)
    belt = .36+.11*np.sin((z+5.87)/12.37*np.pi*1.6-.65)
    lower_pin = side*ridge(y-chine-belt*depth+.008,.0095,foot*.5)*ramp(6.36,5.90,z)
    foil_tag = side & s.where("gold")
    upper_pin = side*ridge(y-chine-(belt+.1325)*depth,np.maximum(.0125,.018*depth),foot*.68)
    upper_pin *= ramp(6.43,6.07,z)
    # The pierced foredeck panels leave a polished margin at the rails and skylights.
    axis = np.interp(z,[.89,1.25,2.5,3.5,4.4,5.35,5.96],[.83,.82,.70,.57,.42,.19,.035])
    width = np.interp(z,[.91,1.26,2.1,3.72,4.7,5.63,5.96],[0,.092,.084,.061,.046,.022,0])
    stripe = foredeck * ramp(-foot*.5,foot*.5,width-np.abs(ax-axis))*(z>.92)*(z<5.96)
    trim = foredeck*ridge(ax-axis-width-.024,.008,foot*.5)*(z>1.18)*(z<5.52)
    shoulder = ax-axis-width-.060
    margin = np.minimum.reduce([shoulder,beam*.825-ax,(z-1.20)*.65,(5.26-z)*.65])
    central = np.minimum.reduce([axis-width-.065-ax,(z-1.18)*.67,(5.36-z)*.67])
    for zz,ww in ((2.355,.39),(3.72,.285)):
        surround = rounded_box(x,z-zz,ww+.05,.375,.060)
        central = np.minimum(central,surround)
    nonskid = foredeck*ramp(-foot,foot,np.maximum(central,margin))
    deck_key = foredeck*ridge(ax-axis+width+.010,.0105,foot*.60)*(z>1.12)*(z<5.80)
    # Project side lettering so both sides read from left to right when seen from the dock.
    u = np.where(x>0,-1,1)
    name_y = y-(sheer-.146)
    ns = transfer("name",u*(z+4.18),name_y,side,1.98,.139,foot)
    ks = transfer("name",u*(z+4.18),name_y,side,1.98,.139,foot,True)
    nt = transfer("name",-x,y-1.105,transom,1.60,.145,foot)
    kt = transfer("name",-x,y-1.105,transom,1.60,.145,foot,True)
    reg_y = y-(chine+.737*depth)
    reg = transfer("registration",u*(z-3.83),reg_y,side,.63,.081,foot)
    reg_key = transfer("registration",u*(z-3.83),reg_y,side,.63,.081,foot,True)
    home = transfer("port",-x,y-.955,transom,.42,.065,foot)
    port_rule = transom*ridge(y-.955,.0065,foot*.45)*(ax>.245)*(ax<.44)
    gel = s.where("pearl","gel","midnight") & ~s.on("gasket")
    tops = s.where("vinyl","suede") & ~s.on("piping","glove box")
    water_surface = hull | s.on("lifting strake","leg","gimbal","skeg","gearcase","plate")
    waterline = water_surface*np.exp(-((y-.58)/.033)**2)
    submerged = water_surface*ramp(.60,.545,y)
    rear_shell = s.on("wraparound bucket") & s.where("midnight") & (s.N[:,2]<-.64)
    emblem = rear_shell*poly(ax-.64,y-1.75,[(-.062,.016),(.016,.029),(-.009,.005),
                         (.066,.016),(-.033,-.035),(-.008,-.009),(-.068,-.017)],foot*.58)
    horn = s.on("horn hub") & (s.N[:,2]<-.65)
    horn_emblem = horn*poly(x-.64,y-1.62,[(-.029,.004),(.006,.021),(-.002,.004),
                            (.031,.005),(-.015,-.022),(-.007,-.004),(-.029,-.007)],foot*.48)
    return dict(hull=hull,side=side,foredeck=foredeck,sheer=sheer,chine=chine,beam=beam,
                gelcoat=gel,glass=s.where("screen"),upholstery=tops,water_surface=water_surface,waterline=waterline,
                submerged=submerged,flash=flash,blade=blade,flash_tracer=tracer,
                deck_stripe=stripe,deck_tracer=trim,deck_key=deck_key,nonskid=nonskid,
                name_ground=name_ground,lower_pin=lower_pin,upper_pin=upper_pin,foil_tag=foil_tag,
                seat_emblem=emblem,horn_emblem=horn_emblem,name=np.maximum(ns,nt),
                name_key=np.maximum(ks,kt),name_place=(side&(np.abs(z+4.18)<1.04)&(np.abs(name_y)<.087)) |
                (transom&(ax<.83)&(np.abs(y-1.105)<.087)),registration=reg,registration_key=reg_key,
                home_port=home,port_rule=port_rule,transom=transom)


FINISH = {
    "midnight": ((23,41,59),.20,0), "gel": ((190,190,190),.171,0),
    "pearl": ((237,232,213),.215,0), "gold": ((224,183,113),.245,.83),
    "teak": ((163,112,69),.56,0), "engine": ((40,49,55),.30,0),
    "vinyl": ((194,194,194),.57,0), "tobacco": ((130,76,48),.51,0),
    "carbon": ((45,53,57),.28,0), "screen": ((54,85,92),.105,0),
    "graphite": ((53,61,65),.29,0), "tread": ((36,40,40),.82,0),
}


def teak_fields(s):
    x,y,z = s.P.T
    ax = np.abs(x)
    texel = np.clip(s.MPT,.002,.03)
    wood = s.where("teak")
    platform = s.on("teak platform")
    dx,dz = np.abs(ax-.94), np.abs(z+6.01)
    edge = .31-np.maximum(dx,dz)
    border = platform&(edge<.056)
    across = np.where(platform,ax-.94,x)
    along = np.where(platform,z+6.01,z)
    cross_grain = border&(dz>dx)
    board = np.floor((across+.046)/.092)
    face = np.where(cross_grain,along,across)
    length = np.where(cross_grain,across,along)
    phase = .0018*np.sin(length*4.1+np.sin(face*13))+.0011*np.sin(length*11+board)
    grain = np.sin((face+phase)*378 + 2*np.sin(face*77+length*1.8))
    fleck = np.sin((face+phase)*1060 + 1.5*np.sin(length*5+board))
    plank = np.sin(board*75.1+np.where(platform,1.2,.4))
    seams = ridge(periodic(across+.046,.092),.0046,texel*.46)
    butt = ridge(periodic(along+.59*board,1.44),.004,texel*.45)
    join = np.where(border,0,np.maximum(seams,np.where(platform,0,butt)))
    join = np.maximum(join, platform*ridge(edge-.056,.0046,texel*.45))
    join = np.maximum(join,border*ridge(dx-dz,.0035,texel*.45))
    return wood,platform,grain,fleck,plank,join


def paint_strip(s):
    x,y,z = s.P.T
    ax = np.abs(x)
    ny = s.N[:,1]
    texel = np.clip(s.MPT,.002,.03)
    f = thunderbolt_fields(s)
    fine = noise(s.P,.009,673)
    bloom = noise(s.P,.093,112)
    cloud = noise(s.P,.39,515)
    rgb = np.empty((s.n,3),np.float32)
    rough,metal = np.empty(s.n,np.float32),np.empty(s.n,np.float32)
    for tag in np.unique(s.TAG):
        col,r,m = FINISH[s.tags[tag]]
        use = s.TAG==tag
        rgb[use],rough[use],metal[use] = col,r,m
    dye = np.zeros((s.n,3),np.float32)
    dye[:,0],dye[:,1] = s.where("gel"), f["upholstery"]
    h = 128 + 1.7*fine
    rough += fine*.016
    shade = .985 + .015*cloud + .012*fine
    # A slight tide witness and drain tracks survive the last wash.
    film = (1-s.AO)**2*(.35+.65*np.maximum(ny,0))*(.86+.14*bloom)
    wet = f["submerged"]
    salt = f["waterline"]*(.74+.26*bloom)
    shade -= .068*film
    rough += .08*film+.095*wet+.12*salt
    tide = salt*np.exp(-((y-.581-bloom*.006)/.013)**2)
    for c,val in enumerate((90,106,99)):
        rgb[:,c] += (val-rgb[:,c])*(.21*wet+.25*salt+.20*tide)
    drip = np.zeros(s.n,np.float32)
    for zz,yy in ((-5.13,1.28),(3.12,1.497),(1.11,1.465),(-4.56,1.33)):
        down = np.clip(yy-y,0,.40)
        drip += np.exp(-((z-zz+.024*down)/(.012+.031*down))**2)*ramp(.36,0,down)*(y<yy)*(ax>1)
    shade -= .085*drip*s.on("warped V hull")
    rough += .09*drip*s.on("warped V hull")

    def layer(a,colour,r,m=0,region=None):
        nonlocal rough,metal
        a = np.asarray(a,np.float32)
        rgb[:] += (np.asarray(colour,np.float32)-rgb)*a[:,None]
        rough += (r-rough)*a
        metal += (m-metal)*a
        dye[:] *= (1-a[:,None])
        if region is not None:
            dye[:,region] += a

    gold = (223,178,102)
    layer(f["foil_tag"],(190,190,190),.171,region=0)
    layer(f["upper_pin"],gold,.236,.76)
    layer(f["lower_pin"],gold,.236,.76)
    layer(f["name_ground"],(21,44,63),.203)
    layer(f["deck_key"],(48,63,70),.24)
    layer(f["flash"],(238,232,210),.206)
    layer(f["blade"],(191,191,191),.166,region=0)
    layer(f["deck_stripe"],(190,190,190),.167,region=0)
    leaf = np.maximum.reduce([f["deck_tracer"],f["flash_tracer"],f["port_rule"]])
    layer(leaf,gold,.226,.82)
    gold_leaf = np.maximum.reduce([s.where("gold") & ~f["foil_tag"],leaf,f["upper_pin"],f["lower_pin"]])
    shade += gold_leaf*(.031*bloom+.027*np.sin(z*18+2*cloud)*np.sin(y*35+bloom))
    h += (leaf+.35*f["flash"])*1.7
    layer(f["name_key"],(18,31,43),.234)
    layer(f["name"],(248,235,204),.228,.24)
    layer(f["home_port"],gold,.27,.50)
    layer(f["registration_key"],(245,240,220),.23)
    layer(f["registration"],(16,28,37),.22)
    # Moulded diamond nonskid against a smooth border.
    pad = f["nonskid"]
    diamond = np.minimum(periodic(z*.78+x,.044),periodic(z*.78-x,.044))
    nib = ramp(.001,.016,diamond)
    layer(pad,(220,217,202),.68+.13*nib+.024*fine)
    h += pad*(nib*61-18)
    shade += pad*(nib-.43)*.11
    # Plank end joints are staggered. The platforms have a mitred margin board.
    wood,platform,grain,fleck,plank,join = teak_fields(s)
    shade += wood*(.099*grain+.035*fleck+.11*plank+.050*bloom)
    layer(wood*join,(33,35,32),.76)
    h += wood*(grain*2.5+fleck*.9-join*28)
    sole = wood & ~platform & (y<.758) & (ny>.72)
    locker = rounded_box(x,z+1.22,.325,.412,.048)
    locker_seam = sole*ridge(locker,.007,texel*.52)
    ring = np.hypot(x,z+1.50)
    cup = sole*ramp(.042,.034,ring)
    hoop = sole*ridge(ring-.029,.005,texel*.4)
    layer(locker_seam,(47,43,34),.70)
    layer(cup,(43,48,47),.46,.47)
    layer(hoop,(174,165,134),.31,.95)
    h += -locker_seam*17 - cup*19 + hoop*17
    # Inset centre panels, shaped side rolls and two rows of saddle stitch.
    sun = s.on("crowned sun lounge")
    back = s.on("aft backrest","wraparound bucket")
    aft = s.on("aft seat","aft backrest")
    bucket = s.on("wraparound bucket")
    centre = np.where(sun,np.round(x/.70)*.70,np.where(aft,np.round(x/.76)*.76,np.sign(x)*.64))
    a = np.abs(x-centre)
    v = np.where(back,y,z)
    panel_width = np.where(sun,.222+.020*np.sin((z+5.25)*2.1),
                      np.where(aft,.243,np.where(bucket,.156-.066*ramp(1.62,1.91,y),.135)))
    visible = np.where(back,s.N[:,2]>.60,ny>.60)
    centre_panel = visible*ramp(panel_width+.006,panel_width-.003,a)
    seam = visible*ridge(a-panel_width,.0045,texel*.6)
    thread = (visible*ridge(np.abs(a-panel_width)-.011,.0028,texel*.50)*
              (.28+.72*ramp(.010,.005,periodic(v,.027))))
    # Shallow chevron channels turn out at the bolsters and stop below the head cushions.
    quilting = centre_panel*np.where(sun,ramp(-3.50,-3.78,z),np.where(back,ramp(1.64,1.49,y),1))
    tuck = np.where(sun,periodic(z+5.10,.158),periodic(v-.34*a,.091))
    flute = np.exp(-(tuck/.011)**2)*quilting
    puff = sun*quilting*(1-np.exp(-(tuck/.032)**2))
    pores = np.exp(-((periodic(x,.022)/.0048)**2+(periodic(v+.011*(np.floor(x/.022+.5)%2),.022)/.0048)**2))
    cover = f["upholstery"]
    shade += cover*(-.085*centre_panel-(.165-.102*sun)*flute-.19*seam+.102*thread-.11*pores*centre_panel+.021*fine)
    h += cover*(fine*3.0-10*centre_panel-28*flute+20*puff-24*seam+12*thread-7*pores*centre_panel)
    rough += cover*(.052*centre_panel-.065*thread+.064*sun*flute-.029*puff)
    rear = bucket & s.where("midnight") & (s.N[:,2]<-.64)
    # A moulded handhold and a bound slip pocket across the back of each shell.
    handle = rounded_box(ax-.64,y-1.84,.085,.022,.016)
    slot = rear*ramp(texel*.5,-texel*.5,handle)
    surround = rear*ridge(handle-.006,.0045,texel*.45)
    pocket_d = rounded_box((ax-.64)*(1+.8*(y-1.43)),y-1.424,.198,.100,.031)
    pocket = rear*ramp(texel*.62,-texel*.62,pocket_d)
    pocket_edge = rear*ridge(pocket_d+.011,.0034,texel*.52)*(.35+.65*ramp(.014,.009,periodic(x+y,.026)))
    binding = pocket*ridge(y-1.512,.008,texel*.48)
    layer(slot,(12,19,24),.53)
    layer(surround,(82,90,91),.34,.37)
    layer(pocket,(69,65,60),.68)
    layer(binding,(115,77,54),.57)
    layer(pocket_edge,(159,138,106),.62)
    layer(f["seat_emblem"],(205,175,120),.34,.56)
    h += -slot*28+surround*9+pocket*(9+3*fine)+binding*8+pocket_edge*7
    layer(s.on("sun lounge piping"),(201,163,110),.53)
    layer(s.on("port glove box"),(117,81,61),.56)
    h += (s.where("tobacco")|s.on("port glove box"))*fine*3
    # Smoked acrylic has a printed bond border and a dotted fade at its foot.
    sky = s.on("skylight lid")
    forward = z<3
    clear_edge = np.minimum(np.where(forward,.371,.266)-ax,
                            .3025-np.abs(z-np.where(forward,2.355,3.72)))
    glass_edge = np.where(sky,clear_edge,y-1.48)
    dots = np.exp(-((periodic(x+z,.017)/.0047)**2+(periodic(y+z,.017)/.0047)**2))
    frit = f["glass"]*np.maximum(ramp(.030,.015,glass_edge),ramp(.071,.033,glass_edge)*dots)
    layer(sky,(45,73,82),.093)
    layer(frit,(24,35,39),.26)
    shade += f["glass"]*.011*bloom
    dash = s.on("moulded dashboard") & (s.N[:,2]<-.7)
    bank = rounded_box(x+.035,y-1.638,.160,.051,.014)
    plate = dash*ramp(texel*.6,-texel*.6,bank)
    rocker = rounded_box(periodic(x+.035,.076),y-1.641,.022,.032,.007)
    switch = plate*ramp(texel*.5,-texel*.5,rocker)*(np.abs(x+.035)<.108)
    pilot = switch*ridge(y-1.653,.0048,texel*.48)
    layer(plate,(63,71,75),.35,.61)
    layer(switch,(25,31,35),.52)
    layer(pilot,(205,167,99),.29)
    h += -plate*9 + switch*17 + pilot*3
    horn = s.on("horn hub") & (s.N[:,2]<-.65)
    horn_rim = horn*ridge(np.hypot(x-.64,y-1.62)-.042,.0038,texel*.42)
    layer(horn_rim,(134,146,145),.29,.92)
    layer(f["horn_emblem"],(219,183,116),.28,.64)
    h += horn_rim*7+f["horn_emblem"]*6
    gasket = s.on("engine cover gasket")
    layer(gasket,(32,37,40),.70)
    carbon = s.where("carbon")
    twill = np.sin((x+z)*390)*np.cos((x-z)*390)
    shade += carbon*twill*.13
    h += carbon*twill*2
    ribs = s.where("tread")*np.cos(x*460)
    h += ribs*9
    shade += ribs*.10
    # Partly covered transfer edges use neutral albedo anywhere the dye still contributes.
    rgb *= (shade*(.966+.034*s.AO))[:,None]
    dyed = dye.max(1)>.5/255
    neutral = .2126*rgb[dyed,0]+.7152*rgb[dyed,1]+.0722*rgb[dyed,2]
    rgb[dyed] = neutral[:,None]
    packed = np.stack((s.AO,rough,metal),axis=1)
    return byte(rgb), h, byte(packed*255), byte(dye*255)


def byte(a):
    return np.rint(a).clip(0,255).astype(np.uint8)


def surface_strips(surface):
    size = surface.size
    s = copy(surface)
    for start in range(0,surface.n,size*96):
        strip = slice(start,min(start+size*96,surface.n))
        for attr in ("P","N","MPT","AO","TAG","PART"):
            setattr(s,attr,getattr(surface,attr)[strip])
        s.n = len(s.P)
        yield strip,s


def paint_shell(surface,recipe=paint_strip):
    size = surface.size
    base,packed,mask = [np.empty((surface.n,3),np.uint8) for _ in range(3)]
    height = np.empty(surface.n,np.float32)
    for strip,s in surface_strips(surface):
        base[strip],height[strip],packed[strip],mask[strip] = recipe(s)
    return base.reshape(size,size,3),height.reshape(size,size),packed.reshape(size,size,3),mask.reshape(size,size,3)


def write_maps(folder,material,base,height,packed,mask,slope):
    def save(role,img):
        img.save(folder / f"{material}_{role}.png",compress_level=6)
    height = byte(height)
    field = height.astype(np.float32)
    dx = (np.roll(field,1,1)-np.roll(field,-1,1))*slope
    dy = (np.roll(field,-1,0)-np.roll(field,1,0))*slope
    inv = 127.5 / np.sqrt(1+dx*dx+dy*dy)
    normal = byte(np.stack((127.5+dx*inv,127.5+dy*inv,127.5+inv),axis=2))
    save("base",Image.fromarray(base).convert("RGBA"))
    save("height",Image.fromarray(height))
    save("normal",Image.fromarray(normal))
    save("packed",Image.fromarray(packed))
    save("mask",Image.fromarray(mask))


def thunderbolt():
    tex = HERE.parent / "thunderbolt/tex"
    shell = Surface(tex / "bakes","shell")
    write_maps(tex,"shell",*paint_shell(shell),slope=.0078)


def main():
    from craft_finish import REGISTRATIONS, graphic, paint_strip as craft_strip
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("boat",choices=("thunderbolt",*REGISTRATIONS))
    boat = parser.parse_args().boat
    if boat=="thunderbolt":
        save_originals()
        thunderbolt()
    else:
        folder=HERE.parent/boat/"tex"
        surface=Surface(folder/"bakes","shell")
        write_maps(folder,"shell",*paint_shell(surface,lambda s: craft_strip(s,boat)),slope=.0115)
        directory=HERE/"ref"/boat
        directory.mkdir(exist_ok=True)
        extra={"needle":("number","stiletto"),"jon_boat":("RUN","AUX"),"riptide":()}
        for key in (boat,*extra[boat]):
            graphic(key).save(directory/(("registration" if key==boat else key.lower())+".png"))
        if boat=="riptide":
            from ski_finish import engine_page
            engine_page().save(directory/"engine.png")
    write_maps(HERE / "tex","hardware",*fittings(),slope=.019)


if __name__=="__main__":
    main()
