"""Original, deterministic skin paintings in the animal's physical coordinates.

Run after model.py has emitted var/trike-art/layout.npz. Uses no photographs,
third-party textures or ARK imagery. The atlas records a measured mesh; scale
fields, pigment, keratin grain and injury strokes below are authored here.
"""

from pathlib import Path
import hashlib
import json

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[5]
LAYOUT=ROOT/"var/trike-art/layout.npz"
DATA=np.load(LAYOUT)
META=json.loads(LAYOUT.with_suffix(".json").read_text())
REGIONS=np.array([[255,0,0],[0,255,0],[0,0,255],[0,255,255],[255,0,255],[255,255,0],[0,0,0]],np.uint8)


def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)


def mix(a,b,t):
    return np.asarray(a)*(1-t[...,None])+np.asarray(b)*t[...,None]


def noise(x,y,seed=0):
    ix,iy=np.floor(x),np.floor(y);fx=x-ix;fy=y-iy
    fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
    def h(a,b):
        n=np.sin(a*127.1+b*311.7+seed*53.9)*43758.5453
        return n-np.floor(n)
    return ((h(ix,iy)*(1-fx)+h(ix+1,iy)*fx)*(1-fy)+(h(ix,iy+1)*(1-fx)+h(ix+1,iy+1)*fx)*fy)*2-1


def scutes(x,y):
    """Irregular pebble cells with independently staggered centres.

    The difference between the closest two distances finds each true shared
    boundary; a second seed varies the individual scale's pigment/height.
    This avoids a regular hex grid stamped over the whole animal.
    """
    cellx=np.floor(x);celly=np.floor(y)
    first=np.full(x.shape,np.inf);second=first.copy();identity=np.zeros(x.shape)
    def h(a,b,seed):
        n=np.sin(a*127.1+b*311.7+seed*74.7)*43758.5453
        return n-np.floor(n)
    for oy in (-1,0,1):
        for ox in (-1,0,1):
            cx=cellx+ox;cy=celly+oy
            dx=x-(cx+.18+.64*h(cx,cy,1));dy=y-(cy+.18+.64*h(cx,cy,2))
            distance=np.sqrt(dx*dx+dy*dy)
            smaller=distance<first
            second=np.where(smaller,first,np.minimum(second,distance))
            identity=np.where(smaller,h(cx,cy,4),identity)
            first=np.minimum(first,distance)
    dome=smooth(.018,.16,second-first)*(1-.28*smooth(.20,.62,first))
    return dome,identity*2-1


def feature_scutes(x,y):
    """Sparse large scales nested among the pavement scales, not a second grid.

    Each original feature has its own centre, size, elliptical section and
    pigment. The intervening hide keeps the small scales and flexible creases.
    """
    gx,gy=x/.25,y/.25;ix,iy=np.floor(gx),np.floor(gy)
    distance=np.full(x.shape,4.0);identity=np.zeros(x.shape)
    def h(a,b,seed):
        n=np.sin(a*127.1+b*311.7+seed*74.7)*43758.5453
        return n-np.floor(n)
    for oy in (-1,0,1):
        for ox in (-1,0,1):
            a,b=ix+ox,iy+oy
            radius=.21+.13*h(a,b,12)
            dx=(gx-a-.20-.60*h(a,b,22))/radius
            dy=(gy-b-.20-.60*h(a,b,32))/(radius*(.80+.30*h(a,b,42)))
            angle=np.arctan2(dy,dx)
            d=np.sqrt(dx*dx+dy*dy)*(1+.075*np.sin(angle*5+h(a,b,72)*6.28)+.04*np.sin(angle*3+h(a,b,82)*6.28))
            d=np.where(h(a,b,52)>.45,d,4)
            nearer=d<distance;identity=np.where(nearer,h(a,b,62)*2-1,identity)
            distance=np.minimum(distance,d)
    cover=1-smooth(.90,1.025,distance)
    dome=1-.35*smooth(.12,.96,distance)
    return cover,dome,identity


def raster(material,size):
    xyz=np.zeros((size,size,3),np.float32);used=np.zeros((size,size),bool)
    for tri,uv,mat in zip(DATA['triangles'],DATA['uvs'],DATA['materials']):
        if mat!=material:continue
        v=uv.copy()*size;v[:,1]=size-v[:,1]
        x0,y0=np.maximum(0,np.floor(v.min(axis=0)).astype(int));x1,y1=np.minimum(size,np.ceil(v.max(axis=0)).astype(int)+1)
        if x1<=x0 or y1<=y0:continue
        a,b,c=v;det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(det)<1e-8:continue
        y,x=np.mgrid[y0:y1,x0:x1];x=x+.5;y=y+.5
        w0=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det
        w1=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det;w2=1-w0-w1
        mask=(w0>=-.0001)&(w1>=-.0001)&(w2>=-.0001)
        points=DATA['points'][tri]
        xyz[y0:y1,x0:x1][mask]=(w0[...,None]*points[0]+w1[...,None]*points[1]+w2[...,None]*points[2])[mask]
        used[y0:y1,x0:x1]|=mask
    # Padding follows the closest painted texel, preventing dark mip seams.
    indices=distance_transform_edt(~used,return_distances=False,return_indices=True)
    xyz=xyz[indices[0],indices[1]]
    return xyz,used,indices


def skin(p,u,v):
    x,y,z=np.moveaxis(p,-1,0);x=abs(x)
    y=y+META['ground_shift']
    # Every chart samples the same anatomical fields. A chart boundary must
    # not change scale size, wrinkles or pigment across an otherwise continuous
    # surface. Front/back shield projections have distinct islands now.
    frill=smooth(2.05,2.40,y)*smooth(.3,.65,z)*(1-smooth(1.95,2.3,z))
    head=smooth(1.2,1.8,z)*(1-frill)
    legs=(1-smooth(1.2,1.72,y))*smooth(.36,.68,x)*smooth(-2.35,-2.0,z)*(1-smooth(1.05,1.40,z))
    macro=noise(z*1.6,y*1.8,19)*.65+noise(z*4.1,y*4.7,6)*.35
    sections=np.asarray(META['body_sections'])
    cy=np.interp(z,sections[:,0],sections[:,1])
    radius=np.interp(z,sections[:,0],(sections[:,2]*2+sections[:,3]+sections[:,4])/4)
    arc=1.6+np.arctan2(y-cy,x)*radius
    trunk=(1-head)*(1-legs)
    # Blend complete regional fields. Dividing world position by a changing
    # scale size creates very large warped cells at anatomical transitions.
    # Circumferential trunk distance also prevents belly projection collapse.
    tz=z+.008*noise(z*6,y*6,7);ty=arc+.008*noise(z*7,y*7,2)
    td,tn=scutes(tz/.033,ty/.033*1.14)
    hd,hn=scutes((z+.004*noise(z*8,y*7,17))/.022,(y+.004*noise(z*7,y*8,12))/.022*1.14)
    # Fine pavement around movable eyelids/lips contrasts with the broad
    # cheek and sparse shoulder scutes. Blend complete physical fields so a
    # transition never stretches individual cells into bands.
    eye=META['eye_centre']
    orbital=np.exp(-((z-eye[2])/.24)**2-((y-eye[1])/.16)**2)
    lip=np.exp(-((z-2.55)/.52)**2-((y-1.55)/.12)**2)
    fine=np.maximum(orbital,lip)*head
    fd,fn=scutes((z+.002*noise(z*17,y*14,71))/.012,
                 (y+.002*noise(z*14,y*17,72))/.012*1.08)
    hd=hd*(1-fine)+fd*fine;hn=hn*(1-fine)+fn*fine
    ld,ln=scutes((z+.005*noise(z*7,y*7,27))/.027,(y+.005*noise(z*7,y*7,22))/.027*1.14)
    total=np.maximum(trunk+head+legs,1e-6)
    dome=(td*trunk+hd*head+ld*legs)/total
    scale_noise=(tn*trunk+hn*head+ln*legs)/total
    # Blend complete scale fields at the shield junction. Interpolating X/Z
    # projection coordinates there stretched individual cells into ribbons.
    shield_dome,shield_noise=scutes((x+.010*noise(x*6,y*6,8))/.027,
                                    (y+.010*noise(x*6,y*6,9))/.027*1.14)
    # On the finite rim, XY becomes edge-on. A second physical field wraps
    # over its depth; blend complete fields so individual cells never stretch
    # into stripes where the broad shield turns away from the camera.
    radial_distance=np.sqrt((x/1.16)**2+((y-2.12)/np.where(y>=2.12,1.08,.36))**2)
    edge_weight=smooth(.87,.985,radial_distance)
    edge_arc=np.arctan2((y-2.12)/np.where(y>=2.12,1.08,.36),x/1.16)*1.08
    edge_dome,edge_noise=scutes((edge_arc+.004*noise(edge_arc*8,z*8,18))/.028,
                              (z+.004*noise(edge_arc*8,z*8,28))/.028)
    shield_dome=shield_dome*(1-edge_weight)+edge_dome*edge_weight
    shield_noise=shield_noise*(1-edge_weight)+edge_noise*edge_weight
    dome=dome*(1-frill)+shield_dome*frill
    scale_noise=scale_noise*(1-frill)+shield_noise*frill
    height=.38+(.135-.065*head-.018*fine)*dome+.017*macro+.010*scale_noise
    large,large_dome,large_tint=feature_scutes(tz,ty)
    large*=trunk*smooth(1.10,1.50,y)*(1-smooth(2.28,2.57,y))
    # Broad scapular/flank scales have their own silhouette and relief;
    # fine pebbles remain between them and across the articulating skin.
    height=height*(1-large)+(.43+.155*large_dome+.012*large_tint)*large
    height+=.006*noise(z*180,y*180,53)
    # Wrinkles converge at wrists/elbows and under the jaw rather than tiling everywhere.
    joint=np.maximum(np.exp(-((y-.58)/.16)**2),np.exp(-((y-1.12)/.18)**2))*legs
    folds=np.sin(y*75+z*9+noise(z*5,y*3,12)*1.5)
    height+=joint*.035*folds
    # Deep directional folds collect beneath the cheek and across the neck,
    # while shallow radial furrows emphasize the shield's bony supports.
    throat=np.exp(-((z-1.58)/.48)**2-((y-1.52)/.28)**2)*head
    height+=throat*.055*np.sin(z*32+y*12+macro*.3)
    cheek=np.exp(-((z-1.94)/.31)**2-((y-1.76)/.22)**2)*head
    cheek_fold=np.sin((z-1.84)*34+(y-1.74)*13+macro*.4)
    height+=cheek*.035*cheek_fold
    radial=np.arctan2(y-2.05,x+.02)
    height-=frill*.035*np.sin(radial*13+macro*.2)**6
    belly=(1-smooth(1.20,1.82,y))*(1-legs)*(1-frill)
    back=smooth(2.0,2.47,y)*(1-frill)
    # Broken flank bars and a darker nape connect large readable color masses.
    stripe=np.sin(z*5.3+y*2.1+macro*.9)
    bars=smooth(.36,.87,stripe)*smooth(1.30,1.75,y)*(1-smooth(2.05,2.55,y))*(1-frill)
    frill_ink=np.exp(-((x-.64)/.40)**2-((y-2.60)/.43)**2)*frill
    rim=smooth(.72,.98,np.maximum(x/1.25,(y-2.12)/1.06))*frill
    rim_scutes=np.maximum(0,np.cos(radial*14+.2))**6*rim
    height+=.055*rim_scutes
    dust=(1-smooth(.16,.54,y))*legs
    nostril=np.exp(-((z-2.64)/.065)**4-((y-1.83)/.036)**4)*(1-smooth(.23,.29,x))*head
    region=np.zeros(y.shape,np.int8)
    region[belly>.45]=1;region[back>.35]=2;region[frill>.5]=3;region[legs>.5]=4
    rough=np.clip(.79-.13*dome+.08*dust+.055*macro-.025*large,.58,.94)
    # Dyed albedo carries luminance only. Native dye masks supply pigment;
    # tinting a pre-coloured albedo again makes a muddy double tint.
    lum=184+(34-8*fine)*dome+17*macro+12*scale_noise
    lum=lum*(1-large)+(184+49*large_dome+12*large_tint)*large
    lum-=bars*22
    lum+=rim*16+dust*12
    lum-=joint*7*(.5+.5*folds)+throat*9*(.5+.5*np.sin(z*32+y*12+macro*.3))
    lum-=cheek*6*(.5+.5*cheek_fold)
    # Subtle broken freckles bridge the large pigment masses and fine scales.
    freckle=smooth(.40,.77,noise(z*17,y*19,27))*smooth(.15,.65,noise(z*4,y*5,33))
    lum-=freckle*13
    lum=np.clip(lum,126,246)
    color=np.repeat(lum[...,None],3,axis=-1)
    color=mix(color,[28,30,26],nostril*.95)
    occlusion=np.clip(174+76*dome-18*joint*(.5+.5*folds)-22*throat,135,250)
    return color,height,rough,region,occlusion


def skin_masks(p,u,v):
    x,y,z=np.moveaxis(p,-1,0);x=abs(x)
    y=y+META['ground_shift']
    # Continuous physical fields, including atlas borders. No triangle-based
    # region cutoff along the belly, shoulder roots or base of the shield.
    frill=smooth(2.12,2.55,y)*smooth(.35,.65,z)*(1-smooth(2.10,2.40,z))
    limb=(1-smooth(1.08,1.67,y))*smooth(.43,.70,x)*smooth(-2.28,-1.95,z)*(1-smooth(1.0,1.4,z))
    belly=(1-smooth(1.10,1.73,y))*(1-limb)*(1-frill)
    macro=noise(z*1.6,y*1.8,19)*.65+noise(z*4.1,y*4.7,6)*.35
    bars=smooth(.36,.87,np.sin(z*5.3+y*2.1+macro*.9))*smooth(1.30,1.75,y)*(1-smooth(2.05,2.55,y))
    back=np.maximum(smooth(1.96,2.56,y),bars*.48)*(1-frill)*(1-limb)
    # The frill's rust field has a dark base and pale, discontinuous rim;
    # every part remains dyeable through the same continuous six-region mask.
    rim=smooth(.74,1.02,np.maximum(x/1.25,(y-2.12)/1.06)+macro*.025)*frill
    # Original broken charcoal growth bands give the warm shield a readable
    # hierarchy. They are physical pigment, shared by both atlas faces.
    radius=np.sqrt((x/1.16)**2+((y-2.12)/1.08)**2)
    ink=smooth(.42,.78,np.sin(radius*15+noise(x*6,y*6,22)*1.1))
    ink*=frill*.45*(1-rim*.55)
    w=np.stack([(1-belly)*(1-back)*(1-frill)*(1-limb),belly+rim*.50,back+ink,frill*(1-rim*.55)*(1-ink),limb,rim*.20],axis=-1)
    w/=np.maximum(w.sum(axis=-1)[...,None],1e-6)
    return w


def horn(p,u,v):
    x,y,z=np.moveaxis(p,-1,0)
    y=y+META['ground_shift']
    eyes=(u>.79)&(v<.22);beak=(u>.72)&(v>.23)&(v<.74);nails=(u>.72)&(v>.89);oral=(u>.74)&(v>.74)&(v<.89)
    grain=(np.sin(u*175+noise(u*14,v*18,3)*3)+.4*np.sin(u*349+v*7))*(.45+.35*noise(u*24,v*8,21))
    bands=np.sin(v*110+.6*np.sin(u*18))*(.35+.25*noise(u*5,v*15,39))
    tint=smooth(.1,.95,v)
    color=mix([158,130,88],[221,207,165],tint)
    color*= (.96+.025*grain+.028*bands)[...,None]
    color[beak]=np.stack([76+9*grain[beak],70+8*grain[beak],57+7*grain[beak]],axis=-1)
    color[nails]=np.stack([105+8*grain[nails],94+7*grain[nails],72+5*grain[nails]],axis=-1)
    height=.45+.027*grain+.010*bands+.008*noise(u*190,v*130,11)
    rough=.57+.085*noise(u*15,v*13,8)+.035*grain-.11*smooth(.75,1,v);rough[beak]=.50;rough[nails]=.65
    # The eye island includes a nearly-black pupil and warm amber iris. No white eyeball.
    eye=META['eye_centre']
    er=np.sqrt(((z-eye[2])/.035)**2+((y-eye[1])/.034)**2)
    iris=1-smooth(.86,1.05,er)
    pupil=1-smooth(.32,.40,er)
    eye_color=mix([35,29,18],[151,103,36],iris)
    eye_color=mix(eye_color,[8,12,9],pupil*.96)
    color[eyes]=eye_color[eyes];height[eyes]=.5;rough[eyes]=.22
    lum=142+87*tint+12*grain+7*bands+12*noise(u*11,v*2,48)
    lum[beak]=73+8*grain[beak];lum[nails]=102+8*grain[nails]
    color[~eyes]=np.repeat(lum[...,None],3,axis=-1)[~eyes]
    oral_noise=noise(x*35,z*28,41)
    tongue=(u>.74)&(v>.795)&(v<.84)
    tongue_centre=np.exp(-(x/.022)**2)
    # Posterior mucosa and the recessed roof darken into a real throat;
    # the anterior floor remains a quieter brown-red under the tongue.
    rear=1-smooth(1.88,2.55,z)
    oral_colour=np.stack([60+7*oral_noise-17*rear,32+3*oral_noise-9*rear,29+3*oral_noise-7*rear],axis=-1)
    tongue_colour=np.stack([96+10*oral_noise-8*tongue_centre,49+5*oral_noise-4*tongue_centre,41+4*oral_noise-3*tongue_centre],axis=-1)
    oral_colour[tongue]=tongue_colour[tongue]
    roof=(u>.74)&(v>.84)&(v<.89)
    rugae=np.sin(z*58+abs(x)*11)*np.exp(-(x/.25)**4)
    oral_height=.48+.008*oral_noise+.012*rugae*roof
    color[oral]=oral_colour[oral];height[oral]=oral_height[oral];rough[oral]=.70
    root=horn_root(p,u,v)
    living,skin_height,skin_rough,_,_=skin(p,u,v)
    color=color*(1-root[...,None])+living*root[...,None]
    height=height*(1-root)+skin_height*root
    rough=rough*(1-root)+skin_rough*root
    region=np.full(u.shape,5,np.int8);region[eyes|oral]=6
    return color,height,rough,region,np.full(u.shape,238)


def horn_root(p,u,v):
    # The narrow living sheath and keratin share a continuous surface. A
    # physical colour/relief transition avoids painting a jagged remesh
    # intersection as an abrupt pale ring. The rest of each horn stays keratin.
    x=abs(p[...,0])
    return np.where(x<.24,1-smooth(.025,.12,v),1-smooth(.12,.32,v))*(u<.70)


def horn_masks(p,u,v):
    _,_,_,regions,_=horn(p,u,v)
    root=horn_root(p,u,v)
    weights=skin_masks(p,u,v)*root[...,None]
    weights[...,5]+=1-root
    weights[regions==6]=0
    return weights


def injuries(p,skin_material):
    x,y,z=np.moveaxis(p,-1,0);x=abs(x)
    y=y+META['ground_shift']
    n=noise(z*8,y*9,24)
    # Layer alpha is reveal order, not transparency. Keep marks local and
    # irregular; even a low-alpha broad bruise becomes an opaque colour patch
    # by the final hurt stage. Three tapered scores carry smaller edge scuffs.
    wound=np.zeros(x.shape)
    for offset,length in ((-.20,.38),(.04,.46),(.24,.30)):
        axial=np.clip(1-((z+.65)/length)**2,0,1)
        line=abs(y-(1.62+offset+.33*(z+.65)+.005*noise(z*35,y*21,17)))
        width=.016*axial*(.8+.2*noise(z*42,y*27,12))
        support=smooth(0,.14,axial)*smooth(.65,.90,x)
        wound=np.maximum(wound,(1-smooth(width*.38,width+.005,line))*support)
    brow=np.exp(-((z-2.20)/.07)**2-((y-2.10)/.025)**2)*smooth(.35,.50,x)
    wound=np.maximum(wound,brow*.9)
    edge_scuff=smooth(.2,.7,noise(z*68,y*58,34))*smooth(.08,.25,wound)*(1-smooth(.25,.7,wound))
    rgba=np.zeros((*x.shape,4),np.uint8)
    color=mix([113,72,52],[67,27,23],smooth(.25,.85,wound))
    color+=noise(z*120,y*110,3)[...,None]*5
    alpha=np.where(wound>.12,75+160*wound,np.where(edge_scuff>.12,30+70*edge_scuff,0))
    # Keratin does not bleed; the living eye and mouth receive no wound decal.
    if not skin_material:
        alpha=np.zeros_like(alpha)
    rgba[...,:3]=np.clip(color,0,255);rgba[...,3]=np.clip(alpha,0,255)
    decay=np.zeros_like(rgba)
    rot=smooth(-.4,.8,n+np.sin(z*2+y*3)*.35)
    decay[...,:3]=np.clip(mix([83,79,59],[53,58,40],rot),0,255)
    decay[...,3]=np.clip(30+105*rot+(1-smooth(.2,1.4,y))*35,0,255)
    return rgba,decay


def paint_lid_margins(u,v,used,color,height,rough,occlusion):
    # Longitudinal chart coordinates stay aligned to the blink. A thin
    # pigmented margin and the shallow superior fold taper into both canthi.
    for left,upper in ((.49,True),(.61,False)):
        region=used&(u>=left)&(u<=left+.11)&(v>=.18)&(v<=.205)
        along=(u[region]-left)/.11
        across=(v[region]-.18)/.025
        taper=np.sin(np.pi*along)**.7
        field=(1-(1-taper)**3)*(1-smooth(.78,.98,across))
        grains,variation=scutes(along*10+.14*noise(along*8,across*4,54),across*10)
        margin=(1-smooth(.05,.20,across))*taper
        crease=np.exp(-((across-(.40+.09*np.sin(np.pi*along)))/.055)**2)*taper if upper else 0
        value=204+5*grains+3*variation
        color[region]=mix(color[region],np.repeat(value[:,None],3,axis=1),field)
        color[region]*=(1-.45*margin-.07*crease)[:,None]
        height[region]=height[region]*(1-field)+(.417+.010*grains+.002*variation)*field-.014*crease
        rough[region]=rough[region]*(1-margin)+.52*margin
        # The supple lid has shallow pavement. Carrying the cheek's deeper
        # scute occlusion onto this moving surface produces long dark flutes.
        occlusion[region]=occlusion[region]*(1-field)+(222+5*grains)*field-22*margin-7*crease


def write(name,size):
    mat=META['materials'].index(name)
    p,used,indices=raster(mat,size)
    yy,xx=np.mgrid[:size,:size];u=(xx+.5)/size;v=1-(yy+.5)/size
    hide=name in ('trike_skin','trike_frill')
    color,height,rough,region,occlusion=(skin if hide else horn)(p,u,v)
    if name=='trike_skin':
        paint_lid_margins(u,v,used,color,height,rough,occlusion)
    # Bleed final pictures too, not just physical coordinates (some fields use UV islands).
    color=color[indices[0],indices[1]];height=height[indices[0],indices[1]]
    rough=rough[indices[0],indices[1]];region=region[indices[0],indices[1]]
    occlusion=occlusion[indices[0],indices[1]]
    height=gaussian_filter(height,.38)
    dy,dx=np.gradient(height)
    strength=8 if hide else 3.8
    normal=np.stack([-dx*strength,dy*strength,np.ones_like(dx)],axis=-1)
    normal/=np.linalg.norm(normal,axis=-1)[...,None]
    packed=np.stack([occlusion,rough*255,np.zeros_like(rough)],axis=-1)
    if name=='trike_horn':
        # Recessed mouth lining receives little sky. It is soft tissue, not a
        # polished plate reflecting a bright blue patch across the open jaw.
        oral=((u>.74)&(v>.74)&(v<.89))[indices[0],indices[1]]
        cavity=(112-62*(1-smooth(1.90,2.60,p[...,2])))[indices[0],indices[1]]
        packed[...,0][oral]=cavity[oral]
    def save(suffix,data,mode=None,side=None):
        if side and suffix=='regions':
            data=data[::size//side,::size//side].copy();side=None
        img=Image.fromarray(data,mode=mode)
        if side:img=img.resize((side,side),Image.Resampling.NEAREST if suffix=='regions' else Image.Resampling.LANCZOS)
        img.save(HERE/f'{name}_{suffix}.png',compress_level=9)
    save('base',np.clip(color,0,255).astype(np.uint8))
    save('height',(np.clip(height,0,1)*65535).astype(np.uint16))
    save('normal',np.clip((normal*.5+.5)*255,0,255).astype(np.uint8))
    save('packed',np.clip(packed,0,255).astype(np.uint8),side=size//2)
    save('regions',REGIONS[region],side=size//2)
    if hide or name=='trike_horn':
        weights=(skin_masks if hide else horn_masks)(p,u,v)[indices[0],indices[1]]
        for suffix,channels in [('mask',weights[...,:3]),('mask2',weights[...,3:])]:
            # Box average is the native meaning of mask coverage.
            channels=(channels[::2,::2]+channels[1::2,::2]+channels[::2,1::2]+channels[1::2,1::2])*.25
            Image.fromarray(np.clip(channels*255,0,255).astype(np.uint8)).save(HERE/f'{name}_{suffix}.png',compress_level=9)
    hurt,decay=injuries(p,hide)
    hurt=np.array(Image.fromarray(hurt[indices[0],indices[1]]).resize((512,512),Image.Resampling.LANCZOS))
    decay=np.array(Image.fromarray(decay[indices[0],indices[1]]).resize((512,512),Image.Resampling.LANCZOS))
    decay[...,3][hurt[...,3]>0]=0
    Image.fromarray(hurt).save(HERE/f'{name}_hurt.png',compress_level=9)
    Image.fromarray(decay).save(HERE/f'{name}_decay.png',compress_level=9)
    print(name,'painted',size,'coverage',round(float(used.mean()),3))


def saddle():
    size=1024;yy,xx=np.mgrid[:size,:size];u=(xx+.5)/size;v=1-(yy+.5)/size
    grain=noise(u*145,v*145,8);fine=noise(u*390,v*390,14)
    hide=mix([69,38,23],[122,76,42],.5+.25*noise(u*9,v*11,9))
    hide*= (.94+.055*grain+.025*fine)[...,None]
    wood=(u>.5)&(u<.77);rope=u>.77
    rings=np.sin(u*370+3*noise(u*11,v*4,12)+1.2*np.sin(v*18))
    wooden=mix([65,41,21],[143,103,57],smooth(-.9,.6,rings)*.7+.15)
    hide[wood]=wooden[wood]
    braid=np.sin(v*520+u*75)*np.sin(v*520-u*75)
    rope_color=mix([88,70,43],[167,139,91],smooth(-.8,.8,braid))
    hide[rope]=rope_color[rope]
    # Stitches run along the inset edge of the leather atlas, with a subtle
    # impressed channel. Scuffs are pigment, not lighting baked into albedo.
    edge=np.minimum(abs(u-.035),abs(u-.465))
    stitches=(1-smooth(.001,.004,edge))*smooth(-.3,.3,np.sin(v*450))*(u<.49)
    hide=mix(hide,[178,149,100],stitches*.8)
    height=.46+.025*grain+.013*fine+stitches*.035
    height[wood]=.46+.035*rings[wood];height[rope]=.46+.045*braid[rope]
    dy,dx=np.gradient(height);normal=np.stack([-dx*3.8,dy*3.8,np.ones_like(dx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1)[...,None]
    rough=np.where(wood,.65,np.where(rope,.88,.77))
    packed=np.stack([np.full(u.shape,244),rough*255,np.zeros(u.shape)],axis=-1)
    for suffix,values in [('base',np.clip(hide,0,255).astype(np.uint8)),('height',(np.clip(height,0,1)*65535).astype(np.uint16)),
                          ('normal',np.clip((normal*.5+.5)*255,0,255).astype(np.uint8)),('packed',packed.astype(np.uint8)),
                          ('regions',np.zeros((size,size,3),np.uint8))]:
        if suffix in ('packed','regions'):values=values[::2,::2].copy()
        Image.fromarray(values).save(HERE/f'trike_saddle_{suffix}.png',compress_level=9)
    print('trike_saddle painted',size)


if __name__=='__main__':
    write('trike_skin',2048)
    write('trike_horn',1024)
    write('trike_frill',1024)
    saddle()
    files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(HERE.glob('trike_*.png'))}
    (HERE/'manifest.json').write_text(json.dumps({'geometry':META,'paint_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'images':files},indent=2)+'\n')
