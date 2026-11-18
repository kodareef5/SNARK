"""Paint the selectable hurt and decay stages on a yacht's shipyard surfaces."""
import argparse
from functools import lru_cache
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

sys.dont_write_bytecode = True
from glazing import cells, frame_shards, triangle
from paint import (Fields, HERE, IDENTITY, OWN, TAU, Vessel, as_byte, band, noise,
                   read_surface, roof_graphics, save_png, smooth, teak_fields, unit)


class Brush:
    """Write only on the selected texels. Coverage orders the reveal within a stage."""
    def __init__(self, image, indices):
        self.image = image
        self.indices = indices

    def put(self, amount, stage, colour, variation=0):
        take = amount > .12
        if not np.any(take):
            return
        i = self.indices[take]
        shade = variation[take, None] if np.ndim(variation) else variation
        ink = np.asarray(colour, np.float32)
        self.image[i,:3] = as_byte((ink[take] if ink.ndim==2 else ink) + shade)
        self.image[i,3] = as_byte((3-stage)*85 + 1 + 84*unit(amount[take]))


class Patch:
    def __init__(self, field, choose, layers, texture):
        self.i = np.flatnonzero(choose)
        self.P = field.P[self.i]
        self.x, self.y, self.z = self.P.T
        self.nx, self.ny, self.nz = field.N[self.i].T
        self.u, self.v, self.w = field.local[self.i].T
        self.hx, self.hy, self.hz = field.half[self.i].T
        self.part = field.part[self.i]
        self.ao = field.AO[self.i]
        self.wl = field.waterline[self.i]
        self.step = np.maximum(.001,field.step[self.i])
        self.grit, self.flake, self.cloud = (a[self.i] for a in texture)
        self.hurt, self.decay = (Brush(img,self.i) for img in layers)


def vein(u,v,a,b,width):
    dx,dy = b[0]-a[0],b[1]-a[1]
    t = unit(((u-a[0])*dx+(v-a[1])*dy)/(dx*dx+dy*dy+1e-9))
    return unit(1.45-np.hypot(u-a[0]-dx*t,v-a[1]-dy*t)/width)


@lru_cache(None)
def fractures(seed):
    rng = np.random.default_rng(seed)
    segments = []
    for angle in np.arange(8)*np.pi/4+rng.uniform(-.27,.27,8):
        along = np.array([np.cos(angle),np.sin(angle)])
        cross = along[::-1]*[-1,1]
        last = np.zeros(2)
        for j,r in enumerate((.20,.43,.69,rng.uniform(.86,1.30))):
            end = along*r + cross*rng.uniform(-.068,.068)*r
            segments.append((last,end,1-.12*j))
            if j in (1,2) and rng.random()<.73:
                fork=end+along*.14+cross*rng.uniform(-.16,.16)
                segments.append((end,fork,.68))
            last=end
    return segments


def fracture_lines(u,v,seed,width):
    mask=np.zeros_like(u)
    use=(np.abs(u)<1.45)&(np.abs(v)<1.45)
    x,y=u[use],v[use]
    pattern=np.zeros_like(x)
    if np.ndim(width):
        width=width[use]
    for a,b,weight in fractures(seed):
        np.maximum(pattern,vein(x,y,a,b,width*weight),out=pattern)
    mask[use]=pattern
    return mask


def broken_radius(u,v,phase,grain):
    theta=np.arctan2(v,u)
    edge=1+.125*np.sin(3*theta+phase)+.082*np.sin(7*theta-phase)+.045*np.cos(13*theta+phase)
    return np.hypot(u,v)/edge + grain*.084


def strike(p, u, v, length, height, seed, side):
    # Fractured topcoat, a rolled lip, exposed chopped strand and a torn opening.
    use=side & (np.abs(u)<length*2.15)&(np.abs(v)<height*2.3)
    if not use.any():
        return
    h=Brush(p.hurt.image,p.i[use])
    a,b=u[use]/length,v[use]/height
    g,n=p.grit[use],p.flake[use]
    r=broken_radius(a,b,seed*.16,n)
    rays=fracture_lines(a/1.6,b/1.9,seed,.024)
    fiber=np.sin(95*a+36*b+3.7*n)
    h.put(rays*(r>.78),1,(117,120,110),g*19)
    h.put(unit((1.48-r)*5)*unit((r-.64)*6)*unit(.38+1.3*n+.47*fiber),1,(188,177,143),g*24)
    h.put(unit((1.13-r)*7),2,(173,140,96),fiber*13+n*27+g*18)
    h.put(band(r-.91,.049,.041)*(b>-.25),2,(217,191,142),fiber*14)
    h.put(unit((.85-r)*8),3,(66,58,49),g*13+fiber*5)
    h.put(unit((.66-r)*9),3,(22,30,31),9*b+g*6)
    h.put(band(r-.68,.027,.025)*unit(-b*2.8),3,(137,113,84),fiber*16)


def scuff(p, centre, span, level, rise, width, side, seed):
    u=(p.z-centre)/span
    run=unit(1-u*u)
    v=p.y-level-rise*u-.030*np.sin(3.2*u+seed)-.013*p.flake
    rake=(v/width+.12*np.sin(9*u+seed))
    scar=run*(1+.16*np.sin(13*u+seed)) - np.abs(rake)
    fibers=np.sin(23*rake+1.7*np.sin(11*u)+5*p.flake)
    broken=unit(.59+.77*p.flake+.40*fibers)
    p.hurt.put(side*unit((scar+.17)*3)*broken,1,(76,78,72),p.grit*19+12*fibers)
    p.hurt.put(side*unit((scar-.02)*4)*unit(.30+.8*fibers),1,(192,186,160),p.flake*30)
    core=side*unit((scar-.28)*4)*unit((.78-np.abs(u+.11))*4)
    p.hurt.put(core,2,(167,133,91),fibers*17+p.grit*24)
    p.hurt.put(core*unit(.10+.95*fibers+p.flake*.7),2,(214,195,155),p.grit*18)


def compressed_panel(p, side, z0, length, y0, slope, depth):
    # The shell buckles along a crease. Long splintered lips turn in opposite directions.
    u=(p.z-z0)/length
    span=unit(1-u*u)
    line=p.y-y0-slope*u-.049*np.sin(3.9*u)-.027*p.flake
    width=.021+depth*span
    fiber=np.sin(113*line+22*u+2.3*p.flake)
    inside=side*span
    p.hurt.put(inside*band(line+.4*width,width*1.15,p.step)*unit(.46+.73*p.flake+.46*fiber),
               1,(106,105,90),p.grit*17)
    p.hurt.put(inside*band(line,width*.71,p.step),2,(141,120,86),p.flake*22+fiber*12)
    p.hurt.put(inside*band(line+.67*width,.028+.015*span,p.step),2,(216,196,149),p.grit*22)
    deep=inside*unit((1.04-np.abs(u))*3)
    p.hurt.put(deep*band(line-.18*width,width*.36,p.step),3,(61,63,54),fiber*9+p.grit*11)
    p.hurt.put(deep*band(line-.61*width,.022,p.step),3,(182,172,144),p.grit*16)


def hull_hurt(p,boat):
    h=boat.lines["length"]*.5
    deck=boat.lines["main"]
    port=p.x>0
    flank=np.abs(p.nx)>.25
    # Separate contacts leave a long interrupted port rub and a short, deeper aft collision.
    for z,length,y,rise,width,which,seed in [
        (-.32,.29,.89,.09,.082,port,3),(.18,.30,.92,-.06,.10,port,7),
        (.46,.22,.63,.12,.092,port,9),(-.68,.17,.75,-.18,.12,~port,5),
        (-.36,.15,.93,.07,.055,~port,11),(.39,.10,.77,.09,.045,~port,17)]:
        scuff(p,z*h,length*h,y*deck,rise,width,which&flank,seed)
    if boat.key!="belvedere":
        # A compressed fender rolls aft along the exposed coaming, leaving rubber above a cut lip.
        along=(p.z+.32*h)/(.39*h)
        run=smooth((1-np.abs(along))/.22)
        level=deck+.115+.053*along+.032*np.sin(3.5*along)
        offset=p.y-level-.011*p.flake
        breadth=.018+.040*run+.020*np.cos(5.1*along)**2
        grain=.5+.5*np.sin(235*offset+2.5*along+.9*p.flake)
        transfer=run*smooth((breadth-np.abs(offset))/.026)*(p.nx>.47)
        skip=smooth((.70+.30*np.sin(11*along)+.23*p.cloud)/.88)
        stain=transfer*skip
        p.hurt.put(stain*(.47+.47*grain),1,(69,72,68),p.grit*15+grain*26)
        peel=band(offset+.72*breadth,.016,p.step)*run*(p.nx>.47)
        p.hurt.put(peel*skip,2,(176,153,112),p.grit*23+grain*14)
        p.hurt.put(peel*skip*unit(.22+.85*p.flake+grain*.42),2,(212,198,160),p.grit*14)
    for z,yy,along,deep,seed,where in [
        (.69,.35,1.07,.45,37,port),
        (-.77,.38,.88,.39,61,~port),
        (.12,.26,.37,.12,83,port)]:
        ratio=deck/2.68
        offset=0 if boat.key=="belvedere" else {"solstice":-.061,"meridian":.034,"sovereign":-.023}[boat.key]
        u=p.z-(z+offset)*h
        y=yy if boat.key=="belvedere" else yy*ratio
        strike(p,u,p.wl-y-.15*u,along*h/11.6,deep*ratio,seed+round(abs(offset)*710),where&flank)
    compressed_panel(p,port&flank,-.23*h,.285*h,deck+.125,.045,.091)
    compressed_panel(p,port&flank,-.47*h,.21*h,deck*.60,.08,.075)
    compressed_panel(p,port&flank&(p.z>.756*h),.824*h,.096*h,boat.lines["draft"]+.53,.16,.103)
    compressed_panel(p,(~port)&flank,-.64*h,.215*h,deck*.74,.29,.181)
    # Long keel scores follow the narrowing forebody and climb onto the forward chines.
    fore=unit(p.z/h)
    beam=boat.lines["beam"]
    for k,offset in enumerate((-.29,-.11,.08,.23,.37)):
        trace=offset*beam*(1-.69*fore**2)+.075*np.sin(p.z*.52+k)
        length=unit(1-((p.z/h-(.21 if k%2 else .43))/(.67-.045*k))**2)
        across=p.x-trace-.019*p.flake
        width=.032+.062*length
        reach=length*(p.ny<-.18)*unit((.67-p.wl)*3)
        lines=np.sin(across*239+1.6*p.flake)
        p.hurt.put(reach*band(across,width+.026,p.step)*unit(.55+.65*lines),1,(116,122,110),p.grit*22)
        p.hurt.put(reach*band(across,width*.70,p.step),2,(171,151,109),p.flake*26+lines*11)
        p.hurt.put(reach*band(across,width*.34,p.step)*unit((fore-.24)*3),3,(73,68,58),p.grit*18)
    # Compression on the aft-facing swim terrace and its moulded locker.
    aft=(p.nz<-.44)&(p.z<-.58*h)
    strike(p,p.x+boat.lines["beam"]*.205,p.y-(boat.lines["terrace"]+.20)+.25*(p.x+1.18),
           .59,.28,98,aft)
    aft_edge=aft*unit((-.28-p.x)*1.9)
    score=p.y-boat.lines["terrace"]-.16-.13*p.x-.018*p.flake
    p.hurt.put(aft_edge*band(score,.031,p.step),1,(172,157,129),25*p.grit)


def shell_spots(a,b,spacing,seed):
    # An irregular colony within each cell; shell radii stop short of the cell edges.
    u,v=a/spacing,b/spacing
    x,y=np.floor(u),np.floor(v)
    def hashed(phase):
        return np.mod(np.sin(x*1.731+y*6.253+phase)*1741.72,1)
    cx=.24+.5*hashed(seed)
    cy=.24+.50*hashed(seed+13.1)
    radius=.085+.12*hashed(seed-22.5)
    return np.hypot((u-x-cx)/radius,(v-y-cy)/radius), hashed(seed+7.12)


def hull_decay(p,boat):
    h=boat.lines["length"]*.5
    micro=p.grit
    tide=p.wl-.055-.058*p.cloud-.025*p.flake
    zonal=.60+.40*np.sin(p.z*.72+p.x*.59)+.42*p.cloud
    hair=np.cos(74*p.z+15*p.x+3*np.sin(p.y*9)+p.flake*1.8)
    lace=unit(.5+.62*hair+.7*p.flake)
    p.decay.put(unit(1-np.abs(tide)/.14)*(.52+.45*lace),1,(105,109,67),micro*16+lace*12)
    p.decay.put(unit((.155-tide)*9)*unit((tide+.50)*5)*unit(zonal+.3*micro),2,
                (83,93,54),p.flake*23+hair*6)
    weed=unit((.077-tide)*8)*unit((tide+.59+.09*p.cloud)*4)*lace*unit(zonal)
    p.decay.put(weed,3,(51,63,40),p.grit*16+hair*8)
    boot=band(tide-.073,.027,p.step)*unit(1.6*p.flake+.7*np.sin(.93*p.z))
    p.decay.put(boot,2,(159,145,108),p.grit*27)
    foul=unit((.08-tide)*3.4)*unit(.61+.74*p.cloud+.35*np.sin(p.z*1.06+p.x))
    p.decay.put(foul*unit(.53+1.12*p.flake),3,(62,70,47),p.grit*20)
    transverse=.72*p.y+.71*np.abs(p.x)
    for spacing,seed in ((.15,7),(.094,46)):
        r,variation=shell_spots(p.z+(.28*(p.x<0)),transverse,spacing,seed)
        group=foul*unit((variation+.65*p.cloud-.22)*2)
        p.decay.put(group*unit((1.32-r)*3.6),2,(124,121,92),variation*18+micro*17)
        p.decay.put(group*band(r-.69,.21,.21),3,(177,170,133),micro*20)
        p.decay.put(group*unit((.52-r)*4),3,(56,61,46),micro*13)
    tide_salt=band(tide-.19,.039,p.step)*unit(.42+p.flake*1.1+p.cloud*.42)
    p.decay.put(tide_salt,1,(171,169,135),micro*22)


class Fittings:
    def __init__(self,boat):
        anchors=[]
        for material in OWN[boat.key]:
            with np.load(boat.folder/"bakes"/(material+".npz")) as d:
                metal=d["tag"]==list(d["tags"]).index("stainless")
                owners=d["part"][metal]
                triangles=d["pos"][metal]
                for k in np.unique(owners):
                    v=triangles[owners==k].reshape(-1,3)
                    low,high=v.min(0),v.max(0)
                    extent=high-low
                    if extent[1]>max(extent[0],extent[2])*.37 or max(extent)<.20:
                        bottom=v[v[:,1]<low[1]+max(.009,extent[1]*.025)]
                        anchors.append(bottom.mean(0))
                    else:
                        axis=int(np.argmax(extent))
                        for end in (low[axis],high[axis]):
                            anchors.append(v[np.abs(v[:,axis]-end)<max(.012,extent[axis]*.015)].mean(0))
        self.points=np.unique(np.round(anchors,2),axis=0)
        self.stretch=np.array([1,.24,1],np.float32)
        self.tree=cKDTree(self.points*self.stretch)

    def trails(self,p):
        q=p.P.copy()
        q[:,1]+=.30
        _,i=self.tree.query(q*self.stretch,k=4)
        source=self.points[i]
        dx=p.x[:,None]-source[:,:,0]
        dz=p.z[:,None]-source[:,:,2]
        dy=source[:,:,1]-p.y[:,None]
        radial=np.hypot(dx,dz)
        ny=unit(np.abs(p.ny))
        tangent=(dx*p.nz[:,None]-dz*p.nx[:,None])/np.maximum(.15,np.hypot(p.nx,p.nz))[:,None]
        lateral=ny[:,None]*radial+(1-ny[:,None])*np.abs(tangent+.016*np.sin(p.y[:,None]*11+source[:,:,2]*2))
        width=.024+.032*unit(dy)+.007*p.flake[:,None]
        distance=np.exp(-(lateral/width)**2)*np.exp(-radial/(.36+.16*unit(dy)))
        extent=.43+.87*np.mod(np.abs(source[:,:,0]*3.7+source[:,:,2]*1.9),1)
        fade=unit((extent-dy)/(.36+extent*.25))*unit((dy+.04)/.06)
        return np.max(distance*fade,axis=1)


def pane_wear(p,f):
    wind=f.on("curved windscreen","windscreen brow and sill")[p.i]
    deflector=f.on("deflector","windbreak")[p.i]
    roof=f.on("panoramic roof light","forehatch")[p.i]
    front=np.abs(p.nz)>np.abs(p.nx)
    u=np.where(roof|front,p.u,p.w)
    v=np.where(roof,p.w,p.v)
    hu=np.maximum(.085,np.where(roof|front,p.hx,p.hz))
    hv=np.maximum(.08,np.where(roof,p.hz,p.hy))
    d=f.boat.lines
    upper=(f.boat.key=="sovereign") & (p.y>5.64)
    k=np.where(wind,34+(p.x>0)+2*upper,p.part)
    x=np.where(wind,p.x-np.sign(p.x)*d["beam"]*.182,u-.34*hu*np.sin(1.37*k))
    windbase=np.where(upper,5.64,d["main"])
    y=np.where(wind,p.y-windbase-1.19,v+.22*hv*np.cos(k))
    a=x/np.where(wind,.76,np.minimum(1.01,hu*1.19))
    b=y/np.where(wind,.76,np.minimum(.79,hv*1.27))
    selected=np.where(wind,p.x>0,(k%4!=0)&(k%7!=3)) | (deflector & (p.x>0)) | roof
    saloon=f.on("saloon glazing")[p.i]
    if saloon.any():
        # One blow can cross a mullion. Its centre belongs to the side of the house.
        along=d["length"]*.5
        source_z=np.where(upper,np.where(p.x>0,-.11,.16),np.where(p.x>0,.18,-.24))*along
        source_y=np.where(upper,5.64,d["main"])+np.where(p.x>0,1.24,.91)
        x=np.where(saloon,p.z-source_z,x)
        y=np.where(saloon,p.y-source_y,y)
        a=np.where(saloon,x/np.where(upper,1.38,1.15),a)
        b=np.where(saloon,y/.81,b)
        k=np.where(saloon,21+(p.x>0)+3*upper,k)
        selected|=saloon
    r=np.hypot(a,b)
    edge,facet=cells(x+.008*p.flake,y,.034,441)
    bloom=smooth((.95-r+.065*p.flake)/.66)
    split=smooth((.17-edge)/.13)
    rays=np.zeros_like(x)
    width=(.015+.032*bloom)*(.78+.43*facet)
    for seed in range(4):
        pick=selected & (k%4==seed)
        rays[pick]=fracture_lines(a[pick],b[pick],241+seed,width[pick])
    # Diced safety glass scatters light through the whole crushed area.
    milk=bloom*(.49+.22*facet+.32*split)+rays*smooth((1.23-r)/.48)*.72
    rgb=np.array([30,48,55])+unit(milk)[:,None]*np.array([191,183,166])
    p.hurt.put(selected*smooth((1.21-r)/.30)*unit(milk*2.3),1,rgb,p.grit*(6+8*bloom))
    core=selected*smooth((.40-r+.045*p.flake)/.20)
    p.hurt.put(core,2,(207,222,215),(facet-.5)*35+split*15+p.grit*9)
    # A few complete side panes fall; elsewhere only the centre drops out of the crazing.
    gone=selected & ~wind & ~deflector & ((k%9==1) | (roof & (p.w<0) & (k%2==0)))
    gone &= ~saloon
    gone |= saloon & (p.part%11==2) & (np.abs(p.z)>d["length"]*.046)
    edge_dist=f.glass_edge()[p.i]
    for part in np.unique(p.part[gone]):
        take=gone&(p.part==part)
        at=np.flatnonzero(take)
        brush=Brush(p.hurt.image,p.i[at])
        centre,basis,pieces=frame_shards(f.boat,int(part))
        uv=p.P[at]-centre
        gu,gv=((uv*ax).sum(1) for ax in basis)
        brush.put(np.ones_like(gu),3,(18,26,30),6*p.cloud[at]+5*smooth(edge_dist[at]/.15))
        for left,mid,right,tip,tone in pieces:
            shard=np.maximum(triangle(gu,gv,left,mid,tip,p.step[at]),triangle(gu,gv,mid,right,tip,p.step[at]))
            brush.put(shard,3,(59+26*tone,88+21*tone,91+22*tone),p.flake[at]*10)
    cut=broken_radius(a,b,.17*k,p.flake)
    hole=selected & ~gone & ((k%3==1)|roof)
    p.hurt.put(hole*smooth((.37-cut)/.06),3,(24,32,34),p.grit*5)
    p.hurt.put(hole*band(cut-.37,.021,.018),3,(144,172,171),p.flake*19)
    veil=unit((.19-edge_dist)*4+.5*p.cloud+.35*p.flake)
    spot,_=shell_spots(u,v,.085,33)
    p.decay.put(veil*.8+band(spot-.80,.20,.25)*unit(.5+.75*p.cloud),1,(131,147,141),p.grit*13)
    p.decay.put(unit(.18+.76*p.cloud+.60*p.flake)*(.40+.6*unit((hv-v)/(2*hv))),2,(137,151,145),p.grit*18)
    p.decay.put(veil*unit(.39+p.cloud+.85*veil),3,(68,81,74),p.grit*18)
    p.decay.put((~selected)*(k%3==2)*smooth((.75-r)/.09),3,(27,39,41),p.cloud*8)


def glazing(p, f):
    if f.boat.key!="belvedere":
        return pane_wear(p,f)
    k=p.part.astype("f")
    front=np.abs(p.nz)>np.abs(p.nx)
    u=np.where(front,p.u,p.w)
    hu=np.maximum(.10,np.where(front,p.hx,p.hz))
    hv=np.maximum(.09,p.hy)
    wind=f.on("curved windscreen","windscreen brow and sill")[p.i]
    d=f.boat.lines
    # The forward glazing is built in horizontal strips across each of its two halves.
    u=np.where(wind,p.x,u)
    v=np.where(wind,p.y,p.v)
    k=np.where(wind,np.where(p.x>0,32,29),k).astype(int)
    center_u=np.where(wind,d["beam"]*np.where(p.x>0,.202,-.087),hu*.63*np.sin(k*1.73))
    center_v=np.where(wind,d["main"]+np.where(p.x>0,.98,1.38),hv*.62*np.cos(k*1.29))
    a=(u-center_u)/np.where(wind,1.08,np.minimum(1.15,hu*1.38))
    b=(v-center_v)/np.where(wind,.81,np.minimum(.88,hv*1.49))
    selected=np.where(wind,p.x>0,(k%5!=0)&(k%3!=2))
    r=broken_radius(a,b,.17*k,p.flake)
    ang=np.arctan2(b,a)
    rays=np.zeros_like(a)
    for seed in range(4):
        use=selected&(k%4==seed)
        rays[use]=fracture_lines(a[use],b[use],251+seed,.015)
    p.hurt.put(rays,1,(154,171,170),p.grit*15)
    rings=np.zeros_like(a)
    for j,dist in enumerate((.17,.32,.56,.79)):
        contour=np.hypot(a,b)*(1+.072*np.sin(7*ang+k)+.043*np.sin(12*ang-.4*k))+.013*p.flake
        rings=np.maximum(rings,band(contour-dist,.011+.002*j,.015)*unit(.49+.88*np.cos(ang*3.4+j+k)))
    p.hurt.put(selected*rings,2,(145,162,158),p.grit*20)
    frost=selected*unit((.31-r)*4)*unit(.24+.68*np.sin(ang*13+k)*np.cos(r*38)+.55*p.flake)
    p.hurt.put(frost,2,(112,137,137),p.grit*28)
    big=(k%4==0)|(k%7==3)
    # Straight edges join the ends of radial cracks. Several long shards remain in the opening.
    pitch=TAU/11
    sector=(ang-.29*k)%TAU/pitch
    vertex=np.floor(sector).astype(int)
    angle=(sector-vertex)*pitch
    def tip(j):
        j=j%11
        return (.61+.135*np.sin(2.09*j+.72*k)+.085*np.cos(4.3*j-.53*k))*(1-.54*((j+k)%7==0))
    r0,r1=tip(vertex),tip(vertex+1)
    rim=r0*r1*np.sin(pitch)/(r1*np.sin(pitch-angle)+r0*np.sin(angle))
    cut=np.hypot(a,b)-rim+.003*p.flake
    broken=selected*big
    p.hurt.put(broken*unit(-cut*33),3,(17,26,30),p.cloud*5)
    p.hurt.put(broken*band(cut-.009,.016,.014),3,(78,106,109),p.grit*11)
    glint=unit(.37+.49*np.cos(vertex*pitch-.33)+.24*np.sin(3.2*vertex+k))
    p.hurt.put(broken*band(cut+.002,.008,.009)*glint,3,(187,207,201),p.grit*12)
    missing=(~wind)&(k%13==0)&selected
    p.hurt.put(missing*unit((.96-np.abs(u)/hu-.08*p.flake)*14)*
               unit((.89-np.abs(p.v)/hv+.09*p.cloud)*12),3,(21,30,32),p.cloud*8)
    edge=f.glass_edge()[p.i]
    veil=unit((.19-edge)*4+.5*p.cloud+.35*p.flake)
    spot,rand=shell_spots(u,p.v,.085,33)
    p.decay.put(veil*.8+band(spot-.80,.20,.25)*unit(.5+.75*p.cloud),1,(131,147,141),p.grit*13)
    bloom=unit(.18+.76*p.cloud+.60*p.flake)*(.40+.6*unit((hv-p.v)/(2*hv)))
    p.decay.put(bloom,2,(137,151,145),p.grit*18)
    perished=unit(.3+p.cloud+1.2*veil)*unit((.18-edge)*7)
    p.decay.put(perished,3,(64,77,69),p.grit*20)
    p.decay.put((~selected)*(k%3==2)*unit((.72-r)*9),3,(27,39,41),p.cloud*8)


def upholstery(p,f):
    back=f.on("seatback","backrest")[p.i]
    bolster=f.on("settee bolster")[p.i]
    u=np.where(bolster,p.w,p.u)
    v=np.where(back|bolster,p.v,p.w)
    hu=np.maximum(.05,np.where(bolster,p.hz,p.hx))
    hv=np.maximum(.05,np.where(back|bolster,p.hy,p.hz))
    k=p.part
    u0=hu*.37*np.sin(k*2.03)
    v0=hv*.29*np.cos(k*1.71)
    t=(u-u0)/(.65*hu+.035)
    line=v-v0-.18*(u-u0)-.025*np.sin(t*3.4+k)-.009*p.flake
    face=unit((np.where(back,abs(p.nz),np.where(bolster,abs(p.nx),p.ny))-.12)*2)
    split=unit(1-t*t)*face*(k%4!=1)
    w=.012+.039*unit(1-t*t)
    p.hurt.put(split*band(line,w+.014,p.step),1,(153,145,120),p.grit*21)
    p.hurt.put(split*band(line,w,p.step),2,(96,80,61),p.flake*19)
    p.hurt.put(split*band(line+.006,w*.51,p.step),2,(212,178,107),p.grit*35)
    threads=np.sin((u+line*.60)*273+2*p.flake)
    p.hurt.put(split*band(line-w,.014,p.step)*unit(threads+.24),2,(220,210,174),p.grit*17)
    edge=np.minimum(hu-np.abs(u),hv-np.abs(v))
    damp=unit((.17-edge)*4+.36+.66*p.cloud+.55*p.flake+.34*(1-p.ao))
    p.decay.put(damp*unit(.2+.90*p.flake+.54*p.grit),1,(135,135,105),p.grit*19)
    p.decay.put(damp*unit(.34+.74*p.cloud+.9*p.flake),2,(88,91,64),p.grit*26)
    mould=damp*unit(.24+1.24*p.flake+.57*p.grit)
    p.decay.put(mould,3,(53,61,47),p.grit*23)
    rotten=(k%3==1)*face*unit((.73-np.abs(t))*3)*band(line+.15*hv,.035+.027*p.flake,p.step)
    p.decay.put(rotten,3,(122,103,72),p.grit*30)


def hardware(p, f):
    upright=p.hy>np.maximum(p.hx,p.hz)*.65
    bronze=f.where("bronze")[p.i]
    t=np.where(upright,p.v,np.where(p.hz>p.hx,p.w,p.u))
    angle=np.where(upright,np.arctan2(p.nz,p.nx),np.arctan2(p.ny,p.nx+.37*p.nz))
    sides=np.where(upright,p.hy,np.maximum(p.hz,p.hx))
    tip=np.abs(t)/np.maximum(sides,.018)
    crease=t-sides*.22*np.sin(p.part*1.37)-.039*np.sin(angle+.9*p.part)
    line=band(crease,.011+p.step,p.step)
    contact=unit(.41+.9*p.cloud+.45*np.cos(angle)+.24*tip)
    sweep=np.sin(116*(t+.024*np.sin(angle*2))+.77*p.flake)
    p.hurt.put(contact*unit((sweep-.76)*4)*unit(.19+.82*p.flake+.48*p.cloud),1,
               (213,211,191),p.grit*22)
    struck=(p.part%5==1)|bronze
    p.hurt.put(struck*line,2,(64,66,59),p.grit*12)
    p.hurt.put(struck*band(crease-.021,.009+p.step,p.step),2,(209,201,171),p.grit*23)
    p.hurt.put(bronze*unit((tip-.59)*3)*unit(.62+p.flake-.65*np.cos(angle)),3,
               (111,82,52),p.grit*23)
    foot=np.exp(-(np.maximum(p.v+p.hy,0)/(.04+.15*upright))**1.4)
    tea=unit(foot*(.41+.69*p.flake+.32*np.sin(angle))+(.73-p.ao)*.42)
    p.decay.put(tea,1,(173,145,99),p.grit*20)
    p.decay.put(tea*unit(.24+1.06*p.flake),2,(129,89,53),p.grit*23)
    p.decay.put(bronze*unit(.27+.85*p.cloud+.64*p.flake),3,(65,98,81),p.grit*17)


def gelcoat(p, f, fittings):
    up=unit(p.ny)
    side=np.abs(p.nx)
    trail=fittings.trails(p)
    chalk=unit((.90*up+.25*side+.14*p.ao+.69*p.cloud+.52*p.flake-.63)*1.5)
    # Old binder blooms in patches. Salt collects in their pores and below the fittings.
    p.decay.put(chalk*unit(.47+.70*p.grit),2,(211,213,201),p.grit*13)
    p.decay.put(chalk*unit(.10+.91*p.flake+.59*p.cloud),3,(191,196,178),p.grit*16)
    p.decay.put(trail*unit(.81+.48*p.flake),1,(187,154,103),p.grit*13)
    p.decay.put(trail*unit(.56+.90*p.flake+.27*p.cloud),2,(146,95,55),p.grit*17)
    p.decay.put(trail*unit(.09+.9*p.flake+.34*p.cloud),3,(99,67,43),p.grit*18)
    drop,seed=shell_spots(p.x*1.73,p.z,.47,71)
    blot=up*(seed>.91)*unit((1.12-drop+.23*p.flake)*2.8)
    p.decay.put(blot,1,(224,217,184),p.grit*22)
    p.decay.put(blot*unit((.65-drop+.32*p.flake)*3),1,(121,119,91),p.grit*23)
    chip=f.boot_inlay[p.i]+f.boot_line[p.i]
    p.decay.put(unit(chip)*unit((.53*p.cloud+1.08*p.flake-.20)*2),2,(165,152,118),p.grit*24)

    frame=f.on("moulded saloon frame","windscreen brow","saloon glazing brow","swept hardtop pier")[p.i]
    corner_u=p.w-np.where(p.part%2==0,p.hz,-p.hz)*.96
    corner_v=p.v-np.where(p.part%3==0,p.hy,-p.hy)*.96
    for seed in range(3):
        take=frame&(p.part%5!=4)&(p.part%3==seed)
        if take.any():
            h=Brush(p.hurt.image,p.i[take])
            rays=fracture_lines(corner_u[take]/.84,corner_v[take]/.47,551+seed,.026)
            h.put(rays,1,(115,115,103),p.grit[take]*21)
            crease=(corner_v[take]-.38*corner_u[take]+.015*p.flake[take])
            h.put(band(crease,.018,p.step[take])*unit(1-np.abs(corner_u[take])/.53),2,
                  (98,88,69),p.grit[take]*21)
    axis=np.argmax(np.abs(np.column_stack((p.nx,p.ny,p.nz))),axis=1)
    gaps=np.column_stack((p.hx-np.abs(p.u),p.hy-np.abs(p.v),p.hz-np.abs(p.w)))
    gaps[np.arange(len(gaps)),axis]=np.inf
    edge=gaps.min(axis=1)
    raised=f.on("bridge coaming","transom riser","saloon frame","hardtop pier","table","sunbed base")[p.i]
    chips=raised*unit((.046-edge)*24)*unit((.97*p.flake+.53*p.cloud-.22)*2.7)
    p.hurt.put(chips,1,(170,157,129),p.grit*24)


def fire_front(p,f,canvas,lift):
    d=f.boat.lines
    fires={"solstice":[(.24,.14,.26,.27),(-.17,-.37,.17,.17)],
           "meridian":[(-.31,-.43,.23,.26),(.17,-.12,.15,.19)],
           "sovereign":[(-.33,-.45,.23,.24),(.32,.03,.19,.20),(-.10,-.02,.18,.16)]}
    heat=np.zeros_like(lift)
    drift=.065*lift+.026*np.sin(lift*5)
    for x,z,w,h in fires[f.boat.key]:
        dx=p.x/d["beam"]-x+drift
        dz=p.z/(d["length"]*.5)-z-.115*lift
        if f.boat.key=="sovereign" and f.material=="house":
            # Smoke curls around the mast. Short windrows of ash trail aft across the sun roof.
            lean=lift*lift
            stripe=np.sin(2.8*p.x+.44*p.z+.37*p.y)+.45*np.sin(7*p.x+.82*p.z)
            dx+=.027*np.sin(.91*p.z+.35*p.y)+.014*p.cloud
            dz+=lean*(.074+.043*stripe)+.020*np.sin(2.3*p.x)+.014*p.cloud
            h*=1+.45*lean
        reach=(dx/(w*(.85+.68*lift)))**2+(dz/(h*(.79+.82*lift)))**2
        heat=np.maximum(heat,np.exp(-1.65*reach))
    heat*=.97+.035*p.cloud+.015*p.flake
    plume=.5+.5*np.cos(11*p.z+8*p.x+.68*p.y+1.6*p.cloud)
    cloth=f.cloth[p.i]|canvas[p.i]
    tone=np.tile(np.array([203,196,176],"f"),(len(p.x),1))
    tone[cloth]=(182,170,143)
    tone[f.where("graphite","leather","gasket")[p.i]]=(64,68,65)
    def blend(col,t):
        tone[:]+=(np.asarray(col)-tone)*smooth(t)[:,None]
    blend((139,132,111),(heat-.09)/.25+.13*plume)
    blend((160,104,55),(heat-.24)/.20)
    blend((88,66,46),(heat-.39)/.20)
    blend((34,35,32),(heat-.51)/.25)
    if f.boat.key=="sovereign" and f.material=="house":
        soot_ribbon=.5+.5*np.sin(6.6*p.x+.82*p.z+.64*np.sin(2*p.z)+.37*p.y)
        ash=smooth((heat-.49)/.32)*unit(.18+.42*p.cloud+.38*soot_ribbon)*unit(p.ny)
        tone+=(np.array([105,103,92])-tone)*ash[:,None]
    tone+=(5*p.cloud+5*p.grit+4*plume)[:,None]
    # Stage boundaries change the extent. The ink carries the continuous heat gradient.
    for stage,lo,hi in ((1,.11,.26),(2,.26,.50),(3,.50,1.2)):
        p.hurt.put((heat>=lo)*(heat<hi)*unit(.46+(heat-lo)/(hi-lo)),stage,tone)
    perimeter=np.exp(-((heat-.40)/.105)**2)
    r,_=shell_spots(p.x+p.z*.37,p.y+.45*p.z,.087,74)
    p.hurt.put(perimeter*band(r-.76,.20,.25)*unit(.48+.58*p.flake),2,(156,123,82),p.grit*19)
    tear=np.sin(107*(p.x+.31*p.z)+2.8*p.flake)
    p.hurt.put(cloth*smooth((heat-.63)/.17)*unit((tear-.61)*3)*unit(.32+.81*p.flake),3,(89,73,55),p.grit*13)


def fire(p, f, canvas):
    d=f.boat.lines
    beam,h,main,height=d["beam"],d["length"]*.5,d["main"],d["height"]
    lift=unit((p.y-main)/(height-main))
    if f.boat.key!="belvedere":
        return fire_front(p,f,canvas,lift)
    # Two seats of fire. Each plume widens up the pier, rolls under the roof and curls over its lip.
    heat=np.zeros_like(p.x)
    for x0,z0,width,along,start,bend in [
        (.29,-.23,.175,.16,.00,.077),(-.22,-.44,.164,.116,.00,.083),
        (.004,-.11,.21,.18,.57,-.07)]:
        x=p.x/beam-x0+.032*np.sin(lift*7+z0*9)+.015*p.cloud
        z=p.z/h-z0-lift*bend
        ellipse=np.hypot(x/(width*(.81+.69*lift)),z/(along*(.72+.58*lift)))
        column=unit((lift-start+.10)*6)*(1-ellipse+.13*p.cloud+.061*p.flake)
        heat=np.maximum(heat,column)
    soot=unit((heat-.06)*1.55)
    finger=np.sin(17*p.x+6*p.z+3*p.cloud+1.9*np.sin(2.2*p.y))
    smoke=unit((heat-.056)*2)*unit((.38-heat)*6)*unit(.28+.73*p.flake+.41*finger)
    p.hurt.put(smoke,1,(150,138,111),p.grit*17)
    p.hurt.put(unit((soot-.19)*2)*unit(.63+.67*p.flake+.39*p.cloud),2,
               (101,96,83),p.grit*17+p.flake*22)
    char=unit((heat-.36)*3.7)
    p.hurt.put(char,3,(49,49,43),p.cloud*19+p.flake*16+p.grit*9)
    p.hurt.put(char*unit((heat-.56)*4+.42*p.flake),3,(31,34,31),p.grit*8+p.flake*14)
    ash=unit((heat-.65)*4)*unit(.25+.76*p.flake+.32*finger)
    p.hurt.put(ash,3,(91,89,75),p.grit*17+p.flake*22)
    cloth=f.cloth[p.i]|canvas[p.i]
    field=p.x+p.z*.42
    r,phase=shell_spots(field,p.y+.45*p.z,.083,74)
    blister=char*band(r-.80,.20,.25)*unit(.58+.78*p.flake)
    p.hurt.put(blister*(~cloth),3,(121,108,82),p.grit*18)
    weave=np.sin(165*p.x+.8*p.flake)*np.sin(145*p.z+.8*p.grit)
    p.hurt.put(cloth*char*unit(.18+.94*p.flake+.49*weave),3,(84,77,61),p.grit*24)
    p.hurt.put(canvas[p.i]*char*unit((heat-.50)*5+.83*p.flake+.17*weave),3,
               (27,31,31),p.grit*12)


def joinery(p,f):
    screen=f.where("chart","instruments","keyboard")[p.i]
    span=np.maximum(p.hx,.1)
    diagonal=p.v-.31*p.u+.006*np.sin(p.u*33)-.018
    cut=band(diagonal,.003+p.step*.55,p.step)*unit((.75-p.u/span)*2)
    p.hurt.put(screen*cut,2,(132,147,144),p.grit*17)
    p.hurt.put(screen*unit((-p.u/span-.32)*2)*unit((diagonal-.014)*18),3,(18,29,31),p.grit*6)
    face=f.name_board[p.i]|f.where("walnut","leather")[p.i]
    rub=unit(.13+.86*p.flake+.56*p.cloud)*unit((.75-np.abs(p.u/span))*2)
    p.hurt.put(face*rub*band(p.v+.16*p.u+.013*p.flake,.014,p.step),1,(164,138,99),p.grit*17)
    p.decay.put(face*unit((.60*p.cloud+.82*p.flake-.09)*2),2,(154,140,105),p.grit*20)
    p.decay.put(screen*unit(.12+.87*p.cloud+.82*p.flake),2,(109,121,111),p.grit*15)


def basin(p,f):
    wet=f.where("pool")[p.i]
    rim=np.minimum(p.hx-np.abs(p.u),p.hz-np.abs(p.w))
    ray=fracture_lines((p.u+.90)/.61,(p.w+.43)/.49,811,.022)
    p.hurt.put((~wet)*ray,1,(159,160,140),p.grit*17)
    # Water drains towards the crushed starboard corner, revealing a shelf of dry mosaic.
    dry=p.u+.98+.22*p.w+.05*p.cloud
    tile=np.sin(21*np.floor(p.u/.085)+37*np.floor(p.w/.085))
    grout=np.minimum(np.abs((p.u+.0425)%.085-.0425),np.abs((p.w+.0425)%.085-.0425))
    bed=np.array([125,162,147])+tile[:,None]*np.array([11,17,13])
    bed+=(np.array([164,166,141])-bed)*smooth((.007-grout)/.006)[:,None]
    p.hurt.put(wet*smooth((.02-dry)/.055),2,bed,p.grit*5)
    p.hurt.put(wet*smooth((.19-dry)/.059)*(dry>.015),3,bed,p.grit*8)
    p.hurt.put(ray*smooth((.18-dry)/.14),3,(74,87,81),p.grit*19)
    tide=band(rim-.038,.022,p.step)
    p.decay.put(tide*unit(.61+.48*p.flake),1,(182,184,149),p.grit*14)
    stagnant=smooth((.37-rim+.11*p.cloud)/.30)
    p.decay.put(unit(.19+.49*stagnant+.42*p.cloud),2,(93,123,86),p.flake*12)
    mud=smooth((p.w+.25+.13*p.u+.12*p.cloud)/.50)
    p.decay.put(mud*(.52+.44*stagnant),3,(99,101,68),p.grit*16+p.flake*13)


def wear_slice(f,fittings,hurt,decay):
    layers=(hurt,decay)
    grain=(noise(f.P,.012,411),noise(f.P,.065,519),noise(f.P,.46,638))
    def patch(mask):
        return Patch(f,mask,layers,grain)
    shell=f.on("chine-built hull","folded sheer coaming","transom riser","transom locker","beach club seat base")
    if shell.any():
        p=patch(shell)
        hull_hurt(p,f.boat)
        hull_decay(p,f.boat)
    if f.gelcoat.any():
        gelcoat(patch(f.gelcoat),f,fittings)
    glass=f.glass & ~f.where("clear")
    if glass.any():
        glazing(patch(glass),f)
    pool=f.where("pool","tile")
    if pool.any():
        basin(patch(pool),f)
    if f.cloth.any():
        upholstery(patch(f.cloth),f)
    metal=f.where("stainless","bronze")|f.on("windscreen post")
    if metal.any():
        hardware(patch(metal),f)
    face=f.where("chart","instruments","keyboard","leather","walnut")|f.name_board
    if face.any():
        joinery(patch(face),f)
    burn=(f.y>f.boat.lines["main"]+.08)&(f.gelcoat|f.cloth|f.where("graphite","leather","gasket","walnut"))
    if burn.any():
        canvas=np.zeros(len(f.P),bool)
        if f.on("cambered coachroof").any():
            for mark in roof_graphics(f):
                if mark.name=="roof canvas":
                    canvas[mark.indices]=mark.coverage>.5
                    break
        fire(patch(burn),f,canvas)
    decay[hurt[:,3]!=0]=0


def save_pair(folder, material, layers, side):
    for role,layer in zip(("hurt","decay"),layers):
        save_png(Image.fromarray(layer.reshape(side,side,4)),folder/(material+"_"+role+".png"))
    print("Painted",material,side,flush=True)


def wear_material(boat, material, fittings):
    s=read_surface(boat,material)
    hurt,decay=(np.zeros((s.n,4),np.uint8) for _ in range(2))
    for start in range(0,s.n,131072):
        rows=slice(start,start+131072)
        wear_slice(Fields(boat,s,rows),fittings,hurt[rows],decay[rows])
    save_pair(boat.folder,material,(hurt,decay),s.size)


def wrap(x):
    return (x+.5)%1-.5


def teak_wear(n=1024):
    t=teak_fields(n)
    u,v,board,seam,edge,grain,fiber,dust=(a.ravel() for a in
        (t.u,t.v,t.board,t.seam,t.distance,t.grain,t.strand,t.dust))
    rng=np.random.default_rng(72253)
    def field(cols,rows):
        grid=rng.uniform(-1,1,(rows,cols)).astype("f")
        return ndimage.map_coordinates(grid,(v*rows,u*cols),order=1,mode="grid-wrap")
    coarse,fleck=field(5,6),field(61,39)
    layers=[np.zeros((n*n,4),np.uint8) for _ in range(2)]
    indices=np.arange(n*n)
    hurt,decay=(Brush(a,indices) for a in layers)
    for cx,cy,length,drift in [( .247,.38,.13,.025),(.253,.34,.091,.015),
                               (.804,.68,.15,-.021),(.452,.095,.08,.012)]:
        along=wrap(v-cy)/length
        shape=unit(1-along**2)
        trace=wrap(u-cx-drift*along-.0014*np.sin(along*3.1)-.0008*fleck)
        width=.0009+.0033*shape
        hurt.put(shape*unit(1.6-np.abs(trace)/width),1,(161,139,99),grain+fiber*3)
        hurt.put(shape*unit(1.4-np.abs(trace)/(.62*width)),2,(100,73,48),grain+fiber*4)
        hurt.put(shape*band(trace-width*.67,.00065,.0009),2,(226,193,132),grain+dust*3)
    butt=np.minimum(t.from_butt.ravel(),1-t.from_butt.ravel())
    splinter=unit(1-butt/.09)*(board%7==2)
    split=t.across.ravel()-.27-.11*np.sin(v*TAU*3+board)-(.68*splinter-.2)*.20
    hurt.put(splinter*unit(1.4-np.abs(split)/.05),1,(113,86,54),fiber*5)
    hurt.put(splinter*unit(1.3-np.abs(split+.045)/.046),2,(206,170,111),grain+fiber*4)
    wood=np.array([180,138,89],"f")+(t.tone.ravel()+grain+1.6*fiber)[:,None]*np.array([1,.89,.69],"f")
    wood+=(np.array([39,38,33],"f")-wood)*seam[:,None]
    heat=1-np.hypot(wrap(u-.57)/.049,wrap(v-.81)/.097)+.16*fleck+.011*grain+.045*np.sin(board*7)
    burnt=wood+(np.array([43,39,31],"f")-wood)*unit(heat+.12)[:,None]
    hurt.put(unit((heat+.10)*2.4),2,burnt,grain*.5+fiber)
    hurt.put(unit((heat-.38)*4),3,burnt*.81,grain*.42+fiber*2)
    hurt.put(unit((heat-.52)*4)*unit(.15+fleck+.23*fiber),3,(73,67,53),grain+fiber*2)
    damp=unit(.43+.72*coarse+.35*fleck)
    salt=unit((.006-edge)*180)*unit((.35+fleck+.41*coarse))
    decay.put(salt,1,(145,137,102),grain*.5+fiber*4)
    green=unit((.012-edge)*77)*damp*unit(.22+fleck+.37*fiber)
    decay.put(green,2,(88,97,58),grain*.65+fiber*3)
    end=t.from_butt.ravel()
    plank=.29*np.cos(board*4.31)+.21*np.cos(TAU*end+board*.83)
    grey=unit((.22+.79*coarse+.27*fleck+plank+grain*.013)*1.65)
    # Silvering runs along the grain as the oil leaves each plank at its own rate.
    dry=wood+(np.array([160,159,142],"f")-wood)*unit(.13+grey*.88)[:,None]
    land=1-seam
    decay.put(unit((grey+.04)*1.4)*land,1,dry,grain*.58+fiber*2)
    decay.put(unit((grey-.15)*2.5)*land,2,dry,grain*.73+fiber*3)
    decay.put(unit((grey-.53)*2.8)*land,3,dry,grain*.89+fiber*4)
    mould=unit((.0085-edge)*137)*unit(.35+fleck+.67*coarse)
    decay.put(mould,3,(52,56,43),grain*.45+fiber*4)
    open_seam=seam*unit(.17+.88*coarse+.68*fleck)
    decay.put(open_seam,3,(29,31,26),fiber*3)
    layers[1][layers[0][:,3]!=0]=0
    save_pair(HERE/"tex","teak",layers,n)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("yacht",choices=IDENTITY)
    boat=Vessel(parser.parse_args().yacht)
    fittings=Fittings(boat)
    teak_wear()
    for material in OWN[boat.key]:
        wear_material(boat,material,fittings)


if __name__=="__main__":
    main()
