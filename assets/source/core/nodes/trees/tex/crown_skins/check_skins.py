#!/usr/bin/env python3
"""Independent delivered-file audit and fixed-camera game-light purpose renders.

Run after build_skins.py. The Python light evaluator mirrors surface.ts with
frozen skyFrame/domeLight data and validates against probes from the actual TS.
All review images and numerical evidence are regenerated in checks/.
"""
from pathlib import Path
import hashlib
import json
import math
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

ROOT=Path(__file__).resolve().parent
SRC=ROOT/'source';OUT=ROOT/'checks';CACHE=ROOT/'.cache'
MIPS={}
FACE_CACHE={}
NAMES=['oak','fig','mangrove']
SPECS={
 'oak':dict(width_m=4.8,height_m=2.4,height_range_mm=220,head_m=3,mean=[117,124,64],sun_mean=[140,142,66],shade_mean=[94,106,62],clump_m=[.84375,1.96875],blade_mm=[105,120]),
 'fig':dict(width_m=6.4,height_m=3.2,height_range_mm=250,head_m=5,mean=[104.5,116.5,59],sun_mean=[125,133,60],shade_mean=[84,100,58],clump_m=[.5*17/12,1.1*17/12],blade_mm=[140,200]),
 'mangrove':dict(width_m=4.,height_m=2.,height_range_mm=200,head_m=3,mean=[92,112,57],sun_mean=[110,128,58],shade_mean=[74,96,56],clump_m=[.3,.6],blade_mm=[130,169])}
FOCAL=1080/(2*np.tan(np.deg2rad(70)/2))
LIGHT=json.loads((SRC/'game_lighting.json').read_text())['hours']
BG=(30,38,38)
ASSERTIONS=[]

def test(name,value,detail=None):
    ASSERTIONS.append(dict(name=name,passed=bool(value),detail=detail))
    if not value:print('FAIL:',name,detail,flush=True)

def u8(a):return np.clip(np.rint(a),0,255).astype(np.uint8)
def linear(a):
    a=np.asarray(a)/255
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
def srgb(a):
    a=np.maximum(a,0)
    return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)*255
def unit(a):return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-9)

def resize(a,size):
    if a.ndim==2:return np.array(Image.fromarray(a.astype(np.float32)).resize(size,Image.Resampling.BOX))
    return np.stack([resize(a[...,k],size) for k in range(a.shape[-1])],-1)

def sample(a,u,v):
    coords=[v*a.shape[0]-.5,u*a.shape[1]-.5]
    if a.ndim==2:return ndi.map_coordinates(a,coords,order=1,mode='grid-wrap')
    return np.stack([ndi.map_coordinates(a[...,k],coords,order=1,mode='grid-wrap') for k in range(a.shape[-1])],-1)

def font(size=16):
    for name in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(name).exists():return ImageFont.truetype(name,size)
    return ImageFont.load_default(size=size)

def label(im,xy,text,size=16,fill=(220,226,220)):
    ImageDraw.Draw(im).text(xy,text,font=font(size),fill=fill)

def save(im,name):
    im.save(OUT/name,**({'quality':94,'subsampling':0} if name.endswith('.jpg') else {}))

def sky_light(n,f):
    t=(.5+.5*n[...,1])[...,None]
    sky=np.array(f['skyBelow'])*(1-t)+np.array(f['skyAbove'])*t
    s=np.array(f['sun']);toward=(n[...,0]*s[0]+n[...,2]*s[2])/np.hypot(s[0],s[2])
    sky+=np.array(f['skySide'])*(1-n[...,1]**2)[...,None]
    sky+=(np.array(f['skySun'])+np.array(f['skyAlong'])*toward[...,None])*toward[...,None]
    return sky

def mirror_light(n,f):
    # v=(0,0,1), reflected vector 2(n.v)n-v.
    r=2*n[...,2:3]*n-np.array([0,0,1])
    theta=np.arccos(np.clip(r[...,1],-1,1));phi=np.arctan2(r[...,2],r[...,0])%(2*np.pi)
    tab=f['mirror_latlong'];arr=np.asarray(tab['rgb']).reshape(tab['height'],tab['width'],3)
    # Wrap azimuth, clamp the two polar rows.
    arr=np.concatenate([arr,arr[:,:1]],1)
    shape=theta.shape
    coords=[np.atleast_1d(theta).ravel()/np.pi*(tab['height']-1),np.atleast_1d(phi).ravel()/(2*np.pi)*tab['width']]
    return np.stack([ndi.map_coordinates(arr[...,k],coords,order=1,mode='nearest') for k in range(3)],-1).reshape((*shape,3))

def illuminate(base,n,orm,hour,macro=None,shadow=False):
    """surface.ts lit + exposure + neutral shoulder; AO touches only the sky.

    Default is software-tier direct illumination, without geometric shadows.
    Optional ellipsoid self-shadow is a separate GPU-style diagnostic.
    """
    f=LIGHT[str(hour)];rough=np.maximum(orm[...,1],.08);a=rough**2;a2=a*a
    nv=np.clip(n[...,2],.001,1)
    sky=sky_light(n,f);mirror=mirror_light(n,f)
    p0=1-nv*np.log(1+1/nv)*a**(.7*rough+2.6*(1-rough)*nv)
    p1=(1-nv)**(5-4*rough)/(1+5*a)**2
    out=orm[...,0,None]*(sky*base+(.04*p0+.96*p1)[...,None]*(mirror*(1-a)[...,None]+sky*a[...,None]))
    for key in ['sun','moon']:
        l=np.array(f[key]);color=np.array(f[key+'Color'])
        nl=np.maximum(np.sum(n*l,axis=-1),0)
        h=unit(l+np.array([0,0,1.]));nh=np.clip(np.sum(n*h,axis=-1),0,1)
        vh=np.clip(h[2],0,1)
        d=nh*nh*(a2-1)+1
        gloss=(a2/(d*d)*.5)/np.maximum(nl*np.sqrt(nv*nv*(1-a2)+a2)+nv*np.sqrt(nl*nl*(1-a2)+a2),1e-9)
        term=color*nl[...,None]*(base+gloss[...,None]*(.04+.96*(1-vh)**5))
        if shadow and macro is not None and key=='sun':term*=((macro*l).sum(-1)>0)[...,None]
        out+=term
    out*=f['exposure']
    peak=out.max(-1);top=np.where(peak<=.8,peak,1-.04/np.maximum(peak-.6,.001))
    white=np.where(peak<=.8,0,1-1/(.15*(peak-top)+1))
    kept=np.where((peak<=.8)[...,None],out,out*top[...,None]/np.maximum(peak[...,None],1e-9))
    return np.clip(kept*(1-white)[...,None]+top[...,None]*white[...,None],0,1)

def normal_decode(raw,engine=False):
    if engine:
        xy=np.clip((raw[...,:2]-128)/127,-1,1)
        return np.concatenate([xy,np.sqrt(np.maximum(1-np.sum(xy*xy,axis=-1,keepdims=True),0))],-1)
    return unit(raw/127.5-1)

def face_ecotypes(x,y,diameter):
    """Game broadleaf.py skin() rule on an irregular triangular test head.

    This deterministic Fibonacci/convex-hull ellipsoid is an isolated material
    fixture, not the game's complete marching-tetrahedra crown. Selection is
    the exact game expression, using average vertex normals and face index.
    """
    key=(diameter,x.shape)
    if key in FACE_CACHE:return FACE_CACHE[key]
    count=math.ceil(4*np.pi*(diameter/2)**2/(.42**2*.866))
    i=np.arange(count,dtype=float);up=1-2*(i+.5)/count
    phase=i*np.pi*(3-np.sqrt(5))+.319
    radius=np.sqrt(1-up*up)
    points=np.stack([radius*np.cos(phase),up*.78,radius*np.sin(phase)],-1)
    # Sorting vertex indices makes face numbering explicit and repeatable.
    faces=sorted(tuple(sorted(f)) for f in ConvexHull(points).simplices)
    normals=unit(points/np.array([1.,.78**2,1.]))
    sx=(points[:,0]-x[0,0])/(x[0,1]-x[0,0])
    sy=(points[:,1]/.78-y[0,0])/(y[1,0]-y[0,0])
    face_ids=np.full(x.shape,-1,np.int32);sun=np.zeros(x.shape,bool)
    depth=np.full(x.shape,-np.inf)
    for f,indices in enumerate(faces):
        a,b,c=indices
        if max(points[[a,b,c],2])<0:continue
        lo=np.maximum(np.floor([min(sx[[a,b,c]]),min(sy[[a,b,c]])]).astype(int),0)
        hi=np.minimum(np.ceil([max(sx[[a,b,c]]),max(sy[[a,b,c]])]).astype(int)+1,[x.shape[1],x.shape[0]])
        if np.any(hi<=lo):continue
        yy,xx=np.mgrid[lo[1]:hi[1],lo[0]:hi[0]]
        den=(sy[b]-sy[c])*(sx[a]-sx[c])+(sx[c]-sx[b])*(sy[a]-sy[c])
        if abs(den)<1e-9:continue
        u=((sy[b]-sy[c])*(xx-sx[c])+(sx[c]-sx[b])*(yy-sy[c]))/den
        v=((sy[c]-sy[a])*(xx-sx[c])+(sx[a]-sx[c])*(yy-sy[c]))/den
        w=1-u-v;z=u*points[a,2]+v*points[b,2]+w*points[c,2]
        sl=np.s_[lo[1]:hi[1],lo[0]:hi[0]]
        hit=(u>=0)&(v>=0)&(w>=0)&(z>depth[sl])
        depth[sl][hit]=z[hit];face_ids[sl][hit]=f
        ny=float(normals[[a,b,c],1].mean())
        sun[sl][hit]=ny+.25*((f*.618034)%1*2-1)>-.05
    FACE_CACHE[key]=(sun,face_ids)
    return sun,face_ids

def render_head(layers,spec,hour,distance=12,cap=2048,flat_normal=False,shadow=True,offset=(.137,.293),ecotype='faces'):
    """Oblate ellipsoid, physical skin UVs, engine RG normal sampling.

    Nine subpixel samples for silhouette AA; texture LOD is chosen at output
    resolution, not the supersampling resolution. Camera looks along -Z.
    """
    diameter=spec['head_m'];pixel_width=round(FOCAL*diameter/distance)
    w=pixel_width+12;h=round(pixel_width*.78)+12;ss=3
    yy,xx=np.mgrid[:h*ss,:w*ss].astype(float)
    x=((xx+.5)/ss-w/2)/(pixel_width/2)
    y=-((yy+.5)/ss-h/2)/(pixel_width/2*.78)
    inside=x*x+y*y<1
    zz=np.sqrt(np.maximum(0,1-x*x-y*y))
    macro=unit(np.stack([x,y/.78,zz],-1))
    lon=np.arctan2(x,np.maximum(zz,1e-7));lat=np.arcsin(np.clip(y,-1,1))
    # Local longitude/latitude in metres. UV-island edge distortion is not
    # claimed to reproduce a specific mesh's unknown per-face unwrap.
    u=lon*diameter*.5/spec['width_m']+offset[0]
    v=-lat*diameter*.5*.78/spec['height_m']+offset[1]
    tangent=unit(np.stack([np.cos(lon),np.zeros_like(lon),-np.sin(lon)],-1))
    bitangent=np.cross(macro,tangent)
    # Build a mip chain and trilinearly sample by projected texel footprint.
    want=FOCAL/distance*spec['width_m']
    target=min(cap,max(8,want))
    lod=np.clip(np.log2(2048/target),0,8)
    ilo=int(np.floor(lod));blend=lod-ilo
    sun_faces,face_ids=face_ecotypes(x,y,diameter)
    inside &= face_ids>=0
    if ecotype=='sun':sun_faces=np.ones_like(inside)
    elif ecotype=='shade':sun_faces=np.zeros_like(inside)
    mip=[]
    for step in [ilo,ilo+1]:
        width=max(4,2048//(2**step));size=(width,width//2)
        cache_key=(id(layers),step)
        if cache_key not in MIPS:
            MIPS[cache_key]={k:resize(linear(layers[k]) if k.endswith('base') else layers[k]/255 if k=='orm' else layers[k],size) for k in ['base','sun_base','shade_base','normal','orm']}
        maps=MIPS[cache_key]
        if ecotype=='mean':b=sample(maps['base'],u,v)
        else:b=np.where(sun_faces[...,None],sample(maps['sun_base'],u,v),sample(maps['shade_base'],u,v))
        nr=sample(maps['normal'],u,v)
        orm=sample(maps['orm'],u,v)
        mip.append((b,nr,orm))
    base,nraw,orm=[a*(1-blend)+b*blend for a,b in zip(*mip)]
    detail=normal_decode(nraw,True)
    n=unit(tangent*detail[...,:1]+bitangent*detail[...,1:2]+macro*detail[...,2:3])
    if flat_normal:n=macro
    light=illuminate(base,n,orm,hour,macro,shadow)
    background=linear(np.array(BG))
    light=np.where(inside[...,None],light,background)
    light=light.reshape(h,ss,w,ss,3).mean((1,3))
    return Image.fromarray(u8(srgb(light))),dict(head_pixels=pixel_width,canvas_pixels=[w,h],
        lod=float(lod),max_texture=cap,ecotype=ecotype,core_self_shadow=shadow,
        sun_visible_fraction=float(sun_faces[inside].mean()),visible_faces=len(np.unique(face_ids[inside])),
        mean_lit_rgb=srgb(light)[light.sum(-1)>background.sum()+.01].mean(0).tolist())

def seam_metrics(a):
    a=a.astype(float)
    result={}
    for axis,name in [(1,'left_right'),(0,'top_bottom')]:
        diff=np.abs(np.roll(a,-1,axis)-a)
        line=np.mean(diff,axis=tuple(i for i in range(diff.ndim) if i!=axis))
        edge=float(line[-1]);interior=float(line[:-1].mean())
        result[name]=dict(edge_mean_abs=edge,interior_mean_abs=interior,ratio=edge/max(interior,1e-12),
                          edge_rank_among_all_cuts=float(np.mean(line<=edge)))
    return result

def read_layers(name):
    return {key:np.array(Image.open(ROOT/f'{name}_skin_{key}.png')).astype(float) for key in ['base','sun_base','shade_base','height','normal','orm']}

def make_layers_sheet(all_layers):
    sheet=Image.new('RGB',(1456,3*650+70),BG)
    label(sheet,(24,18),'CROWN SKINS / paired leaf pigments, one shared geometry',26)
    keys=['sun_base','shade_base','base','height','normal','orm']
    for row,name in enumerate(NAMES):
        a=all_layers[name];y=70+row*650
        label(sheet,(24,y),f'{name.upper()}  /  {SPECS[name]["width_m"]:g} × {SPECS[name]["height_m"]:g} m  /  height 0–{SPECS[name]["height_range_mm"]} mm',20)
        for i,key in enumerate(keys):
            raw=a[key]/257 if key=='height' else a[key]
            im=Image.fromarray(u8(raw)).convert('RGB').resize((460,230),Image.Resampling.LANCZOS)
            x=20+(i%3)*480;yy=y+35+(i//3)*278
            label(sheet,(x,yy),key.upper().replace('_',' '),18)
            sheet.paste(im,(x,yy+28))
        label(sheet,(24,y+612),'Sun / shade share every blade, overlap, height, normal and occlusion. Base = rounded sRGB average.',16)
    save(sheet,'layers.jpg')
    for row,name in enumerate(NAMES):
        save(sheet.crop((0,70+row*650,1456,70+(row+1)*650)),f'{name}_layers.jpg')

def tiling_and_detail(name,a):
    keys=['sun_base','shade_base','base','height','normal','orm']
    sheet=Image.new('RGB',(1600,len(keys)*455+55),BG)
    label(sheet,(18,12),f'{name.upper()} / 2 × 2 repeats and half-period offset — all six maps',23)
    for row,key in enumerate(keys):
        raw=u8(a[key]/257 if key=='height' else a[key]);y=55+row*455
        label(sheet,(18,y),key.upper(),18)
        tile=np.tile(raw,(2,2,1) if raw.ndim==3 else (2,2))
        offset=np.roll(raw,(512,1024),(0,1))
        small=Image.fromarray(tile).convert('RGB').resize((800,400),Image.Resampling.LANCZOS)
        sheet.paste(small,(18,y+32))
        half=Image.fromarray(offset).convert('RGB').resize((740,370),Image.Resampling.LANCZOS)
        sheet.paste(half,(840,y+32));label(sheet,(840,y+412),'Offset 50% X / 50% Y; no edge matching strip',14)
    save(sheet,f'{name}_tiling.jpg')
    spec=SPECS[name];p=int(1200/(spec['width_m']*1000/2048));q=p//2
    patch={k:v[260:260+q,490:490+p] for k,v in a.items()}
    n=normal_decode(patch['normal'],True)
    detail=Image.new('RGB',(1500,740),BG)
    for row,key in enumerate(['sun_base','shade_base']):
        panels=[u8(patch[key])]+[u8(srgb(illuminate(linear(patch[key]),n,patch['orm']/255,h))) for h in [10,17]]
        for i,(image,title) in enumerate(zip(panels,['Unlit','10:00 / normal-lit','17:00 / normal-lit'])):
            label(detail,(i*500+14,15+row*340),key.replace('_base','').upper()+' / '+title,21)
            detail.paste(Image.fromarray(image).resize((490,245),Image.Resampling.LANCZOS),(i*500+5,65+row*340))
    label(detail,(15,710),'Each panel: same 1.2 × 0.6 m patch. No exposure adjustment; enlargement is for inspection.',17)
    save(detail,f'{name}_leaf_detail.jpg')
    # Spliced variants explicitly expose whether the same blade crosses the
    # material boundary; normal relief is continuous on the last panel too.
    yy,xx=np.mgrid[:q,:p];cut=xx<p//2
    checker=((xx//max(1,p//6)+yy//max(1,q//3))%2)==0
    split=np.where(cut[...,None],patch['sun_base'],patch['shade_base'])
    mixed=np.where(checker[...,None],patch['sun_base'],patch['shade_base'])
    aligned=Image.new('RGB',(1500,400),BG)
    panels=[split,mixed,srgb(illuminate(linear(mixed),n,patch['orm']/255,10))]
    for i,(im,title) in enumerate(zip(panels,['Sun | shade / same UV','Alternating pigments / same blades','Same split / shared normals / 10:00'])):
        label(aligned,(i*500+10,20),title,19)
        aligned.paste(Image.fromarray(u8(im)).resize((490,245),Image.Resampling.LANCZOS),(i*500+5,75))
    label(aligned,(20,355),'Material boundary changes pigment only. Each panel is the same 1.2 × 0.6 m patch.',17)
    save(aligned,f'{name}_ecotype_alignment.jpg')

def distance_bases(all_layers):
    sheet=Image.new('RGB',(1400,1870),BG)
    label(sheet,(20,15),'BASE COLOURS AT SCREEN SIZE / 1080 rows, 70° vertical view',24)
    info={}
    for group,name in enumerate(NAMES):
        info[name]={}
        for row,key in enumerate(['sun_base','shade_base','base']):
            y=70+(group*3+row)*200
            label(sheet,(15,y),name.upper(),17)
            label(sheet,(15,y+24),key.replace('_base','').upper(),15)
            for col,distance in enumerate([15,30,60]):
                spec=SPECS[name];size=(round(FOCAL*spec['width_m']/distance),round(FOCAL*spec['height_m']/distance))
                shrunk=Image.fromarray(u8(srgb(resize(linear(all_layers[name][key]),size))))
                x=160+col*410
                label(sheet,(x,y),f'{distance} m   {size[0]} × {size[1]} px',17)
                sheet.paste(shrunk,(x,y+28));info[name][str(distance)]=size
    save(sheet,'base_distance.jpg')
    return info

def card_scale_sheet(all_layers):
    provenance=json.loads((SRC/'provenance.json').read_text())
    sheet=Image.new('RGB',(1600,1700),BG)
    label(sheet,(20,18),'CARD / SKIN LEAF SCALE / every panel at 400 pixels per metre',26)
    for row,name in enumerate(NAMES):
        ref=provenance['card_references'][name];y=75+row*530
        label(sheet,(20,y),name.upper()+f' / card cell 0 = {ref["physical_width_m"]:g} m square',20)
        card=Image.open(ROOT/ref['local']).convert('RGBA')
        side=round(400*ref['physical_width_m'])
        card=card.resize((side,side),Image.Resampling.LANCZOS)
        sheet.paste(card,(20,y+35),card)
        pitch=SPECS[name]['width_m']/2048;pixels=round(1.2/pitch)
        for col,key in enumerate(['sun_base','shade_base']):
            patch=u8(all_layers[name][key][180:180+pixels,450:450+pixels])
            label(sheet,(550+col*520,y),key.replace('_',' ').upper()+' / 1.2 m square',18)
            sheet.paste(Image.fromarray(patch).resize((480,480),Image.Resampling.LANCZOS),(550+col*520,y+35))
    label(sheet,(20,1670),'Original card crops are unretouched. The same specimen contours continue into both skin pigments.',17)
    save(sheet,'card_skin_scale.jpg')

def purpose_sheets(all_layers):
    metrics={}
    for row,name in enumerate(NAMES):
        spec=SPECS[name];a=all_layers[name];metrics[name]={}
        concept=Image.open(SRC/f'{name}_concept_head.png').convert('RGB')
        heads={}
        for d in [12,30,60]:
            for hour in [10,17]:
                im,m=render_head(a,spec,hour,d)
                metrics[name][f'{hour}_{d}']=m
                test(f'{name} paired face coverage {hour}h {d}m',.4<m['sun_visible_fraction']<.65,m['sun_visible_fraction'])
                heads[(hour,d)]=im
        sub=Image.new('RGB',(1480,780),BG)
        label(sub,(22,16),f'{name.upper()} / oblate {spec["head_m"]} m head, 1080p / 70° vertical FOV',24)
        label(sub,(22,51),'Sun on upper faces; shade below. Game face rule + core self-shadow. Concept retains its own light.',16)
        for col,d in enumerate([12,30,60]):
            x=25+col*485;width=round(FOCAL*spec['head_m']/d)
            label(sub,(x,89),f'{d} m • {width} pixels across',19)
            cref=concept.resize((width,round(concept.height/concept.width*width)),Image.Resampling.LANCZOS)
            for rr,(hour,title) in enumerate([(None,'Concept'),(10,'10:00'),(17,'17:00')]):
                y0=125+rr*210
                label(sub,(x,y0),title,16)
                im=cref if hour is None else heads[(hour,d)]
                # 5 m fig at 12 m is 321px wide/250 high, so use wider vertical
                # layout for that species below, to keep screen pixels intact.
                sub.paste(im,(x+90,y0+25))
        if name=='fig':
            sub=Image.new('RGB',(1480,1030),BG)
            label(sub,(22,16),'FIG / 5 m head — sun above, shade below / native pixels, 1080 rows / 70°',24)
            for col,d in enumerate([12,30,60]):
                x=25+col*485;width=round(FOCAL*5/d)
                label(sub,(x,70),f'{d} m • {width} pixels',19)
                cref=concept.resize((width,round(concept.height/concept.width*width)),Image.Resampling.LANCZOS)
                for rr,(hour,title) in enumerate([(None,'Concept'),(10,'10:00'),(17,'17:00')]):
                    y0=110+rr*295;label(sub,(x,y0),title,16)
                    im=cref if hour is None else heads[(hour,d)]
                    sub.paste(im,(x+70,y0+25))
            label(sub,(20,1010),'Concept scale is approximate; figures are offline material previews, not game captures.',14)
        save(sub,f'{name}_purpose_actual.png')
        # Critical 30m comparison enlarged with nearest filtering, labelled.
        compare=Image.new('RGB',(1500,580),BG)
        scale=3 if name=='fig' else 4
        label(compare,(20,18),f'{name.upper()} / 30 m, {scale}× nearest enlargement of the actual screen pixels',23)
        width=round(FOCAL*spec['head_m']/30)
        cref=concept.resize((width,round(concept.height/concept.width*width)),Image.Resampling.LANCZOS)
        for col,(title,im) in enumerate([('Concept',cref),('10:00',heads[(10,30)]),('17:00',heads[(17,30)])]):
            label(compare,(col*500+20,65),title,21)
            # Fig needs 516 px at 4x, use 3x to avoid overlap.
            scale=3 if name=='fig' else 4
            compare.paste(im.resize((im.width*scale,im.height*scale),Image.Resampling.NEAREST),(col*500+20,110))
        if name=='fig':label(compare,(20,550),'Fig is enlarged 3× to fit; original head is 129 px across.',15)
        save(compare,f'{name}_purpose_30m_enlarged.png')
        # Normal contribution and resolution cap, including GPU self-shadow.
        diagnostic=Image.new('RGB',(1500,880),BG)
        label(diagnostic,(18,15),f'{name.upper()} / controls at 12 m ({"native pixels" if name=="fig" else "2× nearest enlargement"})',23)
        for i,(title,kw) in enumerate([('Smooth head / core self-shadow',dict(flat_normal=True)),('Delivered / core self-shadow',{}),('1024 cap / core self-shadow',dict(cap=1024)),('Software tier / no cast shadows',dict(shadow=False))]):
            im,_=render_head(a,spec,10,12,**kw)
            scale=1.8 if name=='fig' else 2
            im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.NEAREST)
            # two columns, two rows, no nonuniform scaling
            x=(i%2)*750+20;y0=60+(i//2)*400
            label(diagnostic,(x,y0),title,20)
            # Fig controls fit at native to avoid overlapping rows.
            if name=='fig':im,_=render_head(a,spec,10,12,**kw)
            diagnostic.paste(im,(x+120,y0+30))
        save(diagnostic,f'{name}_normal_and_tier_controls.png')
    return metrics

def range_and_relief(all_layers):
    """Broaden the purpose test to the requested viewing envelope.

    Compare the identical texture with and without normal detail to avoid
    confusing colour variation with actual relief surviving the mip chain.
    """
    report={}
    for name,a in all_layers.items():
        spec=SPECS[name]
        sheet=Image.new('RGB',(1650,1000),BG)
        label(sheet,(20,16),f'{name.upper()} / reading range: 5, 15, 30, 60, 100 and 120 m',25)
        label(sheet,(20,52),'Native screen pixels. Top: 10:00; bottom: 17:00. Close detail and distant clumps use the same material.',16)
        report[name]={}
        positions=[20,850,1150,1350,1470,1560]
        for col,d in enumerate([5,15,30,60,100,120]):
            x=positions[col]
            label(sheet,(x,90),f'{d} m',18)
            for row,hour in enumerate([10,17]):
                im,_=render_head(a,spec,hour,d)
                y=125+row*435
                if d==5 and name=='fig':
                    # 5m-wide fig at 5m is 771px; preserve native in a separate
                    # file and crop no pixels. Overview uses 0.65x, labelled.
                    im.save(OUT/f'{name}_head_{hour}h_5m.png')
                    im=im.resize((round(im.width*.65),round(im.height*.65)),Image.Resampling.LANCZOS)
                    label(sheet,(x+90,90),'5m fig shown at 65%; full-size PNG retained',14)
                sheet.paste(im,(x,y))
            compare,_=render_head(a,spec,10,d)
            plain,_=render_head(a,spec,10,d,flat_normal=True)
            b=np.array(compare).astype(float);flat=np.array(plain).astype(float)
            mask=np.any(b!=np.array(BG),axis=-1)
            mask=ndi.binary_erosion(mask,iterations=3)
            delta=np.sum((b-flat)*np.array([.2126,.7152,.0722]),axis=-1)
            rms=float(np.sqrt(np.mean(delta[mask]**2)))
            report[name][str(d)]={'normal_contribution_rms_display_luma':rms,'head_width_px':round(FOCAL*spec['head_m']/d)}
            if d in [30,60]:test(f'{name} relief survives {d} m',rms>2,rms)
        save(sheet,f'{name}_viewing_range.jpg')
        # Multiple UV origins, so success cannot depend on a flattering crop.
        atlas=Image.new('RGB',(1400,740),BG)
        label(atlas,(20,18),f'{name.upper()} / independent UV cuts at 30 m, 3× nearest enlargement',23)
        for i,offset in enumerate([(.07,.11),(.37,.29),(.71,.79),(.91,.51)]):
            for row,hour in enumerate([10,17]):
                im,_=render_head(a,spec,hour,30,offset=offset)
                # Fig is 129px across; four times 423px doesn't fit, so 2x.
                sc=2 if name=='fig' else 3
                im=im.resize((im.width*sc,im.height*sc),Image.Resampling.NEAREST)
                x=20+i*345;y=70+row*325
                label(atlas,(x,y),f'{hour}:00 • UV {offset}',16)
                atlas.paste(im,(x,y+30))
        if name=='fig':label(atlas,(20,720),'Fig enlargement is 2×.',14)
        save(atlas,f'{name}_uv_cuts.png')
    return report

def metrics_for(name,a):
    spec=SPECS[name];out={}
    b=a['base'];luma=np.sum(b*np.array([.2126,.7152,.0722]),axis=-1)
    darkest=luma<=np.quantile(luma,.01)
    out['mean_srgb']=b.mean((0,1)).tolist()
    out['darkest_one_percent']={'selection':'lowest Rec.709 weighted sRGB value','mean_srgb':b[darkest].mean(0).tolist(),
                                'channel_min':b.min((0,1)).tolist(),'luma_threshold':float(np.quantile(luma,.01))}
    test(name+' mean within 0.1 sRGB',np.max(np.abs(b.mean((0,1))-spec['mean']))<.1)
    test(name+' base floor',np.all(b>=np.array([40,52,38])))
    test(name+' zero metalness',np.max(a['orm'][...,2])==0)
    out['occlusion_range']=(a['orm'][...,0].min()/255,a['orm'][...,0].max()/255)
    out['roughness_range']=(a['orm'][...,1].min()/255,a['orm'][...,1].max()/255)
    out['occlusion_below_065_fraction']=float(np.mean(a['orm'][...,0]<.65*255))
    test(name+' occlusion 0.6 to 1',out['occlusion_range'][0]>=.6 and out['occlusion_range'][1]<=1)
    test(name+' matte atlas roughness',out['roughness_range'][0]>.9 and out['roughness_range'][1]<.98)
    z=a['height']/65535*spec['height_range_mm'];pitch=spec['width_m']*1000/2048
    gx=(np.roll(z,-1,1)-np.roll(z,1,1))/(2*pitch)
    gy=(np.roll(z,-1,0)-np.roll(z,1,0))/(2*pitch)
    expected=unit(np.stack([-gx,gy,np.ones_like(z)],-1));actual=normal_decode(a['normal'])
    angle=np.rad2deg(np.arccos(np.clip(np.sum(actual*expected,-1),-1,1)))
    out['normal_height_error_degrees']={'mean':float(angle.mean()),'p99':float(np.quantile(angle,.99)),'max':float(angle.max())}
    out['height_mm']={'encoding':[0,spec['height_range_mm']],'actual':[float(z.min()),float(z.max())],
                      'actual_relief':float(np.ptp(z)),'p01_p99':np.quantile(z,[.01,.99]).tolist()}
    out['normal_tilt_degrees']=np.quantile(np.rad2deg(np.arccos(np.clip(actual[...,2],-1,1))),[.1,.5,.9]).tolist()
    test(name+' normals match delivered metric height < 0.4 degrees',angle.max()<.4)
    test(name+' visible relief 150 to 250 mm',150<np.ptp(z)<=250)
    out['seam_energy']={key:seam_metrics(v) for key,v in a.items()}
    for key,result in out['seam_energy'].items():
        for direction,value in result.items():
            test(name+' '+key+' '+direction+' seam energy',value['ratio']<1.65,value['ratio'])
    for key in a:
        path=ROOT/f'{name}_skin_{key}.png';image=Image.open(path)
        header=path.read_bytes()[24:26]
        test(name+' '+key+' dimensions',image.size==(2048,1024))
        test(name+' '+key+' PNG encoding',tuple(header)==((16,0) if key=='height' else (8,2)),list(header))
        test(name+' '+key+' colour tag',('srgb' in image.info)==(key.endswith('base')))
    structure=np.load(CACHE/f'{name}_structure.npz')
    out['crease_fraction_over_half']=float(np.mean(structure['crease']>.5))
    # Width of dark regions, including their periodic boundary continuation.
    dark=luma<70
    pad=np.pad(dark,128,mode='wrap')
    dist=ndi.distance_transform_edt(pad)[128:-128,128:-128]*pitch
    out['dark_region_max_inscribed_width_mm']=float(2*dist.max())
    test(name+' dark areas narrower than a clump',2*dist.max()<spec['clump_m'][0]*1000)
    composition=json.loads((CACHE/f'{name}_composition.json').read_text())
    lengths=np.array([r['length_mm'] for r in composition['leaves']])
    diameters=np.array([r['diameter_mm'] for r in composition['clumps']])
    out['construction']={'clumps':len(diameters),'shoots':len(composition['shoots']),'leaves':len(lengths),
                         'blade_length_mm':[float(lengths.min()),float(lengths.max())],
                         'clump_diameter_mm':[float(diameters.min()),float(diameters.max())],
                         'leaf_tissue_gap_fill_fraction':composition['unfilled_fraction_before_tissue_extension'],
                         'visible_kind_fraction':{label:float(np.mean(structure['leaf_kind']==i)) for i,label in [(1,'mature'),(2,'fresh'),(3,'underside'),(4,'brown')]}}
    test(name+' leaf dimensions',lengths.min()>=spec['blade_mm'][0] and lengths.max()<=spec['blade_mm'][1])
    test(name+' clump dimensions',diameters.min()>=spec['clump_m'][0]*1000 and diameters.max()<=spec['clump_m'][1]*1000)
    for kind in ['fresh','underside','brown']:
        test(name+' sparse '+kind,out['construction']['visible_kind_fraction'][kind]<.035)
    out['ecotypes']=ecotype_metrics(name,a,structure,composition)
    out['sha256']={key:hashlib.sha256((ROOT/f'{name}_skin_{key}.png').read_bytes()).hexdigest() for key in a}
    return out

def ecotype_metrics(name,a,structure,composition):
    spec=SPECS[name];out={}
    expected=u8((a['sun_base']+a['shade_base'])/2)
    test(name+' compatibility base equals rounded sun/shade mean',np.array_equal(a['base'],expected))
    out['compatibility_average']='Arithmetic mean of delivered sRGB code values; nearest/ties-even.'
    leaves=composition['leaves']
    ids=structure['leaf_ids'];crease=structure['crease']
    out['shared_leaf_identity_sha256']=hashlib.sha256(ids.tobytes()).hexdigest()
    for variant in ['sun','shade']:
        b=a[variant+'_base'];kinds=structure[variant+'_kind']
        luma=np.sum(b*np.array([.2126,.7152,.0722]),axis=-1);dark=luma<=np.quantile(luma,.01)
        fractions={k:float(np.mean(kinds==i)) for i,k in [(1,'mature'),(2,'fresh'),(3,'underside'),(4,'brown')]}
        mean=b.mean((0,1))
        darkwidth=2*ndi.distance_transform_edt(np.pad(luma<70,128,mode='wrap'))[128:-128,128:-128].max()*spec['width_m']*1000/2048
        out[variant]=dict(mean_srgb=mean.tolist(),darkest_one_percent_mean_srgb=b[dark].mean(0).tolist(),
            channel_min=b.min((0,1)).tolist(),visible_kind_fraction=fractions,dark_region_max_inscribed_width_mm=float(darkwidth),
            fresh_mean_srgb=b[kinds==2].mean(0).tolist() if np.any(kinds==2) else None,
            fresh_p90_srgb=np.quantile(b[kinds==2],.9,axis=0).tolist() if np.any(kinds==2) else None)
        test(name+' '+variant+' target mean',np.max(np.abs(mean-spec[variant+'_mean']))<.1,mean.tolist())
        test(name+' '+variant+' pigment floor',np.all(b>=np.array([40,52,38])))
        test(name+' '+variant+' narrow dark pigment',darkwidth<spec['clump_m'][0]*1000,float(darkwidth))
        test(name+' '+variant+' rare undersides',fractions['underside']<.012,fractions['underside'])
        test(name+' '+variant+' sparse brown',fractions['brown']<.015,fractions['brown'])
        if variant=='shade':
            test(name+' shade has no fresh tips',fractions['fresh']==0 and all(r['shade_kind']!=2 for r in leaves))
        else:
            test(name+' sun has localized new growth',.025<fractions['fresh']<.085,fractions['fresh'])
            test(name+' sun fresh only on terminal ranks',all(r['terminal_rank'] for r in leaves if r['sun_kind']==2))
            old_fresh=float(np.mean(structure['leaf_kind']==2))
            test(name+' sun fresh growth increased',fractions['fresh']>old_fresh*1.6,[old_fresh,fractions['fresh']])
            fresh=b[kinds==2].mean(0);mature=b[kinds==1].mean(0)
            test(name+' sun fresh warmer and lighter than mature',fresh[0]>mature[0]+15 and fresh[1]>mature[1]+12,[fresh.tolist(),mature.tolist()])
    test(name+' undersides stay on identical leaves',np.array_equal(structure['sun_kind']==3,structure['shade_kind']==3))
    # Measure the residual of the best possible per-channel linear-light
    # gain, including a more permissive offset. A recoloured gain cannot pass.
    x=linear(a['shade_base']).reshape(-1,3)[::7];y=linear(a['sun_base']).reshape(-1,3)[::7]
    gain=(x*y).sum(0)/(x*x).sum(0)
    residual=srgb(y)-srgb(x*gain)
    out['best_linear_gain']=gain.tolist();out['gain_residual_rms_srgb']=float(np.sqrt(np.mean(residual**2)))
    fitted=np.empty_like(y)
    for k in range(3):
        design=np.stack([x[:,k],np.ones(len(x))],-1)
        coeff=np.linalg.lstsq(design,y[:,k],rcond=None)[0]
        fitted[:,k]=x[:,k]*coeff[0]+coeff[1]
    out['affine_residual_rms_srgb']=float(np.sqrt(np.mean((srgb(y)-srgb(fitted))**2)))
    test(name+' pigments are not a global gain',out['gain_residual_rms_srgb']>3,out['gain_residual_rms_srgb'])
    test(name+' leaf populations survive affine fit',out['affine_residual_rms_srgb']>2,out['affine_residual_rms_srgb'])
    # Inside mature blades, fine tissue has the same location in both PNGs.
    interior=(structure['sun_kind']==1)&(structure['shade_kind']==1)&(crease<.05)
    for ax in (0,1):
        for shift in (-3,3):interior &= ids==np.roll(ids,shift,ax)
    hp=[]
    for variant in ('sun','shade'):
        green=a[variant+'_base'][...,1]
        hp.append((green-ndi.gaussian_filter(green,1.2,mode='wrap'))[interior])
    correlation=float(np.corrcoef(*hp)[0,1])
    out['shared_interior_tissue_correlation']=correlation
    test(name+' same fine tissue at same UV',correlation>.85,correlation)
    out['blade_width_mm']=[min(r['width_mm'] for r in leaves),max(r['width_mm'] for r in leaves)]
    if name=='oak':test('oak blade widths match cards',out['blade_width_mm'][0]>=53 and out['blade_width_mm'][1]<=60,out['blade_width_mm'])
    if name=='fig':test('fig blade proportions match cards',all(.48-1e-9<=r['width_mm']/r['length_mm']<=.67+1e-9 for r in leaves))
    test(name+' interstice fill under five percent',composition['unfilled_fraction_before_tissue_extension']<.05,composition['unfilled_fraction_before_tissue_extension'])
    return out

def main():
    OUT.mkdir(exist_ok=True)
    if not all((CACHE/f'{name}_structure.npz').exists() and (CACHE/f'{name}_composition.json').exists() for name in NAMES):
        raise SystemExit('Missing regenerable audit cache. Run python3 build_skins.py, then this checker.')
    for pattern in ['*_tiled_2x2.png','*_offset_half.png','*_base_*m.png','*_head_*h_12m.png','*_head_*h_30m.png','*_head_*h_60m.png','reference_review.jpg']:
        for old in OUT.glob(pattern):old.unlink()
    print('Reading delivered PNGs and checking actual game lighting probes',flush=True)
    provenance=json.loads((SRC/'provenance.json').read_text())
    for name in NAMES:
        p=ROOT/provenance[name]['local']
        test(name+' retained source provenance',hashlib.sha256(p.read_bytes()).hexdigest()==provenance[name]['sha256'])
        ref=provenance['card_references'][name]
        test(name+' retained card reference provenance',hashlib.sha256((ROOT/ref['local']).read_bytes()).hexdigest()==ref['sha256'])
    for name,sha in provenance['round1_mangrove_shared_sha256'].items():
        test(name+' preserved from round 1',hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==sha)
    probes=[]
    for hour,f in LIGHT.items():
        for p in f['probes']:
            calc=srgb(illuminate(linear(np.array(p['base'])),np.array(p['normal']),np.array(p['orm']),int(hour)))
            err=float(np.max(np.abs(calc-p['shown'])))
            probes.append(dict(hour=hour,normal=p['normal'],actual_engine=p['shown'],python=calc.tolist(),max_error=err))
            test('game lighting probe '+str(hour)+str(p['normal']),err<.15,err)
    layers={name:read_layers(name) for name in NAMES}
    metrics={'camera':{'rows':1080,'vertical_fov_deg':70,'focal_pixels':FOCAL,'pixels_per_m_at_30m':FOCAL/30},
             'purpose_face_selection':provenance['purpose_face_selection'],
             'lighting':{'source':'frozen skyFrame/domeLight from actual renderer, Python surface.ts evaluator','probes':probes},
             'skins':{name:metrics_for(name,a) for name,a in layers.items()}}
    print('Writing contact sheets, periodic proofs and distance images',flush=True)
    make_layers_sheet(layers)
    card_scale_sheet(layers)
    for name,a in layers.items():tiling_and_detail(name,a)
    metrics['base_distance_pixels']=distance_bases(layers)
    print('Rendering rounded heads in both game lights',flush=True)
    metrics['purpose']=purpose_sheets(layers)
    metrics['distance_relief']=range_and_relief(layers)
    metrics['checks']=ASSERTIONS
    metrics['passed']=sum(r['passed'] for r in ASSERTIONS);metrics['total']=len(ASSERTIONS)
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(f'{metrics["passed"]}/{metrics["total"]} checks pass',flush=True)
    if metrics['passed']!=metrics['total']:raise SystemExit(1)

if __name__=='__main__':main()
