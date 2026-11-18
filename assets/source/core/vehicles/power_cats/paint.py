"""Paint the boat in metres in its rest pose."""
import argparse
from functools import lru_cache
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "marine"))
_prior_bytecode = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    from artwork import IDENTITY, project, save_originals
    from palette import OWN
    from surface import Surface
finally:
    sys.dont_write_bytecode = _prior_bytecode

TAU = np.float32(2 * np.pi)


def fade(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0, 1)
    return t*t*(3-2*t)


def stripe(distance, radius, pixel):
    return 1 - fade(radius - pixel*.5, radius + pixel*.5, abs(distance))


def mix(a, b, weight):
    return a + (b-a)*weight


def byte(a):
    return np.clip(np.rint(a), 0, 255).astype(np.uint8)


def wave(q):
    return np.sin(TAU*q)


@lru_cache(maxsize=3)
def lattice(seed):
    return np.random.default_rng(seed).uniform(-1, 1, (48, 48, 48)).astype(np.float32)


def noise(x, y, z, seed):
    # A periodic volume sampled in metres keeps both sides of a chart aligned.
    return ndimage.map_coordinates(lattice((7241, 5197, 89)[seed]), [x, y, z], order=1,
                                   mode="grid-wrap", prefilter=False)


def segment(x, y, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    t = np.clip(((x-a[0])*dx + (y-a[1])*dy)/(dx*dx+dy*dy),0,1)
    return np.hypot(x-a[0]-t*dx,y-a[1]-t*dy)


class Scheme:
    """Part extents, tag finishes and named, importable ranges of surface fields."""

    def __init__(self, boat, surface):
        self.boat, self.s = boat, surface
        self.large = boat == "lagoon"
        self.draft = .99 if self.large else .60
        with np.load(HERE.parent / boat / "tex/bakes" / (surface.name + ".npz")) as tri:
            p = tri["pos"]
            self.screen_sizes = {}
            for key in ("chart", "sonar"):
                front = (tri["tags"][tri["tag"]] == key) & (tri["nrm"][:,:,2].mean(1) < -.5)
                if front.any():
                    span = np.ptp(tri["uv"][front] * surface.size, axis=1).max(axis=0)
                    self.screen_sizes[key] = tuple(np.maximum(1, np.ceil(span)).astype(int))
            self.low = np.full((len(surface.parts), 3), np.inf, np.float32)
            self.high = -self.low.copy()
            np.minimum.at(self.low, tri["part"], p.min(axis=1))
            np.maximum.at(self.high, tri["part"], p.max(axis=1))
        self.groups = {n: np.array([name.split(".")[0] == n for name in surface.parts])
                       for n in {name.split(".")[0] for name in surface.parts}}

    def fields(self, texels=slice(None)):
        return Fields(self, texels)


class Fields:
    def __init__(self, scheme, texels):
        self.scheme = scheme
        s = scheme.s
        self.x, self.y, self.z = s.P[texels].T
        self.nx, self.up, self.nz = s.N[texels].T
        self.part, self.tag = s.PART[texels], s.TAG[texels]
        self.low, self.high = scheme.low[self.part].T, scheme.high[self.part].T
        self.ao, self.pixel = s.AO[texels], np.maximum(.001, s.MPT[texels])
        self.gelcoat = self.is_tag("gel", "shell", "stripe")
        self.glass = self.is_tag("glass")
        self.upholstery = self.is_tag("seat", "piping")
        self.waterline = self.y - scheme.draft
        self.tide = np.exp(-((self.waterline-.012-.008*wave(self.z*.82))/.048)**2)
        self.salt = self.tide*(.63+.37*noise(self.x*8, self.y*15, self.z*7, 1))
        self.name_place, self.port_place = self.stern()

    def is_tag(self, *tags):
        return np.isin(self.tag, [self.scheme.s.tags.index(t) for t in tags if t in self.scheme.s.tags])

    def on(self, name):
        has = self.scheme.groups.get(name)
        return has[self.part] if has is not None else np.zeros(self.tag.shape, bool)

    def stern(self):
        if self.scheme.large:
            aft = self.on("molded stern stair") & (self.z < self.low[2]+.032)
            return aft & (abs(self.low[2]+7.41)<.02), aft & (abs(self.low[2]+7.77)<.02)
        aft = self.on("aft bench storage") & (self.nz<-.62) & (self.z<-3.10)
        return aft, aft

    def graphics(self):
        """Yield (name, coverage, RGB, roughness, metalness, relief in mm) in paint order."""
        x, y, z = self.x, self.y, self.z
        boat, large = self.scheme.boat, self.scheme.large
        px = self.pixel
        outside = x*self.nx > 0
        if self.scheme.s.name == "hull" or not large:
            if large:
                centre = np.sign(x)*2.64
                name_y, port_y, width = 1.962, 1.699, 1.23
            else:
                centre = 0
                name_y, port_y, width = 1.645, 1.485, 1.17
            u = .5-(x-centre)/width
            mask = project(boat, "name", u, (name_y-y)/.126, 150, 17, self.name_place)
            yield "name", mask, (28,47,57), .28, 0, .14
            u = .5-(x-centre)/(.87 if large else .58)
            mask = project(boat, "port", u, (port_y-y)/.122, 100, 15, self.port_place)
            yield "home_port", mask, (30,45,48), .30, 0, .12
            if large:
                u = (z-3.50)/4.26
                datum = 1.64 + .49*np.clip(u, 0, 1)**1.5
                v = 1-(y-datum)/.30
                side = self.is_tag("shell") & outside
                underlay = project(boat, "wake", u, v-.076, 400, 33, side)
                ink = project(boat, "wake", u, v, 400, 33, side)
                yield "wake_keyline", underlay, (36,36,36), .30, 0, .07
                yield "wake_inlay", ink, (237,237,237), .25, .25, .09
        if large:
            # The registration sits on the white bulwark, clear of the hull colour.
            u = .5-np.sign(x)*(z-5.15)/1.49
            sheer = np.interp(z,[4.6,5.9,7],[2.38,2.48,2.58])
            v = (sheer+.238-y)/.157
            face = self.on("sheer and internal bulwark") & self.is_tag("gel") & outside & (abs(self.nx)>.54)
            ink = project(boat, "registration", u, v, 210, 22, face)
            yield "registration", ink, (35,54,64), .26, 0, .06
        if self.scheme.s.name == "house" or not large:
            for key in ("chart", "sonar"):
                face = self.is_tag(key)
                if face.any():
                    lo, hi = self.low, self.high
                    u = (hi[0]-x)/np.maximum(hi[0]-lo[0], .001)
                    v = (hi[1]-y)/np.maximum(hi[1]-lo[1], .001)
                    art = project(boat, key, u, v, *self.scheme.screen_sizes[key], face)
                    yield key, face, art, .23, 0, .02
        if not large:
            from sport_finish import graphics
            yield from graphics(self)
            return
        front = self.glass & self.on("panoramic bridge-deck saloon") & (self.nz>.45) & (z>2.4)
        if front.any():
            # Two pendulum arms park low on the raked forward panes.
            xx, yy = abs(x), (y-3.05)*1.35
            arm = stripe(segment(xx,yy,(.13,.045),(.93,.38)),.017,px)
            blade = stripe(segment(xx,yy,(.61,.197),(1.41,.55)),.025,px)
            pivot = fade(.055,.042,np.hypot(xx-.13,yy-.045))
            yield "wiper_arms", front*arm, (75,84,85), .31, .78, .71
            yield "wiper_blades", front*np.maximum(blade,pivot), (25,31,32), .68, 0, .91
        sideglass = self.glass & self.on("panoramic bridge-deck saloon") & (abs(self.nx)>.85)
        if sideglass.any():
            # Partly lowered blinds behind the aft quarter-lights, seen through the tint.
            top = fade(-2.39,-2.72,z)*fade(-4.25,-3.85,z)
            lower = 3.68 + .22*fade(-3.90,-2.89,z)
            area = top*fade(lower-.015,lower+.012,y)*sideglass
            slat = .40+.60*fade(-.80,.08,wave((y-lower)/.072))
            yield "quarter_blinds", area*slat*.65, (89,107,110), .12, 0, .012
        deck_end = self.on("high tunnel and bridge main deck") & (self.nz>.70) & (z>6.63)
        if deck_end.any():
            xx, yy = abs(x)-1.91, y-2.29
            d = np.hypot(np.maximum(abs(xx)-.11,0),yy)
            yield "dock_light_bezel", deck_end*fade(.089,.077,d), (74,89,94), .25, .85, .5
            yield "dock_light_lens", deck_end*fade(.063,.051,d), (166,184,185), .17, 0, .29
            flute = stripe((xx%.046)-.023,.005,px)
            yield "dock_light_flutes", deck_end*fade(.056,.047,d)*flute, (103,129,135), .24, 0, .42
        fascia = self.on("instrument fascia") & (self.up>.85)
        if fascia.any():
            xx, zz = x+1.02, z-1.393
            edges = np.maximum(abs(xx)-.53,abs(zz)-.106)
            rim = fascia*fade(.01,-.003,edges)
            yield "compass_recess", rim, (20,31,35), .31, 0, -.45
            ticks = stripe((xx+.055)%.11-.055,.009,px)
            major = stripe((xx+.165)%.33-.165,.012,px)
            pips = np.maximum(ticks*stripe(zz-.046,.023,px),major*stripe(zz-.031,.038,px))
            yield "compass_card", rim*pips,(198,210,192),.26,0,.04
            pointer = fade(.008,-.003,abs(xx)-np.maximum(0,(zz+.077)*.42))*(zz<-.004)*(zz>-.077)
            yield "compass_index", rim*pointer,(238,166,76),.28,0,.23
        switches = self.on("switch") & (self.nz<-.50)
        if switches.any():
            dx = x-(self.low[0]+self.high[0])*.5
            cap = switches*fade(.014,.009,np.hypot(dx,y-5.348))
            yield "switch_inserts", cap,(51,88,90),.47,0,-.13
        roof = self.on("floating flybridge hardtop") & (self.up>.75)
        if roof.any():
            dx, dz = abs(x)-1.08, z+.71
            edge = np.maximum(np.maximum(abs(dx)-.68, abs(dz)-1.46),
                              abs(dx)+abs(dz)-2.07)
            panel = fade(.006,-.006,edge)
            frame = panel*roof
            yield "solar_gasket", frame, (63,72,77), .36, .15, -.4
            border = fade(-.014,-.028,edge)*roof
            yield "solar_rim", border, (146,155,154), .27, .86, .6
            cells = fade(-.038,-.052,edge)*roof
            i = (dx+.636)/.212
            j = (dz+1.403)/.234
            ix, iz = abs((i+.5)%1-.5)*.212, abs((j+.5)%1-.5)*.234
            solder = np.maximum(stripe(ix,.0025,px),stripe(iz,.003,px))
            clips = fade(.023,.004,ix+iz)
            shade = 4*wave(np.floor(i)*.33+np.floor(j)*.13) + 26*solder + 41*clips
            shade += 5*stripe(((dx+.013)%.053)-.0265,.002,px)
            color = np.stack((25+shade,46+shade,61+shade),axis=-1)
            yield "solar_glass", cells, color, .17, .1, .34
        saloon = self.on("panoramic bridge-deck saloon")
        vent = saloon & outside & (abs(self.nx)>.70)
        if vent.any():
            dx, dy = abs(z+3.07), abs(y-2.64)
            edge = np.maximum(dx-.61, dy-.108) + .22*np.maximum(0,dx+dy-.65)
            frame = fade(.007,-.007,edge)*vent
            yield "vent_rim", frame, (151,159,155), .27, .88, .43
            slots = fade(-.017,-.029,edge)*vent
            louvre = fade(.38,.62,((y-2.54)/.043)%1)
            vals = 33+42*louvre
            yield "vent_louvres", slots, np.stack([vals,vals+9,vals+12],-1), .42, .35, -.7
        liner = self.on("flybridge hardtop liner") & (self.up<-.65)
        if liner.any():
            radius = np.hypot(abs(x)-1.84, np.minimum(abs(z-1.02),abs(z+3.45)))
            yield "downlight_trim", liner*fade(.085,.077,radius), (170,176,173), .23, 1, -.3
            yield "downlight_lens", liner*fade(.066,.059,radius), (221,211,172), .31, 0, .1
        bowl = self.on("sink bowl") & (self.up>.50)
        if bowl.any():
            r = np.hypot(x+1.88,z+2.58)
            yield "drain", bowl*fade(.052,.041,r), (149,157,155), .21, 1, -.6
            slots = stripe(r-.024,.005,px)*(.6+.4*wave(np.arctan2(z+2.58,x+1.88)*6/TAU))
            yield "drain_slots", bowl*slots,(35,40,40),.53,0,-.9


# Base sRGB, perceptual roughness and metallic fraction.
FINISH = {
    "gel": ((231,232,226),.225,0), "shell": ((201,201,201),.185,0),
    "stripe": ((207,207,207),.19,0), "under": ((44,57,59),.77,0),
    "rubber": ((33,39,40),.74,0), "carbon": ((41,49,52),.36,0),
    "glass": ((32,60,73),.095,0), "metal": ((207,214,214),.185,1),
    "bronze": ((170,126,65),.28,1), "seat": ((190,190,190),.72,0),
    "piping": ((218,208,184),.65,0), "chart": ((18,39,46),.23,0),
    "sonar": ((18,39,46),.23,0), "red": ((164,55,37),.31,0),
    "vent": ((49,56,58),.50,0), "green": ((46,132,104),.23,0),
}


def upholstery(f, fine):
    x, y, z = f.x, f.y, f.z
    lo, hi = f.low, f.high
    half = np.maximum((hi[0]-lo[0])*.5,.01)
    across = abs(x-(hi[0]+lo[0])*.5)
    back = f.on("bolstered backrest")
    length = np.where(back, (y-lo[1]), (z-lo[2]))
    run = np.where(back, hi[1]-lo[1], hi[2]-lo[2])
    t = np.clip(length/np.maximum(run,.01),0,1)
    edge = across - half*(.62+.105*(2*t-1)**2)
    groove = stripe(edge,.012,f.pixel)
    stitch = stripe(edge-.022,.0045,f.pixel)*(.22+.78*fade(-.6,.3,wave(length/.026)))
    inside = fade(.018,-.018,edge)
    ribs = stripe(((length+.017)%.145)-.0725,.013,f.pixel)*inside
    face = np.where(back, abs(f.nz), np.maximum(0,f.up))
    seam = (groove*31 + ribs*23 - stitch*24)*face
    leather = -20*inside*face + 3*fine - seam
    relief = fine*.105 - (groove*.86 + ribs*.46 - stitch*.26)*face
    recliner = f.on("foredeck recliner cushion")
    tape = recliner*(stripe(across-half*.76,.018,f.pixel) + stripe(across-half*.62,.007,f.pixel))
    return leather, relief, tape


def paint_block(f):
    s = f.scheme.s
    x, y, z = f.x, f.y, f.z
    color_lut = np.array([FINISH.get(n,((0,0,0),.5,0))[0] for n in s.tags],np.float32)
    rug_lut = np.array([FINISH.get(n,((0,0,0),.5,0))[1] for n in s.tags],np.float32)
    met_lut = np.array([FINISH.get(n,((0,0,0),.5,0))[2] for n in s.tags],np.float32)
    col, rough, metal = color_lut[f.tag], rug_lut[f.tag], met_lut[f.tag]
    dye = np.stack([f.is_tag("shell"),f.is_tag("stripe"),f.is_tag("seat")],-1)
    broad = noise(x*3.1,y*4.1,z*2.7,0)
    grain = noise(x*81,y*91,z*87,1)
    pores = noise(x*148+2,y*132,z*151,2)
    grain = .72*grain+.28*pores
    contact = (1-f.ao)**1.6
    dust = contact*(.28+.72*fade(-.06,.85,f.up))*(.75+.25*broad)
    col *= (1-.048*contact-.040*dust)[:,None]
    col += (broad*.91+grain*1.35)[:,None]
    height = grain*.155
    rough += .013*broad + .021*grain + dust*.039
    molded = f.on("separate molded demi-hull")
    wet = fade(.014,-.075,f.waterline)
    aged = f.gelcoat*(f.salt + wet*.41)*molded
    col -= (aged*18)[:,None]
    rough += aged*.11
    # Dilute runnels descend from the rail feet and disappear above the boot top.
    if f.scheme.large:
        runnel = np.zeros_like(x)
        for at, head in [(-6.64,2.43),(-5.47,2.58),(.74,2.60),(2.72,2.61),(6.15,2.86),(7.48,2.95)]:
            drop = head-y
            d = abs(z-at-.008*wave(y*2+at)-.012*drop)
            runnel = np.maximum(runnel, np.exp(-np.minimum(35,(d/.039)**2))*fade(-.02,.09,drop)*fade(.70,.10,drop))
        runnel *= f.gelcoat*(x*f.nx>0)
        col -= (runnel*10)[:,None]
        rough += .047*runnel

    under = f.is_tag("under")
    if under.any():
        film = wet*(.47+.25*broad) + f.salt*.54
        col[under] += (film[:,None]*np.array([12,14,7]) + grain[:,None]*5)[under]
        rough[under] += (.041*grain+.027*broad)[under]
        height[under] += (.22*grain+.12*broad)[under]
    if f.glass.any():
        light = f.on("long hull portlight")
        saloon = f.on("panoramic bridge-deck saloon")
        lo, hi = f.low, f.high
        h = np.where(saloon,(y-3.05)/1.06,(y-lo[1])/np.maximum(.04,hi[1]-lo[1]))
        h = np.clip(h,0,1)
        # A graduated laminate, a ceramic edge and a dot fade at the top of the cabin panes.
        frit = fade(.065,.020,np.minimum(h,1-h))
        dots = (saloon*fade(.77,.97,h)*fade(.45,.75,wave(x*44+z*47)*wave(y*49)))
        along = x*.77+z*.93
        veil = fade(-.75,.8,wave(along*.21+h*.39+.055*wave(along*.77)))
        band = np.exp(-((h-.37-.09*wave(along*.22))/.18)**2)
        sky = fade(.12,.93,h)
        glass = np.stack([23+23*sky+10*veil+5*band,
                          44+31*sky+14*veil+12*band,
                          55+39*sky+18*veil+16*band],axis=-1)
        glass -= light[:,None]*np.array([6,11,13])
        glass *= (1-.40*frit-.17*dots-.065*contact)[:,None]
        col[f.glass] = glass[f.glass]
        rough[f.glass] = (.095+.035*frit+.012*broad)[f.glass]
        height[f.glass] = (.015*broad-.19*frit)[f.glass]
    cloth = f.upholstery
    if cloth.any():
        leather, embossed, tape = upholstery(f,grain)
        col[cloth] += leather[cloth,None]
        height[cloth] = embossed[cloth]
        col = mix(col, np.array([96,84,65],np.float32), np.clip(tape,0,1)[:,None])
        rough[cloth] += (.028*pores)[cloth]
    composite = f.is_tag("carbon")
    if composite.any():
        weave = wave((x+z)*45+y*41)*wave((x-z)*44+y*39)
        weave *= fade(.015,.004,f.pixel)
        col[composite] += (2.8*weave)[composite,None]
        height[composite] += (.14*weave)[composite]
        wheel = f.on("steering rim") | f.on("arm pad")
        rough[wheel] = (.61+.03*grain)[wheel]
        liner = f.on("flybridge hardtop liner") & (f.up<-.5)
        col[liner] = np.array([123,121,109])*(1-.15*contact[liner,None])
    stainless = f.is_tag("metal")
    if stainless.any():
        # Dark water and bright deck returns turn round the tube. Uprights reflect the cabin.
        vertical = (f.high[1]-f.low[1]) > np.maximum(f.high[0]-f.low[0],f.high[2]-f.low[2])
        flank = np.where(vertical, f.nx*np.sign(x)*.77 + f.nz*.63, f.up+.16*f.nz)
        across = flank + .10*wave(z*.26+x*.16) + .036*broad
        return_light = fade(-.33,-.04,across)*fade(.57,.22,across)
        dark = fade(.16,.37,across)*fade(.96,.72,across)
        foot = f.on("stanchion foot") | f.on("cleat foot")
        socket = np.where(vertical,fade(.22,.025,y-f.low[1]),0) + foot*.55
        hand = .5+.5*wave(z*.62+x*.31+y*.8)
        silver = 158 + 89*return_light - 95*dark + 12*wave(across*.72+.19)
        silver *= 1-.24*np.minimum(1,socket)-.17*contact
        col[stainless] = np.stack((silver*1.09+5,silver*.99+3,silver*.89+2),-1)[stainless]
        rough[stainless] = (.245+.11*hand+.085*socket+.052*contact+.018*grain)[stainless]
        height[stainless] += (.055*wave((x+z)*104+y*3)*fade(.013,.004,f.pixel))[stainless]
    bronze = f.is_tag("bronze")
    if bronze.any():
        polish = wave(y*65 + z*3.3 + x*2.1)*.5 + .5*grain
        col[bronze] += (polish*3)[bronze,None]
        rough[bronze] += (.033*polish+.04*contact)[bronze]
    for _, coverage, pigment, gloss, metallic, relief in f.graphics():
        if not np.any(coverage):
            continue
        a = coverage.astype(np.float32)
        col = mix(col,np.asarray(pigment,np.float32),a[:,None])
        rough = mix(rough,gloss,a)
        metal = mix(metal,metallic,a)
        height = mix(height,relief,a)
        dye[a>.16] = False
    if not f.scheme.large:
        dyed = dye.any(axis=1)
        col[dyed] = col[dyed].mean(axis=1,keepdims=True)
    return byte(col), byte(np.stack((f.ao,rough,metal),-1)*255), dye.astype(np.uint8)*255, byte(128+55*height)


def normals(height, metres_per_pixel):
    h = height.astype(np.float32)
    slope = .001/(2*55*metres_per_pixel)
    x = (np.roll(h,1,axis=1)-np.roll(h,-1,axis=1))*slope
    y = (np.roll(h,-1,axis=0)-np.roll(h,1,axis=0))*slope
    nz = 1/np.sqrt(1+x*x+y*y)
    return byte(np.stack([x*nz,y*nz,nz],axis=-1)*127.5+127.5)


def save(folder, name, rgb, packed, mask, height, spacing):
    def write(role, im):
        im.save(folder / f"{name}_{role}.png", compress_level=4)
    solid = Image.fromarray(rgb).convert("RGBA")
    write("base",solid)
    write("packed",Image.fromarray(packed))
    write("mask",Image.fromarray(mask))
    write("height",Image.fromarray(height))
    write("normal",Image.fromarray(normals(height,spacing)))
    # The wear painter owns populated layers.
    for role in ("hurt", "decay"):
        if not (folder / f"{name}_{role}.png").exists():
            write(role,Image.new("RGBA",solid.size))


def own_picture(boat, material):
    folder = HERE.parent / boat / "tex"
    s = Surface(folder / "bakes", material)
    scheme = Scheme(boat,s)
    base, packed, mask = [np.empty((s.n,3),np.uint8) for _ in range(3)]
    height = np.empty(s.n,np.uint8)
    for start in range(0,s.n,192*1024):
        take = slice(start,min(start+192*1024,s.n))
        base[take],packed[take],mask[take],height[take] = paint_block(scheme.fields(take))
    side = s.size
    save(folder,material,base.reshape(side,side,3),packed.reshape(side,side,3),
         mask.reshape(side,side,3),height.reshape(side,side),1/(143 if material=="house" else 92))
    print(f"{boat} {material} {side}",flush=True)


def teak_fields():
    """Periodic plank index, caulking, bungs, grain and individual board tones."""
    size, count = 1024, 40
    rng = np.random.default_rng(86312)
    rows, cols = (np.indices((size,size),np.float32)+.5)/size
    course = cols*count+.48
    board = np.floor(course).astype(int)%count
    across = course%1
    # One full-length joint per course; four-lane shift keeps adjacent ends apart.
    joints = ((np.arange(count)*.313 + rng.uniform(-.043,.043,count)+.107)%1)
    joints[(joints<.042) | (joints>.958)] = .073
    along = (rows-joints[board])%1
    side = np.minimum(across,1-across)*2.4/count
    end = np.minimum(along,1-along)*2.4
    edge = np.minimum(side,end)
    caulk = fade(.00315,.00085,edge)
    lip = fade(.0049,.0018,edge)*(1-caulk)
    # Pin bungs lie either side of a butt, with the grain turned slightly in the plug.
    r = np.hypot((across-.50)*.060,end-.025)
    bung = fade(.0058,.0036,r)
    tone = rng.normal(0,7.3,count)[board]
    phase = rng.random(count)[board]
    bend = .24*wave(along+phase)+.085*wave(along*3+phase*2)
    fibre = wave(across*3.6+bend+phase)+.4*wave(across*7.9+bend*1.5+phase)
    def thread(sy,sx):
        n = ndimage.gaussian_filter(rng.standard_normal((size,size)).astype(np.float32),
                                    (sy,sx),mode="wrap")
        return n/max(.0001,float(n.std()))
    ribbons = thread(32,1.6)
    pores = np.maximum(thread(4,.50)-.76,0)
    grain = 2.6*fibre+2.6*ribbons-5.8*pores+1.35*thread(.6,.55)
    ring = fade(.0075,.0048,r)*(1-bung)
    grain = mix(grain,2.8*wave(across*5+along*171)+2,bung)-5*ring
    return board,caulk,lip,bung,tone,grain


def teak():
    board,caulk,lip,bung,tone,grain = teak_fields()
    n = grain + tone
    rgb = np.stack((180+n*.92,132+n*.91,78+n*.74),-1)
    rgb *= (1-lip*.10)[:,:,None]
    rgb = mix(rgb,np.array([36,37,33]),caulk[:,:,None])
    h = byte(128+55*(.08*grain/4-.19*lip-1.12*caulk+.06*bung))
    packed = byte(np.stack((1-.14*caulk-.08*lip,.46+.018*grain/4+.012*tone/6+.25*caulk,
                            np.zeros_like(grain)),-1)*255)
    save(HERE/"tex","teak",byte(rgb),packed,np.zeros((*board.shape,3),np.uint8),h,2.4/1024)
    print("shared teak 1024",flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("boat",choices=tuple(IDENTITY))
    args = parser.parse_args()
    save_originals(args.boat)
    for material in OWN[args.boat]:
        own_picture(args.boat,material)
    if args.boat == "lagoon" or not all((HERE/"tex"/f"teak_{role}.png").exists() for role in ("base","height","normal","packed","mask")):
        teak()
