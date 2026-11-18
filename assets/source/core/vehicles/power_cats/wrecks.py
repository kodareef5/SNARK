"""Paint the catamarans as their two wreck meshes lie in the water."""
import argparse
import json
from pathlib import Path
import subprocess
from tempfile import NamedTemporaryFile

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

from paint import HERE, OWN, Scheme, Surface, byte, fade, noise, teak_fields, wave
from wear import Marks, cells, pane_coordinates

FORMS = HERE.parent / "marine/forms.json"
ROLES = ("base", "packed", "mask")


class Form:
    def __init__(self, name, spec, design, vertices):
        self.name = name
        self.sunk = name == "sunk"
        self.burnt = spec.get("burnt", False)
        self.floor, self.share = spec.get("slump", (0, 0))
        heel, trim = np.radians([spec["heel"], spec["trim"]])
        self.ch, self.sh = np.cos(heel), np.sin(heel)
        self.ct, self.st = np.cos(trim), np.sin(trim)
        self.dents = spec["dents"]
        if design["id"]=="core:manta":
            self.water = design["beltline"]*.90 if self.sunk else design["draft"]*1.25
        elif self.sunk:
            bottom = self.position(*vertices.T)[1].min()
            self.water = bottom + design["boarding"]["deck"][1]
        else:
            draft = design["draft"]
            self.water = round(draft + .30 * (design["beltline"] - draft), 3)

    def position(self, x, y, z):
        y = y - self.share * np.maximum(0, y - self.floor)
        hy = y*self.ch - x*self.sh
        return x*self.ch + y*self.sh, hy*self.ct - z*self.st, hy*self.st + z*self.ct

    def skyward(self, f):
        ny = f.up / np.where(f.y > self.floor, 1-self.share, 1)
        norm = np.sqrt(f.nx*f.nx + ny*ny + f.nz*f.nz)
        return ((ny*self.ch-f.nx*self.sh)*self.ct - f.nz*self.st) / np.maximum(norm, .01)


class Coating:
    def __init__(self, base, packed, mask):
        self.base = base
        self.mask = mask
        self.rgb = base[..., :3].astype(np.float32)
        self.ao, self.rough, self.metal = np.moveaxis(packed.astype(np.float32)/255, -1, 0)
        self.sound = np.ones(base.shape[:-1], np.float32)

    def lay(self, amount, colour, rough, metal=0, grain=0):
        a = np.clip(amount, 0, 1)
        target = np.asarray(colour, np.float32) + np.asarray(grain, np.float32)[..., None]
        self.rgb += (target-self.rgb)*a[..., None]
        self.rough += (rough-self.rough)*a
        self.metal += (metal-self.metal)*a
        self.sound *= 1-a

    def maps(self):
        mask = self.mask.copy()
        dyed = mask.any(axis=-1)
        bare = dyed & (self.sound < .64)
        mask[bare] = 0
        # Under lifted enamel the neutral dye carrier gives way to the deposit and primer.
        surviving = self.sound[bare, None]
        self.rgb[bare] -= surviving*(self.base[bare, :3].astype(np.float32)-np.array([137,138,128],np.float32))
        keep = dyed & ~bare
        self.rgb[keep] = self.rgb[keep].mean(axis=-1, keepdims=True)
        base = self.base.copy()
        base[..., :3] = byte(self.rgb)
        return base, byte(np.stack((self.ao, self.rough, self.metal), axis=-1)*255), mask


def seawater(coat, m, form, height, up):
    f = m.f
    x, y, z = f.x, f.y, f.z
    wet = height - form.water
    if wet.min() > 1.0:
        return
    current = noise(z*2.8, x*2, height*3.7, 2)
    chop = .019*wave(z*.84+x*.41) + .040*m.cloud + .015*m.mottle
    line = wet-chop
    submerged = fade(.04, -.12, line)
    tide = fade(.085, -.025, line)*fade(-.37,-.11,line)
    crust = np.exp(-((line-.054)/(.028 if form.sunk else .017))**2)
    sun = np.maximum(0, up)
    shadow = 1-f.ao
    texture = m.tone
    if form.sunk:
        coat.lay(submerged*(.63+.17*current), (68,80,62), .46, grain=texture*.69)
        mud = fade(.12,-.31,wet)*(.16+.65*sun+.19*shadow)*(.79+.30*m.cloud)
        coat.lay(mud, (114,104,78), .77, grain=texture*.85)
        coat.lay(crust*(.57+.35*m.mottle), (155,148,110), .79, grain=texture*.48)
    else:
        coat.lay(submerged*(.12+.055*current), (79,89,66), .40, grain=texture*.49)
        coat.lay(crust*(.46+.26*m.mottle), (194,191,155), .64, grain=texture*.48)

    threads = noise(x*18+z*22, wet*3.6, z*.8, 0)
    weed = fade(.12,-.04,line) * fade(-.56,-.17,line + .26*current+.12*threads)
    coat.lay(tide*(.69+.20*current), (83,89,52), .48, grain=texture*.62)
    coat.lay(weed*fade(-.32,.27,threads+.45*current)*(.78 if form.sunk else .49),
             (48,67,41), .41, grain=texture*.62)
    tang = y + .15*x
    # Project onto each hull's side and underbody, including the ceiling of the tunnel.
    longitudinal = np.abs(f.up) > .57
    v = np.where(longitudinal, x, tang)
    _, dy, radius, scale = cells(z*18.3 + v*2.7, v*18.7-z*1.8, 749)
    ceiling = (f.on("high tunnel and bridge main deck")|f.on("tunnel bridge and cockpit sole")) & (up<-.38)
    bed = np.maximum(submerged, ceiling*fade(.50,-.15,wet))
    clump = m.cloud + .58*m.mottle + .29*current
    density = fade(-.20,.38,clump) if form.sunk else fade(.30,.78,clump)*.42
    shell = bed*density*fade(1.15,.84,radius)
    coat.lay(shell, (165,155,121), .84, grain=17*dy + 13*scale + texture*.48)
    coat.lay(shell*fade(.57,.27,radius), (57,62,45), .70, grain=texture*.40)


def strikes(coat, m, form, hurt):
    f = m.f
    x,y,z = f.x,f.y,f.z
    body = f.on("separate molded demi-hull")
    bulwark = f.on("sheer and internal bulwark")
    metal = f.is_tag("metal","bronze")
    for i, ((cx,cy,cz), radius, depth) in enumerate(form.dents):
        side = np.sign(cx)
        dist = np.sqrt((x-cx)**2+(y-cy)**2+(z-cz)**2)/radius
        if not np.any(dist < 2.5):
            continue
        reach = fade(1.0,.56,dist)
        sidewall = (body|bulwark) & (side*f.nx>.10)
        incline = (.62 if side<0 else -.45) * (1 if i==0 else -.64)
        dz = (z-cz)/radius
        h = (y-cy)/radius - incline*dz
        scar = h + .048*wave(1.18*dz+i) + .036*m.mottle
        taper = np.maximum(0, 1-(dz/1.34)**2)
        width = np.maximum(.001, (.075+.093*depth/.26)*taper)
        fibre = wave(scar*44 + .20*m.mottle)+.54*wave(scar*87 + .32*dz)
        rubbed = sidewall * fade(width+.022,width-.012,abs(scar)) * fade(1.48,1.19,abs(dz))
        coat.lay(rubbed*(.71+.22*m.cloud), (73,74,66), .52, grain=m.tone*.71)
        coat.lay(rubbed*fade(-.2,.48,fibre)*fade(width*.87,width*.25,abs(scar)),
                 (189,157,111), .77, grain=m.tone+fibre*13)
        cap = f.is_tag("rubber") & (side*x>0)
        coat.lay(cap*fade(2.1,.38,abs(dz))*fade(-.27,.52,m.mottle+.4*fibre),
                 (145,140,117), .63, grain=m.tone)
        shoulder = sidewall*reach*fade(.003,.19,abs(scar))*fade(.9,.22,abs(h))
        coat.rgb *= (1-.17*shoulder + .05*shoulder*wave(h*1.22))[...,None]

        # Use the same laminate fracture as the vessel, centred on this mesh's dent.
        m.hurt.rgba.fill(0)
        m.breach(side,cz,cy,radius*(.36+depth*.65),radius*(.115+depth*.39),
                 np.sign(incline)*.18, 2.25+i*2.12)
        ink = m.hurt.rgba
        cut = (ink[:,3]>0)*fade(1,.85,dist)
        coat.lay(cut, ink[:,:3], .82)
        opening = cut*(ink[:,:3].max(1)<46)
        coat.ao *= 1-.60*opening
        if not form.sunk:
            # The same blow transmits up the wet quarter into its light, fittings and rail.
            local = fade(2.1,.52,abs(dz))*fade(1.65,.12,abs(x-cx))
            portlight = f.on("long hull portlight")
            seat = f.upholstery & (z<cz+1.6)
            damage = ((metal|portlight|seat)*local + (body|bulwark)*reach*(ink[:,3]==0))
            # Existing laminate holes have a different centre; keep only surface scratches there.
            use = (hurt[:,3]>0) & ((metal|portlight|seat)|(hurt[:,3]>170))
            coat.lay(np.minimum(1,damage)*use, hurt[:,:3], .59)
            fascia = (bulwark|body) & (x*side>0) & (f.nx*side>.18)
            nick = (y-cy)-.59-.36*(z-cz)+.055*wave(z*.57)+.025*m.mottle
            skid = fascia*fade(1.75,.52,abs(dz-.25))*fade(.114,.050,abs(nick))
            coat.lay(skid, (85,82,68), .64, grain=m.tone*.72)
            strands = noise(z*2.7,nick*95,x*.7,1) + .35*noise(z*.88,nick*123,x*1.4,0)
            coat.lay(skid*fade(-.21,.45,strands), (197,174,126), .76, grain=m.tone)
            aft_light = f.glass & f.on("panoramic bridge-deck saloon") & (x*side>2.45) & (z<cz+2.5)
            coat.lay(aft_light*(hurt[:,3]>85)*.74, hurt[:,:3], .44)


def adrift(coat, m, form, height, up, hurt, decay):
    f = m.f
    sun = np.maximum(0,up)
    cloth = f.upholstery
    salt = fade(.24,.75,m.cloud+.56*m.mottle+.47*sun)
    coat.rough += (1-coat.rough)*(.046+.072*sun)*f.ao
    coat.lay(f.is_tag("gel")*salt*(.14+.08*sun), (212,209,190), .54, grain=m.tone*.32)
    coat.lay(cloth*salt*.25,(152,146,123), .78, grain=m.tone*.44)
    old = decay[:,3]
    # Retain early dry salt rings, drip trails and soiled hems; the tide moves with the hull.
    early = (old>170) & (f.waterline>.23)
    rust = (decay[:,0].astype(int)-decay[:,2]>48) & (f.waterline>.30)
    coat.lay(.48*early+.27*rust, decay[:,:3], .58)
    seep = (1-f.ao)*(.19+.18*fade(-.33,.37,m.mottle))
    coat.lay(seep*(cloth|f.is_tag("rubber","gel")), (122,116,89), .68, grain=m.tone*.56)
    # Leave the chart glass and dead sounder visible beneath the hardtop.
    screen = f.is_tag("chart","sonar")
    coat.lay(screen*.84, (28,38,40), .22, grain=m.cloud*4)
    seawater(coat,m,form,height,up)
    strikes(coat,m,form,hurt)


def fissures(u,v):
    """Distance to the boundary of a heat-check cell and the pitch of its surface."""
    ix,iy = np.floor(u),np.floor(v)
    fx,fy = u-ix,v-iy
    first = np.full_like(u,9)
    second = first.copy()
    slope = np.zeros_like(u)
    for ox in (-1,0,1):
        for oy in (-1,0,1):
            dx,dy,_,_ = cells(ix+ox+.5,iy+oy+.5,1801)
            dx,dy = fx-.5-ox+dx,fy-.5-oy+dy
            distance = dx*dx+dy*dy
            closer = distance<first
            second = np.where(closer,first,np.minimum(second,distance))
            slope = np.where(closer,dy-.36*dx,slope)
            first = np.minimum(first,distance)
    return np.sqrt(second)-np.sqrt(first),slope


def roof_fire(coat, m, roof):
    if not roof.any():
        return
    f = m.f
    idx = np.flatnonzero(roof)
    x,y,z = f.x[idx],f.y[idx],f.z[idx]
    cloud, flakes, grit = m.cloud[idx],m.mottle[idx],m.grit[idx]
    # The wet-bar fire vents through the liner, then runs diagonally forward under the skin.
    dx,dz = x+1.61,z+2.25
    down = .61*dx+.79*dz
    cross = .79*dx-.61*dz
    flow = cross-.17*np.sin(1.5*down)-.06*cloud
    tail = noise(flow*7.3,down*.54,y*.26,2)
    wind = noise(flow*20+cloud*.24,down*.68,y*.12,1)
    tongues = np.minimum(np.hypot((down-.31)/1.70,flow/.87),
                         np.hypot((down-1.52)/1.67,(flow+.30)/.54))
    run = fade(-.55,.53,down)*fade(4.7,2.9,down)
    fingers = np.maximum(np.exp(-((flow+.51+.10*np.sin(down*2.8))/.18)**2),
                         .79*np.exp(-((flow-.38-.11*np.sin(down*1.9))/.14)**2))
    burn = tongues + .23*cloud + .11*flakes + .14*tail + .028*grit - .40*run*fingers
    smoke = fade(-1.85,-.48,down)*fade(7.3,3.95,down)*fade(2.78,.86,abs(flow))
    ribbon = fade(-.58,.52,tail+.35*wind)
    upface = f.up[idx]
    raised = upface>.55
    ripple = noise(x*2.9,y*.38,z*2.1,2)
    border,pitch = fissures(x*5.9+z*2.2+1.44*ripple+.41*flakes,
                            z*8.3-x*1.6+1.62*cloud+.35*flakes)
    fibre = wave(x*67+z*40+.29*flakes)+.65*wave(z*55-x*30+.31*grit)
    _,by,blister,size = cells(x*16+z*4,z*18-x*3,785)
    rgb = coat.rgb[idx].copy()
    rough = coat.rough[idx].copy()
    metal = coat.metal[idx].copy()
    ao = coat.ao[idx].copy()

    def skin(amount, colour, r, grain=0):
        a=np.clip(amount,0,1)
        rgb[:] += (np.asarray(colour)+np.asarray(grain)[...,None]-rgb)*a[:,None]
        rough[:] += (r-rough)*a
        metal[:] *= 1-a

    # Long, narrow smoke returns can still be traced outside the peeling front.
    skin(smoke*(.16+.69*ribbon), (52,48,43),.91, 8*tail+4*wind)
    skin(smoke*run*np.maximum(fingers,ribbon*fade(.14,.72,tail+.5*wind)), (27,27,25),.94, 5*wind)
    edge = fade(1.91,1.14,burn)
    skin(edge, (112,99,80), .85, 14*cloud+8*flakes+4*fibre)
    bare = fade(1.51,1.39,burn+.065*pitch)
    skin(bare, (99,91,77),.93, 16*flakes+8*fibre+5*grit)
    peel = fade(.99,1.20,burn)*fade(1.90,1.37,burn)*fade(-.17,.42,ripple+.63*tail+.23*flakes)
    scale = fade(.12,.43,pitch+.33*flakes+.25*tail)
    skin(peel*scale*fade(.035,.17,border), (143,131,111),.86, 15*pitch+8*grit)
    skin(peel*fade(.11,.018,border), (51,44,39),.97)
    rim = peel*scale*fade(.026,.073,border)*fade(.15,.08,border)
    skin(rim,(176,164,139),.86, 6*grit)
    bubbles = fade(.55,.96,size)*fade(1.8,1.1,burn)*fade(.91,1.14,burn)*fade(-.40,.42,flakes+.7*ripple)
    skin(bubbles*fade(1.23,.84,blister), (82,70,56),.91, 58*by+4*flakes)
    skin(bubbles*fade(.79,.40,blister), (39,34,28),.96)
    # A near-black carbon core, its ripped plies and an inward-facing lip.
    core = fade(1.15,1.00,burn+.042*fibre+.075*pitch)
    skin(core,(26,24,22),.97, 7*pitch+3*grit+5*flakes)
    skin(core*fade(.087,.02,border)*fade(-.15,.38,flakes+.45*tail), (9,10,10),.98)
    mouth = fade(.75,.64,burn+.09*flakes+.035*fibre)
    skin(mouth,(12,13,13),.98, 2*grit+3*cloud+3*tail)
    skin(core*(1-mouth)*fade(.67,.95,tail+.45*flakes), (57,49,39),.93, 4*fibre)
    ao *= 1-.39*core-.20*mouth
    # Liner has lost its finish even where the carbon skin above still holds.
    skin((~raised)*(1-core)*.36,(48,43,35),.94,6*flakes)
    coat.rgb[idx],coat.rough[idx],coat.metal[idx],coat.ao[idx] = rgb,rough,metal,ao


def burnt_glazing(coat, m):
    f=m.f
    glass=f.glass|f.is_tag("chart","sonar")
    if not glass.any():
        return
    u,v,pane=pane_coordinates(f)
    rooflight=f.on("panoramic bridge-deck saloon")
    drip=noise((f.x+f.z)*17,v*1.5,f.z*.7,2)
    coat.lay(glass*.98,(28,32,32),.48,grain=9*m.cloud+8*drip)
    soot=glass*fade(.57,.10,v+.14*drip+.08*m.mottle)
    coat.lay(soot,(15,17,17),.85,grain=m.tone*.19)
    # Through a dropped pane the dark inner jamb and sill survive as separate planes.
    open_pane=glass & rooflight & np.isin(pane,[1,3,4,5,8,10,13,14])
    room=np.zeros_like(u)
    cut_edge=np.zeros_like(u)
    for key in np.unique(pane[open_pane]):
        at=np.flatnonzero(open_pane & (pane==key))
        a,b=u[at],v[at]
        rng=np.random.default_rng(3191+int(key))
        air=np.ones_like(a)
        glint=np.zeros_like(a)
        for along,inward in ((a,b),(a,1-b),(b,a),(b,1-a)):
            depth=np.zeros_like(a)
            for _ in range(rng.integers(1,4)):
                peak=rng.uniform(0,1)
                left,right=rng.uniform(.025,.26,2)
                tooth=np.minimum(1+(along-peak)/left,1-(along-peak)/right)
                depth=np.maximum(depth,tooth*rng.uniform(.034,.235))
            offset=inward-depth-.007
            air=np.minimum(air,fade(-.005,.007,offset))
            glint=np.maximum(glint,fade(.009,.002,abs(offset))*fade(.022,.076,depth))
        room[at],cut_edge[at]=air,glint
    bulkhead=np.where(u>.62+.09*v,7,0)+np.where(v>.79-.13*u,8,0)
    coat.lay(room,(13,17,18),.96,grain=bulkhead+4*m.cloud)
    coat.lay(cut_edge,(79,89,87),.44,grain=m.tone*.55)
    coat.ao *= 1-.62*room
    coat.lay(f.is_tag("chart","sonar"),(25,29,29),.65,grain=m.tone*.28)


def fire(coat, m, form, height, up):
    f=m.f
    x,y,z=f.x,f.y,f.z
    wet=height-form.water
    roof=f.on("floating flybridge hardtop")|f.on("flybridge hardtop liner")|f.on("formed sport hardtop")|f.on("hardtop carbon underside")
    metal=f.is_tag("metal","bronze")
    fabric=f.upholstery|f.is_tag("rubber","carbon")
    superstructure=fade(1.97,2.83,y)
    bar=np.exp(-((x+1.67)/1.81)**2-((z+2.08)/2.85)**2)
    aft=np.exp(-((z+2.60)/3.82)**2)
    sootruns=noise(z*6.3+x*5.8,y*.87,z*.91,2)
    wash=noise((x+z)*21.3,y*.82,z*.52,1)
    heat=.40+.43*superstructure+.42*bar+.16*aft+.13*m.cloud+.105*sootruns
    heat+=.13*(1-f.ao)+.11*np.maximum(-up,0)-.20*fade(.14,-.40,wet)
    tone=m.tone
    # Below the fire the primer is grey. Only scattered sheltered islands of enamel survive.
    shell=f.is_tag("shell","stripe")
    sound=fade(.54,.83,m.cloud+.51*m.mottle+.12*wash)*fade(.79,.38,heat)
    primer=(1-sound*.97)*shell
    coat.lay(primer,(98,101,88),.77,grain=11*m.cloud+tone*.46)
    gel=f.gelcoat
    fibre=wave(x*39+y*47+z*55+.37*m.mottle)+.62*wave(z*69-y*41+x*27+.29*m.grit)
    coat.lay(gel*fade(.36,.70,heat),(150,141,121),.78,grain=14*m.cloud+tone*.56)
    char=fade(.52,1.0,heat+.095*sootruns)
    coat.lay(gel*char,(76,68,57),.93,grain=7*fibre+tone*.70)
    peel=fade(.19,.59,m.cloud+.54*m.mottle+.22*m.grit)
    coat.lay(gel*superstructure*peel*(.86-.40*bar),(161,148,124),.89,grain=9*fibre+tone*.64)
    coat.lay(gel*superstructure*(.27+.52*bar)*fade(-.20,.50,sootruns+.6*wash),(44,43,38),.94,grain=tone*.39)
    valance=f.on("high tunnel and bridge main deck") & (z>2.0) & (f.nz>.45)
    coat.lay(valance*fade(-.15,.25,wet)*(.30+.56*fade(-.27,.57,sootruns+.46*wash)),
             (66,64,53),.89,grain=tone*.48)
    lip=f.on("salon roof shadow line")|f.on("flybridge floor and aft cockpit overhang")
    skirt=lip*fade(-.35,.30,sootruns+.35*wash)*fade(.56,-.56,up)
    coat.lay(skirt,(35,33,29),.96,grain=tone*.29)
    coat.lay(fabric*(.60+.38*superstructure),(43,42,36),.92,grain=tone*.65)
    heatmetal=metal*fade(.50,.90,heat)
    band=.5+.5*wave(.36*y+.18*z+.13*m.cloud)
    blue=np.stack((84+42*band,88+16*band,105-39*band),axis=-1)
    coat.lay(heatmetal*.83,blue,.41,.91,grain=tone*.26)
    coat.lay(heatmetal*fade(.08,.64,sootruns+.63*bar), (54,51,45),.79,.20,grain=tone*.45)
    burnt_glazing(coat,m)
    roof_fire(coat,m,roof)
    # Under the starboard quarter lip a few enamel chips escaped the flame and tide.
    island=np.hypot((z+4.9)/1.74,(y-1.96)/.26)
    shelter=shell*(x<-2.4)*fade(1.1,.59,island+.38*m.cloud+.19*m.mottle)
    remnant=shelter*fade(-.20,.28,m.cloud+.65*m.mottle+.32*wash)
    coat.rgb += (coat.base[:,:3].astype(np.float32)-coat.rgb)*remnant[:,None]
    coat.sound += (1-coat.sound)*remnant
    coat.rough += (.27-coat.rough)*remnant


def read_maps(folder, material):
    maps=[]
    for role in (*ROLES, "hurt", "decay"):
        with Image.open(folder/f"{material}_{role}.png") as image:
            pixels=np.asarray(image)
        maps.append(pixels.reshape(-1,pixels.shape[-1]))
    return maps


def write_maps(folder, material, maps, size):
    folder.mkdir(parents=True,exist_ok=True)
    for role, pixels in zip(ROLES,maps):
        path=folder/f"{material}_{role}.png"
        with NamedTemporaryFile(dir=folder, suffix=".png", delete=False) as tmp:
            temp=Path(tmp.name)
        try:
            Image.fromarray(pixels.reshape(size,size,-1)).save(temp, compress_level=4)
            temp.chmod(0o644)
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)


def own(boat, material, forms):
    folder=HERE.parent/boat/"tex"
    s=Surface(folder/"bakes",material)
    scheme=Scheme(boat,s)
    base,packed,mask,hurt,decay=read_maps(folder,material)
    outputs=[[np.empty_like(a) for a in (base,packed,mask)] for _ in forms]
    for start in range(0,s.n,192*1024):
        sl=slice(start,min(s.n,start+192*1024))
        f=scheme.fields(sl)
        m=Marks(f)
        for form,maps in zip(forms,outputs):
            coat=Coating(base[sl],packed[sl],mask[sl])
            height=form.position(f.x,f.y,f.z)[1]
            up=form.skyward(f)
            if form.sunk:
                if form.burnt:
                    fire(coat,m,form,height,up)
                else:
                    from sport_wreck import swamp
                    swamp(coat,m,form,height,up,decay[sl])
                seawater(coat,m,form,height,up)
                strikes(coat,m,form,hurt[sl])
            else:
                adrift(coat,m,form,height,up,hurt[sl],decay[sl])
            for target,pixels in zip(maps,coat.maps()):
                target[sl]=pixels
    for form,maps in zip(forms,outputs):
        write_maps(HERE.parent/f"{boat}_{form.name}"/"tex",material,maps,s.size)
        print(f"{boat}_{form.name} / {material} {s.size}px, water {form.water:.3f} m",flush=True)


def decks(include_burnt=True):
    board, caulk, lip, bung, tone, grain=teak_fields()
    folder=HERE/"tex"
    src=[a.reshape(1024,1024,-1) for a in read_maps(folder,"teak")]
    base,packed,mask,hurt,decay=src
    y,x=(np.indices(board.shape,np.float32)+.5)/1024
    rng=np.random.default_rng(21915)
    def cloud(along,across):
        field=gaussian_filter(rng.standard_normal(board.shape).astype(np.float32),(along,across),mode="wrap")
        return field/field.std()

    pool=cloud(36,16)
    streak=cloud(26,3)
    chip=cloud(3,1.8)
    crown=1-caulk
    ashore=Coating(base,packed,mask)
    bleach=np.clip(.39+.014*tone+.15*pool+.11*streak,0,1)
    ashore.lay(crown*bleach,(165,156,132),.63,grain=.79*grain+.62*tone)
    ashore.lay((caulk+.65*lip)*fade(-.31,1.30,streak)*.51,(80,81,58),.49,grain=grain*.55)
    ashore.lay(crown*fade(.18,1.54,-pool-.27*chip)*.27,(109,99,73),.58,grain=grain+tone*.52)
    ashore.lay((hurt[...,3]>85)*(hurt[...,0]>128)*.72, hurt[...,:3],.73)
    ashore.lay((decay[...,3]>170)*.44, decay[...,:3],.67)
    write_maps(folder,"teak_worn",ashore.maps(),1024)
    if not include_burnt:
        return

    sunk=Coating(base,packed,mask)
    channel=.52*wave(x+.07*wave(y)+.10)+.19*wave(x*3-.035*wave(y*2))
    hot=fade(-.22,.64,.15*pool+.15*streak+channel+.31*rng.uniform(-1,1,40)[board])
    scum=fade(-.67,.85,-.64*pool+.38*streak+.17*chip)
    sunk.lay(np.ones_like(y),(130,123,101),.78,grain=grain*.87+tone*.72+4*chip)
    sunk.lay(scum*(.38+.21*lip),(79,89,63),.53,grain=grain*.55)
    sunk.lay(crown*hot,(51,45,37),.95,grain=grain*.90+7*chip+tone*.24)
    check=abs((y*15 + board*.317 + .12*wave(x*40)+.15*streak+.5)%1-.5)
    sunk.lay(crown*hot*fade(.064,.020,check)*fade(-.45,.55,chip), (23,24,21),.97)
    sunk.lay(crown*hot*fade(.91,1.73,chip+.44*streak),(112,99,77),.90,grain=grain)
    sunk.lay(caulk*.92,(39,40,32),.80,grain=chip*4)
    sunk.lay((caulk+lip)*scum*.52,(61,72,46),.46,grain=grain*.4)
    sunk.lay(bung*crown*(1-hot)*.28,(123,116,95),.78,grain=grain*.62)
    sunk.ao *= 1-.12*caulk*hot
    write_maps(folder,"teak_wrecked",sunk.maps(),1024)
    print("shared teak / worn and wrecked 1024px",flush=True)


def wrecks(boat):
    design=json.loads(subprocess.check_output(["bun",str(HERE/"design.ts"),boat]))
    specs=json.loads(FORMS.read_text())[boat]
    with np.load(HERE.parent/boat/"tex/bakes/hull.npz") as bake:
        vertices=bake["pos"].reshape(-1,3)
    forms=[Form(name,specs[name],design,vertices) for name in ("damaged","sunk")]
    for material in OWN[boat]:
        own(boat,material,forms)
    if boat=="lagoon":
        decks()
    elif not all((HERE/"tex"/f"teak_worn_{role}.png").exists() for role in ROLES):
        decks(include_burnt=False)
    if boat=="manta":
        from sport_wreck import flooded_teak
        write_maps(HERE.parent/"manta_sunk/tex","teak",flooded_teak(),1024)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("boat",choices=tuple(OWN))
    wrecks(parser.parse_args().boat)
