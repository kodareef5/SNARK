#!/usr/bin/env python3
"""Independent checks plus linear-light GGX cabinet previews, no environment map.

Run normally to validate/render, or --verify-rebuild to rebuild and compare every
delivery and retained source hash. All outputs stay in this directory.
"""
from pathlib import Path
import argparse
import hashlib
import itertools
import json
import math
import struct
import subprocess
import sys
import time
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
OUT.mkdir(exist_ok=True)
RESAMPLE=Image.Resampling.LANCZOS
FONT_PATH='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def font(size):
    try: return ImageFont.truetype(FONT_PATH,size)
    except OSError: return ImageFont.load_default()


def title(canvas,xy,text,size=22,fill=(218,224,219)):
    ImageDraw.Draw(canvas).text(xy,text,font=font(size),fill=fill)


def norm(v):
    return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-12)


def srgb_decode(v):
    v=np.asarray(v,dtype=np.float64)
    return np.where(v<=.04045,v/12.92,((v+.055)/1.055)**2.4)


def srgb_encode(v):
    v=np.maximum(v,0)
    return np.clip(np.rint(np.where(v<=.0031308,v*12.92,1.055*v**(1/2.4)-.055)*255),0,255).astype(np.uint8)


def independent_normal(h):
    # Explicit periodic border and slice derivative; does not call the builder.
    physical=np.asarray(h,dtype=np.float64)*(8.0/65535.0)
    padded=np.pad(physical,1,mode='wrap')
    denominator=2*1500/h.shape[0]
    east=(padded[1:-1,2:]-padded[1:-1,:-2])/denominator
    south=(padded[2:,1:-1]-padded[:-2,1:-1])/denominator
    direction=norm(np.stack((-east,south,np.ones_like(east)),-1))
    return np.rint((direction+1)*127.5).astype(np.uint8),direction


def avg2(a):
    a=a.astype(np.float64)
    return (a[::2,::2]+a[::2,1::2]+a[1::2,::2]+a[1::2,1::2])/4


def psnr(a,b,peak):
    mse=float(np.mean((a.astype(np.float64)-b.astype(np.float64))**2))
    return 999.0 if mse==0 else 10*math.log10(peak*peak/mse)


def png_header(path):
    raw=path.read_bytes()
    w,h,depth,colour=struct.unpack('>IIBB',raw[16:26])
    chunks=[]; pos=8
    while pos<len(raw):
        length=struct.unpack('>I',raw[pos:pos+4])[0]
        chunks.append(raw[pos+4:pos+8].decode('ascii'))
        pos+=length+12
    return dict(width=w,height=h,bit_depth=depth,colour_type=colour,chunks=sorted(set(chunks)))


def wrap_metric(a):
    a=a.astype(np.float64)
    dx=float(np.abs(a[:,1:]-a[:,:-1]).mean())
    dy=float(np.abs(a[1:]-a[:-1]).mean())
    ex=float(np.abs(a[:,0]-a[:,-1]).mean())
    ey=float(np.abs(a[0]-a[-1]).mean())
    return dict(x=ex/max(dx,1e-12),y=ey/max(dy,1e-12),edge_x=ex,edge_y=ey,interior_x=dx,interior_y=dy)


def sample(a,u,v):
    n=a.shape[0]
    x=(u%1)*n-.5; y=(v%1)*n-.5
    xi=np.floor(x).astype(np.int32); yi=np.floor(y).astype(np.int32)
    fx=(x-xi)[...,None]; fy=(y-yi)[...,None]
    return ((1-fy)*((1-fx)*a[yi%n,xi%n]+fx*a[yi%n,(xi+1)%n])+
            fy*((1-fx)*a[(yi+1)%n,xi%n]+fx*a[(yi+1)%n,(xi+1)%n]))


def shade(base,rough,metal,ao,normal,view,light):
    """One directional sun, analytic diffuse sky, no reflected environment."""
    n=norm(normal); l=norm(np.asarray(light,dtype=float)); v=norm(view)
    h=norm(l+v)
    nl=np.maximum(np.sum(n*l,axis=-1),0)
    nv=np.maximum(np.sum(n*v,axis=-1),1e-4)
    nh=np.maximum(np.sum(n*h,axis=-1),0)
    vh=np.clip(np.sum(v*h,axis=-1),0,1)
    a2=np.maximum(rough,.1)**4
    distribution=a2/(np.pi*np.maximum((nh*nh*(a2-1)+1)**2,1e-8))
    k=(rough+1)**2/8
    geometry=(nv/(nv*(1-k)+k))*(nl/(nl*(1-k)+k+1e-8))
    f0=.04*(1-metal[...,None])+base*metal[...,None]
    fresnel=f0+(1-f0)*(1-vh[...,None])**5
    spec=distribution[...,None]*geometry[...,None]*fresnel/(4*nv[...,None]*np.maximum(nl[...,None],1e-5))
    diffuse=base*(1-metal[...,None])*(1-fresnel)/np.pi
    sunlight=(diffuse+spec)*nl[...,None]*np.array([3.0,2.94,2.80])
    hemi=.62+.38*np.maximum(n[...,1],0)
    sky=base*(1-metal[...,None])*(.31*hemi[...,None])*np.array([.91,.96,1.06])*ao[...,None]
    return sunlight+sky


def convex_box(orig,ray,center,half,bevel):
    """Intersect exact chamfer geometry: 6 faces, 12 bevels, 8 corners."""
    half=np.asarray(half,dtype=float)
    planes=[]
    for axis in range(3):
        for sign in (-1,1):
            n=np.zeros(3); n[axis]=sign
            planes.append((n,half[axis]))
    if bevel>0:
        for axes in ((0,1),(0,2),(1,2)):
            for signs in itertools.product((-1,1),repeat=2):
                n=np.zeros(3); n[list(axes)]=signs; n/=np.sqrt(2)
                planes.append((n,(half[list(axes)].sum()-bevel)/np.sqrt(2)))
        for signs in itertools.product((-1,1),repeat=3):
            planes.append((np.array(signs)/np.sqrt(3),(half.sum()-2*bevel)/np.sqrt(3)))
    p=orig-np.asarray(center)
    near=np.full(orig.shape[:-1],-1e8)
    far=np.full_like(near,1e8)
    ns=np.zeros_like(orig)
    for n,d in planes:
        den=float(np.dot(n,ray))
        side=np.sum(p*n,axis=-1)
        if abs(den)<1e-8:
            far=np.where(side>d,-1e9,far); continue
        t=(d-side)/den
        if den<0:
            changed=t>near
            ns[changed]=n
            near=np.maximum(near,t)
        else: far=np.minimum(far,t)
    hit=(near<=far)&(near>0)
    return np.where(hit,near,np.inf),ns


def render_cabinet(maps,light,w=1100,h=850):
    # Metres: 1.7 wide x 1.04 tall x .68 deep, plus .16 m iron feet.
    view=norm(np.array([2.4,1.5,3.6]))
    right=norm(np.cross([0,1,0],view)); up=np.cross(view,right)
    ix=(np.arange(w)+.5-w/2)/w*2.55
    iy=(h/2-np.arange(h)-.5)/w*2.55
    target=np.array([0,.69,0])
    orig=target+view*5+ix[None,:,None]*right+iy[:,None,None]*up
    ray=-view
    center=np.array([0,.68,0]); half=np.array([.85,.52,.34])
    distance,gn=convex_box(orig,ray,center,half,.024)
    objectid=np.where(np.isfinite(distance),1,0)
    for x in (-.68,.68):
        for z in (-.23,.23):
            ft,fn=convex_box(orig,ray,[x,.09,z],[.047,.09,.047],.007)
            valid=ft<distance
            distance[valid]=ft[valid]; gn[valid]=fn[valid]; objectid[valid]=2
    # Simple dark pull demonstrates the intended relationship with black iron.
    for x in (-.51,-.25):
        ft,fn=convex_box(orig,ray,[x,.68,.366],[.016,.018,.04],.005)
        valid=ft<distance
        distance[valid]=ft[valid]; gn[valid]=fn[valid]; objectid[valid]=2
    ft,fn=convex_box(orig,ray,[-.38,.68,.403],[.15,.018,.016],.006)
    valid=ft<distance
    distance[valid]=ft[valid]; gn[valid]=fn[valid]; objectid[valid]=2
    hit=objectid>0
    p=orig[hit]+distance[hit,None]*ray
    g=gn[hit]; ids=objectid[hit]
    local=p-center
    texu=np.zeros(len(p)); texv=np.zeros(len(p))
    tangent=np.zeros_like(p); bitangent=np.zeros_like(p)
    flat=np.max(abs(g),axis=-1)>.999
    face_axis=np.argmax(abs(g),axis=-1)
    for axis in range(3):
        for sign in (-1,1):
            mask=flat&(face_axis==axis)&(g[:,axis]*sign>0)
            if not np.any(mask):continue
            if axis==2:
                U=np.array([sign,0,0]); D=np.array([0,-1,0]); hw,hh=half[0],half[1]
            elif axis==0:
                U=np.array([0,0,-sign]); D=np.array([0,-1,0]); hw,hh=half[2],half[1]
            else:
                U=np.array([1,0,0]); D=np.array([0,0,sign]); hw,hh=half[0],half[2]
            a=local[mask]@U+hw; b=local[mask]@D+hh
            u=a/1.5; v=(250+b*1000)/1500
            T=np.broadcast_to(U,(len(a),3)).astype(float).copy()
            B=np.broadcast_to(-D,(len(a),3)).astype(float).copy()
            # Each surface is mapped inside exactly one strip. Panel width
            # follows image x. Vertical seam strips rotate their tangent frame.
            top=b<.125; bottom=b>2*hh-.125
            horizontal=top|bottom
            v[top]=b[top]/1.5
            v[bottom]=(b[bottom]-(2*hh-.125))/1.5
            left=a<.125; rightband=a>2*hw-.125
            middle=(abs(a-(hw+.10))<.0625)&(axis==2)&(sign==1)
            vertical=(left|rightband|middle)&~horizontal
            lateral=np.where(left,a,np.where(rightband,a-(2*hw-.125),a-(hw+.10-.0625)))
            u[vertical]=-b[vertical]/1.5
            v[vertical]=lateral[vertical]/1.5
            T[vertical]=-D; B[vertical]=-U
            texu[mask]=u; texv[mask]=v
            tangent[mask]=T; bitangent[mask]=B
    bevel=~flat
    for i in range(3):
        mask=bevel&(np.argmin(abs(g),axis=-1)==i)
        if not np.any(mask):continue
        axisv=np.eye(3)[i]
        T=norm(axisv-g[mask]*g[mask,i,None])
        B=np.cross(g[mask],T)
        tangent[mask]=T;bitangent[mask]=B
        texu[mask]=np.sum(p[mask]*T,axis=-1)/1.5
        texv[mask]=.125+np.sum(local[mask]*B,axis=-1)*.045
    base=sample(maps['base'],texu,texv)
    normaltex=norm(sample(maps['normal'],texu,texv)*2-1)
    orm=sample(maps['orm'],texu,texv)
    worldn=norm(tangent*normaltex[:,0,None]+bitangent*normaltex[:,1,None]+g*normaltex[:,2,None])
    iron=ids==2
    base[iron]=srgb_decode(np.array([44,41,39])/255)
    orm[iron]=[1,.66,.18]
    worldn[iron]=g[iron]
    colour=shade(base,orm[:,1],orm[:,2],orm[:,0],worldn,view,light)
    img=np.broadcast_to(srgb_decode(np.array([45,48,47])/255),(h,w,3)).copy()
    img[hit]=colour
    # Ground is a plain matte receiver with actual box shadows, no image lighting.
    ground_t=-orig[...,1]/ray[1]
    ground_p=orig+ground_t[...,None]*ray
    ground=(ground_t>0)&(ground_t<distance)
    l=norm(np.asarray(light,dtype=float))
    shadow_t,_=convex_box(ground_p+l*.001,l,center,half,.024)
    shadow=np.isfinite(shadow_t)
    ground_col=srgb_decode(np.array([63,65,60])/255)
    gi=np.broadcast_to(ground_col,(h,w,3)).copy()
    gi[shadow]*=.55
    img[ground]=gi[ground]
    return Image.fromarray(srgb_encode(img))


def views(arrays,metrics):
    bases={k:Image.fromarray(v) for k,v in arrays.items() if k!='height'}
    h=arrays['height'].astype(float)*8/65535
    stretch=np.clip((h-1.35)/(6.35-1.35),0,1)
    bases['height']=Image.fromarray(np.rint(stretch*255).astype(np.uint8)).convert('RGB')
    layer=Image.new('RGB',(2080,592),(25,29,28))
    for i,k in enumerate(('base','height','normal','orm')):
        layer.paste(bases[k].resize((504,504),RESAMPLE),(i*520+8,48))
        title(layer,(i*520+10,12),{'base':'Base / sRGB','height':'Height / display stretched','normal':'Normal / OpenGL','orm':'AO | roughness | metalness'}[k],19)
    title(layer,(12,564),'2048 native master   /   1.50 m per tile   /   full height encoding 0–8 mm',18)
    layer.save(OUT/'layers.png')
    offset=Image.new('RGB',(1556,1600),(25,29,28))
    for i,k in enumerate(('base','height','normal','orm')):
        a=np.asarray(bases[k]); shifted=np.roll(a,(1024,1024),(0,1))
        Image.fromarray(shifted).save(OUT/f'offset_{k}_native.png')
        tile=Image.fromarray(shifted).resize((760,760),RESAMPLE)
        x=10+(i%2)*778;y=44+(i//2)*778
        offset.paste(tile,(x,y));title(offset,(x,y-30),k+' / half-tile wrap',18)
    offset.save(OUT/'offset.png')
    for k in ('base','normal'):
        a=np.asarray(bases[k])
        tiled=Image.fromarray(np.tile(a,(3,3,1)))
        tiled.save(OUT/f'tiled3x3_{k}_native.png')
        if k=='base':
            small=tiled.resize((1536,1536),RESAMPLE)
            small.save(OUT/'tiled3x3.png')
            tilethumb=tiled.resize((600,600),RESAMPLE)
    # Native four-corner meeting, and near-field diagonal seam row crops.
    cross=np.roll(arrays['base'],(1024,1024),(0,1))[768:1280,768:1280]
    Image.fromarray(cross).save(OUT/'native_wrap_intersection.png')
    strips=Image.new('RGB',(1536,620),(25,29,28))
    for i,k in enumerate(('base','normal','orm')):
        a=arrays[k]
        wrap=np.concatenate((a[-72:],a[:116]),axis=0)
        strips.paste(Image.fromarray(wrap).resize((1536,141),RESAMPLE),(0,i*200+34))
        title(strips,(10,i*200+8),k+' / bottom meets top (join at 54 px inside strip)',18)
    strips.save(OUT/'seam_strips.png')
    detail=Image.new('RGB',(1880,1165),(25,29,28))
    crops=[(0,0,920,184),(600,345,1060,805),(1250,1570,1710,2030)]
    for j,box in enumerate(crops):
        for i,k in enumerate(('base','height','normal','orm')):
            c=bases[k].crop(box)
            if j==0:c=c.resize((460,92),RESAMPLE)
            detail.paste(c,(i*470+5,40 if j==0 else 170+(j-1)*480))
            if j==0:title(detail,(i*470+5,9),k,19)
    title(detail,(6,1130),'Face crops shown at native pixel size; seam strip reduced 2:1. Height is display-stretched.',17)
    detail.save(OUT/'native_detail.png')
    # A separate native near-field strip relight makes the rivet curvature visible.
    crop=(slice(0,180),slice(0,1100))
    bc=srgb_decode(arrays['base'][crop]/255)
    nm=norm(arrays['normal'][crop]/127.5-1)
    oc=arrays['orm'][crop]/255
    lights=[(-.65,.7,1),(.7,.35,1)]
    relit=Image.new('RGB',(1120,470),(25,29,28))
    for i,l in enumerate(lights):
        # Flat texture coordinates x right, y up, z out. Sky up is image-up.
        lit=shade(bc,oc[...,1],oc[...,2],oc[...,0],nm,np.array([0,0,1]),l)
        relit.paste(Image.fromarray(srgb_encode(lit)),(10,45+i*220))
        title(relit,(10,10+i*220),'Rivet strip / sun '+('upper left' if i==0 else 'upper right')+' / native texels',20)
    relit.save(OUT/'rivet_relight.png')
    # Textures prefiltered to 1024 for this approximately 650 px/m projection.
    render_maps=dict(base=srgb_decode(np.asarray(Image.open(ROOT/'plate_base_1024.png'))/255),
                     normal=np.asarray(Image.open(ROOT/'plate_normal_1024.png'))/255,
                     orm=np.asarray(Image.open(ROOT/'plate_orm_1024.png'))/255)
    boxes=[]
    for i,l in enumerate(lights):
        box=render_cabinet(render_maps,l)
        box.save(OUT/f'box_light_{i+1}.png');boxes.append(box)
    joined=Image.new('RGB',(2200,930),(25,29,28))
    for i,b in enumerate(boxes):
        joined.paste(b,(i*1100,45));title(joined,(i*1100+20,12),'SUN '+('UPPER LEFT' if i==0 else 'UPPER RIGHT')+' / diffuse sky / no environment map',20)
    title(joined,(20,902),'1.7 m cabinet • painted faces • steel chamfers • rotated seam trims • illustrative iron feet and pull',20)
    joined.save(OUT/'boxes_two_lights.png')
    inventory=Image.new('RGB',(1000,410),(25,29,28))
    for i,b in enumerate(boxes):
        sq=b.crop((125,0,975,850)).resize((64,64),RESAMPLE)
        sq.save(OUT/f'inventory_64_light_{i+1}.png')
        inventory.paste(sq,(30+i*500,65))
        enlarged=Image.fromarray(np.repeat(np.repeat(np.asarray(sq),4,0),4,1))
        inventory.paste(enlarged,(120+i*500,65))
        title(inventory,(25+i*500,22),'64 px / actual and 4x nearest',20)
    for i,(name,col) in enumerate([('paint',(98,110,100)),('bare steel',(150,150,148)),('iron',(44,41,39))]):
        x=20+i*326
        ImageDraw.Draw(inventory).rectangle((x,340,x+110,385),fill=col)
        title(inventory,(x+120,350),name,19)
    inventory.save(OUT/'inventory_palette.png')
    # Comparisons keep normal at physical strength; smaller height is rederived.
    comparison=Image.new('RGB',(1600,900),(25,29,28))
    for i,k in enumerate(('base','height','normal','orm')):
        master=arrays[k]
        half=np.asarray(Image.open(ROOT/f'plate_{k}_1024.png'))
        reduced=np.rint(avg2(master)).astype(master.dtype)
        if k=='height':
            half=np.clip((half.astype(float)*8/65535-1.35)/5*255,0,255).astype(np.uint8)
            reduced=np.clip((reduced.astype(float)*8/65535-1.35)/5*255,0,255).astype(np.uint8)
        for j,a in enumerate((reduced,half)):
            im=Image.fromarray(a).convert('RGB').crop((0,0,390,390))
            comparison.paste(im,(i*400+5,50+j*425))
        title(comparison,(i*400+8,14),k+' / master reduced',18)
        title(comparison,(i*400+8,448),'delivered 1024',18)
    comparison.save(OUT/'downsample.png')
    pack_contact(metrics)


def pack_contact(metrics):
    layer=Image.open(OUT/'layers.png')
    joined=Image.open(OUT/'boxes_two_lights.png')
    tilethumb=Image.open(OUT/'tiled3x3.png').resize((600,600),RESAMPLE)
    offset=Image.open(OUT/'offset.png')
    inventory=Image.open(OUT/'inventory_palette.png')
    comparison=Image.open(OUT/'downsample.png')
    contact=Image.new('RGB',(2200,2650),(22,26,25))
    title(contact,(28,18),'PLATE  /  painted steel for a survivor-built fabricator',31)
    title(contact,(28,61),'2048 + 1024  •  1.5 m square  •  25 rivets at 60 mm pitch  •  shared physical layers',21)
    contact.paste(layer.resize((2160,615),RESAMPLE),(20,105))
    contact.paste(joined.resize((2160,913),RESAMPLE),(20,735))
    contact.paste(tilethumb,(24,1700));title(contact,(24,1663),'3 × 3 / complete sheet',22)
    contact.paste(offset.resize((585,602),RESAMPLE),(650,1700));title(contact,(650,1663),'Half-tile wrap / four maps',22)
    contact.paste(inventory.resize((920,377),RESAMPLE),(1250,1700));title(contact,(1250,1663),'Inventory silhouette / material separation',22)
    title(contact,(1250,2105),'Master reduced / delivered 1024 comparison',22)
    contact.paste(comparison.resize((850,478),RESAMPLE),(1250,2145))
    title(contact,(28,2340),'VERIFIED SURFACE',25)
    lowest=min(v['lanczos_psnr_db'] for v in metrics['downsample'].values())
    notes=[
        'Height: 0–8 mm encoding; paint 0.2 mm; rivet caps about 4 mm.',
        'Normals: byte-exact reconstruction from each saved height.',
        f'Reduction: every Lanczos comparison exceeds {lowest:.1f} dB (required: 30 dB).',
        'Periodic fields and wrapped features; native 6144 px repeats retained.',
        'Import only base as sRGB. Height, normal and ORM are linear data.',
    ]
    for i,note in enumerate(notes):title(contact,(28,2390+i*40),note,21)
    contact.save(OUT/'contact_sheet.png')


def main():
    start=time.time()
    parser=argparse.ArgumentParser();parser.add_argument('--verify-rebuild',action='store_true')
    args=parser.parse_args()
    if args.verify_rebuild:
        paths=list(ROOT.glob('plate_*.png'))+list((ROOT/'source').glob('*'))
        paths=[p for p in paths if p.is_file()]
        before={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        subprocess.run([sys.executable,str(ROOT/'build_material.py')],cwd=ROOT,check=True)
        after={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in before}
        result=dict(identical=before==after,files={p:before[p]==after[p] for p in before},before=before,after=after)
        (OUT/'rebuild_verification.json').write_text(json.dumps(result,indent=2)+'\n')
        if before!=after:raise AssertionError('Rebuild changed retained files')
    checks=[];metrics={'files':{},'normal':{},'downsample':{},'wrap':{},'regions':{}}
    def require(name,condition,value=None):
        checks.append(dict(name=name,pass_=bool(condition),value=value))
    arrays={k:np.asarray(Image.open(ROOT/f'plate_{k}.png')) for k in ('base','height','normal','orm')}
    for suffix,n in (('',2048),('_1024',1024)):
        for k in arrays:
            path=ROOT/f'plate_{k}{suffix}.png';meta=png_header(path)
            a=np.asarray(Image.open(path))
            metrics['files'][path.name]=meta
            require(path.name+' dimensions',a.shape[:2]==(n,n))
            require(path.name+' encoding',meta['bit_depth']==(16 if k=='height' else 8) and meta['colour_type']==(0 if k=='height' else 2))
            require(path.name+' colour metadata',('sRGB' in meta['chunks']) if k=='base' else not any(c in meta['chunks'] for c in ('sRGB','gAMA','iCCP')))
            wrap=wrap_metric(a);metrics['wrap'][path.name]=wrap
            require(path.name+' wrap x',wrap['x']<3,wrap['x'])
            require(path.name+' wrap y',wrap['y']<3,wrap['y'])
        h=np.asarray(Image.open(ROOT/f'plate_height{suffix}.png'))
        actual=np.asarray(Image.open(ROOT/f'plate_normal{suffix}.png'))
        expected,ideal=independent_normal(h)
        error=abs(actual.astype(int)-expected.astype(int))
        direction=norm(actual/127.5-1)
        angle=np.degrees(np.arccos(np.clip(np.sum(direction*ideal,axis=-1),-1,1)))
        metrics['normal'][str(n)]=dict(max_byte_error=int(error.max()),mismatched_channels=int(np.count_nonzero(error)),mean_angular_error=float(angle.mean()),p99_angle=float(np.percentile(angle,99)),max_angle=float(angle.max()))
        require(str(n)+' normal matches physical height',not np.any(error),int(error.max()))
        require(str(n)+' normal unit length',float(np.max(abs(np.linalg.norm(actual/127.5-1,axis=-1)-1)))<.007)
    for k,master in arrays.items():
        half=np.asarray(Image.open(ROOT/f'plate_{k}_1024.png'))
        area=avg2(master);peak=65535 if k=='height' else 255
        if k=='height':
            lanczos=np.asarray(Image.fromarray(master.astype(np.float32)).resize((1024,1024),RESAMPLE))
        else:lanczos=np.asarray(Image.fromarray(master).resize((1024,1024),RESAMPLE))
        metrics['downsample'][k]=dict(area_psnr_db=psnr(area,half,peak),lanczos_psnr_db=psnr(lanczos,half,peak),exact_rounded_area=bool(np.array_equal(np.rint(area),half)))
        require(k+' reduction exceeds 30 dB',min(metrics['downsample'][k]['area_psnr_db'],metrics['downsample'][k]['lanczos_psnr_db'])>30)
        if k!='normal':require(k+' exact area reduction',np.array_equal(np.rint(area),half))
    with np.load(ROOT/'source/construction_fields.npz') as src:
        row=(np.arange(2048)+.5)*1500/2048
        region_masks={'seam':np.broadcast_to((row<122)[:,None],(2048,2048)),
                      'bare':np.broadcast_to(((row>129)&(row<246))[:,None],(2048,2048)),
                      'face':np.broadcast_to(((row>258)&(row<1492))[:,None],(2048,2048))}
        b=arrays['base'];o=arrays['orm']/255
        for name,mask in region_masks.items():
            metrics['regions'][name]=dict(mean_srgb=b[mask].mean(0).tolist(),std_srgb=b[mask].std(0).tolist(),roughness_range=[float(o[...,1][mask].min()),float(o[...,1][mask].max())],mean_roughness=float(o[...,1][mask].mean()),mean_metalness=float(o[...,2][mask].mean()))
        face=region_masks['face'];bare=src['bare'];rust=src['rust'];grime=src['grime'];paint=src['paint']
        unpainted=bare>.999
        cleanpaint=(paint>.999)&(rust<.001)&(grime<.001)
        require('face palette target',np.max(abs(b[face].mean(0)-[98,110,100]))<1)
        require('bare palette target',np.max(abs(b[region_masks['bare']].mean(0)-[150,150,148]))<2)
        require('paint is dielectric',np.all(arrays['orm'][...,2][paint>.999]==0),int(arrays['orm'][...,2][paint>.999].max()))
        require('clean paint roughness .60-.75',o[...,1][cleanpaint].min()>=.6-1/255 and o[...,1][cleanpaint].max()<=.75+1/255)
        require('bare band metalness 89',np.all(arrays['orm'][...,2][region_masks['bare']]==89))
        require('bare band roughness .45-.60',o[...,1][region_masks['bare']].min()>=.45-1/255 and o[...,1][region_masks['bare']].max()<=.60+1/255)
        cleansteel=unpainted&(rust<.001)&(grime<.001)
        require('clean steel and rivet roughness .45-.60',o[...,1][cleansteel].min()>=.45-1/255 and o[...,1][cleansteel].max()<=.60+1/255)
        require('bright rivet tops metalness 115',np.all(arrays['orm'][...,2][src['rivet_wear']>.999]==115))
        require('shallow AO',arrays['orm'][...,0].min()>=204,int(arrays['orm'][...,0].min()))
        require('base matches shared fields',np.array_equal(b,np.clip(np.rint(src['base_unquantized']),0,255).astype(np.uint8)))
        for i,k in enumerate(('ao','roughness','metalness')):
            require(k+' matches shared fields',np.array_equal(arrays['orm'][...,i],np.rint(src[k]*255).astype(np.uint8)))
        height=arrays['height'].astype(float)*8/65535
        max_herr=float(abs(height-src['height_mm']).max())
        require('height quantization matches physical source',max_herr<=8/65535*.501,max_herr)
        require('height within 0-8 mm',height.min()>0 and height.max()<8)
        metrics['height']=dict(range_mm=[0,8],actual_extrema_mm=[float(height.min()),float(height.max())],reference_steel_mm=1.5,paint_thickness_mm=.2,max_source_error_mm=max_herr)
        edge=np.broadcast_to((((row>258)&(row<330))|(row>1420))[:,None],face.shape)&face
        middle=np.broadcast_to(((row>450)&(row<1300))[:,None],face.shape)
        chips=src['chips']
        metrics['coverage']=dict(face_bare_fraction=float((bare[face]>.5).mean()),face_chip_weight=float(chips[face].mean()),edge_chip_weight=float(chips[edge].mean()),middle_chip_weight=float(chips[middle].mean()),rust_above_10_percent=float((rust[face]>.1).mean()),grime_above_10_percent=float((grime[face]>.1).mean()))
        require('chips denser at panel edges',chips[edge].mean()>chips[middle].mean()*2)
        require('face mostly intact paint',float((bare[face]>.5).mean())<.04)
        require('rust sparse',float((rust[face]>.1).mean())<.01)
        # A fitted plane detects unintended broad colour ramps in the clean face.
        meanrows=b[365:2010].astype(float).mean(1)
        meancols=b[365:2010].astype(float).mean(0)
        drift_y=np.polyfit(np.linspace(-.5,.5,len(meanrows)),meanrows,1)[0]
        drift_x=np.polyfit(np.linspace(-.5,.5,len(meancols)),meancols,1)[0]
        metrics['base_drift_bytes']=dict(x=drift_x.tolist(),y=drift_y.tolist())
        require('no broad directional colour ramp',max(abs(drift_x).max(),abs(drift_y).max())<4)
        # Relief direction: first difference of retained brush field, before chips.
        brush=src['brush']
        bx=float(abs(brush-np.roll(brush,1,1)).mean());by=float(abs(brush-np.roll(brush,1,0)).mean())
        metrics['horizontal_brush_direction_ratio']=by/bx
        require('brush marks run horizontally',by/bx>5)
    params=json.loads((ROOT/'source/construction.json').read_text())
    rv=params['features']['rivets'];xs=np.array([v['x_mm'] for v in rv])
    spacing=np.diff(np.r_[xs,xs[0]+1500])
    require('25 rivets',len(rv)==25,len(rv))
    require('60 mm rivet spacing',np.max(abs(spacing-60))<1e-6)
    require('14 mm rivet diameters',all(13.5<r['diameter_mm']<14.5 for r in rv))
    require('4 mm proud rivets',all(3.8<r['proud_mm']<4.2 for r in rv))
    require('exact band boundaries',params['band_boundaries_mm']==[0,125,250,1500])
    metrics['features']={k:len(v) for k,v in params['features'].items()}
    metrics['checks']=checks
    metrics['passed']=sum(c['pass_'] for c in checks)
    metrics['failed']=[c for c in checks if not c['pass_']]
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    views(arrays,metrics)
    metrics['check_seconds']=round(time.time()-start,3)
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    (OUT/'check.log').write_text('\n'.join(('PASS' if c['pass_'] else 'FAIL')+' '+c['name'] for c in checks)+'\n')
    print(json.dumps(dict(passed=metrics['passed'],failed=metrics['failed'],normal=metrics['normal'],downsample=metrics['downsample'],regions=metrics['regions'],coverage=metrics['coverage'],check_seconds=metrics['check_seconds']),indent=2))
    if metrics['failed']:raise SystemExit(1)


if __name__=='__main__':
    main()
