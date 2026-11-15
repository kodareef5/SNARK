#!/usr/bin/env python3
"""Offline, deterministic set-2 oak atlas builder. Writes only beside this script.

Generated rounded leaf tissue is placed on tilted metric laminae and composed
with a depth buffer at 2x sampling. Moss and fern retain their round-2 sources.
Coordinates: image +y down; tangent +Y up. Relief in millimetres.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'source'
N = 2048
SS = 2
HEIGHT_MM = 160.0
LAYOUT = json.loads((ROOT / 'guide/LAYOUT.json').read_text())
REGIONS = LAYOUT['cells']



def png_save(array, path, srgb=False, description=''):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
        info.add(b'gAMA', (45455).to_bytes(4, 'big'))
    info.add_text('Description', description)
    Image.fromarray(array).save(path, pnginfo=info, compress_level=7)


def largest(mask):
    lab, n = ndi.label(mask)
    hist = np.bincount(lab.ravel()); hist[0] = 0
    return lab == np.argmax(hist)


def leaf_sources():
    a = np.asarray(Image.open(SRC/'rounded_oak_leaves_round3_generated.png').convert('RGBA'))
    out = []
    for row in range(4):
        for col in range(4):
            cut = a[row*a.shape[0]//4:(row+1)*a.shape[0]//4,
                    col*a.shape[1]//4:(col+1)*a.shape[1]//4]
            m = ndi.binary_fill_holes(largest(cut[...,3]>180))
            yy,xx = np.nonzero(m)
            low, high = yy.min(), yy.max()
            # Exclude the small separate petiole from the blade's metric length.
            widths = m.sum(1)
            high = np.flatnonzero(widths>widths.max()*.15)[-1]
            centers=[]; halves=[]
            for y in range(low,high+1):
                xs=np.flatnonzero(m[y])
                centers.append((xs[0]+xs[-1])/2 if len(xs) else centers[-1])
                halves.append((xs[-1]-xs[0]+1)/2 if len(xs) else .1)
            centers=ndi.gaussian_filter1d(np.array(centers),3)
            halves=ndi.gaussian_filter1d(np.array(halves),1.25)
            t=np.linspace(0,1,256); y=high-t*(high-low)
            c=np.interp(y-low,np.arange(len(centers)),centers)
            h=np.interp(y-low,np.arange(len(halves)),halves)
            v=np.linspace(-.96,.96,64)
            sx=c[:,None]+h[:,None]*v; sy=np.broadcast_to(y[:,None],sx.shape)
            tex=np.stack([ndi.map_coordinates(cut[...,k].astype(float),[sy,sx],order=1) for k in range(3)],-1)
            broad=ndi.gaussian_filter(tex,(22,10,0))
            # Remove illumination, preserve fine tissue pigment. The central
            # vein is re-authored in the same coordinates as the height ridge.
            tissue=np.clip((tex-broad)*.38,-12,12)
            shape=h/h.max()
            shape*=np.minimum(1,t*14)*np.minimum(1,(1-t)*24)
            out.append(dict(shape=shape.astype(np.float32),tissue=tissue.astype(np.float32)))
    return out


class Canvas:
    def __init__(self,w,h,ss=SS):
        self.ss=ss; self.w=w; self.h=h
        shape=(h*ss,w*ss)
        self.z=np.full(shape,-100.,np.float32)
        self.rgb=np.zeros((*shape,3),np.float32)
        self.rough=np.full(shape,.86,np.float32)
        self.ids=np.zeros(shape,np.uint16)
        self.kind=np.zeros(shape,np.uint8)
        self.layers=np.zeros(shape,np.uint8)

    def put(self,x0,y0,mask,z,rgb,rough,ident,kind):
        h,w=mask.shape; sl=np.s_[y0:y0+h,x0:x0+w]
        old=self.z[sl]; active=mask & (z>=old)
        self.layers[sl]+=mask.astype(np.uint8)
        old[active]=np.broadcast_to(z,mask.shape)[active]
        self.rgb[sl][active]=np.broadcast_to(rgb,(*mask.shape,3))[active]
        self.rough[sl][active]=np.broadcast_to(rough,mask.shape)[active]
        self.ids[sl][active]=ident; self.kind[sl][active]=kind

    def segment(self,p,q,r0,r1,z0,z1,color,rough=.85,ident=1,kind=1):
        p=np.asarray(p);q=np.asarray(q); d=q-p; length2=float(d@d)
        if length2<.0001:return
        lo=np.maximum(np.floor((np.minimum(p,q)-max(r0,r1)-2)*self.ss).astype(int),0)
        hi=np.minimum(np.ceil((np.maximum(p,q)+max(r0,r1)+2)*self.ss).astype(int),[self.w*self.ss,self.h*self.ss])
        x0,y0=lo;x1,y1=hi
        if x1<=x0 or y1<=y0:return
        y,x=np.mgrid[y0:y1,x0:x1].astype(np.float32)
        x=(x+.5)/self.ss; y=(y+.5)/self.ss
        t=np.clip(((x-p[0])*d[0]+(y-p[1])*d[1])/length2,0,1)
        dist=np.hypot(x-p[0]-t*d[0],y-p[1]-t*d[1]); r=r0+(r1-r0)*t
        mask=dist<r
        crown=np.sqrt(np.maximum(0,1-(dist/np.maximum(r,.01))**2))
        z=z0+(z1-z0)*t+crown*np.minimum(r,2.)*.5
        grain=.025*np.sin(t*np.sqrt(length2)*1.7+dist*4)
        rgb=np.array(color)*(1+grain[...,None])
        self.put(x0,y0,mask,z,rgb,rough,ident,kind)

    def curve(self,points,r0,r1,z0,z1,color,rough=.85,ident=1,kind=1):
        points=np.asarray(points,float)
        t=np.linspace(0,1,17)[:,None]
        line=(1-t)**3*points[0]+3*(1-t)**2*t*points[1]+3*(1-t)*t*t*points[2]+t**3*points[3]
        for i in range(len(line)-1):
            a=i/(len(line)-1);b=(i+1)/(len(line)-1)
            self.segment(line[i],line[i+1],r0+(r1-r0)*a,r0+(r1-r0)*b,z0+(z1-z0)*a,z0+(z1-z0)*b,color,rough,ident,kind)

    def finish(self):
        mask=self.ids>0
        # Full-cell nearest-tissue padding, not just a narrow dilation ring.
        _,ix=ndi.distance_transform_edt(~mask,return_indices=True)
        def fill(a):
            b=a.copy(); b[~mask]=a[tuple(ix[:,~mask])]; return b
        def down(a):
            s=self.ss
            if a.ndim==2:return a.reshape(self.h,s,self.w,s).mean((1,3))
            return a.reshape(self.h,s,self.w,s,a.shape[-1]).mean((1,3))
        rgb=down(fill(self.rgb));z=down(ndi.gaussian_filter(fill(self.z),.38*self.ss))
        rough=down(fill(self.rough))
        alpha=down(ndi.gaussian_filter(mask.astype(np.float32),.38*self.ss))
        ids=self.ids[self.ss//2::self.ss,self.ss//2::self.ss]
        kind=self.kind[self.ss//2::self.ss,self.ss//2::self.ss]
        layers=down(self.layers.astype(np.float32))
        return dict(rgb=rgb,z=z,rough=rough,alpha=alpha,ids=ids,kind=kind,layers=layers)




def fern_cell():
    """Larger pinnate blades, arched from the foot; 0.8 m overall silhouette.

    Round 2's 30–60 cm applies to the leafy blades. Petioles extend the two
    tallest fronds beyond 60 cm to reconcile the requested 0.8 m tuft height.
    Both blade and complete frond lengths are recorded without conflating them.
    """
    raw=np.asarray(Image.open(SRC/'fern_fronds_generated.png').convert('RGBA'))
    sources=[]
    for i in range(4):
        cut=raw[:,i*raw.shape[1]//4:(i+1)*raw.shape[1]//4]
        mask=largest(cut[...,3]>160)
        ys,xs=np.nonzero(mask);box=(xs.min(),ys.min(),xs.max()+1,ys.max()+1)
        x0,y0,x1,y1=box;mask=mask[y0:y1,x0:x1]
        col=cut[y0:y1,x0:x1,:3].astype(float)
        _,ix=ndi.distance_transform_edt(~mask,return_indices=True)
        col[~mask]=col[tuple(ix[:,~mask])]
        broad=ndi.gaussian_filter(col,(16,7,0))
        texture=(col-broad)*.44+(broad-np.mean(broad[mask],axis=0))*.18
        dist=ndi.distance_transform_edt(mask)
        lum=np.sum(col*np.array([.2126,.7152,.0722]),axis=-1)
        ridge=np.maximum(0,lum-ndi.gaussian_filter(lum,2.8))/45
        root_x=float(np.mean(np.nonzero(mask[-5:])[1]))/(mask.shape[1]-1)
        sources.append(dict(mask=mask,texture=texture,dist=dist,ridge=ridge,root_x=root_x))
    placements=[(825,-91,1),(755,-103,0),(715,-78,0),(650,-112,0),
                (640,-73,1),(615,-97,2),(590,-83,0),(560,-111,3),
                (535,-70,0),(500,-108,0),(470,-73,3),(440,-88,2),
                (425,-107,0),(410,-68,3),(405,-116,0)]
    canvas=Canvas(512,1024)
    rng=np.random.default_rng(142605)
    records=[]
    for i,(total,degrees,source_index) in enumerate(placements):
        source=sources[source_index];angle=np.deg2rad(degrees)
        d=np.array([np.cos(angle),np.sin(angle)]);perp=np.array([-d[1],d[0]])
        root=np.array([254+rng.uniform(-9,9),1027.])
        L=min(610.,total*.76);W=L*rng.uniform(.20,.235)
        base=root+d*(total-L);cx,cy=base;tip=base+L*d
        lift=2.1+i*.10
        canvas.curve([root,root+d*(total*.08)+perp*7,base-d*12,base],
            2.5,1.0,lift-.8,lift,[89,113,53],.92,31000+i,4)
        canvas.segment(base,base+d*4,1.1,.8,lift,lift,[89,113,53],.92,31000+i,4)
        lo=np.maximum(np.floor((np.minimum(base,tip)-W*.7-3)*SS).astype(int),0)
        hi=np.minimum(np.ceil((np.maximum(base,tip)+W*.7+3)*SS).astype(int),[512*SS,1024*SS])
        x0,y0=lo;x1,y1=hi
        y,x=np.mgrid[y0:y1,x0:x1].astype(np.float32)
        delta=np.stack([(x+.5)/SS-cx,(y+.5)/SS-cy],-1)
        t=np.sum(delta*d,axis=-1)/L;v=np.sum(delta*perp,axis=-1)/W+source['root_x']
        h,w=source['mask'].shape
        sy=(1-t)*(h-1);sx=v*(w-1)
        uv=[sy,sx]
        inside=(t>=0)&(t<=1)&(v>=0)&(v<=1)
        a=ndi.map_coordinates(source['mask'].astype(float),uv,order=1,mode='constant')
        mask=inside&(a>=.5)
        tissue=np.stack([ndi.map_coordinates(source['texture'][...,k],uv,order=1,mode='nearest') for k in range(3)],-1)
        color=np.array([79,116,53])
        if source_index==1:color=np.array([57,91,48])
        if source_index==2:color=np.array([129,155,67])
        color=color*rng.uniform(.95,1.04)+tissue
        distance=ndi.map_coordinates(source['dist'],uv,order=1)*L/h
        vein=ndi.map_coordinates(source['ridge'],uv,order=1)
        z=lift+np.minimum(distance,4.5)*.24+.28*np.clip(vein,0,1)+.7*np.sin(np.clip(t,0,1)*np.pi)
        canvas.put(x0,y0,mask,z,color,.92,31000+i,4)
        records.append(dict(id=31000+i,base=base.tolist(),length_px=L,blade_length_mm=L*1000/1024,frond_length_mm=total*1000/1024,
                            angle_degrees=degrees,width_px=float(W),source=source_index))
    (SRC/'fern_composition.json').write_text(json.dumps(dict(card_height_mm=1000,blades=records,
        interpretation='Round 2: 30–60 cm leafy blades. Petioles bring the upright silhouette to about 0.8 m; complete lengths are recorded separately.'),indent=2)+'\n')
    result=canvas.finish()
    allowed=np.zeros(result['alpha'].shape,bool)
    allowed[12:,12:-12]=True
    allowed[-12:]=False;allowed[-12:,232:280]=True
    metadata=json.loads((SRC/'fern_composition.json').read_text())
    metadata['nonzero_alpha_outside_allowed_before_finalization']=int(np.sum((result['alpha']>0)&~allowed))
    (SRC/'fern_composition.json').write_text(json.dumps(metadata,indent=2)+'\n')
    return result



def resized(a, shape):
    """Float channel resampling, width and height explicit."""
    if a.ndim==3:
        return np.stack([resized(a[...,k],shape) for k in range(a.shape[-1])],-1)
    return np.asarray(Image.fromarray(a.astype(np.float32)).resize(shape,Image.Resampling.LANCZOS)).copy()


def pad(a,mask):
    _,ix=ndi.distance_transform_edt(~mask,return_indices=True)
    out=a.copy();out[~mask]=a[tuple(ix[:,~mask])]
    return out


def moss_cell():
    src=np.asarray(Image.open(SRC/'dense_moss_generated.png').convert('RGBA')).astype(float)
    a=src[...,3]/255;m=a>.35;yy,xx=np.nonzero(m)
    x0,x1=xx.min(),xx.max()+1;y1=yy.max()+1
    raw=src[:y1,x0:x1,:3];a=a[:y1,x0:x1]
    raw=pad(raw,a>.5)
    a=np.clip(resized(a,(472,1006)),0,1)
    raw=resized(raw,(472,1006))
    # Retain tresses, eliminate low-alpha generator matte haze.
    a=np.clip((a-.16)/.78,0,1)
    lum=np.sum(raw*np.array([.2126,.7152,.0722]),axis=-1)
    detail=lum-ndi.gaussian_filter(lum,8)
    yr=np.linspace(0,1,1006)[:,None]
    tips=np.clip((detail-4)/30,0,1)*(.3+.7*yr)
    rgb=np.array([146.,156.,135.])+tips[...,None]*np.array([41.,36.,30.])
    rgb+=np.clip(detail,-25,25)[...,None]*.12
    alpha=np.zeros((1024,512));alpha[:1006,20:492]=a
    col=np.zeros((1024,512,3));col[:1006,20:492]=rgb
    d=ndi.distance_transform_edt(alpha>.5)
    z=1.4+np.minimum(d,2.5)*.23+ndi.gaussian_filter(alpha,5)*.6
    relief=np.zeros_like(alpha);relief[:1006,20:492]=np.clip(detail/25,-1,1)*.25
    z+=relief
    kind=np.full(alpha.shape,3,np.uint8)
    return dict(rgb=col,z=z,alpha=alpha,rough=np.full(alpha.shape,.95),kind=kind,
                ids=np.zeros(alpha.shape,np.uint16),layers=alpha,
                ao=np.clip(.96-.12*ndi.gaussian_filter(alpha,6)-np.maximum(0,-relief)*.18,.70,1))


def lamina(canvas, rec, source, mmpp, periodic=False):
    """Rasterize a metric tilted leaf, z-tested against every earlier leaf.

    Blade length is the painted projection; rise is projection*tan(tilt).
    There is no perimeter darkening or nearest-shoot domain anywhere.
    """
    angle=rec['angle']; tilt=np.deg2rad(rec['tilt_degrees'])
    length=rec['length_mm']/mmpp
    width=rec['width_mm']/mmpp
    d=np.array([np.cos(angle),np.sin(angle)]);perp=np.array([-d[1],d[0]])
    rise=rec['length_mm']*np.tan(tilt)*rec['tilt_sign']
    center=np.array(rec['center_mm'])/mmpp
    offsets=[(0,0)]
    if periodic:
        offsets=[(ox,oy) for ox in (-canvas.w,0,canvas.w) for oy in (-canvas.h,0,canvas.h)]
    for ox,oy in offsets:
        c=center+[ox,oy];extent=(length+width)*.55+3
        lo=np.maximum(np.floor((c-extent)*canvas.ss).astype(int),0)
        hi=np.minimum(np.ceil((c+extent)*canvas.ss).astype(int),[canvas.w*canvas.ss,canvas.h*canvas.ss])
        x0,y0=lo;x1,y1=hi
        if x1<=x0 or y1<=y0:continue
        yy,xx=np.mgrid[y0:y1,x0:x1].astype(np.float32)
        dx=(xx+.5)/canvas.ss-c[0];dy=(yy+.5)/canvas.ss-c[1]
        t=(dx*d[0]+dy*d[1])/length+.5;tc=np.clip(t,0,1)
        cross=dx*perp[0]+dy*perp[1]-rec['bend_mm']/mmpp*np.sin(np.pi*tc)
        profile=np.interp(tc,np.linspace(0,1,256),source['shape'])
        v=cross/np.maximum(.01,width*.5*profile)
        mask=(t>0)&(t<1)&(np.abs(v)<1)
        if not mask.any():continue
        if not periodic:
            yv,xv=np.nonzero(mask)
            assert (xv.min()+x0)/canvas.ss>=14 and (xv.max()+x0)/canvas.ss<canvas.w-14
            assert (yv.min()+y0)/canvas.ss>=14 and (yv.max()+y0)/canvas.ss<canvas.h-14
        crown=np.maximum(0,1-v*v)*np.sin(np.pi*tc)
        midrib=np.exp(-(cross*mmpp/.7)**2)*np.sin(np.pi*tc)
        z=rec['height_center_mm']+(tc-.5)*rise+rec['cup_mm']*crown+.38*midrib
        tissue=np.stack([ndi.map_coordinates(source['tissue'][...,k],[tc*255,(np.clip(v,-1,1)+1)*31.5],order=1,mode='nearest') for k in range(3)],-1)
        # Pigment is independent of tilt and illumination. Depth is stored per
        # complete lamina; no dark perimeter is painted around the oval.
        rgb=np.array(rec['color'])+tissue*1.3+midrib[...,None]*2.2
        canvas.put(x0,y0,mask,z,rgb,.95,rec['id'],rec['kind'])


def shoot(rng, center, height, ident, tier, card=False, fresh=False):
    count=int(rng.integers(6,10)) if not card else 9
    phase=rng.uniform(-np.pi,np.pi); leaves=[]
    for j in range(count):
        angle=phase+2*np.pi*j/count+rng.uniform(-.20,.20)
        length=float(rng.uniform(105 if card else 80,120))
        width=float(rng.uniform(53 if card else 40,60))
        tilt=float(rng.uniform(20,50)); projected=length
        radial=float(rng.uniform(83,112))
        c=np.array(center)+radial*np.array([np.cos(angle),np.sin(angle)])
        # Off-axis blades and alternating raised/lowered tips break flower symmetry.
        angle+=rng.uniform(-.36,.36)
        half_rise=length*np.tan(np.deg2rad(tilt))*.5
        z=float(np.clip(height+rng.uniform(-7,7),half_rise+5,154-half_rise))
        depth=np.clip((z-47)/63,0,1)
        color=np.array([49.,64.,45.])*(1-depth)+np.array([108.,118.,66.])*depth
        color+=rng.normal(0,4)*np.array([1,.85,.55])
        kind=2;src=int(rng.integers(0,14))
        if fresh and j in [1,3]:color=np.array([135.,145.,74.]);kind=5;src=14
        elif fresh and j==7 and ident%2==0:color=np.array([100.,83.,49.]);kind=6;src=15
        rec=dict(id=ident*10+j+10,shoot=ident,tier=tier,center_mm=c.tolist(),length_mm=length,width_mm=width,
            projected_length_mm=float(projected),surface_length_mm=float(length/np.cos(np.deg2rad(tilt))),angle=float(angle),tilt_degrees=tilt,
            tilt_sign=int(rng.choice([-1,1])),height_center_mm=z,bend_mm=float(rng.uniform(-3,3)),
            cup_mm=float(rng.uniform(.6,1.8)),color=color.tolist(),kind=kind,source=src)
        leaves.append(rec)
    # Maximum pairwise tip separation is the actual projected rosette diameter.
    tips=[]
    for leaf in leaves:
        d=np.array([np.cos(leaf['angle']),np.sin(leaf['angle'])])
        tips.extend([np.array(leaf['center_mm'])+s*.5*leaf['projected_length_mm']*d for s in [-1,1]])
    tips=np.array(tips);diameter=float(np.sqrt(np.max(np.sum((tips[:,None]-tips[None])**2,-1))))
    while diameter<305:
        for leaf in leaves:
            leaf['center_mm']=(np.array(center)+(np.array(leaf['center_mm'])-center)*1.035).tolist()
        tips=[]
        for leaf in leaves:
            d=np.array([np.cos(leaf['angle']),np.sin(leaf['angle'])])
            tips.extend([np.array(leaf['center_mm'])+s*.5*leaf['projected_length_mm']*d for s in [-1,1]])
        tips=np.array(tips);diameter=float(np.sqrt(np.max(np.sum((tips[:,None]-tips[None])**2,-1))))
    return dict(id=ident,center_mm=list(center),height_mm=float(height),tier=tier,
                diameter_mm=diameter,leaf_count=count,leaves=leaves)


def foliage_finish(canvas, periodic, target):
    """Resolve the visible z surface; broad depth controls pooled occlusion."""
    if periodic:
        # The deepest interstices have already received wrapped tissue.
        p={};s=canvas.ss
        def down(a):
            if a.ndim==3:return a.reshape(canvas.h,s,canvas.w,s,3).mean((1,3))
            return a.reshape(canvas.h,s,canvas.w,s).mean((1,3))
        for k,a in [('rgb',canvas.rgb),('z',canvas.z),('rough',canvas.rough),('layers',canvas.layers)]:p[k]=down(a)
        p['ids']=canvas.ids[s//2::s,s//2::s].copy();p['kind']=canvas.kind[s//2::s,s//2::s].copy()
        p['alpha']=np.ones((canvas.h,canvas.w))
        p['z']=ndi.gaussian_filter(p['z'],.5,mode='wrap')
    else:p=canvas.finish()
    mask=p['alpha']>=.5
    # Tonal calibration preserves relative depths and leaf pigment; no lighting.
    p['rgb']+=np.array(target)-p['rgb'][mask].mean(0)
    broad=ndi.gaussian_filter(p['z'],9,mode='wrap' if periodic else 'reflect')
    if periodic:
        # Broaden the existing recess response without moving any leaf. The
        # same periodic depth field supplies the interior's pooled occlusion.
        depth=np.clip((broad-64)/44,0,1)
        p['ao']=.35+.62*depth
    else:
        depth=np.clip((broad-55)/55,0,1)
        p['ao']=.75+.22*depth
    return p


def cluster_pigment(p,cell):
    """Whole-card ecotype pigment; independent of tilt or light direction.

    Preserve twig and brown-leaf colour. Fresh cell-2 tissue remains the
    brightest yellow-green; calibrate the remaining tissue to the card mean.
    Geometry, alpha, height, roughness and occlusion are untouched.
    Round 6 changes only these pigment targets and ceilings. Additive offsets
    retain face-to-face value differences; the engine applies its own tint.
    """
    target=np.array([150.,152.,76.] if cell in [0,2] else [96.,108.,64.])
    visible=p['alpha']>=.5
    fixed=np.isin(p['kind'],[1,6])
    fresh=p['kind']==5
    mutable=visible&~fixed&~fresh
    if fresh.any():
        variation=p['rgb'][fresh]-p['rgb'][fresh&visible].mean(0)
        p['rgb'][fresh]=np.array([183.,180.,90.])+variation*.65
    for _ in range(8):
        correction=(target-p['rgb'][visible].mean(0))*visible.sum()/mutable.sum()
        p['rgb'][~fixed&~fresh]+=correction
        if cell in [0,2]:
            # Bound mature pigment (including mixed leaf-boundary samples),
            # leaving the fresh tips as the brightest oak yellow-green.
            p['rgb'][~fixed&~fresh]=np.minimum(p['rgb'][~fixed&~fresh],[182,179,90])
    return p


def interior_pigment(rec):
    """Darker, relatively bluer pigment for complete existing deep laminae.

    Four depth anchors spread the cool lower-leaf tones over the existing
    shingled strata. No directional gradient, border ink or new geometry.
    """
    anchors=np.array([[34.,44.,34.],[54.,68.,40.],[74.,88.,50.],[86.,98.,62.]])
    for leaf in rec['leaves']:
        z=leaf['height_center_mm'];old_depth=np.clip((z-47)/63,0,1)
        old=np.array([49.,64.,45.])*(1-old_depth)+np.array([108.,118.,66.])*old_depth
        variation=np.array(leaf['color'])-old
        color=np.array([np.interp(z,[40,60,80,100],anchors[:,k]) for k in range(3)])
        leaf['color']=(color+variation*.65).tolist()


def cluster(i,sources):
    rng=np.random.default_rng(83450+i);canvas=Canvas(512,512);mmpp=900/512
    # Full-card canopies: spread the shoot tips without scaling their blades.
    # The nine terminal leaves remain a recognizable rosette; lower shingled
    # leaves support it, just as the unchanged mass uses overlapping strata.
    centers=[[(450,186),(695,375),(585,678),(310,660),(200,350),(450,430)],
             [(225,270),(480,230),(670,370),(225,510),(475,475),(605,615)],
             [(450,202),(680,375),(585,668),(310,650),(200,350),(450,435)],
             [(420,235),(520,395),(370,570),(475,660)]][i]
    records=[]
    canvas.curve([[256,514],[257,493],[250,476],[253,450]],3.4,2.2,6,18,[88,79,54],.85)
    for j,c in enumerate(centers):
        rec=shoot(rng,c,94+rng.uniform(-10,13),j,0,card=True,fresh=(i==2 and j in [0,4]))
        # A canopy rosette contains a terminal whorl and older leaves below it.
        # All supports are complete round-3 laminae, never an opaque backing.
        supports=[]
        for k in range(34):
            a=float(rng.uniform(-np.pi,np.pi));rad=float(150*np.sqrt(rng.random()))
            leaf=dict(rec['leaves'][k%9])
            leaf.update(id=1000+j*100+k,kind=2,source=int(rng.integers(0,14)),
                        center_mm=(np.array(c)+rad*np.array([np.cos(a),np.sin(a)])).tolist(),
                        angle=a+float(rng.uniform(-.7,.7)),length_mm=float(rng.uniform(90,120)),
                        width_mm=float(rng.uniform(45,60)),tilt_degrees=float(rng.uniform(20,50)),
                        tilt_sign=int(rng.choice([-1,1])))
            leaf['projected_length_mm']=leaf['length_mm']
            leaf['surface_length_mm']=leaf['length_mm']/np.cos(np.deg2rad(leaf['tilt_degrees']))
            half=leaf['length_mm']*np.tan(np.deg2rad(leaf['tilt_degrees']))/2
            z=float(np.clip(78+rng.uniform(-12,14),half+5,154-half))
            leaf['height_center_mm']=z
            depth=np.clip((z-47)/63,0,1)
            leaf['color']=(np.array([49.,64.,45.])*(1-depth)+np.array([108.,118.,66.])*depth+rng.normal(0,4)*np.array([1,.85,.55])+np.array([4.,4.,2.])).tolist()
            supports.append(leaf)
        rec['supporting_leaves']=supports
        # Translate whole rosettes if their actual generated leaf tips would
        # enter a gutter. Never clip a blade or rescale it to make it fit.
        bounds=[]
        for leaf in supports+rec['leaves']:
            t=np.linspace(0,1,256);d=np.array([np.cos(leaf['angle']),np.sin(leaf['angle'])]);v=np.array([-d[1],d[0]])
            for side in [-1,1]:
                cross=leaf['bend_mm']*np.sin(np.pi*t)+side*.5*leaf['width_mm']*sources[leaf['source']]['shape']
                bounds.extend(np.array(leaf['center_mm'])+(t[:,None]-.5)*leaf['length_mm']*d+cross[:,None]*v)
        bounds=np.array(bounds);low=bounds.min(0);high=bounds.max(0)
        shift=np.maximum(18*mmpp-low,0)-np.maximum(high-492*mmpp,0)
        rec['margin_translation_mm']=shift.tolist()
        c=np.array(c)+shift;rec['center_mm']=c.tolist()
        for leaf in supports+rec['leaves']:leaf['center_mm']=(np.array(leaf['center_mm'])+shift).tolist()
        records.append(rec)
        canvas.segment([450/mmpp,815/mmpp],np.array(c)/mmpp,1.7,1.0,18,30,[86,81,51],.85,1,1)
        for leaf in supports+rec['leaves']:
            d=np.array([np.cos(leaf['angle']),np.sin(leaf['angle'])])
            base=np.array(leaf['center_mm'])-d*leaf['length_mm']*.48
            canvas.segment(np.array(c)/mmpp,base/mmpp,1.0,.65,32,42,[87,96,55],.85,1,1)
            lamina(canvas,leaf,sources[leaf['source']],mmpp)
    p=foliage_finish(canvas,False,[105,115,65])
    p=cluster_pigment(p,i)
    return p,dict(cell=i,physical_mm_per_pixel=mmpp,shoots=records,
                  nonzero_alpha_outside_allowed_before_finalization=int(np.count_nonzero(p['alpha'][:12])))


def rosette_mass(sources):
    rng=np.random.default_rng(520311);w,h=2048,1024;mmpp=4800/2048
    canvas=Canvas(w,h);records=[]
    # A dark, continuous lowest surface. Its visible holes are covered by
    # several depths of actual large leaves; no cell seams or polygon domains.
    canvas.z[:]=3;canvas.rgb[:]=[39,52,39];canvas.rough[:]=.95;canvas.ids[:]=60000;canvas.kind[:]=2
    hollows=[dict(center_mm=rng.uniform([0,0],[4800,2400]).tolist(),diameter_mm=float(rng.uniform(50,150))) for _ in range(95)]
    for tier,(count,level) in enumerate([(650,50),(230,76),(180,103)]):
        for j in range(count):
            center=rng.uniform([0,0],[4800,2400])
            z=level+rng.uniform(-8,8)
            if tier==2:
                for pool in hollows:
                    delta=(center-np.array(pool['center_mm'])+[2400,1200])%[4800,2400]-[2400,1200]
                    z-=26*np.exp(-2*np.sum(delta**2)/(pool['diameter_mm']*.65)**2)
            rec=shoot(rng,center,np.clip(z,30,112),len(records),tier)
            interior_pigment(rec)
            records.append(rec)
            for leaf in rec['leaves']:lamina(canvas,leaf,sources[leaf['source']],mmpp,True)
        print('  mass depth',tier,'shoots',count,flush=True)
    # Put additional DEEP shoots under uncovered interstices. Aim one complete
    # blade at each sampled gap, rather than spreading edge colour into hollows.
    for pass_index in range(3):
        empty=np.flatnonzero(canvas.ids.ravel()==60000)
        if len(empty)/canvas.ids.size<.0005:break
        chosen=rng.choice(empty,min(220,len(empty)),replace=False)
        for address in chosen:
            py,px=np.unravel_index(address,canvas.ids.shape)
            if canvas.ids[py,px]!=60000:continue
            point=np.array([(px+.5)/canvas.ss*mmpp,(py+.5)/canvas.ss*mmpp])
            rec=shoot(rng,point,35,len(records),-1)
            interior_pigment(rec)
            shift=point-np.array(rec['leaves'][0]['center_mm'])
            rec['center_mm']=(np.array(rec['center_mm'])+shift).tolist()
            for leaf in rec['leaves']:
                leaf['center_mm']=(np.array(leaf['center_mm'])+shift).tolist()
                # Periodic coordinates canonicalized for the bounded raster.
                leaf['center_mm']=(np.array(leaf['center_mm'])%[4800,2400]).tolist()
                lamina(canvas,leaf,sources[leaf['source']],mmpp,True)
            records.append(rec)
        print('  deepest infill pass',pass_index,flush=True)
    # Pad only the last sub-pixel/deepest interstices, periodically, under all
    # visible strata. The measured fraction is included in composition.json.
    bottom=canvas.ids==60000
    bottom_fraction=float(bottom.mean())
    if bottom.any():
        # Only a narrow periodic halo is needed for sub-leaf interstices.
        border=160;mask=np.pad(~bottom,border,mode='wrap')
        _,ix=ndi.distance_transform_edt(~mask,return_indices=True)
        coords=tuple((ix[k,border:-border,border:-border][bottom]-border)%canvas.z.shape[k] for k in range(2))
        for a in [canvas.z,canvas.rgb,canvas.rough,canvas.ids,canvas.kind]:a[bottom]=a[coords]
    p=foliage_finish(canvas,True,[66,78,48])
    # A pigment floor in the deepest tissue, with the requested mean retained.
    # Repeating the offset-and-bound calibration converges below quantization.
    for _ in range(8):
        p['rgb']=np.maximum(p['rgb'],[34,44,34])
        p['rgb']+=np.array([66,78,48])-p['rgb'].mean((0,1))
    return p,dict(physical_mm_per_pixel=mmpp,shoots=records,hollows=hollows,
        deepest_interstice_fraction=bottom_fraction,
        periodic_method='Each leaf geometry wraps at both axes; z-buffer and Gaussian filters wrap; no image seam repair.')


def finalize(p,idx):
    a=p['alpha']
    if idx<4:
        turned=p['kind']==7
        p['rgb'][turned]=np.minimum(p['rgb'][turned],np.array([120.,128.,100.]))
        foliage=p['kind']!=1
        p['rough'][foliage]=np.clip(p['rough'][foliage],.93,.97)
    if idx<6:
        # No visible or low-alpha tissue in the guide's 12 px gutters.
        a[:,:12]=0;a[:,-12:]=0
        if idx!=4:a[:12]=0
        if idx==4:a[-12:]=0
        if idx<4:a[-12:,:246]=0;a[-12:,266:]=0
        if idx==5:a[-12:,:232]=0;a[-12:,280:]=0
        m=a>=.5
        for k in ['rgb','z','rough']:p[k]=pad(p[k],m)
        if 'ao' not in p:
            density=ndi.gaussian_filter(m.astype(float),10)
            cavity=np.clip((ndi.maximum_filter(p['z'],7)-p['z'])/1.5,0,1)
            p['ao']=np.clip(.97-.10*density-.10*cavity,.75,1)
        p['ao']=pad(p['ao'],m)
        p['z']=ndi.gaussian_filter(p['z'],.40)
        p['kind'][a<.005]=0
        p['ids'][a<.005]=0
    else:
        p['z']=ndi.gaussian_filter(p['z'],.40,mode='wrap')
    return p


def normal_from_height(z,region):
    x0,y0,x1,y1=region['box']
    dxmm=region['metres_across']*1000/(x1-x0)
    dymm=region.get('metres_down',region['metres_across'])*1000/(y1-y0)
    if region['what']=='mass':
        dx=(np.roll(z,-1,1)-np.roll(z,1,1))/(2*dxmm)
        dy=(np.roll(z,-1,0)-np.roll(z,1,0))/(2*dymm)
    else:dy,dx=np.gradient(z,dymm,dxmm)
    n=np.stack([-dx,dy,np.ones_like(z)],-1)
    return n/np.linalg.norm(n,axis=-1,keepdims=True)


def main():
    sources=leaf_sources();records=[]
    base=np.zeros((N,N,4),np.uint8);height=np.zeros((N,N),np.uint16)
    orm=np.zeros((N,N,3),np.uint8);kinds=np.zeros((N,N),np.uint8)
    leaf_ids=np.zeros((N,N),np.uint16)
    for i,r in enumerate(REGIONS):
        print('Building',i,r['what'],flush=True)
        if i<4:p,meta=cluster(i,sources);records.append(meta)
        elif i==4:p=moss_cell()
        elif i==5:p=fern_cell()
        else:p,meta=rosette_mass(sources);records.append(meta)
        p=finalize(p,i);x0,y0,x1,y1=r['box'];sl=np.s_[y0:y1,x0:x1]
        for key in ['rgb','alpha','z','rough','ao']:
            assert np.isfinite(p[key]).all(),f'Non-finite {key} in region {i}'
        base[sl][...,:3]=np.clip(np.rint(p['rgb']),0,255).astype(np.uint8)
        base[sl][...,3]=np.rint(p['alpha']*255).astype(np.uint8)
        height[sl]=np.rint(np.clip(p['z']/HEIGHT_MM,0,1)*65535).astype(np.uint16)
        orm[sl][...,0]=np.rint(p['ao']*255).astype(np.uint8)
        orm[sl][...,1]=np.rint(p['rough']*255).astype(np.uint8)
        kinds[sl]=p['kind'];leaf_ids[sl]=p['ids']
    png_save(base,ROOT/'oak_leaves_base.png',True,'Set 2 round 6. Brighter sun-leaf cells 0/2 and lifted shade-leaf cells 1/3. Unchanged geometry, alpha, interior mass, moss and fern. Straight RGBA. Alpha cut 0.5.')
    png_save(height,ROOT/'oak_leaves_height.png',False,'16-bit linear relief; black 0 mm, white 160 mm. Tilted leaf planes, layered shoot tips and pooled recesses.')
    z=np.asarray(Image.open(ROOT/'oak_leaves_height.png')).astype(float)*HEIGHT_MM/65535
    normals=np.zeros((N,N,3),np.uint8)
    for r in REGIONS:
        x0,y0,x1,y1=r['box'];sl=np.s_[y0:y1,x0:x1]
        normals[sl]=np.rint((normal_from_height(z[sl],r)*.5+.5)*255).astype(np.uint8)
    png_save(normals,ROOT/'oak_leaves_normal.png',False,'OpenGL tangent +Y up. (-dH/dx,+dH/drow,1), derived from delivered height at metric scale.')
    png_save(orm,ROOT/'oak_leaves_orm.png',False,'Linear RGB: occlusion, matte roughness, zero metalness.')
    png_save(base,SRC/'composed_master_2048.png',True)
    png_save(kinds,SRC/'material_ids.png')
    png_save(leaf_ids,SRC/'detail_leaf_ids.png')
    manifest=dict(height_range_mm=HEIGHT_MM,layout=LAYOUT,composition=records,
        material_ids={'0':'transparent','1':'twig','2':'oak','3':'moss','4':'fern','5':'fresh oak','6':'brown oak','7':'turned oak'},
        source_method='Round-6 brighter ecotype pigments on unchanged round-4 geometry. Round-5 interior mass and occlusion retained. Full-cell clusters reuse round-3 generated oval tissue and metric tilted laminae. Moss and fern unchanged.',
        pigment=dict(sun_cells=[0,2],shade_cells=[1,3],sun_mean=[150,152,76],shade_mean=[96,108,64],
            fresh_mean=[183,180,90],mature_sun_ceiling=[182,179,90],mass_mean=[66,78,48],mass_pigment_floor=[34,44,34],
            mass_depth_anchors_mm=[40,60,80,100],mass_depth_anchor_rgb=[[34,44,34],[54,68,40],[74,88,50],[86,98,62]],
            mass_ao_depth_interval_mm=[64,108],mass_ao_range=[.35,.97],
            note='Depth anchors are complete-leaf pigments before mean calibration, never a lighting function. Twig and brown colours retained.'))
    (SRC/'composition.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('All four maps saved.',flush=True)


if __name__=='__main__':main()
