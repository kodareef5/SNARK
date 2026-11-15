#!/usr/bin/env python3
"""Fig/banyan set 2, round 3: offline metric leaf assembly, deterministic and local.

Every visible blade has source tissue, its own tilted surface, and a stable visible
identity. Rosettes overlap; no Voronoi domains or perimeter shading. Source
specimens are original built-in imagegen outputs. Never writes outside here.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from scipy.fft import fft2, ifft2

ROOT=Path(__file__).resolve().parent
SRC=ROOT/'source'
N,SS,HEIGHT_MM=2048,2,200.0
LAYOUT=json.loads((ROOT/'guide/LAYOUT.json').read_text())
REGIONS=LAYOUT['cells']

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
    a = np.asarray(Image.open(SRC/'fig_specimens_set2_generated.png').convert('RGBA'))
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
            tissue=np.clip((tex-broad)*.65,-18,18)+.10*(broad-broad.mean((0,1)))
            shape=h/h.max()
            shape*=np.minimum(1,t*22)*np.minimum(1,(1-t)*32)
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
        old=self.z[sl]
        # A blade is a complete shingle. Do not let intersecting tilted planes
        # cut one another into triangular fragments at each pixel.
        active=mask if kind in (2,5,6,7) else mask & (z>=old)
        if kind==1:active &= ~np.isin(self.kind[sl],[2,5,6,7])
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
        alpha=down(ndi.gaussian_filter(mask.astype(np.float32),.48*self.ss,truncate=3))
        ids=self.ids[self.ss//2::self.ss,self.ss//2::self.ss]
        kind=self.kind[self.ss//2::self.ss,self.ss//2::self.ss]
        layers=down(self.layers.astype(np.float32))
        return dict(rgb=rgb,z=z,rough=rough,alpha=alpha,ids=ids,kind=kind,layers=layers)





def root_library():
    a = np.array(Image.open(SRC / 'generated_aerial_roots.png'))
    out = []
    for k in range(4):
        cut = a[:, k*a.shape[1]//4:(k+1)*a.shape[1]//4]
        mask = cut[...,3] > 150
        centers, widths = [], []
        lastc, lastw = cut.shape[1]/2, 8
        for y in range(len(cut)):
            lab, n = ndi.label(mask[y])
            hist = np.bincount(lab); hist[0] = 0
            if n:
                xs = np.flatnonzero(lab == hist.argmax())
                lastc, lastw = xs.mean(), max(1, len(xs)/2)
            centers.append(lastc); widths.append(lastw)
        centers = ndi.gaussian_filter1d(centers, 3)
        widths = ndi.gaussian_filter1d(widths, 3)
        yy = np.linspace(0, len(cut)*.85, 1024)
        cx = np.interp(yy, np.arange(len(cut)), centers)
        hw = np.interp(yy, np.arange(len(cut)), widths)
        sx = cx[:,None]+hw[:,None]*np.linspace(-.72,.72,48)
        sy = np.broadcast_to(yy[:,None],sx.shape)
        tex = np.stack([ndi.map_coordinates(cut[...,c].astype(float),[sy,sx],
                         order=1,mode='nearest') for c in range(3)],-1)
        broad = ndi.gaussian_filter(tex,(25,8,0))
        out.append(np.clip(tex-broad,-25,25)*.5)
    return out


def smooth(a,b,x):
    u=np.clip((x-a)/(b-a),0,1)
    return u*u*(3-2*u)


def pad(a,mask):
    _,idx=ndi.distance_transform_edt(~mask,return_indices=True)
    b=a.copy(); b[~mask]=a[tuple(idx[:,~mask])]
    return b


def draw_leaf(canvas,r,src,mmpp,periodic=False):
    length=r['projected_length_mm']/mmpp; width=r['width_mm']/mmpp
    angle=r['angle']; d=np.array([np.cos(angle),np.sin(angle)]); p=np.array([-d[1],d[0]])
    c0=np.array(r['center_mm'])/mmpp
    offsets=[(0,0)]
    if periodic:
        offsets=[(x,y) for x in [-canvas.w,0,canvas.w] for y in [-canvas.h,0,canvas.h]]
    for off in offsets:
        c=c0+off
        extent=np.abs(d)*length*.5+np.abs(p)*(width*.5+abs(r['bend_mm'])/mmpp)+3
        lo=np.maximum(np.floor((c-extent)*SS).astype(int),0)
        hi=np.minimum(np.ceil((c+extent)*SS).astype(int),[canvas.w*SS,canvas.h*SS])
        x0,y0=lo; x1,y1=hi
        if x1<=x0 or y1<=y0:continue
        yy,xx=np.mgrid[y0:y1,x0:x1].astype(np.float32)
        dx=(xx+.5)/SS-c[0];dy=(yy+.5)/SS-c[1]
        t=(dx*d[0]+dy*d[1])/length+.5;tc=np.clip(t,0,1)
        cross=dx*p[0]+dy*p[1]-r['bend_mm']/mmpp*np.sin(np.pi*tc)
        shape=np.interp(tc,np.linspace(0,1,256),src['shape'])
        v=cross/np.maximum(.005,width*.5*shape)
        mask=(t>0)&(t<1)&(np.abs(v)<1)
        if not mask.any():continue
        if not periodic:
            iy,ix=np.nonzero(mask)
            assert (ix.min()+x0)/SS>=15 and (ix.max()+x0)/SS<canvas.w-15,('side',r)
            assert (iy.min()+y0)/SS>=15 and (iy.max()+y0)/SS<canvas.h-15,('end',r)
        sample=[tc*255,(np.clip(v,-1,1)+1)*31.5]
        tissue=np.stack([ndi.map_coordinates(src['tissue'][...,k],sample,order=1,mode='nearest') for k in range(3)],-1)
        mid=np.exp(-((cross*mmpp)/.80)**2)*np.sin(np.pi*tc)**.4
        cup=np.maximum(0,1-v*v)*np.sin(np.pi*tc)
        rise=r['projected_length_mm']*np.tan(np.deg2rad(r['tilt_degrees']))*r['tilt_sign']
        z=r['height_center_mm']+(tc-.5)*rise+r['cup_mm']*cup
        z+=r['roll_mm']*np.clip(v,-1,1)*np.sin(np.pi*tc)+.55*mid+tissue[...,1]*.012
        # Quiet vein and pigment halves. No light vector or edge darkening.
        rgb=np.array(r['color'])+tissue+mid[...,None]*np.array([6,7,2])
        rgb+=np.tanh(v*4)[...,None]*np.array([.8,1,.45])*r['pigment_halves']
        if r['kind']==6:
            dry=smooth(.84,.97,tc+.02*np.sin(v*13))
            rgb=rgb*(1-dry[...,None])+np.array([122,103,57])*dry[...,None]
        if r['kind']==7:rgb=np.minimum(rgb,[115,125,90])
        rough=np.clip(r['roughness']+tissue[...,1]*.00016,.93,.97)
        canvas.put(x0,y0,mask,z,rgb,rough,r['id'],r['kind'])


def shoot(rng,center,height,ident,tier,variant=0,scale=1.,orientation=None,group=0):
    """Two compressed alternate leaf ranks around one stout terminal shoot.
    They interpenetrate neighbours, never own a bounded disc-shaped patch.
    """
    phase=float(rng.uniform(-np.pi,np.pi) if orientation is None else orientation)
    leaves=[]
    outer=int(rng.integers(8,11));inner=int(rng.integers(5,8))
    for j in range(outer+inner):
        inner_rank=j>=outer;rankj=j-outer if inner_rank else j
        count=inner if inner_rank else outer
        angle=phase+2*np.pi*rankj/count+rng.uniform(-.29,.29)+(1.15 if inner_rank else 0)
        length=float(rng.uniform(140,200)*scale)
        width=float(length*rng.uniform(.48,.67))
        if variant==3 and j%4==1:width*=.56
        radial=float(rng.uniform(34,66) if inner_rank else rng.uniform(100,139))*scale
        direction=np.array([np.cos(angle),np.sin(angle)])
        center_leaf=np.array(center)+direction*radial+rng.normal(0,9,2)*scale
        angle+=float(rng.uniform(-.32,.32))
        # Keep the physical slopes at 20--50 degrees within a 200 mm field.
        tilt=float(rng.uniform(30,min(50,np.degrees(np.arctan(177/length)))))
        half=length*np.tan(np.deg2rad(tilt))*.5
        hc=float(np.clip(height+(9 if inner_rank else -4)+rng.normal(0,7),half+5,193-half))
        color=np.array([83.,100.,57.])+rng.normal(0,5)*np.array([1,.87,.54])
        if tier==0:color=np.array([39.,56.,37.])+rng.normal(0,4)*np.array([1,.8,.45])
        elif tier==1:color=np.array([62.,79.,46.])+rng.normal(0,5)*np.array([1,.85,.5])
        kind=2;source=int(rng.integers(0,12))
        if variant==2 and inner_rank and rankj in [1,3]:
            color=np.array([140.,150.,70.])+rng.normal(0,3);kind=5;source=14 if rankj==1 else 13
            width*=.72
        elif variant==4 and j==3:color=np.array([114.,113.,53.]);kind=6;source=15
        elif variant in [1,3] and j==outer+2:
            color=np.array([106.,117.,81.]);kind=7;source=12
        leaf=dict(id=ident*20+j+10,shoot=ident,major_group=group,tier=tier,
            center_mm=center_leaf.tolist(),projected_length_mm=length,
            surface_length_mm=float(length/np.cos(np.deg2rad(tilt))),width_mm=width,
            angle=angle,tilt_degrees=tilt,tilt_sign=int(rng.choice([-1,1])),height_center_mm=hc,
            cup_mm=float(rng.uniform(2.,5.)),roll_mm=float(rng.uniform(-6,6)),
            bend_mm=float(rng.uniform(-6,6)),pigment_halves=float(rng.uniform(1.2,3.2)),
            color=color.tolist(),roughness=float(rng.uniform(.941,.961)),source=source,kind=kind)
        leaves.append(leaf)
    tips=[]
    for leaf in leaves:
        d=np.array([np.cos(leaf['angle']),np.sin(leaf['angle'])])
        tips.extend([np.array(leaf['center_mm'])+s*.5*leaf['projected_length_mm']*d for s in [-1,1]])
    tips=np.array(tips)
    diam=float(np.max(np.linalg.norm(tips[:,None]-tips[None],axis=-1)))
    return dict(id=ident,center_mm=list(center),height_mm=float(height),tier=tier,major_group=group,
                diameter_mm=diam,leaves=leaves)


def finish_foliage(canvas,periodic,target):
    if not periodic:p=canvas.finish()
    else:
        s=SS;h,w=canvas.h,canvas.w
        def down(a):
            return a.reshape((h,s,w,s)+a.shape[2:]).mean((1,3))
        p={k:down(v) for k,v in [('rgb',canvas.rgb),('z',canvas.z),('rough',canvas.rough),('layers',canvas.layers)]}
        p.update(ids=canvas.ids[1::s,1::s].copy(),kind=canvas.kind[1::s,1::s].copy(),alpha=np.ones((h,w)))
        p['z']=ndi.gaussian_filter(p['z'],.46,mode='wrap')
    m=p['alpha']>=.5
    p['rgb']+=np.array(target)-p['rgb'][m].mean(0)
    mode='wrap' if periodic else 'reflect'
    broad=ndi.gaussian_filter(p['z'],11,mode=mode)
    higher=ndi.maximum_filter(p['z'],size=9,mode=mode)
    cavity=np.clip((higher-p['z'])/100,0,1)
    if periodic:
        # Large low valleys, not thin seam outlines, drive the occlusion field.
        depth=smooth(float(np.percentile(broad,2)),float(np.percentile(broad,86)),broad)
        p['ao']=np.clip(.47+.53*depth-.05*cavity,.45,1)
    else:
        density=ndi.gaussian_filter(m.astype(float),14)
        p['ao']=np.clip(1-.09*density-.16*cavity,.75,1)
    return p


def cluster(i,sources):
    rng=np.random.default_rng(914710+i);canvas=Canvas(512,512);pitch=1200/512
    # Spread complete leafy shoots across the 1.2 m card, retaining the mass's
    # metric blade size. Older, lower blades support each terminal rosette.
    # The diagonal rim spray has a long axis but still reaches three gutters.
    centers=[[(600,270),(905,500),(790,855),(420,900),(275,550),(565,590)],
             [(310,340),(340,680),(620,290),(650,620),(910,540),(850,850)],
             [(590,260),(905,490),(785,865),(410,890),(285,545),(565,590)],
             [(925,270),(795,450),(650,610),(465,755),(290,915)]][i]
    branches=[];records=[]
    canvas.curve([[256,515],[252,491],[258,450],[254,420]],3.5,2.4,12,30,[123,119,92],.94,1,1)
    for j,c in enumerate(centers):
        variant=0
        if i==1 and j in [0,4]:variant=1
        if i==2:variant=2 if j in [0,4] else (4 if j in [1,5] else 0)
        if i==3:variant=3
        rec=shoot(rng,c,103+rng.uniform(-12,10),j,2,variant,group=j//2 if i==1 else j)
        supports=[]
        for k in range(32 if i==2 else 34):
            angle=float(rng.uniform(-np.pi,np.pi));rad=float(200*np.sqrt(rng.random()))
            leaf=dict(rec['leaves'][k%len(rec['leaves'])])
            length=float(rng.uniform(140,200))
            tilt=float(rng.uniform(30,min(50,np.degrees(np.arctan(177/length)))))
            half=length*np.tan(np.deg2rad(tilt))/2
            leaf.update(id=1000+j*100+k,kind=2,source=int(rng.integers(0,12)),
                center_mm=(np.array(c)+rad*np.array([np.cos(angle),np.sin(angle)])).tolist(),
                angle=angle+float(rng.uniform(-.7,.7)),projected_length_mm=length,
                surface_length_mm=float(length/np.cos(np.deg2rad(tilt))),
                width_mm=float(length*rng.uniform(.48,.67)),tilt_degrees=tilt,
                tilt_sign=int(rng.choice([-1,1])),height_center_mm=float(np.clip(96+rng.normal(0,9),half+5,193-half)),
                color=(np.array([81.,98.,56.])+rng.normal(0,5)*np.array([1,.87,.54])).tolist())
            if i==3 and k%4==1:leaf['width_mm']*=.65
            supports.append(leaf)
        rec['supporting_leaves']=supports
        # Fit true generated contours by translating whole shoots. Never scale
        # a leaf or clip foliage against an opaque canopy-shaped backing.
        bounds=[]
        for leaf in supports+rec['leaves']:
            t=np.linspace(0,1,256);d=np.array([np.cos(leaf['angle']),np.sin(leaf['angle'])]);v=np.array([-d[1],d[0]])
            for side in [-1,1]:
                cross=leaf['bend_mm']*np.sin(np.pi*t)+side*.5*leaf['width_mm']*sources[leaf['source']]['shape']
                bounds.extend(np.array(leaf['center_mm'])+(t[:,None]-.5)*leaf['projected_length_mm']*d+cross[:,None]*v)
        bounds=np.array(bounds);low=bounds.min(0);high=bounds.max(0)
        shift=np.maximum(20*pitch-low,0)-np.maximum(high-492*pitch,0)
        rec['margin_translation_mm']=shift.tolist()
        c=np.array(c)+shift;rec['center_mm']=c.tolist()
        for leaf in supports+rec['leaves']:leaf['center_mm']=(np.array(leaf['center_mm'])+shift).tolist()
        records.append(rec)
        join=np.array([600,1000]);base=np.array(c)
        points=[join/pitch,(join*.70+base*.30+[rng.uniform(-50,50),0])/pitch,
                (join*.25+base*.75)/pitch,base/pitch]
        canvas.curve(points,2.2,1.0,27,50,[115,112,84],.94,1,1)
        branches.append(np.array(points).tolist())
        for leaf in supports+sorted(rec['leaves'],key=lambda v:v['height_center_mm']):
            d=np.array([np.cos(leaf['angle']),np.sin(leaf['angle'])])
            root=np.array(leaf['center_mm'])-d*leaf['projected_length_mm']*.47
            canvas.segment(np.array(c)/pitch,root/pitch,.95,.65,45,58,[102,111,65],.95,1,1)
            draw_leaf(canvas,leaf,sources[leaf['source']],pitch)
    p=finish_foliage(canvas,False,[84,100,58])
    return p,dict(region=i,seed=914710+i,physical_mm_per_pixel=pitch,major_groups=3 if i==1 else len(records),shoots=records,twig_curves_px=branches)


def mass(sources):
    rng=np.random.default_rng(402820);w,h=2048,1024;pitch=6400/2048
    canvas=Canvas(w,h);records=[]
    canvas.z[:]=2;canvas.rgb[:]=[34,49,34];canvas.ids[:]=65000;canvas.kind[:]=2;canvas.rough[:]=.95
    # Smooth periodic fields make irregular groups of openings. They have no
    # cell borders and never mask a leaf or draw around a rosette.
    field=ndi.gaussian_filter(rng.normal(0,1,(128,256)),5,mode='wrap')
    field=(field-field.min())/(field.max()-field.min())
    def pool(c):
        return float(ndi.map_coordinates(field,[[c[1]/3200*128],[c[0]/6400*256]],order=1,mode='grid-wrap')[0])
    counts=[560,235,215]
    for tier,(count,level) in enumerate(zip(counts,[48,77,110])):
        for j in range(count):
            center=rng.uniform([0,0],[6400,3200]);v=pool(center)
            if tier==2 and rng.random()<smooth(.45,.73,v)*.70:continue
            if tier==1 and rng.random()<smooth(.63,.85,v)*.35:continue
            z=level+rng.uniform(-8,8)-(max(0,v-.52)*80 if tier else 0)
            rec=shoot(rng,center,z,len(records),tier,scale=float(rng.uniform(.92,1.06)))
            # Deeper top shoots also cool in pigment, leaf by leaf, not along edges.
            if tier==2:
                cool=max(0,v-.44)*34
                for leaf in rec['leaves']:leaf['color']=(np.array(leaf['color'])-[cool,cool*.8,cool*.20]).tolist()
            records.append(rec)
            for leaf in sorted(rec['leaves'],key=lambda v:v['height_center_mm']):draw_leaf(canvas,leaf,sources[leaf['source']],pitch,True)
        print('  mass tier',tier,'rosettes so far',len(records),flush=True)
    bottom=canvas.ids==65000;fraction=float(bottom.mean())
    if bottom.any():
        border=160;filled=np.pad(~bottom,border,mode='wrap')
        _,ix=ndi.distance_transform_edt(~filled,return_indices=True)
        coords=tuple((ix[k,border:-border,border:-border][bottom]-border)%canvas.z.shape[k] for k in range(2))
        for a in [canvas.z,canvas.rgb,canvas.rough,canvas.ids,canvas.kind]:a[bottom]=a[coords]
    p=finish_foliage(canvas,True,[70,84,48])
    upper_ids=[v['id'] for q in records for v in q['leaves'] if v['tier']==2 and v['height_center_mm']>94]
    upper=np.isin(p['ids'],upper_ids)
    top_mean=p['rgb'][upper].mean(0)
    # Match the shared exposed tissue, while preserving the darker mean and
    # irregular pools. This is reflectance calibration, not baked lighting.
    gain=np.clip((np.array([84.,100.,58.])-[70,84,48])/(top_mean-[70,84,48]),.35,1.4)
    p['rgb']=np.array([70,84,48])+(p['rgb']-[70,84,48])*gain
    return p,dict(region=6,seed=402820,physical_mm_per_pixel=pitch,shoots=records,
        deepest_interstice_fraction=fraction,periodic_method='Wrapped individual geometry and periodic depth field; filters wrap. No seam repair.',
        hollow_field=field.tolist())


def root_path(canvas,points,radii,color,ident,source,phase,zbase=9):
    points=np.asarray(points);radii=np.asarray(radii);pitch=1000/512
    lo=np.maximum(np.floor((points.min(0)-radii.max()-2)*SS).astype(int),0)
    hi=np.minimum(np.ceil((points.max(0)+radii.max()+2)*SS).astype(int),[canvas.w*SS,canvas.h*SS])
    x0,y0=lo;x1,y1=hi
    if x1<=x0 or y1<=y0:return
    y,x=np.mgrid[y0:y1,x0:x1]/SS+.5/SS
    dist,ii=cKDTree(points).query(np.stack([x.ravel(),y.ravel()],-1))
    dist=dist.reshape(x.shape);ii=ii.reshape(x.shape);rr=radii[ii]
    mask=dist<=rr;t=ii/(len(points)-1)
    v=(x-points[ii,0])/np.maximum(rr,.01)
    dome=np.sqrt(np.maximum(0,1-(dist/np.maximum(rr,.01))**2))
    uv=[t*1023,(np.clip(v,-1,1)*.5+.5)*47]
    tissue=np.stack([ndi.map_coordinates(source[...,k],uv,order=1,mode='nearest') for k in range(3)],-1)
    fibre=np.sin(v*13+t*34+phase)
    rgb=np.array(color)+tissue+fibre[...,None]*2
    rgb-=smooth(.65,1,t)[...,None]*np.array([13,11,7])
    z=zbase+rr*pitch*dome+.12*fibre+tissue[...,0]*.007
    canvas.put(x0,y0,mask,z,rgb,.90,ident,3)


def roots(sparse,library):
    rng=np.random.default_rng(82311+sparse);canvas=Canvas(512,1024);records=[]
    # Radii are native pixels; 1 px = 1.953125 mm. Tops 0.5--2 cm.
    configs=([(67,1000,9.1,22),(150,921,8.7,-13),(250,990,9.35,20),(350,872,7.8,-35),(437,970,8.8,-19)] if sparse else
       [(44,660,9.2,14),(83,906,10.1,-13),(126,790,8.4,16),(173,990,10.1,-20),
        (221,820,9.8,9),(235,954,9.2,-7),(288,705,7.0,18),(321,980,10.1,1),
        (363,850,9.3,-9),(403,615,6.1,21),(450,956,10.15,-16),(474,775,8.6,-17)])
    for i,(x0,length,diameter_px,drift) in enumerate(configs):
        t=np.linspace(0,1,int(length*4));phase=float(rng.uniform(0,6.283))
        x=x0+drift*t+np.sin(t*7+phase)*8*t+np.sin(t*19+phase)*2.2*t
        if not sparse and i in [4,5]:x=228+9*np.cos(t*length/77+(0 if i==4 else np.pi))+drift*t
        y=-2+(length+2)*t;points=np.stack([x,y],-1)
        # Keep the woody body through most of its length. Early exponential
        # taper becomes disconnected pixels after the game's ordinary mips.
        radii=diameter_px*.5*(1-t**(4.8 if sparse else 4.2))**.69
        radii*=1+.025*np.sin(t*43+phase)*np.sin(np.pi*t)
        radii+=.025
        palette=[[136,124,101],[161,148,124],[108,111,91],[146,136,111]]
        color=np.array(palette[i%4])+rng.uniform(-4,4)
        root_path(canvas,points,radii,color,100+i,library[i%4],phase,9+(i%3)*1.6)
        rec=dict(id=100+i,main=True,top_diameter_mm=diameter_px*1000/512,
                 length_mm=length*2000/1024,points_px=points[::40].tolist(),end_px=points[-1].tolist(),side_roots=[])
        for j,tt in enumerate([.27,.48,.66,.81]):
            if rng.random()<(.50 if sparse else .20):continue
            ix=int(tt*(len(t)-1));start=points[ix];side=-1 if (i+j)%2 else 1
            end=start+[side*rng.uniform(9,22),rng.uniform(60,133)]
            if end[0]<20 or end[0]>492 or end[1]>1005:continue
            u=np.linspace(0,1,600)[:,None];control=start+[side*rng.uniform(9,18),24]
            p=(1-u)**2*start+2*(1-u)*u*control+u*u*end
            r=np.linspace(radii[ix]*.42,.025,len(p))
            root_path(canvas,p,r,color*.91,200+i*5+j,library[i%4],phase+j,8)
            rec['side_roots'].append(dict(points_px=p[::30].tolist(),end_px=end.tolist()))
        records.append(rec)
    p=canvas.finish();m=p['alpha']>=.5
    p['ao']=np.clip(.99-.12*ndi.gaussian_filter(m.astype(float),4),.8,1)
    return p,dict(region=5 if sparse else 4,seed=82311+sparse,main_count=len(configs),paths=records)


def finish_region(p,idx):
    a=np.rint(p['alpha']*255).astype(np.uint8)
    allowed=np.ones(a.shape,bool)
    if idx<6:
        allowed[:,:12]=False;allowed[:,-12:]=False
        if idx<4:
            allowed[:12]=False;allowed[-12:]=False;allowed[-12:,248:264]=True
        else:allowed[-12:]=False
        # All geometry must fit naturally, excluding fractional Gaussian tails.
        p['pre_clear_forbidden_alpha']=int(np.count_nonzero((a>=128)&~allowed))
        assert p['pre_clear_forbidden_alpha']==0,(idx,'geometry in margins')
        a[~allowed]=0
        lab,n=ndi.label(a>=128,np.ones((3,3)))
        if idx<4:
            attached=lab[-1,256];orphan=(lab>0)&(lab!=attached)
            hist=np.bincount(lab.ravel());hist[0]=0;hist[attached]=0
            assert hist.max()<20,(idx,'detached blade',int(hist.max()))
            a[orphan]=np.minimum(a[orphan],127)
        else:
            attached=np.unique(lab[0]);orphan=(lab>0)&~np.isin(lab,attached)
            a[orphan]=np.minimum(a[orphan],127)
        mask=a>=128
        for key in ['rgb','z','rough','ao']:p[key]=pad(p[key],mask)
        p['z']=ndi.gaussian_filter(p['z'],.40)
        p['kind'][a<128]=0;p['ids'][a<128]=0
    else:p['z']=ndi.gaussian_filter(p['z'],.40,mode='wrap')
    p['alpha']=a
    # All nonvisible RGB, including edge alpha, exactly nearest solid colour.
    if idx<4:p['rgb'][p['kind']==7]=np.minimum(p['rgb'][p['kind']==7],[115,125,90])
    p['rgb']=np.clip(np.rint(p['rgb']),0,255).astype(np.uint8)
    if idx<6:p['rgb']=pad(p['rgb'],a>=128)
    assert p['z'].min()>=0 and p['z'].max()<HEIGHT_MM,(idx,p['z'].min(),p['z'].max())
    return p


def continuous_leaf_height(z,ids,periodic=False,iterations=16):
    """Integrate blade slopes with a screened Poisson solve.

    Direct finite differences across two disjoint leaf planes create vertical
    walls and dark ink-like rims. Keep the interior slopes, smoothly join them
    at overlaps, and anchor only the broad depth. Refit visible leaf interiors
    during the solve so the result keeps strong tilt instead of flattening.
    The final normal still comes exclusively from the saved scalar height.
    """
    h,w=z.shape
    if periodic:
        gx=(np.roll(z,-1,1)-np.roll(z,1,1))*.5
        gy=(np.roll(z,-1,0)-np.roll(z,1,0))*.5
    else:gy,gx=np.gradient(z)
    same=(ids==np.roll(ids,1,0))&(ids==np.roll(ids,-1,0))&(ids==np.roll(ids,1,1))&(ids==np.roll(ids,-1,1))
    valid=ndi.binary_erosion(same,iterations=2)&(ids>1)
    if periodic:
        border=64;v=np.pad(valid,border,mode='wrap')
        _,ix=ndi.distance_transform_edt(~v,return_indices=True)
        coords=tuple((ix[k,border:-border,border:-border]-border)%z.shape[k] for k in range(2))
    else:
        _,ix=ndi.distance_transform_edt(~valid,return_indices=True);coords=tuple(ix)
    gx[~valid]=gx[coords][~valid];gy[~valid]=gy[coords][~valid]
    gx[ids<=1]=0;gy[ids<=1]=0;gx*=1.4;gy*=1.4
    probes=[]
    for ident,box in enumerate(ndi.find_objects(ids),1):
        if box is None or ident<=1:continue
        if (box[0].stop-box[0].start)*(box[1].stop-box[1].start)>20000:continue
        yy,xx=np.where(ndi.binary_erosion(ids[box]==ident,iterations=4))
        if len(xx)<30 or min(xx.std(),yy.std())<1.5:continue
        cx=xx-xx.mean();cy=yy-yy.mean();sx=np.sum(cx*cx);sy=np.sum(cy*cy);xy=np.sum(cx*cy)
        det=sx*sy-xy*xy
        if det<1e-6:continue
        wx=(cx*sy-cy*xy)/det;wy=(cy*sx-cx*xy)/det
        vals=z[box][yy,xx];target=np.array([np.sum(wx*vals),np.sum(wy*vals)])
        probes.append((ident,box,yy,xx,wx,wy,target))
    def expand(a):return a if periodic else np.block([[a,a[:,::-1]],[a[::-1],a[::-1,::-1]]])
    H,W=expand(z).shape;kx=2*np.pi*np.fft.fftfreq(W)[None,:];ky=2*np.pi*np.fft.fftfreq(H)[:,None]
    anchor=.012;denom=kx*kx+ky*ky+anchor
    screen=anchor*fft2(expand(ndi.gaussian_filter(z,8,mode='wrap' if periodic else 'reflect')))
    result=z
    for iteration in range(iterations):
        ex=expand(gx);ey=expand(gy)
        if not periodic:ex[:,w:]*=-1;ey[h:]*=-1
        result=ifft2((-1j*kx*fft2(ex)-1j*ky*fft2(ey)+screen)/denom).real[:h,:w]
        correction=np.zeros((int(ids.max())+1,2))
        for ident,box,yy,xx,wx,wy,target in probes:
            vals=result[box][yy,xx];fit=np.array([np.sum(wx*vals),np.sum(wy*vals)])
            correction[ident]=np.clip(target-fit,-4,4)*1.2
        gx+=correction[ids,0];gy+=correction[ids,1]
    # Smoothly contain rare integration extrema. Middle 160 mm stays exactly
    # unchanged; no hard clipped plateaus or independent normal strengthening.
    lo=result<20;hi=result>180
    result[lo]=20-15*np.tanh((20-result[lo])/15)
    result[hi]=180+15*np.tanh((result[hi]-180)/15)
    result[ids==1]=z[ids==1]
    if not periodic:result=pad(result,ids>0)
    return ndi.gaussian_filter(result,.55,mode='wrap' if periodic else 'reflect'),dict(
        method='Screened Poisson integration of interior blade slopes; visible-plane residual correction; C1 soft limit outside 20--180 mm.',
        iterations=iterations,screen_weight=anchor,visible_leaf_slope_constraints=len(probes),
        soft_limited_fraction=float(np.mean(lo|hi)),height_min_mm=float(result.min()),height_max_mm=float(result.max()))


def normal_from_height(z,r):
    x0,y0,x1,y1=r['box'];px=r['metres_across']*1000/(x1-x0)
    py=r.get('metres_down',r['metres_across'])*1000/(y1-y0)
    if r['what']=='mass':
        dx=(np.roll(z,-1,1)-np.roll(z,1,1))/(2*px);dy=(np.roll(z,-1,0)-np.roll(z,1,0))/(2*py)
    else:dy,dx=np.gradient(z,py,px)
    n=np.stack([-dx,dy,np.ones_like(z)],-1)
    return n/np.linalg.norm(n,axis=-1,keepdims=True)


def habitat_palette(p,region,record):
    """Change reflectance by leaf habitat, keeping the accepted assembly exact.

    The assembly above is the pigment/geometry precursor. This pass changes
    only RGB, plus interior AO. No normal, light vector, silhouette, plane,
    roughness or random stream participates in the colour change. Tip pigment
    follows each blade's botanical base-to-tip axis, never an atlas direction.
    """
    rgb=p['rgb'].astype(float);ids=p['ids'];kind=p['kind'];solid=p['alpha']>=128
    leaves=[v for q in record['shoots'] for v in q.get('supporting_leaves',[])+q['leaves']]
    if region<4:
        sun=region in (0,2);target=np.array([110,122,62] if sun else [72,88,58])
        mature=solid&(kind==2)
        rgb[mature]+=([26,22,4] if sun else [-12,-12,0])
        if sun:
            # Add warm pigment at the tips of complete blades. Geometry and
            # tissue remain the accepted leaves; fresh growth is handled below.
            lookup=np.zeros((int(ids.max())+1,5))
            for leaf in leaves:
                x,y=leaf['center_mm'];angle=leaf['angle']
                lookup[leaf['id']]=[x,y,np.cos(angle),np.sin(angle),leaf['projected_length_mm']]
            yy,xx=np.mgrid[:ids.shape[0],:ids.shape[1]]
            x,y,c,s,length=np.moveaxis(lookup[ids],-1,0)
            pitch=record['physical_mm_per_pixel']
            t=(((xx+.5)*pitch-x)*c+((yy+.5)*pitch-y)*s)/np.maximum(length,1)+.5
            tip=smooth(.62,.96,t)*mature
            rgb+=tip[...,None]*[24,20,5]
            fresh=solid&(kind==5);old=solid&(kind==6)
            rgb[fresh]+=[10,8,2]
            rgb[fresh]=np.minimum(rgb[fresh],[155,163,76])
            rgb[old]+=[12,10,0]
        else:
            rgb[solid&(kind==7)]+=[-8,-8,0]
        # Calibrate only mature leaves. Keep twig pigment and the fresh/old/
        # underside distinctions; the target is the entire alpha-cut cell.
        for _ in range(8):
            rgb[mature]+=(target-rgb[solid].mean(0))*solid.sum()/mature.sum()
            if sun:rgb[mature]=np.minimum(rgb[mature],[149,157,73])
        record['habitat_palette']=dict(habitat='sun' if sun else 'shade',mean_target_rgb=target.tolist(),
            tip_axis='Per-leaf botanical base-to-tip coordinates; no lighting direction.',
            fresh_tip_cap_rgb=[155,163,76] if sun else None)
    else:
        # Existing AO pools locate deeper foliage. Pool strength is averaged
        # over each visible leaf, so pigment changes whole leaves, not edges.
        count=np.bincount(ids.ravel(),minlength=int(ids.max())+1)
        leaf_ao=np.bincount(ids.ravel(),weights=p['ao'].ravel(),minlength=len(count))/np.maximum(count,1)
        shift=np.zeros((len(count),3));upper_ids=[]
        for leaf in leaves:
            tier=leaf['tier'];ident=leaf['id']
            pooled=1-smooth(.50,.90,leaf_ao[ident])
            shift[ident]=np.array([[-14,-16,0],[-15,-14,-6],[-12,-12,0]][tier])
            if tier:shift[ident]-=pooled*np.array([8,9,3])
            if tier==2 and leaf['height_center_mm']>94:upper_ids.append(ident)
        rgb+=shift[ids]
        upper=np.isin(ids,upper_ids)
        target=np.array([56.,70.,44.]);top=np.array([72.,88.,58.]);floor=np.array([27.,37.,29.])
        # Calibrate with additive pigment offsets, never contrast gain: the
        # source tissue must not acquire blue flecks as the lower tones cool.
        # Each selection is a set of complete leaf identities. Fit its mean
        # through a smooth floor, always evaluating the original tissue so
        # repeated fitting cannot progressively flatten or lift the hollows.
        other_target=(target-top*upper.mean())/(1-upper.mean())
        for selection,mean in [(upper,top),(~upper,other_target)]:
            tissue=rgb[selection].copy();offset=np.zeros(3)
            for _ in range(12):
                u=(tissue+offset-floor)/1.5
                value=floor+1.5*np.logaddexp(0,u)
                derivative=(1/(1+np.exp(-np.clip(u,-60,60)))).mean(0)
                offset+=(mean-value.mean(0))/np.maximum(derivative,.01)
            rgb[selection]=floor+1.5*np.logaddexp(0,(tissue+offset-floor)/1.5)
        p['ao']=.35+.65*smooth(.12,.95,(p['ao']-.45)/.55)
        record['habitat_palette']=dict(habitat='interior',mean_target_rgb=target.tolist(),
            upper_target_rgb=top.tolist(),deep_pigment_floor_rgb=floor.tolist(),
            occlusion_floor=.35,pool_method='Existing depth pools averaged per visible leaf for pigment; broadened AO response. Geometry unchanged.')
    p['rgb']=np.clip(np.rint(rgb),0,255).astype(np.uint8)
    if region<4:p['rgb']=pad(p['rgb'],solid)
    return p


def main():
    sources=leaf_sources();root_sources=root_library();records=[]
    base=np.zeros((N,N,4),np.uint8);height=np.zeros((N,N),np.uint16);orm=np.zeros((N,N,3),np.uint8)
    kinds=np.zeros((N,N),np.uint8);ids=np.zeros((N,N),np.uint16)
    for i,r in enumerate(REGIONS):
        print('Building',i,r['what'],flush=True)
        if i<4:p,meta=cluster(i,sources)
        elif i<6:p,meta=roots(i==5,root_sources)
        else:p,meta=mass(sources)
        p=finish_region(p,i)
        if i<4 or i==6:p=habitat_palette(p,i,meta)
        if i<4 or i==6:p['z'],meta['height_integration']=continuous_leaf_height(p['z'],p['ids'],i==6)
        meta['forbidden_solid_before_clear']=p.get('pre_clear_forbidden_alpha',0);records.append(meta)
        x0,y0,x1,y1=r['box'];sl=np.s_[y0:y1,x0:x1]
        for k in ['rgb','z','rough','ao']:assert np.isfinite(p[k]).all(),(i,k)
        base[sl][...,:3]=p['rgb'];base[sl][...,3]=p['alpha']
        height[sl]=np.rint(p['z']/HEIGHT_MM*65535).astype(np.uint16)
        orm[sl][...,0]=np.rint(np.clip(p['ao'],0,1)*255).astype(np.uint8)
        orm[sl][...,1]=np.rint(np.clip(p['rough'],0,1)*255).astype(np.uint8)
        kinds[sl]=p['kind'];ids[sl]=p['ids']
        print('  mean',base[sl][...,:3][p['alpha']>=128].mean(0).round(2),'height',p['z'].min(),p['z'].max(),flush=True)
    png_save(base,ROOT/'fig_leaves_base.png',True,'Fig/banyan set 2. Straight sRGB RGBA. Four dense twig clusters, two aerial-root curtains, opaque periodic leaf mass. Alpha cut 0.5.')
    png_save(height,ROOT/'fig_leaves_height.png',False,'Linear 16-bit height. Black = 0 mm, white = 200 mm. Individual tilted leaf laminae, pooled depth and root cylinders.')
    saved=np.asarray(Image.open(ROOT/'fig_leaves_height.png')).astype(float)*HEIGHT_MM/65535
    normal=np.zeros((N,N,3),np.uint8)
    for r in REGIONS:
        x0,y0,x1,y1=r['box'];sl=np.s_[y0:y1,x0:x1]
        normal[sl]=np.rint((normal_from_height(saved[sl],r)*.5+.5)*255).astype(np.uint8)
    png_save(normal,ROOT/'fig_leaves_normal.png',False,'Linear tangent normal, OpenGL +Y image-up. Derived ONLY from delivered height at each region physical scale; mass derivatives wrap.')
    png_save(orm,ROOT/'fig_leaves_orm.png',False,'Linear RGB = occlusion, roughness, metalness (0). Leaves 0.93--0.97; roots 0.90.')
    png_save(base,SRC/'composed_master_2048.png',True)
    png_save(kinds,SRC/'material_ids.png');png_save(ids,SRC/'leaf_ids.png')
    # Inspectable rectified source details, never an additional input.
    tissue=np.concatenate([np.clip(s['tissue']+[84,100,58],0,255).astype(np.uint8) for s in sources],axis=1)
    png_save(tissue,SRC/'rectified_tissue.png',True)
    manifest=dict(height_range_mm=HEIGHT_MM,supersampling=SS,layout=LAYOUT,regions=records,
        material_ids={'0':'transparent','1':'twig','2':'mature fig','3':'aerial root','5':'fresh fig','6':'yellowed fig','7':'turned underside'},
        source_inputs={name:hashlib.sha256((SRC/name).read_bytes()).hexdigest() for name in ['fig_specimens_set2_generated.png','generated_aerial_roots.png']},
        method='Round-3 habitat pigment over the accepted round-2 assembly: cells 0/2 sun leaves, cells 1/3 shade leaves, mass interior with broader deeper occlusion pools. Original source contours, leaf size, alpha, height, normals, roughness and roots unchanged. No directional light in pigment. Per-region habitat_palette records the final colour transform applied to the precursor leaf colours.')
    (SRC/'composition.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Saved all four maps and composed source master.',flush=True)


if __name__=='__main__':main()
