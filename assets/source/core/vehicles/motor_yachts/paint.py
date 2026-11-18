"""Paint the laid deck and the selected vessel from its shipyard surfaces."""
import argparse
from dataclasses import dataclass
from functools import lru_cache
import json
import os
from importlib.util import module_from_spec, spec_from_file_location
from types import SimpleNamespace
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
from livery import PAINT
from artwork import IDENTITY, masters
from palette import OWN, SCREENS

LINES = HERE.parents[4] / "content/vehicles/yacht-lines.json"
TAU = np.float32(2 * np.pi)

# Unlit colour in sRGB, roughness and metalness.
FINISH = {
    "topsides": ((210,210,210), 38, 0), "strake": ((169,169,169), 54, 0),
    "keel": ((38,52,55), 169, 0), "boot": ((38,54,59), 68, 0),
    "pearl": ((232,231,222), 51, 0), "cream": ((228,219,195), 63, 0),
    "graphite": ((44,52,56), 78, 0), "gasket": ((30,35,36), 180, 0),
    "glass": ((28,46,53), 32, 0), "clear": ((28,46,53), 32, 0),
    "upholstery": ((218,218,218), 156, 0), "piping": ((175,158,129), 148, 0),
    "linen": ((226,216,192), 187, 0), "slate": ((69,99,102), 198, 0),
    "leather": ((54,58,55), 142, 0), "walnut": ((113,73,49), 70, 0),
    "stainless": ((214,220,219), 44, 255), "bronze": ((194,147,84), 87, 255),
    "red": ((181,42,29), 49, 0), "green": ((35,149,99), 49, 0),
    "chart": ((21,42,50), 64, 0), "instruments": ((23,36,40), 64, 0),
    "keyboard": ((55,62,60), 137, 0), "white": ((241,237,213), 53, 0),
    "teak": ((181,139,89), 124, 0), "grille": ((44,53,54), 112, 175), "pool": ((60,135,143), 31, 0),
    "tile": ((134,171,164), 67, 0),
    **{yacht: ((28,51,56), 68, 0) for yacht in IDENTITY}
}


def unit(a):
    return np.clip(a, 0, 1)


def smooth(a):
    t = unit(a)
    return t*t*(3-2*t)


def band(distance, half_width, footprint):
    return smooth(.5 + (half_width - np.abs(distance)) / np.maximum(footprint, .0001))


def rounded_distance(u, v, half_u, half_v, radius):
    a, b = np.abs(u)-half_u+radius, np.abs(v)-half_v+radius
    return np.hypot(np.maximum(a,0),np.maximum(b,0)) + np.minimum(np.maximum(a,b),0) - radius


@lru_cache(None)
def lattice(seed):
    return np.random.default_rng(seed).uniform(-1,1,(51,51,51)).astype("f")


def noise(position, scale, seed):
    return ndimage.map_coordinates(lattice(seed), position.T/scale, order=1, mode="grid-wrap")


class Vessel:
    """Geometry shared by both pictures, including bounds and glazing edges in metres."""
    def __init__(self, yacht):
        self.key = yacht
        self.folder = HERE.parent / yacht / "tex"
        self.lines = json.loads(LINES.read_text())[yacht]
        self.art = masters(yacht)
        self.glass_edges = {}
        for material in OWN[yacht]:
            with np.load(self.folder / "bakes" / (material+".npz")) as data:
                names = list(data["parts"])
                part, p = data["part"], data["pos"]
                if not hasattr(self,"parts"):
                    self.parts = names
                    self.lo = np.full((len(names),3), np.inf, np.float32)
                    self.hi = -self.lo.copy()
                if names != self.parts:
                    raise ValueError("Part tables disagree")
                np.minimum.at(self.lo, part, p.min(axis=1))
                np.maximum.at(self.hi, part, p.max(axis=1))
                gl = data["tag"] == list(data["tags"]).index("glass")
                for k in np.unique(part[gl]):
                    edges = {}
                    for triangle in p[gl & (part==k)]:
                        for a,b in zip(triangle, np.roll(triangle,-1,axis=0)):
                            edge = tuple(sorted((tuple(a),tuple(b))))
                            edges[edge] = edges.get(edge,0)+1
                    self.glass_edges[k] = [(np.array(a),np.array(b)-a) for (a,b),n in edges.items() if n==1]

    @lru_cache(maxsize=96)
    def sampled_art(self, key, width, height):
        # Filter the flat artwork to the physical density of its face.
        im = self.art[key].convert("RGBa").resize((width,height),Image.Resampling.LANCZOS)
        return np.asarray(im.convert("RGBA"),dtype=np.float32)

    def save_originals(self):
        out = HERE / "ref" / IDENTITY[self.key][0].lower().replace(" ","-")
        out.mkdir(exist_ok=True,parents=True)
        for name,im in self.art.items():
            im.save(out/(name+".png"))


class Fields:
    """A slice of a Surface. Distances are in metres and include the filled UV gutters."""
    def __init__(self, boat, surface, rows=slice(None)):
        self.boat = boat
        self.material = surface.name
        self.P, self.N = surface.P[rows], surface.N[rows]
        self.part, self.tag = surface.PART[rows], surface.TAG[rows]
        self.tags = surface.tags
        self.AO, self.step = surface.AO[rows], surface.MPT[rows]
        self.x,self.y,self.z = self.P.T
        self.lo,self.hi = boat.lo[self.part],boat.hi[self.part]
        self.mid = (self.lo+self.hi)*.5
        self.half = (self.hi-self.lo)*.5
        self.local = self.P-self.mid
        self.waterline = self.y-boat.lines["draft"]
        self.gelcoat = self.where("pearl","cream","topsides","strake","boot")
        self.glass = self.where("glass","clear")
        self.upholstery = self.where("upholstery")
        self.cloth = self.where("upholstery","linen","piping","slate")
        self.name_board = self.where(boat.key)
        hull = self.on("chine-built hull")
        self.boot_line = hull*band(self.waterline-.043,.034,self.step)
        self.boot_inlay = hull*band(self.waterline-.091,.009,self.step)

    @property
    def name_place(self):
        """Signwriter's reserved rectangles on the board, transom and quarters."""
        place = np.zeros(len(self.P), dtype=bool)
        for mark in graphics(self):
            if mark.name in ("transom board", "stern lettering", "quarter lettering"):
                place[mark.indices] = True
        return place

    def where(self,*names):
        return np.isin(self.tag,[self.tags.index(n) for n in names if n in self.tags])

    def on(self,*names):
        return np.isin(self.part,[k for k,p in enumerate(self.boat.parts) if any(n in p for n in names)])

    def glass_edge(self):
        distance = np.full(len(self.P),10,np.float32)
        outer = self.where("glass")
        for k in np.unique(self.part[outer]):
            select = outer & (self.part==k)
            p = self.P[select]
            nearest = np.full(len(p),100,np.float32)
            for a,edge in self.boat.glass_edges[k]:
                delta = p-a
                along = unit(np.einsum("ij,j->i",delta,edge) / max(edge@edge,1e-10))
                delta -= along[:,None]*edge
                np.minimum(nearest,np.einsum("ij,ij->i",delta,delta),out=nearest)
            distance[select] = np.sqrt(nearest)
        return distance


@dataclass
class Graphic:
    name: str
    indices: np.ndarray
    coverage: np.ndarray
    colour: np.ndarray
    rough: float
    metal: float
    relief: float


def flat(name, cover, colour, rough=65, metal=0, relief=0):
    i = np.flatnonzero(cover>.001)
    return Graphic(name,i,cover[i],np.asarray(colour,dtype="f"),rough,metal,relief)


def stamp(f, name, key, select, u, v, width, height, rough, metal=0, relief=0):
    valid = select & (u>=0)&(u<=1)&(v>=0)&(v<=1)
    i = np.flatnonzero(valid)
    if not i.size:
        return Graphic(name,i,u[i],np.empty((0,3),"f"),rough,metal,relief)
    # Quantised density keeps the same filter on both sides of a chart.
    density = 1344 if key in SCREENS else 224
    art = f.boat.sampled_art(key,max(2,round(width*density)),max(2,round(height*density)))
    uv = (v[i]*(art.shape[0]-1),u[i]*(art.shape[1]-1))
    rgba = np.stack([ndimage.map_coordinates(art[...,k],uv,order=1) for k in range(4)],axis=1)
    return Graphic(name,i,rgba[:,3]/255,rgba[:,:3],rough,metal,relief)


def graphics(f):
    """Yield the masks of each applied graphic, indexed into this slice of the surface."""
    x,y,z = f.P.T
    nx,ny,nz = f.N.T
    d = f.boat.lines
    h,main = d["length"]*.5,d["main"]
    t = z/h
    deck = main + d["sheer"]*unit((t-.24)/.76)**1.55
    sheer = f.on("folded sheer coaming") & (nx*np.sign(x)>.64) & (z>d["stepTop"])
    hull = f.on("chine-built hull")
    topside = f.where("topsides") & (np.abs(nx)>.38)
    design = PAINT.get(f.boat.key)
    symbol = "emblem" if design else "wing"
    # A tapered cove with a brass lower pinline. Its wider aft end holds the name.
    sweep = smooth((t+.64)/.16)*smooth((.94-t)/.27)
    centre = deck+.165+.092*smooth((t+.45)/1.25)
    half = sweep*(.025+.096*(1-smooth((t+.31)/.37)))
    line = y-centre
    if design:
        if f.boat.key=="solstice":
            half *= .78
            line -= .036*np.sin((t+.5)*3)
        elif f.boat.key=="meridian":
            line -= .043*smooth((t+.4)/.9)
            half *= .86
        else:
            yield flat("upper cove fillet",sheer*band(line-half-.028,.008*sweep,f.step)*(sweep>.22),design[1],65,164)
    yield flat("cove",sheer*band(line,half,f.step)*(sweep>.02),design[0] if design else (25,54,62),46)
    yield flat("cove inlay",sheer*band(line+half+.020,.009*sweep,f.step)*(sweep>.17),design[1] if design else (198,166,104),65,157)
    length = min(2.07,.20*h)
    u = .5 - np.sign(x)*(z+.40*h)/length
    yield stamp(f,"quarter lettering","side_name",sheer,u,.5-line/.185,length,.185,57,85,2)
    # The emblem faces the bow on both sides. Each registration reads from the dock.
    width = min(2.72,h*.235)
    high = min(.54,main*.20)
    wing_u = .5+(z-.666*h)/width
    wing_y = deck-.41+.10*(t-.666)
    if design:
        station,width,high=design[4:]
        wing_u=.5+(z-station*h)/width
        wing_y=deck-{"solstice":.238,"meridian":.30,"sovereign":.43}[f.boat.key]
    yield stamp(f,"bow emblem" if design else "bow bird",symbol,topside,wing_u,.5-(y-wing_y)/high,width,high,55,40,1.4)
    reg_w = min(1.23,h*.14)
    reg_y = deck+.14
    yield stamp(f,"bow registration","registration",sheer,.5-np.sign(x)*(z-.70*h)/reg_w,
                .5-(y-reg_y)/.128,reg_w,.128,75)
    # The board and the low transom both carry the full port inscription.
    lx,ly,lz = f.local.T
    hx,hy,hz = np.maximum(f.half,.001).T
    board = f.name_board & (nz<-.60)
    yield stamp(f,"transom board","board",board,.5-lx/(2*hx),.5-ly/(2*hy),1.65,.21,88,27,3)
    stern = hull & (z < -h+.002) & (nz<-.40)
    lower_y = .5*(d["draft"]+d["terrace"])
    w = min(2.20,d["beam"]*.41)
    ht = min(.23,(d["terrace"]-d["draft"])*.81)
    u,v = .5-x/w,.5-(y-lower_y)/ht
    yield stamp(f,"stern lettering","transom",stern,u,v,w,ht,76,12,1.5)
    # A flush push latch at each end of the locker and an emblem on the lid.
    locker = f.on("transom locker") & (nz<-.78)
    dist = np.hypot(np.abs(lx)-hx*.79,ly-.10)
    yield flat("locker latch",locker*band(dist,.039,f.step),(185,189,176),68,247,2)
    yield flat("latch recess",locker*band(dist,.023,f.step),(62,68,65),109,170,-4)
    yield flat("latch bar",locker*(dist<.024)*band(ly-.10,.006,f.step),(205,205,187),54,249,2)
    yield stamp(f,"locker emblem" if design else "locker bird",symbol,locker,.5-lx/.76,.5-(y-(d["main"]-.15))/.252,.76,.252,60,117,1)
    # Screens read from the seated eye. The switch plate has its own face.
    for key, width,height in (("chart",.327,.2),("instruments",.327,.2),("keyboard",.229,.069)):
        sel = f.where(key) & (nz<-.5)
        screen_y = ly-.011 if key=="keyboard" else ly
        yield stamp(f,key,key,sel,.5-lx/width,.5-screen_y/height,width,height,101 if key=="keyboard" else 57)
    hub = f.on("wheel boss") & (nz<-.54)
    yield stamp(f,"wheel medallion",symbol,hub,.5-lx/.091,.5-ly/.043,.091,.043,61,211,1.8)
    # Flush opening ports are let into two of the long dark cabin windows.
    lights = f.on("flush cabin light") & f.where("glass")
    port = lights & ((f.mid[:,2]<-.39*h)|((f.mid[:,2]>.13*h)&(f.mid[:,2]<.31*h)))
    port_z = lz-.15*hz
    port_y = ly+.06*hy
    ring = rounded_distance(port_z,port_y,np.minimum(.32,hz*.34),np.minimum(.128,hy*.54),.103)
    yield flat("opening port seal",port*smooth(.5-(ring-.023)/f.step),(24,36,39),147,0,-3)
    yield flat("opening port rim",port*band(ring,.012,f.step),(147,158,155),73,179,2)
    yield flat("opening port lens",port*smooth(.5-(ring+.015)/f.step),(44,66,70),38)
    latch = np.hypot(np.abs(port_z)-.20,port_y+.108)
    yield flat("port dogs",port*band(latch,.024,f.step),(145,147,134),83,157,1.8)
    # Double woven selvedges on the four sun mattresses.
    mattress = f.where("linen") & f.on("crowned cushion") & (hz>.76) & (ny>-.4)
    hem = hx-np.abs(lx)
    yield flat("woven borders",mattress*band(hem-.115,.016,f.step),(97,128,127),189,0,.8)
    yield flat("woven pinstripes",mattress*band(hem-.155,.0065,f.step),(134,149,137),184,0,.5)
    yield from roof_graphics(f)
    # Narrow engine-room vents aft of the cabin lights, with a turned lip.
    ctr_z = -.637*h
    ctr_y = main-.42
    for j in range(3):
        u = z-ctr_z+(y-ctr_y)*.43
        v = y-ctr_y-(j-1)*.050
        slot = rounded_distance(u,v,min(.285,.032*h),.014,.012)
        yield flat("vent %d lip"%j,topside*smooth(.5-(slot-.009)/f.step),(128,139,134),72,184)
        yield flat("vent %d throat"%j,topside*smooth(.5-slot/f.step),(26,39,42),152,4,-4)


def roof_graphics(f):
    lx,_,lz = f.local.T
    hx,_,hz = np.maximum(f.half,.001).T
    ny = f.N[:,1]
    # The closed fabric insert has a recessed track and stitched transverse bows.
    roof = f.on("cambered coachroof") & f.where("graphite") & (ny>.70)
    ru,rv = lx,lz-hz*.30
    rw,rh = hx*.66,hz*.455
    opening = rounded_distance(ru,rv,rw,rh,.14)
    yield flat("roof insert gasket",roof*smooth(.5-(opening-.043)/f.step),(22,33,38),143,0,-3)
    yield flat("roof track",roof*band(opening-.018,.011,f.step),(146,151,142),79,154,2)
    insert = roof*smooth(.5-opening/f.step)
    yield flat("roof canvas",insert,(73,91,92),185,0,-1.5)
    sections = np.maximum(2*rh/5,.08)
    bow = (rv+rh)%sections
    dist = np.minimum(bow,sections-bow)
    yield flat("roof cover bows",insert*band(dist,.017,f.step),(50,67,68),175,0,5)
    yield flat("roof cover bindings",insert*band(opening+.038,.012,f.step),(125,134,123),174,0,2)


def as_byte(a):
    return np.clip(np.rint(a),0,255).astype("uint8")


def furniture(f, base, rough, height):
    lx,ly,lz = f.local.T
    hx,hy,hz = f.half.T
    nx,ny,nz = np.abs(f.N.T)
    backs = f.on("seatback","stern backrest")
    sideback = f.on("settee bolster")
    u = np.where(sideback,lz,lx)
    v = np.where(backs|sideback,ly,lz)
    hu,hv = np.where(sideback,hz,hx),np.where(backs|sideback,hy,hz)
    face = np.where(sideback,nx,np.where(backs,nz,np.maximum(f.N[:,1],0)))
    sewn = f.where("linen","upholstery") * smooth((face-.54)/.36)
    edge = rounded_distance(u,v,np.maximum(hu-.044,.01),np.maximum(hv-.044,.01),.043)
    hem = band(edge,.005,f.step)
    # The dash wraps round all four sides of the squab.
    phase = np.where((hu-np.abs(u)) < (hv-np.abs(v)),v,u)
    stitch = band(edge+.014,.0038,f.step)*(.50+.50*np.cos(TAU*phase/.030))
    insert = smooth((-edge-.025)/.023)
    seam_pitch = 2*np.maximum(hu,.05)/np.maximum(2,np.rint(2*hu/.187))
    channel = (u+.5*seam_pitch) % seam_pitch - .5*seam_pitch
    roll = np.exp(-(channel/.014)**2)*insert
    button_u = (u+.50*seam_pitch)%(seam_pitch*2)-.50*seam_pitch
    button_v = np.abs(v)-hv*.43
    r = np.hypot(button_u,button_v)
    button = np.exp(-(r/.024)**2)*insert
    crown = band(r-.012,.0035,f.step)*insert
    fac = sewn*(5.5*insert-13*roll-27*hem+13*stitch-28*button+11*crown)
    cloth = f.cloth
    weave = np.cos((u+.24*ly)*TAU/.018)*np.sin((v+.32*lx)*TAU/.019)
    weave *= unit(.012/np.maximum(f.step,.001))
    base += (fac+cloth*weave*1.9)[:,None]
    rough += cloth*(2.8*weave)+sewn*(6*roll-5*stitch)
    height += sewn*(-9*hem+4*stitch-5.6*roll-13*button+4*crown)+cloth*weave*1.5
    # Two dobby borders and a narrow pinstripe in the woven throw.
    throw = f.where("slate")
    margin = hz-np.abs(lz)
    border = band(margin-.058,.020,f.step)+band(margin-.102,.005,f.step)
    base += (throw*border)[:,None]*np.array([92,79,52],np.float32)
    wood = f.where("walnut")
    figure = lx*155+4.5*np.sin(lz*4+ly*8)+np.sin(lz*15+lx*6)
    grain = 5*np.sin(figure)+2.6*np.sin(figure*2.84)+3.8*np.sin(lx*57+np.cos(lz*7))
    base += (wood*grain)[:,None]*np.array([1,.81,.63],"f")
    height += wood*grain*.31
    rim = f.on("stitched helm rim")
    wx,wy,_ = f.boat.lines["seats"][0]
    angle = np.arctan2(f.y-(wy+.36),f.x-wx)
    ring = np.hypot(f.y-(wy+.36),f.x-wx)
    thread = rim*band(ring-.168,.004,f.step)*(.57+.43*np.cos(angle*58))
    base += thread[:,None]*np.array([90,78,60],"f")
    height += thread*4


def flagship(f, base, rough, metal, height):
    x,y,z=f.local.T
    hx,hy,hz=f.half.T
    nx,ny,nz=f.N.T
    def inlay(a,ink,r,m,h):
        i=np.flatnonzero(a>.001)
        w=a[i]
        base[i]+=(np.asarray(ink)-base[i])*w[:,None]
        rough[i]+=(r-rough[i])*w
        metal[i]+=(m-metal[i])*w
        height[i]+=h*w

    pool=f.where("pool","tile")
    if pool.any():
        i=np.flatnonzero(pool)
        a,b=x[i],z[i]
        wet=f.where("pool")[i]
        # See the mosaic through shallow green water. Refraction shifts the grout joints.
        a=a+wet*.012*np.sin(13*b+3.6*a)
        b=b+wet*.009*np.cos(15*a-5*b)
        tx,tz=np.floor(a/.085),np.floor(b/.085)
        material=np.sin(61.39*tx+13.71*tz)*.65+np.sin(79.23*tz+31.51*tx)*.35
        edge=np.minimum(np.abs((a+.0425)%.085-.0425),np.abs((b+.0425)%.085-.0425))
        grout=smooth((.005-edge)/np.maximum(.003,f.step[i]))
        waterline=np.minimum(hx[i]-np.abs(a),hz[i]-np.abs(b))
        ring=band(waterline-.122,.025,f.step[i])+.70*band(waterline-.199,.010,f.step[i])
        ink=np.array([63,143,143])+material[:,None]*np.array([11,18,15])
        ink+=(np.array([179,199,176])-ink)*(grout*.57)[:,None]
        ink+=(np.array([40,85,94])-ink)*unit(ring)[:,None]
        wave=TAU*(a*2.3+b*1.17)+.83*np.sin(6*b-3*a)
        ripple=np.cos(wave)+.45*np.cos(11*b-4*a+np.sin(7*a))
        base[i]=ink+(wet*ripple*3.5)[:,None]
        rough[i]=np.where(wet,36+4*ripple,89+grout*24)
        height[i]=128+np.where(wet,3.7*ripple,-6*grout)
    rim=f.on("cockpit table") & (ny>.62)
    edge=rounded_distance(x,z,np.maximum(hx-.030,.01),np.maximum(hz-.030,.01),.041)
    inlay(rim*band(edge,.006,f.step),(206,176,110),74,167,1.7)
    bar=f.on("sundeck bar") & (np.abs(nx)>.63)
    rail=np.cos(TAU*(z+.018*np.sin(5*y))/.089)
    cut=bar*unit((-rail-.58)/.39)
    inlay(cut,(75,50,37),104,0,-3.3)
    top=f.on("sundeck counter","pool side coping","pool end coping")
    stone=np.sin(4.3*f.z+7.1*f.x+1.35*np.sin(8*f.x+1.9*f.y)+.27*np.sin(21*f.z))
    inlay(top*unit((stone-.83)/.17)*.38,(170,157,130),77,0,-.6)
    trim=f.on("upper bridge coaming","swept forward bridge brow") & (np.abs(ny)<.46)
    inlay(trim*band(y+hy-.097,.013,f.step),(168,143,95),69,185,1.3)
    frame=f.on("moulded saloon frame") & f.where("pearl") & (np.abs(nx)>.68)
    side_height=f.y-np.where(f.y>5.62,5.64,f.boat.lines["main"])
    bridge=f.y>5.62
    end=np.where(bridge,4.05,4.93)
    start=np.where(bridge,-4.5,-6.8)
    reach=smooth((f.z-start)/.47)*smooth((end-f.z)/.62)
    # A double fillet steps up as it emerges from the aft corner of each deckhouse.
    line=side_height-.245-.054*smooth((f.z-start-.24)/.32)
    inlay(frame*reach*band(line,.022,f.step),(57,77,76),63,0,1)
    inlay(frame*reach*band(line+.033,.008,f.step),(194,166,107),68,175,1.7)
    tower=f.on("communications pedestal","communications tower") & (np.abs(ny)<.6)
    inlay(tower*band(y-.52*hy,.016,f.step),(187,161,105),72,190,1.6)


def paint_slice(f):
    table = np.array([(*FINISH[t][0], *FINISH[t][1:]) for t in f.tags], dtype="f")
    data = table[f.tag]
    base,rough,metal = data[:,:3],data[:,3],data[:,4]
    ao = f.AO
    fine = noise(f.P,.012,93)
    mid = noise(f.P,.071,54)
    broad = noise(f.P,.52,317)
    y,z = f.y,f.z
    nx,ny,nz = f.N.T
    height = fine*1.9 + mid*.6 + 128
    soil = (1-ao)**2*(.36+.64*unit(ny))
    base *= (1-.059*(1-ao)-.052*soil)[:,None]
    base += (fine*1.15+mid*.60+broad*.87)[:,None]
    rough += mid*2.4+fine*2.6+soil*12
    mask = np.zeros((len(y),3),"uint8")
    for k,tag in enumerate(("topsides","strake","upholstery")):
        mask[f.where(tag),k]=255
    keel,boot = f.where("keel"),f.where("boot")
    water = f.waterline
    hull = f.on("chine-built hull")
    # Paint the true load line through the moulded, rising chine bands.
    dry = smooth((water-.025)/.045)
    base[keel] += (dry[keel,None]*np.array([27,30,30],"f"))
    rough[keel] -= dry[keel]*68
    satin = np.exp(-((water-.006+mid*.009)/.098)**2)*hull
    base += (satin*(4.2+mid*3.5))[:,None]
    rough += satin*(15+mid*5)
    bottom = keel|boot
    height += bottom*(fine*3.3+mid*2)
    base += (bottom*(broad*2.2+mid*1.2))[:,None]
    # Stripes run off the waterline onto the lift of the bow.
    def enamel(coverage,colour,r):
        nonlocal base,rough
        coverage = np.where(mask.any(axis=1), coverage >= .5, coverage)
        a=coverage[:,None]
        base += (np.asarray(colour,"f")-base)*a
        rough += (r-rough)*coverage
        mask[coverage>.01]=0
    design=PAINT.get(f.boat.key)
    enamel(f.boot_line,design[0] if design else (27,48,56),53)
    enamel(f.boot_inlay,design[1] if design else (192,172,127),66)
    # A trace of runoff below the actual cleat positions.
    half = f.boat.lines["length"]*.5
    cleat_dist = np.min(np.abs(z[:,None]-np.array([-.62,.02,.57,.84],"f")*half),axis=1)
    runs = np.exp(-(cleat_dist/.038)**2)*f.where("topsides","pearl")*np.abs(nx)
    base -= (runs*(1.7+3.2*(1-ao)))[:,None]
    rough += 6*runs
    glass = f.where("glass")
    if glass.any():
        dist = f.glass_edge()
        frit = smooth(1-dist/.025)
        dot = (.5+.5*np.cos((z+f.x)*TAU/.021))*(.5+.5*np.cos(y*TAU/.020))
        frit += (1-frit)*dot*.56*smooth((.053-dist)/.021)
        # Green lamination visible at the edge, then the dark ceramic surround.
        edge_tint = np.exp(-((dist-.040)/.019)**2)
        base[glass] += (edge_tint[glass,None]*np.array([4,13,10],"f"))
        # Smoked tops and privacy pleats sit behind the outer glazing.
        saloon = f.on("saloon glazing","sliding glass door")
        ht = (y-f.lo[:,1])/np.maximum(2*f.half[:,1],.001)
        smoke = smooth((ht-.59)/.39)
        trans = saloon*(1-smoke)*smooth(ht/.16)
        base += trans[:,None]*np.array([7,16,17],"f")
        base -= (saloon*smoke)[:,None]*np.array([7,10,10],"f")
        aft = f.on("saloon glazing") & (f.mid[:,2]<0)
        span = (f.z-f.lo[:,2])/np.maximum(f.half[:,2]*2,.001)
        folds = (.56+.44*np.cos(TAU*(z/.11+.1*np.sin(y*4))))**2
        fabric = aft*smooth((.23-span)/.025)*(1-.57*smoke)*(.35+.65*folds)
        base += fabric[:,None]*np.array([22,20,15],"f")
        glass_low = f.on("flush cabin light")*smooth((ht-.03)/.9)
        base += glass_low[:,None]*np.array([7,13,13],"f")
        # The windscreen is continuous through the horizontal construction strips.
        wind = f.on("curved windscreen","windscreen brow and sill")
        frit[wind] *= .17
        base[glass] *= (1-.42*frit[glass,None])
        rough[glass] += 21*frit[glass]
        height[glass] = 128+.5*mid[glass]+1.1*frit[glass]
    steel = f.where("stainless") | f.on("windscreen post")
    if steel.any():
        n = f.N[steel]
        ext = f.half[steel]
        upright = ext[:,1] > np.maximum(ext[:,0], ext[:,2])*.80
        across = np.where(ext[:,0] > ext[:,2], n[:,2], n[:,0])
        angle = np.where(upright, np.arctan2(n[:,2],n[:,0]), np.arctan2(n[:,1],across))
        angle += .12*np.sin(z[steel]*1.7+y[steel]*1.1)
        # The tube catches the dark deck edge, the bright rail above and the sky.
        facet = .5+.5*np.cos(2*angle-.78)
        dark = smooth((facet-.42)/.47)
        glint = np.exp(-((facet-.26)/.19)**2)
        foot = np.exp(-np.maximum(y[steel]-f.lo[steel,1],0)/.092)*upright
        foot *= .42+.58*(1-ao[steel])
        value = 209 - 121*dark + 32*glint - 44*foot + 4*mid[steel]
        base[steel] = value[:,None]*np.array([1.04,1.01,.965],"f")
        hand = f.on("handhold","handrail","upper deck guard","swim ladder","door pull")[steel]
        brush = np.sin((y[steel]*.73+z[steel]+f.x[steel]*.37)*TAU/.027)
        rough[steel] = 67+34*dark-18*glint+32*hand+45*foot+8*brush
        metal[steel] = 255
        height[steel] = 128+1.1*brush+.8*fine[steel]
    bronze = f.where("bronze")
    rough[bronze] += 5*mid[bronze]
    furniture(f,base,rough,height)
    fascia = f.on("swept helm fascia") & f.where("leather")
    u = f.x
    seat_y,seat_z = f.boat.lines["seats"][0][1:]
    join = f.z-(seat_z+.90+.03*u**2)
    top = fascia*smooth((ny-.40)/.5)
    stitch = top*band(join,.006,f.step)*(.7+.3*np.cos(TAU*u/.030))
    base += stitch[:,None]*np.array([93,83,65],"f")
    height += stitch*5
    vent = top*band(f.z-(seat_z+1.096),.031,f.step)*smooth((.82-np.abs(u))/.09)
    rib = .5+.5*np.cos(TAU*u/.030)
    base -= (vent*(10+14*rib))[:,None]
    height -= vent*(2+5*rib)
    # Split line of the radome and moulded nonslip on the chain well lid.
    dome = f.on("satellite dome")
    joint = dome*band(f.local[:,1]+f.half[:,1]*.34,.006,f.step)
    base -= joint[:,None]*36
    height -= joint*5
    lid = f.on("forepeak chain well")*smooth((ny-.55)/.35)
    knurl = np.cos(f.x*TAU/.028)*np.cos(z*TAU/.028)
    base += (lid*knurl*2.8)[:,None]
    height += lid*knurl*3.6
    if f.boat.key=="sovereign":
        flagship(f,base,rough,metal,height)
    if design:
        key=f.boat.key
        if key=="solstice":
            lid=f.on("cambered coachroof") & f.where("cream") & (ny>.7)
            u,v=f.local[:,0],f.local[:,2]
            reveal=rounded_distance(u,v,.93,1.26,.17)
            enamel(lid*band(reveal,.012,f.step), (100,116,108),101)
            enamel(lid*band(reveal+.034,.007,f.step), (213,158,91),96)
        if key=="meridian":
            pane=f.on("flush panoramic roof light") & glass & (ny>.58)
            if pane.any():
                u,v=f.local[:,0],f.local[:,2]
                hx,_,hz=f.half.T
                # The frit and two fine bus bars follow the outline of each roof sheet.
                edge=f.glass_edge()
                sheen=smooth((v/hz.clip(.01)+1)*.5)
                laminate=np.column_stack((35+10*sheen,57+16*sheen,67+21*sheen))
                base[pane]=laminate[pane]+(fine[pane]+mid[pane])[:,None]
                rough[pane]=38+4*mid[pane]
                enamel(pane*smooth((.047-edge)/.026),(19,30,39),80)
                rim=pane*band(edge-.058,.006,f.step)
                enamel(rim,(135,152,151),77)
                rail=np.abs(np.abs(u)-hx*.84)
                enamel(pane*band(rail,.0035,f.step)*smooth((hz-.08-np.abs(v))/.07),(133,119,94),96)
            louver=f.where("grille")
            ridge=.5+.5*np.cos(TAU*(f.local[:,1]+f.local[:,2]*.17)/.041)
            base[louver]=(np.array([32,42,49])+ridge[louver,None]*np.array([67,69,66]))
            height[louver]+=9*ridge[louver]
        shade={"solstice":(28,115,113),"meridian":(68,85,111),"sovereign":(161,131,86)}[key]
        fabric=f.where("linen") & f.on("crowned cushion") & (ny>.58)
        margin=f.half[:,0]-np.abs(f.local[:,0])
        enamel(fabric*band(margin-.076,.011,f.step),shade,178)
        enamel(fabric*band(margin-.100,.004,f.step),design[1],171)
    for g in graphics(f):
        i,a = g.indices,g.coverage
        if not len(i):
            continue
        # A dyed field needs a clean ink edge before the engine filters its two maps.
        a = np.where(mask[i].any(axis=1), a >= .5, a)
        base[i] += (g.colour-base[i])*a[:,None]
        rough[i] += (g.rough-rough[i])*a
        metal[i] += (g.metal-metal[i])*a
        height[i] += g.relief*a
        mask[i[a>.012]] = 0
    dyed = mask.any(axis=1)
    base[dyed] = base[dyed].mean(axis=1,keepdims=True)
    alpha = np.where(f.where("clear"),0,255).astype("uint8")
    return (np.column_stack((as_byte(base),alpha)),as_byte(np.column_stack((ao*255,rough,metal))),
            as_byte(height),mask)


def normals(h, strength):
    v = h.astype(np.float32)
    x = (np.roll(v,1,1)-np.roll(v,-1,1))*strength
    y = (np.roll(v,-1,0)-np.roll(v,1,0))*strength
    scale = 127.5/np.sqrt(1+x*x+y*y)
    return as_byte(np.stack((127.5+x*scale,127.5+y*scale,127.5+scale),axis=-1))


def save_png(image,path):
    working=path.with_suffix(f".{os.getpid()}.writing")
    try:
        image.save(working,format="PNG",compress_level=4)
        working.replace(path)
    finally:
        working.unlink(missing_ok=True)


def output(folder, name, base, packed, height, mask, strength):
    images = {"base":Image.fromarray(base),"normal":Image.fromarray(normals(height,strength)),
              "height":Image.fromarray(height),"packed":Image.fromarray(packed),"mask":Image.fromarray(mask)}
    empty = Image.new("RGBA", images["base"].size)
    for role in ("hurt","decay"):
        if not (folder / (name+"_"+role+".png")).exists():
            images[role] = empty
    for role,pic in images.items():
        save_png(pic,folder / (name+"_"+role+".png"))


def read_surface(boat, material):
    # The rasterizer visits every triangle. Inflate its arrays once per material.
    def read_arrays(path):
        with np.load(path) as archive:
            return dict(archive)

    spec = spec_from_file_location("yacht_surface", HERE.parent / "marine/surface.py")
    reader = module_from_spec(spec)
    spec.loader.exec_module(reader)
    reader.np = SimpleNamespace(**vars(np))
    reader.np.load = read_arrays
    return reader.Surface(boat.folder / "bakes", material)


def paint_material(boat, material):
    s = read_surface(boat,material)
    base, packed, height, mask = [np.empty((s.n,)+shape,"uint8") for shape in ((4,),(3,),(),(3,))]
    for start in range(0,s.n,262144):
        rows = slice(start,start+262144)
        base[rows],packed[rows],height[rows],mask[rows] = paint_slice(Fields(boat,s,rows))
    size = (s.size,s.size)
    output(boat.folder,material,base.reshape(*size,4),packed.reshape(*size,3),height.reshape(size),
           mask.reshape(*size,3),.009)
    print("Painted",material,s.size,flush=True)


def teak_fields(n=1024):
    yy,xx = np.indices((n,n),dtype=np.float32)
    u,v = (xx+.5)/n,(yy+.5)/n
    rng = np.random.default_rng(730219)
    lane = u*40+.43
    board = np.floor(lane).astype(int)%40
    across = lane%1
    phase,phase2,tone,end = [rng.random(40).astype("f")[board] for _ in range(4)]
    # A 2.4 m repeat contains one staggered plank end in each of forty strakes.
    from_butt = (v-end)%1
    bend = .25*np.sin(TAU*v+phase*TAU)+.073*np.sin(2*TAU*v+phase2*TAU)
    ribbon = np.sin(TAU*(across*2.4+bend+phase))+.42*np.sin(TAU*(across*4.6+bend*.82+phase2))
    pore = np.cos(TAU*(across*(8+phase*2.5)+bend*1.3+phase2))
    grain = ribbon*4.1+2*pore-4.5*unit((pore-.44)/.56)**2
    figure = np.cos(TAU*(across*1.34+.77*np.cos(TAU*v+phase2*TAU)+phase))
    dust = rng.normal(0,1,(n,n)).astype("f")
    strand = ndimage.gaussian_filter(dust,(4.7,.48),mode="wrap")*4
    seam_dist = np.minimum(across,1-across)*.06
    end_dist = np.minimum(from_butt,1-from_butt)*2.4
    distance = np.minimum(seam_dist,end_dist)
    seam = smooth((.00285-distance)/.00185)
    shoulder = np.exp(-((distance-.0038)/.0016)**2)
    tone = (tone-.5)*23+(phase2-.5)*5
    return SimpleNamespace(u=u, v=v, board=board, across=across, from_butt=from_butt,
                           distance=distance, seam=seam, shoulder=shoulder, tone=tone,
                           grain=grain, figure=figure, strand=strand, dust=dust)


def teak():
    n = 1024
    t = teak_fields(n)
    tone,grain,figure,strand,dust = t.tone,t.grain,t.figure,t.strand,t.dust
    seam,shoulder,v = t.seam,t.shoulder,t.v
    colour = tone + grain+figure*2.5+strand*2+dust*.9+shoulder*3.5
    base = np.array([181,139,89],"f")+colour[...,None]*np.array([1,.89,.69],"f")
    caulk = np.array([39,38,33],"f")+(strand*.7)[...,None]
    base += (caulk-base)*seam[...,None]
    h = as_byte(145+grain*.80+strand*2.1+figure*1.3-40*seam-4*shoulder)
    packed = as_byte(np.stack((250-38*seam-5*shoulder,124+grain*.72+strand*2.3+seam*64,
                                np.zeros_like(v)),axis=-1))
    output(HERE/"tex","teak",np.dstack((as_byte(base),np.full((n,n),255,"uint8"))),
           packed,h,np.zeros((n,n,3),"uint8"),.009)
    print("Painted teak",n,flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("yacht",choices=IDENTITY)
    boat = Vessel(parser.parse_args().yacht)
    boat.save_originals()
    teak()
    for material in OWN[boat.key]:
        paint_material(boat,material)


if __name__ == "__main__":
    main()
