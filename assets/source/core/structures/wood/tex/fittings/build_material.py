#!/usr/bin/env python3
"""Native-resolution procedural wood/iron trim sheet; all dimensions in mm.
No input photographs, image synthesis, baked light or inferred albedo height.
Run from this folder: python3 build_material.py
"""
from pathlib import Path
import json, time
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'source'
SOURCE.mkdir(exist_ok=True)
N=2048
MM_PER_PIXEL=1000/N
HEIGHT_RANGE_MM=12.0
SEED=831740
BANDS=[(1024,1280,'hammered_plate'),(1280,1408,'riveted_strap'),
       (1408,1536,'plain_strap'),(1536,1664,'nailed_strap'),
       (1664,1792,'rusted_strap'),(1792,2048,'rusted_plate')]
# Retain the delivered sRGB profile, including its timestamp, for exact rebuilds.
PROFILE=(SOURCE/'srgb.icc').read_bytes()
ENDGRAIN_SRGB=np.array([186,149,107])
PEG_SRGB=np.array([177,142,96])

def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)

def noise(rng,shape,scale,periodic=False):
    """Gaussian random field; periodic X for every iron operation."""
    h,w=shape
    # Filter native samples: exact periodicity, no stitched edge strip.
    z=gaussian_filter(rng.normal(size=shape).astype(np.float32),scale,
                      mode=('reflect','wrap' if periodic else 'reflect'))
    z-=z.mean()
    return z/(z.std()+1e-8)

def fbm(rng,shape,scales,weights,periodic=False):
    z=np.zeros(shape,np.float32)
    for s,v in zip(scales,weights): z+=noise(rng,shape,s,periodic)*v
    return z

def rgb8(a): return np.round(np.clip(a,0,255)).astype(np.uint8)
def encode_height(h): return np.round(np.clip(h/HEIGHT_RANGE_MM,0,1)*65535).astype(np.uint16)
def save_rgb(path,a,srgb=False):
    Image.fromarray(rgb8(a)).save(path,**({'icc_profile':PROFILE} if srgb else {}))

def deposit(field,x,y,sx,sy,amount,periodic=False):
    """Add local elliptical Gaussian; periodic stamps cross the physical seam."""
    h,w=field.shape
    radx=int(np.ceil(sx*3.3)); rady=int(np.ceil(sy*3.3))
    xi=np.arange(int(x)-radx,int(x)+radx+1)
    yi=np.arange(max(0,int(y)-rady),min(h,int(y)+rady+1))
    if not periodic: xi=xi[(xi>=0)&(xi<w)]
    if not len(xi) or not len(yi): return
    z=amount*np.exp(-0.5*((xi[None,:]-x)/sx)**2-0.5*((yi[:,None]-y)/sy)**2)
    field[np.ix_(yi,xi%w)]+=z

def draw_path(shape,points,widths):
    """Antialiased variable-width distance-to-polyline crack, native samples."""
    out=np.zeros(shape,np.float32)
    for j,(a,b) in enumerate(zip(points[:-1],points[1:])):
        a=np.asarray(a); b=np.asarray(b); v=b-a
        pad=max(widths[j],widths[j+1])*2+2
        x0=max(0,int(min(a[0],b[0])-pad)); x1=min(shape[1],int(max(a[0],b[0])+pad)+1)
        y0=max(0,int(min(a[1],b[1])-pad)); y1=min(shape[0],int(max(a[1],b[1])+pad)+1)
        if x1<=x0 or y1<=y0: continue
        yy,xx=np.mgrid[y0:y1,x0:x1]
        t=np.clip(((xx-a[0])*v[0]+(yy-a[1])*v[1])/(np.dot(v,v)+1e-9),0,1)
        d=np.hypot(xx-a[0]-t*v[0],yy-a[1]-t*v[1])
        width=widths[j]*(1-t)+widths[j+1]*t
        val=np.clip((width+0.65-d)/1.15,0,1)
        np.maximum(out[y0:y1,x0:x1],val,out=out[y0:y1,x0:x1])
    return out

WOOD_CENTERS=[(250,262),(180,335),(305,185),(-310,655),(276,264),(360,290),(160,175),(265,248)]
WOOD_KINDS=['boxed heart','off-centre heart','off-centre heart','quarter-sawn corner',
            'boxed heart','off-centre heart','off-centre heart','boxed heart']
PEG_CELLS={1:(378,135),4:(134,370),6:(385,373)}

def wood_cell(index):
    rng=np.random.default_rng(SEED+index*1049)
    shape=(512,512); y,x=np.mgrid[:512,:512].astype(np.float32)
    cx,cy=WOOD_CENTERS[index]
    edge=np.minimum.reduce([x,y,511-x,511-y])
    face=smooth(3,23,edge)
    macro=fbm(rng,shape,[85,28,8],[.75,.32,.12])
    fine=fbm(rng,shape,[2.1,.65],[.6,.4])
    dx=x-cx; dy=y-cy
    angle=.43+index*.71
    u=dx*np.cos(angle)+dy*np.sin(angle)
    v=-dx*np.sin(angle)+dy*np.cos(angle)
    # Compression wood: one side flattens; eccentric growth changes with age.
    # The radial drift changes ring centres instead of repeating nested circles.
    radial_distance=np.hypot(u,v)
    u+=.12*radial_distance*np.sin(radial_distance/145+index)+noise(rng,shape,42)*6
    v+=.07*radial_distance*np.sin(radial_distance/83+index*.4)+noise(rng,shape,39)*5
    u*=1+.24*smooth(-60,120,u)
    exponent=2.0+.80*smooth(-25,140,u)
    r=(np.abs(u)**exponent+np.abs(v*.92)**exponent)**(1/exponent)
    theta=np.arctan2(dy,dx)
    growth=1+.065*np.sin(theta*3+index)+.035*np.cos(theta*5+index*.8+r/190)
    warped=r*growth+smooth(12,100,r)*(5*np.sin(theta*2+r/67)+2*np.sin(theta*9+r/53))
    warped+=1.8*noise(rng,shape,14)
    # Narrow suppressed years alternate with wider growth; not a regular comb.
    widths=np.clip(rng.lognormal(np.log(8.8),.47,260),3.4,20)
    widths*=1+.23*np.sin(np.arange(260)*.39+index)
    boundaries=np.cumsum(np.r_[0,widths])
    phase=np.interp(warped,boundaries,np.arange(len(boundaries))).astype(np.float32)
    phase+=.045*noise(rng,shape,7)+.018*noise(rng,shape,2)
    frac=phase%1
    early=np.exp(-((frac-.15)/.13)**2)
    late=np.exp(-((frac-.84)/(.065+.035*smooth(-1,1,macro)))**2)
    broad=np.sin(phase*2*np.pi-.3)
    # Medullary rays: many fine discontinuous radial ribbons, some broad oak rays.
    ray=np.zeros(shape,np.float32)
    for j,ang in enumerate(rng.uniform(-np.pi,np.pi,130)):
        ad=np.arctan2(np.sin(theta-ang),np.cos(theta-ang))
        width=rng.uniform(.9,1.8) if j%13==0 else rng.uniform(.20,.65)
        streak=np.exp(-.5*((ad+.004*np.sin(r/22+ang))*(radial_distance+6)/width)**2)
        broken=.25+.75*smooth(-.4,.7,np.sin(r/rng.uniform(13,40)+ang*13)+macro*.55)
        ray=np.maximum(ray,streak*broken)
    ray*=smooth(12,35,r)
    # Ring-porous oak vessels lie along earlywood; small isolated latewood vessels.
    pores=np.zeros(shape,np.float32)
    weights=.06+early**2
    for _ in range(13500):
        px=rng.integers(7,505); py=rng.integers(7,505)
        if rng.random()>weights[py,px]*.72: continue
        deposit(pores,float(px),float(py),rng.uniform(.40,.88),rng.uniform(.45,1.12),rng.uniform(.45,1.3))
    pores=np.clip(pores,0,1)
    # A few radial checks: tapered, wandering and bifurcating, from a timber edge.
    checks=np.zeros(shape,np.float32)
    for k in range(5+(index%3)):
        side=int(rng.integers(4)); pos=rng.uniform(42,470)
        start=np.array([(0,pos),(511,pos),(pos,0),(pos,511)][side],float)
        direction=np.array([cx,cy])-start
        direction/=np.linalg.norm(direction)
        perp=np.array([-direction[1],direction[0]])
        length=rng.uniform(65,173)
        if k==0 and index in (0,2,7): length=240
        ts=np.linspace(0,1,int(length/10)+2)
        wander=np.cumsum(rng.normal(0,1.35,len(ts)))
        pts=[start+direction*length*t+perp*w for t,w in zip(ts,wander)]
        widths=rng.uniform(1.3,3.1)*(1-ts)**.72+.08
        checks=np.maximum(checks,draw_path(shape,pts,widths))
        if k%2==0:
            j=len(pts)//2; branch=[pts[j]+direction*length*.31*t+perp*(length*.12*t+2*np.sin(t*4)) for t in np.linspace(0,1,9)]
            checks=np.maximum(checks,draw_path(shape,branch,np.linspace(.9,.04,9)))
    # Unequal heart shakes open out from the pith, separate from edge checks.
    if 0<cx<512 and 0<cy<512:
        ang=rng.uniform(0,2*np.pi)
        for k in range(2 if index%2 else 3):
            direction=ang+k*rng.uniform(1.7,2.5)
            length=rng.uniform(45,135) if k else rng.uniform(130,220)
            t=np.linspace(0,1,22)
            axis=np.array([np.cos(direction),np.sin(direction)])
            perp=np.array([-axis[1],axis[0]])
            wandering=np.cumsum(rng.normal(0,.8,len(t)))
            points=[np.array([cx,cy])+axis*length*s+perp*w for s,w in zip(t,wandering)]
            checks=np.maximum(checks,draw_path(shape,points,rng.uniform(1.0,2.1)*(1-t)**.8+.03))
    checks*=face
    # Sawn face: shallow, imperfect and closely spaced tooling across the rings.
    saw_coord=y*.955+x*(.12+.035*(index%3))+.9*noise(rng,shape,26)
    saw=np.sin(saw_coord*2*np.pi/3.1)*.45+np.sin(saw_coord*2*np.pi/9.7)*.35
    saw*=.65+.35*np.clip(noise(rng,shape,12)*.3+.5,0,1)
    micro=fine*.015
    # Color is pigment only. Checks have the same underlying wood pigment;
    # their darkness under lighting lives in the height/AO, never albedo.
    annual_tone=rng.normal(0,3.7,280)
    annual=np.interp(phase,np.arange(280),annual_tone)
    cell_mottle=noise(rng,shape,1.05)*.95+noise(rng,shape,3.5)*1.6
    # Pigment contrast fades in irregular sectors; latewood remains the dark line.
    ring_visibility=.38+.62*smooth(-1.4,1.4,noise(rng,shape,24)+macro*.35)
    oxidation=noise(rng,shape,48)*4.2+noise(rng,shape,12)*1.4
    tone=macro*5.2+oxidation+annual*.8+(broad*.8-early*3.0-late*11.5)*ring_visibility+ray*6.0-pores*15+fine*1.2+cell_mottle+saw*.65
    # Palette E is the whole-half target, including dark latewood and arrises.
    # A small carrier offset compensates for those existing pigment details.
    center_color=ENDGRAIN_SRGB+np.array([4,3,2])+np.array([2.2,1.5,.9])*(index%4-1.5)
    color=center_color+tone[...,None]*np.array([1,.79,.56])
    # A scuffed, lighter inner arris with a clean dark outer four-pixel margin.
    wear=np.exp(-((edge-21)/5.5)**2)*(.65+.35*smooth(-1,1,macro))
    color+=wear[...,None]*np.array([10,7,4.5])
    rim=(ENDGRAIN_SRGB-np.array([28,20,13])).astype(np.float32)
    color=rim+(color-rim)*face[...,None]
    surface=(6.0+.045*macro-.045*early+.018*late-.045*ray-.18*pores+.012*saw+micro)
    height=4.4+(surface-4.4)*(np.sin(np.clip(edge/22,0,1)*np.pi/2))**.55
    height-=checks*(2.3+.55*smooth(-1,1,macro))
    ao=1-.73*checks-.28*pores*face-.06*early*face
    rough=.78+.04*early+.055*pores+.035*checks+.018*fine
    rough=rough*face+.76*(1-face)
    pegmask=np.zeros(shape,np.float32)
    if index in PEG_CELLS:
        px,py=PEG_CELLS[index]; pr=np.hypot(x-px,y-py)
        radius=25.6+.25*np.sin(np.arctan2(y-py,x-px)*7)
        pegmask=1-smooth(radius-.7,radius+.7,pr)
        ptheta=np.arctan2(y-py,x-px)
        pphase=(np.hypot((x-px+7)*1.05,y-py-5)+.5*np.sin(ptheta*4))/4.25
        pg=np.sin(pphase*2*np.pi)
        pcolor=PEG_SRGB+((pg*3+fine*1.9+ray*2)[...,None])*[1,.8,.55]
        color=color*(1-pegmask[...,None])+pcolor*pegmask[...,None]
        pheight=6.0+.48*(1-smooth(radius-3.0,radius+.2,pr))-.028*pg+fine*.012
        height=height*(1-pegmask)+pheight*pegmask
        # Narrow annular seating joint, not a black paint outline.
        joint=np.exp(-((pr-radius-.65)/.72)**2)
        height-=joint*.38
        ao=ao*(1-pegmask)+(.985-.045*(pg*.5+.5))*pegmask
        ao-=joint*.42
        rough=rough*(1-pegmask)+(.74+.025*pg)*pegmask
    # Fix exact outer margin after all stamping.
    clean=edge<=3
    color[clean]=rim
    height[clean]=4.4+1.6*(np.sin(edge[clean]/22*np.pi/2))**.55
    checks[clean]=0; pores[clean]=0
    orm=np.stack([np.clip(ao,.12,1),np.clip(rough,.62,.96),np.zeros(shape)],-1)*255
    return color.astype(np.float32),height.astype(np.float32),orm.astype(np.float32),dict(check=checks,peg=pegmask,pores=pores)


def iron_band(index,height_px):
    rng=np.random.default_rng(SEED+15000+index*367)
    shape=(height_px,N); y,x=np.mgrid[:height_px,:N].astype(np.float32)
    edge=np.minimum(y,height_px-1-y)
    slow=fbm(rng,shape,[80,27,9],[.65,.27,.10],True)
    scale=fbm(rng,shape,[17,5,1.6,.55],[.49,.29,.16,.07],True)
    granular=noise(rng,shape,.6,True)
    # Overlapping hammer impressions; shallow planar bottoms, softened shoulders.
    facets=np.zeros(shape,np.float32)
    for k in range(int(N*height_px/840)):
        cx=rng.uniform(0,N); cy=rng.uniform(-14,height_px+14)
        rx=rng.uniform(12,37); ry=rng.uniform(8,26); ang=rng.uniform(0,np.pi)
        pad=int(max(rx,ry)*1.65)+3
        xs=np.arange(int(cx)-pad,int(cx)+pad+1); ys=np.arange(max(0,int(cy)-pad),min(height_px,int(cy)+pad+1))
        if len(ys)==0: continue
        dx=xs[None,:]-cx; dy=ys[:,None]-cy
        u=(dx*np.cos(ang)+dy*np.sin(ang))/rx
        v=(-dx*np.sin(ang)+dy*np.cos(ang))/ry
        rr=(np.abs(u)**2.6+np.abs(v)**2.6)**(1/2.6)
        dent=(1-smooth(.56,1.18,rr))*(rng.uniform(.07,.25)+u*rng.uniform(-.045,.045)+v*rng.uniform(-.04,.04))
        facets[np.ix_(ys,xs%N)]-=dent
    facets=gaussian_filter(facets,.65,mode=('reflect','wrap'))
    wavex=noise(rng,(1,N),5,True)[0]
    edgewidth=4.4+1.6*np.clip(wavex,-1,1)
    bevel=1-smooth(0,edgewidth[None,:]+1.5,edge)
    h=6.0+.095*slow+facets+.016*scale+.007*granular-.62*bevel
    # Forge-scale thickness follows hammer relief without directional shading.
    facet_tone=np.clip((facets-facets.mean())/(facets.std()+1e-6),-2,2)
    high=smooth(-.10,.10,facets-gaussian_filter(facets,11,mode=('reflect','wrap')))
    bare=61.0+2.0*slow+2.0*scale+.9*granular+3.5*facet_tone+1.8*high
    warm=smooth(-.8,1.0,slow+scale*.35)
    color=np.stack([bare-1.5+warm*3.3,bare-.3,bare+1.6-warm*3.5],-1)
    # Thin worn metal along the bevel shoulder; the extreme edge stays blackened.
    edgewear=np.exp(-((edge-(2.4+.40*wavex[None,:]))/1.0)**2)
    edgewear*=.74+.26*smooth(-1,1,scale)
    color+=edgewear[...,None]*13
    jointline=1-smooth(0,1.2,edge)
    color-=jointline[...,None]*22
    ao=np.ones(shape,np.float32)
    rough=.57+.033*scale+.02*slow-.035*high-.12*edgewear
    metal=np.ones(shape,np.float32)
    # Corrosion has physical anchors: lower margins, small pits, recessed stamps.
    # No low-frequency island mask is used to paint rust onto the whole face.
    cavity=smooth(.04,.43,-facets)
    flecks=fbm(rng,shape,[3.2,1.0,.5],[.57,.29,.14],True)
    broken=smooth(0,.9,flecks)
    lower=np.exp(-((height_px-1-y)/(9 if height_px==128 else 13))**1.3)
    lower*=.40+.60*smooth(-.7,.7,scale+slow*.2)
    bloom=cavity*broken*(.68 if index<3 else .82)
    rust_score=np.maximum(lower,bloom)
    pits=np.zeros(shape,np.float32)
    for _ in range(int(N*height_px/90)):
        px=int(rng.integers(N)); py=int(rng.integers(height_px))
        if rng.random()>.06+.16*cavity[py,px]+.20*lower[py,px]: continue
        deposit(pits,px+rng.uniform(-.5,.5),py,rng.uniform(.45,1.65),rng.uniform(.45,1.45),rng.uniform(.10,.58),True)
    pits=np.minimum(pits,.72)
    pit_halo=gaussian_filter(pits,.7,mode=('reflect','wrap'))
    rust_score=np.maximum(rust_score,smooth(.005,.10,pit_halo)*(.4+.6*broken))
    # A few short gravity streaks, only below an existing pit or fastener seat.
    streaks=np.zeros(shape,np.float32)
    for k in range(7 if index<5 else 11):
        px=int(rng.integers(N)); py=int(rng.integers(10,height_px-22))
        deposit(pits,px,py,.9,1.1,.16,True)
        length=rng.uniform(9,30)
        xx=(x-px+N/2)%N-N/2
        down=y-py
        streak=np.exp(-.5*((xx-.035*np.maximum(down,0))/rng.uniform(.7,1.5))**2)
        streak*=smooth(-1,2,down)*(1-smooth(1,length,down))
        streaks=np.maximum(streaks,streak)
    rust_score=np.maximum(rust_score,streaks*.85)
    h-=pits
    # Head stamps added after corrosion so their top face remains sound iron.
    headmask=np.zeros(shape,np.float32); baseao=np.zeros(shape,np.float32)
    heads=[]
    if index in (1,3):
        for i,cx in enumerate(range(128,N,256)):
            cy=(height_px-1)/2
            dx=x-cx; dy=y-cy
            rr=np.hypot(dx,dy)
            if index==1:
                radius=16.384
                q=rr/radius
                mask=1-smooth(radius-.7,radius+.5,rr)
                # Truncated spherical cap with steep but finite shoulder.
                dome=3.2*np.sqrt(np.clip(1-q*q,0,1))
                dome+=.035*np.sin(dx*.38+dy*.47)*np.clip(1-q,0,1)
                based=np.exp(-((rr-radius-1)/2.1)**2)
                rimrust=np.exp(-((rr-radius-3.4)/4.0)**2)
                head_rough=.41+.014*scale
                heads.append({'kind':'domed rivet','x':cx,'y_local':cy,'diameter_mm':16.0,'crown_mm':3.2})
            else:
                # 12 mm forged square, very slightly skewed and chamfered.
                a=(i%3-1)*.038
                u=dx*np.cos(a)+dy*np.sin(a); v=-dx*np.sin(a)+dy*np.cos(a)
                sd=np.maximum(np.abs(u),np.abs(v))
                radius=12.288
                mask=1-smooth(radius-.65,radius+.45,sd)
                crown=np.clip(1-(sd/radius)**3,0,1)**.38
                dome=2.0*crown+(.075*np.sin(dx*.48)+.085*u/radius+.03*scale)*np.clip(1-sd/radius,0,1)
                based=np.exp(-((sd-radius-.9)/1.7)**2)
                rimrust=np.exp(-((sd-radius-3)/3.7)**2)
                head_rough=.46+.02*scale
                heads.append({'kind':'square forged nail','x':cx,'y_local':cy,'width_mm':12.0,'crown_mm':2.0})
            # Patchy corrosion crescent, individually weathered; not a painted washer.
            ang=np.arctan2(dy,dx)
            corrode=.18+.26*np.sin(ang*2+i*2.3)+.24*np.sin(ang*5-i*.8)+.20*scale+.12*granular
            corrode+=.30*smooth(-4,12,dy)
            ringrust=smooth(.08,.66,rimrust*corrode)*(1-mask)
            rust_score=np.maximum(rust_score,ringrust)
            support=6.0+.095*slow+facets
            h=h*(1-mask)+(support+dome)*mask
            headmask=np.maximum(headmask,mask)
            headshade=72+granular*1.0+scale*.85
            hc=np.stack([headshade*.985,headshade,headshade*1.02],-1)
            color=color*(1-mask[...,None])+hc*mask[...,None]
            rough=rough*(1-mask)+head_rough*mask
            baseao=np.maximum(baseao,based*(1-mask)*.49)
    # A soft oxide bloom, with dense corrosion only at the strongest deposits.
    # Broad coverage transitions keep individual pits from becoming painted dots.
    rust=smooth(.12,.70,rust_score)*(1-headmask)
    rust*=1-.90*edgewear
    rust*=1-jointline
    h+=rust*(np.clip(granular,-1.5,2)*.018-.010)*(1-headmask)
    # Rust is deep brown-orange pigment, rough dielectric, never orange paint.
    rust_tone=np.clip(.43+.25*scale+.12*granular-.11*(1-smooth(.65,.95,rust)),0,1)
    dark=np.array([70,45,31]); orange=np.array([105,70,46])
    rust_color=dark+(orange-dark)*rust_tone[...,None]
    color=color*(1-rust[...,None])+rust_color*rust[...,None]
    metal=1-rust
    rough=rough*(1-rust)+(.87+.035*granular)*rust
    ao-=np.clip(pits/.65,0,.6)*.64+baseao
    ao-=np.clip(-facets-.18,0,.6)*.13
    orm=np.stack([np.clip(ao,.15,1),np.clip(rough,.35,.98),metal],-1)*255
    return color,h,orm,dict(rust=rust,pits=pits,head=headmask,baseao=baseao,
                           cavity=cavity,edgewear=edgewear,moisture=np.maximum(lower,np.maximum(pit_halo*20,streaks))),heads


def normal_from_height(height_mm):
    """Domain-aware derivatives. No differences between unrelated atlas regions.
    +X is right, +Y up image, so N=(-dh/dx, +dh/drow, 1).
    Cells clamp at their own edges; iron wraps X and clamps Y.
    """
    normals=np.empty((N,N,3),np.float32)
    regions=[(r*512,(r+1)*512,c*512,(c+1)*512,False) for r in range(2) for c in range(4)]
    regions += [(a,b,0,N,True) for a,b,_ in BANDS]
    for y0,y1,x0,x1,wrap in regions:
        h=height_mm[y0:y1,x0:x1]
        dy=np.gradient(h,MM_PER_PIXEL,axis=0)
        if wrap: dx=(np.roll(h,-1,axis=1)-np.roll(h,1,axis=1))/(2*MM_PER_PIXEL)
        else: dx=np.gradient(h,MM_PER_PIXEL,axis=1)
        v=np.stack([-dx,dy,np.ones_like(h)],-1)
        normals[y0:y1,x0:x1]=v/np.linalg.norm(v,axis=-1,keepdims=True)
    return rgb8((normals*.5+.5)*255)


def main():
    start=time.monotonic()
    base=np.zeros((N,N,3),np.float32); height=np.zeros((N,N),np.float32); orm=np.zeros_like(base)
    masks={k:np.zeros((N,N),np.float32) for k in ['check','peg','pores','rust','pits','head','baseao','cavity','edgewear','moisture']}
    manifest={'revision':3,'seed':SEED,'size_px':[N,N],'metres_per_tile':[1,1],'mm_per_pixel':MM_PER_PIXEL,
              'height_range_mm':HEIGHT_RANGE_MM,'height_zero_mm':0,'normal_convention':'OpenGL +X right, +Y up image, +Z out',
              'palette_srgb':{'E':ENDGRAIN_SRGB.tolist(),'P':PEG_SRGB.tolist(),'I':[48,45,41],'I+':[90,85,75]},
              'palette_note':'Pass 3: end grain and pegs recoloured; iron base and all physical maps unchanged from pass 2.',
              'wood_cells':[],'iron_bands':[],'fasteners':[]}
    for i in range(8):
        c,h,o,m=wood_cell(i); y=(i//4)*512; x=(i%4)*512
        base[y:y+512,x:x+512]=c; height[y:y+512,x:x+512]=h; orm[y:y+512,x:x+512]=o
        for k,v in m.items(): masks[k][y:y+512,x:x+512]=v
        stem=f'endgrain_{i+1:02d}'
        save_rgb(SOURCE/f'{stem}_base.png',base[y:y+512,x:x+512],True)
        Image.fromarray(encode_height(height[y:y+512,x:x+512])).save(SOURCE/f'{stem}_height.png')
        save_rgb(SOURCE/f'{stem}_orm.png',orm[y:y+512,x:x+512])
        manifest['wood_cells'].append({'cell':i+1,'bounds_xyxy':[x,y,x+512,y+512],'kind':WOOD_KINDS[i],
                                       'pith_local_xy':WOOD_CENTERS[i],'peg_local_xy':PEG_CELLS.get(i),
                                       'peg_diameter_mm':25 if i in PEG_CELLS else None})
        print(f'wood {i+1}/8',flush=True)
    for i,(a,b,name) in enumerate(BANDS):
        c,h,o,m,heads=iron_band(i,b-a)
        base[a:b]=c; height[a:b]=h; orm[a:b]=o
        for k,v in m.items(): masks[k][a:b]=v
        stem=f'iron_{i+1:02d}_{name}'
        save_rgb(SOURCE/f'{stem}_base.png',base[a:b],True)
        Image.fromarray(encode_height(height[a:b])).save(SOURCE/f'{stem}_height.png')
        save_rgb(SOURCE/f'{stem}_orm.png',orm[a:b])
        manifest['iron_bands'].append({'band':i+1,'name':name,'rows_inclusive':[a,b-1],'period_x_px':2048})
        for hd in heads:
            hd['y']=hd.pop('y_local')+a
            manifest['fasteners'].append(hd)
        print(f'iron {i+1}/6',flush=True)
    save_rgb(ROOT/'fittings_base.png',base,True)
    Image.fromarray(encode_height(height)).save(ROOT/'fittings_height.png')
    # Quantized PNG is the sole input to final normals.
    saved=np.asarray(Image.open(ROOT/'fittings_height.png'),dtype=np.float32)/65535*HEIGHT_RANGE_MM
    save_rgb(ROOT/'fittings_normal.png',normal_from_height(saved))
    save_rgb(ROOT/'fittings_orm.png',orm)
    # Full-resolution construction masks, not reduced thumbnails.
    for k,v in masks.items(): Image.fromarray(rgb8(v*255)).save(SOURCE/f'{k}_mask.png')
    manifest['build_seconds']=round(time.monotonic()-start,2)
    (SOURCE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Done in {manifest["build_seconds"]}s; wood mean RGB {base[:1024].mean(axis=(0,1),dtype=np.float64)}',flush=True)

if __name__=='__main__': main()
