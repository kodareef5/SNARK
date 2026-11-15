#!/usr/bin/env python3
"""Independent file checks and CPU material diagnostics, not game captures.

Closed ellipsoid, two polar charts meeting below the equator, tangent-space
normal mapping, linear-light mip filtering, Lambert diffuse + small roughness
dependent specular. Core-only render has no silhouette foliage; optional fig spray planes are a separate diagnostic.
"""
from pathlib import Path
import hashlib
import json
import math
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parent
CHECKS=ROOT/'checks'
REF=ROOT/'../../ref/concept/broadleaf'
RADIUS=240.64
LUMA=np.array([.2126,.7152,.0722])
HEIGHT_MM=240.


def font(n=16):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(path).exists():return ImageFont.truetype(path,n)
    return ImageFont.load_default()


def normalize(a):
    return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-9)


def linear(a):
    a=a/255.
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.clip(a,0,1)
    return np.rint(255*np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)).astype(np.uint8)


def resize(a,size):
    if a.ndim==2:return np.asarray(Image.fromarray(a.astype(np.float32)).resize(size,Image.Resampling.BOX))
    return np.stack([resize(a[...,k],size) for k in range(a.shape[-1])],-1)


def png_chunks(path):
    data=path.read_bytes();pos=8;out={}
    while pos<len(data):
        n=struct.unpack('>I',data[pos:pos+4])[0]
        kind=data[pos+4:pos+8].decode('ascii')
        out[kind]=data[pos+8:pos+8+n];pos+=n+12
    return out

class Renderer:
    def __init__(self,base,normal,orm,phone=False):
        self.charts={}
        for idx in range(7):
            row,col=divmod(idx,4);y=row*512;x=col*512
            b=linear(base[y:y+512,x:x+512].astype(float))
            n=normal[y:y+512,x:x+512].astype(float)/127.5-1
            o=orm[y//2:y//2+256,x//2:x//2+256].astype(float)/255
            o=resize(o,(512,512))
            material=np.concatenate([b,n,o[...,:2]],axis=-1)
            if phone:material=resize(material,(256,256))
            levels=[material]
            while levels[-1].shape[0]>1:
                a=levels[-1];h,w=a.shape[:2]
                levels.append(a.reshape(h//2,2,w//2,2,8).mean((1,3)))
            self.charts[idx]=levels

    def sample(self,idx,u,v,lod):
        levels=self.charts[idx];s=levels[0].shape[0]
        lod=np.clip(lod+math.log2(s/512),0,len(levels)-1)
        lo=np.floor(lod).astype(int);frac=lod-lo
        out=np.zeros((*u.shape,8))
        for delta in [0,1]:
            k=np.minimum(lo+delta,len(levels)-1)
            for level in np.unique(k):
                mask=k==level;a=levels[level];scale=a.shape[0]/512
                coords=[(v[mask]+.5)*scale-.5,(u[mask]+.5)*scale-.5]
                vals=np.stack([ndi.map_coordinates(a[...,c],coords,order=1,mode='nearest') for c in range(8)],-1)
                weight=frac[mask] if delta else 1-frac[mask]
                out[mask]+=vals*weight[:,None]
        return out

    def render(self,index,diameter=60,light=(.1,-.1,1),elevation=35,rotation=0,ss=4,buffers=False):
        size=diameter+12;count=size*ss
        yy,xx=np.mgrid[:count,:count].astype(float)
        world_width=3.0 if buffers else 2.8
        x=(xx+.5-count/2)*world_width/(diameter*ss)
        y=-(yy+.5-count/2)*world_width/(diameter*ss)
        el=np.deg2rad(elevation)
        view=np.array([0,-np.cos(el),np.sin(el)])
        right=np.array([1,0,0]);up=np.cross(view,right)
        axes=np.array([1.05,1.05,.70]) if buffers else np.array([1.4,1.4,.93])
        origin=x[...,None]*right+y[...,None]*up
        aa=np.sum((view/axes)**2)
        bb=np.sum(origin*view/axes**2,axis=-1)
        cc=np.sum((origin/axes)**2,axis=-1)-1
        disc=bb*bb-aa*cc;valid=disc>=0
        t=(-bb+np.sqrt(np.maximum(0,disc)))/aa
        p=origin+t[...,None]*view
        nmesh=normalize(p/axes**2)
        param=p/axes
        theta=np.arccos(np.clip(param[...,2],-1,1))
        top=theta<=1.75
        sign=np.where(top,1.,-1.)
        beta=np.where(top,theta,np.pi-theta)
        phi=np.arctan2(sign*param[...,1],param[...,0])-np.deg2rad(rotation)
        cap=np.where(top,1.75,np.pi-1.75)
        rr=beta/cap*RADIUS
        u=255.5+rr*np.cos(phi);v=255.5-rr*np.sin(phi)
        # Per-pixel UV footprint; average materials in linear light first.
        uy,ux=np.gradient(u);vy,vx=np.gradient(v)
        # Each supersample integrates its OWN footprint. Multiplying by ss
        # here would apply the full-pixel box once per subsample and blur twice.
        footprint=np.maximum(np.hypot(ux,vx),np.hypot(uy,vy))
        lod=np.log2(np.maximum(footprint,1))
        upper=min(index,5);lower=6
        if index==6:lower=6;upper=4
        mat=self.sample(upper,u,v,lod)
        bot=self.sample(lower,u,v,lod)
        mat=np.where(top[...,None],mat,bot)
        # Derivative of the two polar chart surfaces, then rotate back into
        # world space. B = N cross T implements image row-down / tangent Y-up.
        phi_world=phi+np.deg2rad(rotation)
        dtheta=np.stack([np.cos(beta)*np.cos(phi_world),
                        sign*np.cos(beta)*np.sin(phi_world),-sign*np.sin(beta)],-1)*axes
        dphi=np.stack([-np.sin(beta)*np.sin(phi_world),
                      sign*np.sin(beta)*np.cos(phi_world),np.zeros_like(beta)],-1)*axes
        tangent=dtheta*np.cos(phi)[...,None]-dphi*(np.sin(phi)/np.maximum(beta,.00001))[...,None]
        tangent=normalize(tangent-nmesh*np.sum(tangent*nmesh,axis=-1,keepdims=True))
        bitangent=np.cross(nmesh,tangent)
        tn=normalize(mat[...,3:6])
        normal=normalize(tangent*tn[...,0,None]+bitangent*tn[...,1,None]+nmesh*tn[...,2,None])
        sun=normalize(np.array(light,float));ndotl=np.maximum(0,np.sum(normal*sun,axis=-1))
        # Prevent detail normals shining through the reverse of the shell.
        direct_gate=np.clip(np.sum(nmesh*sun,axis=-1)*6,0,1)
        ao=mat[...,6];rough=mat[...,7]
        ambient=.30+.10*np.maximum(nmesh[...,2],0)
        diffuse=ambient*ao+.86*ndotl*direct_gate
        half=normalize(sun+view)
        ndoth=np.maximum(0,np.sum(normal*half,axis=-1))
        spec=.018*(1-rough)*ndoth**(2+25*(1-rough))*direct_gate
        lit=mat[...,:3]*diffuse[...,None]+spec[...,None]
        background=linear(np.array([178,197,211],float))
        lit=np.where(valid[...,None],lit,background)
        if buffers:return dict(lit=lit,depth=np.where(valid,t,-1e9),origin=origin,view=view,size=size,ss=ss)
        lit=lit.reshape(size,ss,size,ss,3).mean((1,3))
        return Image.fromarray(srgb(lit))


class AssemblyRenderer:
    """Twelve fixed radial cutout cards with exact existing fig material.

    Approximate one 3m head, 2.1m opaque core (0.7 reach). This is a local
    integration diagnostic, not the game's layout, shader or a proposed mesh.
    """
    def __init__(self,renderer,phone=False):
        self.renderer=renderer
        root=ROOT/'../fig_leaves'
        b=np.asarray(Image.open(root/'fig_leaves_base.png'),float)
        n=np.asarray(Image.open(root/'fig_leaves_normal.png'),float)/127.5-1
        o=np.asarray(Image.open(root/'fig_leaves_orm.png'),float)/255
        self.sprites=[]
        for k in range(4):
            y,x=(k//2)*512,(k%2)*512;sl=np.s_[y:y+512,x:x+512]
            alpha=b[sl][...,3:4]/255
            a=np.concatenate([linear(b[sl][...,:3])*alpha,n[sl],o[sl][...,:2],alpha],-1)
            if phone:a=resize(a,(256,256))
            levels=[a]
            while levels[-1].shape[0]>1:
                v=levels[-1];h,w=v.shape[:2]
                levels.append(v.reshape(h//2,2,w//2,2,9).mean((1,3)))
            self.sprites.append(levels)

    def sample(self,k,u,v,lod):
        levels=self.sprites[k];s=levels[0].shape[0]
        lod=np.clip(lod+math.log2(s/512),0,len(levels)-1);lo=int(lod);f=lod-lo
        result=np.zeros((*u.shape,9))
        for level,weight in [(lo,1-f),(min(lo+1,len(levels)-1),f)]:
            a=levels[level];scale=a.shape[0]/512
            coords=[(v+.5)*scale-.5,(u+.5)*scale-.5]
            for c in range(9):result[...,c]+=weight*ndi.map_coordinates(a[...,c],coords,order=1,mode='nearest')
        result[...,:3]/=np.maximum(result[...,8,None],.0001)
        return result

    def render(self,index,size,light,elevation=25,rotation=0):
        buf=self.renderer.render(index,size,light,elevation,rotation,buffers=True)
        origin,view=buf['origin'],buf['view'];lit,depth=buf['lit'],buf['depth']
        sun=normalize(np.array(light,float));half=normalize(sun+view)
        for k in range(12):
            # Equal-area directions, fixed deterministic placement.
            z=1-2*(k+.5)/12;phi=k*math.pi*(3-math.sqrt(5))+math.radians(rotation)
            radial=np.array([np.sqrt(1-z*z)*np.cos(phi),np.sqrt(1-z*z)*np.sin(phi),z])
            tangent=normalize(np.cross([0,0,1],radial))
            # Card grows out of the head along radial, with a slight lean.
            face=normalize(np.cross(tangent,radial))
            along=normalize(.94*radial+.34*face)
            face=normalize(np.cross(tangent,along))
            centre=radial*np.array([.92,.92,.66])
            denom=float(view@face)
            if abs(denom)<.03:continue
            t=np.sum((centre-origin)*face,axis=-1)/denom
            delta=origin+t[...,None]*view-centre
            u=(np.sum(delta*tangent,axis=-1)/1.2+.5)*512-.5
            v=(.5-np.sum(delta*along,axis=-1)/1.2)*512-.5
            vy,vx=np.gradient(v);uy,ux=np.gradient(u)
            footprint=max(float(np.hypot(ux,uy).mean()),float(np.hypot(vx,vy).mean()),1)
            card=(0 if z>0 else 1)+(2 if k%3==0 else 0)
            mat=self.sample(card,u,v,math.log2(footprint))
            active=(u>=0)&(u<=511)&(v>=0)&(v<=511)&(mat[...,8]>=.5)&(t>depth)
            shell=normalize(delta+centre)
            tn=normalize(mat[...,3:6])
            # Leaf cards share a rounded shell normal, matching the head system;
            # local detail perturbs it without exposing the rectangle's plane.
            T=normalize(tangent-shell*np.sum(shell*tangent,axis=-1,keepdims=True))
            B=np.cross(shell,T)
            normal=normalize(T*tn[...,0,None]+B*tn[...,1,None]+shell*tn[...,2,None])
            ndotl=np.maximum(0,np.sum(normal*sun,axis=-1))
            gate=np.clip(np.sum(shell*sun,axis=-1)*6,0,1)
            ambient=.30+.10*np.maximum(shell[...,2],0)
            rough=mat[...,7];ndoth=np.maximum(0,np.sum(normal*half,axis=-1))
            spec=.018*(1-rough)*ndoth**(2+25*(1-rough))*gate
            rgb=mat[...,:3]*(ambient*mat[...,6]+.86*ndotl*gate)[...,None]+spec[...,None]
            lit=np.where(active[...,None],rgb,lit);depth=np.where(active,t,depth)
        n,ss=buf['size'],buf['ss']
        return Image.fromarray(srgb(lit.reshape(n,ss,n,ss,3).mean((1,3))))


BG=(25,31,32)
INK=(226,232,212)
MUTED=(174,189,181)
LABELS=['Sun A','Sun B','Middle A','Middle B','Shade A','Shade B','Underside','Interior']


def sheet(size,title,subtitle=''):
    im=Image.new('RGB',size,BG);d=ImageDraw.Draw(im)
    d.text((22,16),title,font=font(25),fill=INK)
    if subtitle:d.text((22,52),subtitle,font=font(16),fill=MUTED)
    return im,d


def cell(a,i):
    y,x=(i//4)*512,(i%4)*512
    return a[y:y+512,x:x+512]


def purpose_sheet(renderer,phone=False):
    im,d=sheet((1580,1340),'FIG / BANYAN HEADS  |  '+('HALF-SIZE PHONE ATLAS' if phone else 'FULL ATLAS'),
        'Closed 2.8 x 2.8 x 1.86 m head; linear-light mips; fixed exposure. Actual pixels and nearest-neighbour enlargement.')
    concept=Image.open(REF/'fig_lineup.png').convert('RGB')
    crop=concept.crop((int(concept.width*.28),0,int(concept.width*.73),int(concept.height*.94)))
    crop.thumbnail((490,390),Image.Resampling.LANCZOS);im.paste(crop,(1060,104))
    d.text((1060,500),'Project concept: middle strangler fig',font=font(18),fill=INK)
    d.text((1060,530),'Art reference; no camera registration.',font=font(16),fill=MUTED)
    c=Image.open(REF/'banyan_hall.png').convert('RGB')
    c=c.crop((c.width//2,0,c.width,c.height//2));c.thumbnail((490,300),Image.Resampling.LANCZOS)
    im.paste(c,(1060,585))
    for y,line in enumerate(['Project concept: banyan canopy from below.',
        'Material diagnostic, not a game capture.',
        'Core alone: smooth geometric silhouette.',
        'The game adds cutout sprays at the rim.',
        'Top view elevation 35 degrees; underside -70.',
        'Both charts meet below the widest ring.',
        'No exposure lift or artificial rim light.']):
        d.text((1060,900+y*32),line,font=font(16),fill=MUTED)
    for row,(name,idx,elev) in enumerate([('Sun',0,35),('Middle',2,35),('Shade',4,35),('Underside',6,-70)]):
        y0=95+row*303
        d.text((22,y0),name+' / cell '+str(idx),font=font(21),fill=INK)
        for j,(lname,light) in enumerate([('Above',(.1,-.15,1)),('Side',(-1,-.15,.2))]):
            x0=22+j*510;d.text((x0,y0+33),lname,font=font(17),fill=MUTED)
            for k,size in enumerate([60,25,12]):
                x=x0+k*167
                shot=renderer.render(idx,size,light,elevation=elev)
                shot.save(CHECKS/f'{"phone_" if phone else ""}head_{idx}_{size}_{lname.lower()}.png')
                im.paste(shot,(x,y0+60))
                scale=2 if size==60 else 3
                im.paste(shot.resize((shot.width*scale,shot.height*scale),Image.Resampling.NEAREST),(x,y0+140))
                d.text((x,y0+285),f'{size}px / {scale}x',font=font(15),fill=MUTED)
    im.save(CHECKS/('purpose_phone.png' if phone else 'purpose_distance.png'))


def review_sheets(base,normal,height,orm,renderer):
    im,d=sheet((1100,690),'FIG / BANYAN  |  UPPER CROWN ATLAS','Eight 512px cells; 50% preview. Discs have radius 240.64px; corners remain opaque foliage.')
    for i in range(8):
        x=22+(i%4)*268;y=95+(i//4)*290
        d.text((x,y),str(i)+'  '+LABELS[i],font=font(17),fill=INK)
        im.paste(Image.fromarray(cell(base,i)).resize((256,256),Image.Resampling.LANCZOS),(x,y+25))
    im.save(CHECKS/'atlas_preview.png')
    im,d=sheet((1480,980),'SAME PHYSICAL SCALE  |  FIG HEADS AND CURRENT SPRAYS',
        'Head pitch 109.38px/m. Each patch and each entire card covers 1.2m; all enlarged by the same factor.')
    cards=Image.open(ROOT/'../fig_leaves/fig_leaves_base.png').convert('RGBA')
    pixels=round(1.2*RADIUS/2.2)
    for k,idx in enumerate([0,2,4,6]):
        x=22+k*364
        patch=cell(base,idx)[170:170+pixels,170:170+pixels]
        im.paste(Image.fromarray(patch).resize((340,340),Image.Resampling.NEAREST),(x,100))
        d.text((x,455),LABELS[idx]+' / 1.2m patch',font=font(18),fill=INK)
        col,row=k%2,k//2
        card=cards.crop((col*512,row*512,(col+1)*512,(row+1)*512))
        # Premultiplied linear-light reduction, then composite on dark green.
        a=np.asarray(card,float);alpha=a[...,3:4]/255
        b=resize(linear(a[...,:3])*alpha,(pixels,pixels));alpha=resize(alpha,(pixels,pixels))
        out=srgb(b+linear(np.array([24,34,23],float))*(1-alpha))
        im.paste(Image.fromarray(out).resize((340,340),Image.Resampling.NEAREST),(x,510))
        d.text((x,865),'Existing spray '+str(k)+' / 1.2m card',font=font(18),fill=INK)
    d.text((22,915),'Brief: head blades 100–140mm. Existing fig cards declare 140–200mm; shown unchanged, with no scale adjustment.',font=font(18),fill=MUTED)
    for j,mm in enumerate([100,120,140]):
        x=22+j*220;length=mm/1000*RADIUS/2.2*340/pixels
        d.line((x,955,x+length,955),fill=(158,165,80),width=3)
        d.text((x+length+10,942),f'{mm}mm',font=font(17),fill=MUTED)
    im.save(CHECKS/'leaf_scale_and_cards.png')
    im,d=sheet((1380,1120),'CENTRE / RIM / CORNER  |  NO COLOUR-TEXTURE BLUR',
        '96px patches at 2.25x. Radius reaches x=496px on the right; rim patch crosses that line.')
    for row,idx in enumerate([0,2,4,6]):
        y=96+row*250
        d.text((22,y),LABELS[idx],font=font(19),fill=INK)
        a=cell(base,idx)
        for col,(label,box) in enumerate([('Centre',(208,208,304,304)),('Rim',(416,208,512,304)),('Corner',(0,0,96,96))]):
            x=170+col*395
            x0,y0,x1,y1=box
            patch=Image.fromarray(a[y0:y1,x0:x1]).resize((216,216),Image.Resampling.NEAREST)
            im.paste(patch,(x,y));d.text((x+230,y+20),label,font=font(17),fill=MUTED)
    im.save(CHECKS/'edge_detail.png')
    im,d=sheet((1380,860),'ALL SEVEN CHARTS  |  ROTATION AND UNDERSIDES',
        '90px cores enlarged 1.8x. Same side light; rows at 0 / 90 / 180 / 270 degrees.')
    for i in range(7):
        x=20+i*194;d.text((x,95),LABELS[i],font=font(17),fill=INK)
        for row,rot in enumerate([0,90,180,270]):
            shot=renderer.render(i,90,(-1,-.1,.35),elevation=-70 if i==6 else 35,rotation=rot)
            im.paste(shot.resize((184,184),Image.Resampling.NEAREST),(x,120+row*184))
    im.save(CHECKS/'all_heads.png')
    im,d=sheet((1380,940),'FOUR MATERIAL LAYERS','Height display uses the full delivered 0–240mm range. Only base colour is sRGB.')
    arrays=[base,normal,np.repeat((height/257).astype(np.uint8)[...,None],3,2),orm]
    for i,(a,name) in enumerate(zip(arrays,['Base colour','Tangent normal','16-bit height (display)','Occlusion / roughness / zero metal'])):
        x=22+(i%2)*690;y=94+(i//2)*412
        d.text((x,y),name,font=font(19),fill=INK)
        im.paste(Image.fromarray(a).resize((650,325),Image.Resampling.LANCZOS),(x,y+34))
    im.save(CHECKS/'layers.jpg',quality=94)
    tile=cell(base,7)
    Image.fromarray(np.tile(tile,(2,2,1))).save(CHECKS/'interior_tiled_2x2.png')
    Image.fromarray(np.roll(tile,(256,256),(0,1))).save(CHECKS/'interior_offset.png')
    im,d=sheet((1540,650),'LEAF DETAIL AT 6x  |  10px GRID = 91.4mm OF SURFACE',
        'Unsharpened 80px crops from local coordinates (200,200). Complete blades overlap; foreshortened faces look shorter.')
    for j,idx in enumerate([0,4,6]):
        x=22+j*506
        p=cell(base,idx)[200:280,200:280]
        im.paste(Image.fromarray(p).resize((480,480),Image.Resampling.NEAREST),(x,115))
        for k in range(0,81,10):
            d.line((x+k*6,115,x+k*6,595),fill=(76,87,77),width=1)
            d.line((x,115+k*6,x+480,115+k*6),fill=(76,87,77),width=1)
            if k<80:d.text((x+k*6,90),str(200+k),font=font(13),fill=MUTED)
        d.text((x,607),LABELS[idx]+'; target full blade 10.94–15.31px',font=font(16),fill=INK)
    im.save(CHECKS/'leaf_detail_grid.png')


def leaf_proxy(green,periodic=False):
    # Bright face cores, not semantic whole leaves: report uncertainty explicitly.
    blurred=ndi.gaussian_filter(green,7 if periodic else 4,mode='wrap' if periodic else 'reflect')
    mask=(green-blurred)>10
    y,x=np.mgrid[:512,:512]
    if not periodic:mask &= np.hypot(x-255.5,y-255.5)<205
    labels,n=ndi.label(mask);obs=[]
    for label,sl in enumerate(ndi.find_objects(labels),1):
        if sl is None:continue
        patch=labels[sl]
        yy,xx=np.nonzero(patch==label)
        area=len(xx)
        if area<6 or area>900:continue
        cov=np.cov(np.array([xx,yy]),bias=True)
        eig=np.linalg.eigvalsh(cov)
        obs.append([4*np.sqrt(eig[1]+1/12),4*np.sqrt(eig[0]+1/12),area])
    a=np.asarray(obs)
    return dict(count=len(a),median_length_px=float(np.median(a[:,0])),
        median_width_px=float(np.median(a[:,1])),length_p10_p90=np.percentile(a[:,0],[10,90]).tolist())


def assembly_sheet(renderer,phone=False):
    im,d=sheet((1540,1080),'CORE + TWELVE EXISTING FIG SPRAYS  |  '+('PHONE' if phone else 'FULL ATLAS'),
        '3m nominal span, 2.1m opaque core; 1.2m cutout cards; fixed exposure. Local assembly diagnostic, not engine footage.')
    assembly=AssemblyRenderer(renderer,phone)
    for row,(label,idx,elev) in enumerate([('Sun / 25 degree view',0,25),('Shade / 25 degree view',4,25),('From below / -50 degree view',6,-50)]):
        y=100+row*310;d.text((22,y),label,font=font(21),fill=INK)
        for col,(lname,light) in enumerate([('Above',(.1,-.15,1)),('Side',(-1,-.15,.2))]):
            x0=22+col*510;d.text((x0,y+34),lname,font=font(17),fill=MUTED)
            for k,size in enumerate([60,25,12]):
                x=x0+k*167;shot=assembly.render(idx,size,light,elev)
                im.paste(shot,(x,y+60))
                scale=2 if size==60 else 3
                im.paste(shot.resize((shot.width*scale,shot.height*scale),Image.Resampling.NEAREST),(x,y+140))
                d.text((x,y+285),f'{size}px span / {scale}x',font=font(15),fill=MUTED)
    c=Image.open(REF/'fig_lineup.png').convert('RGB')
    c=c.crop((int(c.width*.34),int(c.height*.10),int(c.width*.62),int(c.height*.52)))
    c.thumbnail((470,440),Image.Resampling.LANCZOS);im.paste(c,(1050,100))
    lines=['Project concept: foliage clumps.',
        'Existing cards: alpha, colour, normal, ORM.',
        'No repainting or scale correction of cards.',
        'Alpha cut 0.5, no coverage boost.',
        'Linear-light colour mips, normal filtering.',
        'Twelve fixed radial planes around core.',
        'No cast shadows between cards.',
        'At long range the game reduces sprays;',
        'use the separate core-only sheet too.']
    for j,line in enumerate(lines):d.text((1050,600+j*32),line,font=font(16),fill=MUTED)
    im.save(CHECKS/('assembly_phone.png' if phone else 'assembly_distance.png'))


def audit(base,normal,height,orm):
    tests=[];records=[]
    def check(name,ok,value=None):tests.append(dict(name=name,passed=bool(ok),value=value))
    for name,mode,size,depth,ctype in [('base','RGB',(2048,1024),8,2),('normal','RGB',(2048,1024),8,2),
            ('height','I;16',(2048,1024),16,0),('orm','RGB',(1024,512),8,2)]:
        path=ROOT/f'fig_heads_{name}.png';im=Image.open(path);chunks=png_chunks(path)
        check(name+' dimensions',im.size==size,list(im.size))
        check(name+' format',im.mode==mode and chunks['IHDR'][8]==depth and chunks['IHDR'][9]==ctype,im.mode)
        check(name+' colour space',('sRGB' in chunks)==(name=='base'))
    check('metal zero',int(orm[...,2].max())==0)
    check('pigment ceilings',np.all(base.max((0,1))<=np.array([160,165,80])),base.max((0,1)).tolist())
    targets=[(96,112,58)]*2+[(74,92,52)]*2+[(56,74,46)]*2+[(78,90,64),(36,50,36)]
    yy,xx=np.mgrid[:512,:512];rr=np.hypot(xx-255.5,yy-255.5)/RADIUS
    inner=rr<=1
    for i in range(8):
        b=cell(base,i).astype(float);z=cell(height,i).astype(float)*240/65535
        n=cell(normal,i).astype(float)/127.5-1
        o=orm[(i//4)*256:(i//4+1)*256,(i%4)*256:(i%4+1)*256].astype(float)/255
        mask=np.ones((512,512),bool) if i==7 else inner
        mean=b[mask].mean(0);check(f'cell {i} mean',max(abs(mean-targets[i]))<2,mean.tolist())
        pitch=2400/512 if i==7 else 2200/RADIUS
        if i==7:
            dx=(np.roll(z,-1,1)-np.roll(z,1,1))/(2*pitch)
            dy=(np.roll(z,-1,0)-np.roll(z,1,0))/(2*pitch)
        else:dy,dx=np.gradient(z,pitch)
        expected=normalize(np.stack([-dx,dy,np.ones_like(z)],-1))
        ang=np.degrees(np.arccos(np.clip(np.sum(expected*normalize(n),-1),-1,1)))
        check(f'cell {i} normal from saved height',ang.max()<.42,float(ang.max()))
        check(f'cell {i} normal length',np.max(abs(np.linalg.norm(n,axis=-1)-1))<.007)
        check(f'cell {i} local relief range',z.min()>0 and z.max()<240,[float(z.min()),float(z.max())])
        lum=np.sum(b*LUMA,axis=-1);sep=np.percentile(lum[mask],90)-np.percentile(lum[mask],10)
        check(f'cell {i} face-gap contrast',sep>(40 if i==7 else 50),float(sep))
        proxy=leaf_proxy(b[...,1],i==7)
        check(f'cell {i} distinct blade faces',proxy['count']>40,proxy['count'])
        residual={}
        for size in [60,25,12]:
            mini=resize(lum,(size,size));y,x=np.mgrid[:size,:size]
            rad=np.hypot(x-(size-1)/2,y-(size-1)/2)/(size*.47)
            m=rad<.85
            # Regress radial terms so edge darkening cannot pass as clump contrast.
            design=np.stack([np.ones_like(rad),rad**2,rad**4],-1)
            fit=np.linalg.lstsq(design[m],mini[m],rcond=None)[0]
            contrast=float(np.std((mini-np.sum(design*fit,axis=-1))[m]));residual[size]=contrast
            # The 60/25/12px readability bar belongs to head discs. The dark
            # interior is a periodic backing tile, not another 12px head.
            if i<7:check(f'cell {i} {size}px clump contrast',contrast>4,contrast)
        if i<7:
            centre=float(lum[rr<.6].mean());rim=float(lum[(rr>.92)&(rr<1)].mean())
            check(f'cell {i} turn-under darkening',centre>rim+5,[centre,rim])
            # Derive full first-order azimuth bias after radial terms.
            nx=(xx-255.5)/256;ny=(yy-255.5)/256
            design=np.stack([np.ones_like(nx),nx,ny,rr**2,rr**4],-1)
            fit=np.linalg.lstsq(design[inner],np.log(np.maximum(lum[inner],5)),rcond=None)[0]
            plane=fit[1:3].tolist()
            check(f'cell {i} no image-axis lighting gradient',max(abs(fit[1:3]))<.08,plane)
        else:plane=[0.,0.]
        records.append(dict(index=i,mean_rgb=mean.tolist(),height_mm=[float(z.min()),float(z.max())],
            normal_error_max_deg=float(ang.max()),roughness_median=float(np.median(o[...,1])),
            ao_min=float(o[...,0].min()),face_gap_p90_p10=float(sep),blade_core_proxy=proxy,
            clump_contrast=residual,log_luminance_plane=plane))
    correlations=[]
    for a,b in [(0,1),(2,3),(4,5)]:
        corr=float(np.corrcoef(np.sum(cell(base,a)*LUMA,axis=-1)[inner],np.sum(cell(base,b)*LUMA,axis=-1)[inner])[0,1])
        check(f'cells {a}/{b} distinct',abs(corr)<.65,corr);correlations.append(corr)
    seams={}
    for name,a in [('base',cell(base,7)),('normal',cell(normal,7)),('height',cell(height,7)),('orm',orm[256:512,768:1024])]:
        a=a.astype(float);ratios=[]
        for axis in [1,0]:
            delta=np.abs(np.diff(a,axis=axis));edge=np.abs(np.take(a,0,axis=axis)-np.take(a,-1,axis=axis))
            ratio=float(edge.mean()/max(delta.mean(),1e-9));ratios.append(ratio)
            check(name+f' interior seam axis {axis}',ratio<2.1,ratio)
        seams[name]=ratios
    check('upper leaves glossy; underside rougher',records[0]['roughness_median']<.45 and
        records[2]['roughness_median']<.5 and records[6]['roughness_median']>.68)
    result=dict(passed=sum(t['passed'] for t in tests),total=len(tests),tests=tests,cells=records,
        seams=seams,pair_correlations=correlations,height_encoding_mm=[0,240],
        shader='CPU closed ellipsoid with polar charts, normalized detail normals, fixed diffuse/specular lighting; not engine footage',
        sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'source').glob('*_generated.png')})
    (CHECKS/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
    for t in tests:
        if not t['passed']:print('FAIL',t['name'],t['value'])
    print(f'{result["passed"]}/{len(tests)} checks pass.')
    return result


def main():
    CHECKS.mkdir(exist_ok=True)
    base=np.asarray(Image.open(ROOT/'fig_heads_base.png'))
    normal=np.asarray(Image.open(ROOT/'fig_heads_normal.png'))
    height=np.asarray(Image.open(ROOT/'fig_heads_height.png'))
    orm=np.asarray(Image.open(ROOT/'fig_heads_orm.png'))
    result=audit(base,normal,height,orm)
    renderer=Renderer(base,normal,orm)
    purpose_sheet(renderer)
    phone=Renderer(base,normal,orm,phone=True)
    purpose_sheet(phone,True)
    review_sheets(base,normal,height,orm,renderer)
    assembly_sheet(renderer)
    assembly_sheet(phone,True)
    if result['passed']!=result['total']:raise SystemExit(1)


if __name__=='__main__':main()
