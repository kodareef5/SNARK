#!/usr/bin/env python3
"""Offline periodic crown skins, in millimetres. Run from any directory.

Original atlas specimens -> de-lit tissue and contours -> overlapping shoot
clumps on a torus -> metric height -> OpenGL normals from the reopened PNG.
No light vector enters the asset builder. Requires numpy, scipy and Pillow.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
CACHE = ROOT / '.cache'
W, H = 2048, 1024
CONFIG = {
    'oak': dict(width_mm=4800., height_mm=2400., range_mm=220., mean=[117,124,64],
                sun_mean=[140,142,66], shade_mean=[94,106,62],
                clumps=9, diameter=[843.75,1968.75], blade=[105,120], aspect=[.45,.57], blade_width=[53,60],
                scale_from_round1=2.8125,
                rough=.950, seed=206111501, shoots_per_m2=650/2.8125**2, leaf_relief=6.0),
    'fig': dict(width_mm=6400., height_mm=3200., range_mm=250., mean=[104.5,116.5,59],
                sun_mean=[125,133,60], shade_mean=[84,100,58],
                clumps=28, diameter=[500*17/12,1100*17/12], blade=[140,200], aspect=[.48,.67],
                scale_from_round1=17/12,
                rough=.948, seed=206111502, shoots_per_m2=78/(17/12)**2, leaf_relief=8.0),
    'mangrove': dict(width_mm=4000., height_mm=2000., range_mm=200., mean=[92,112,57],
                sun_mean=[110,128,58], shade_mean=[74,96,56], scale_from_round1=1.,
                clumps=65, diameter=[300,600], blade=[130,169], aspect=[.47,.60],
                rough=.925, seed=206111503, shoots_per_m2=56, leaf_relief=9.0),
}

def u8(a):
    return np.clip(np.rint(a),0,255).astype(np.uint8)

def save_png(path, array, srgb=False, description=''):
    info=PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB',b'\x00')
        info.add(b'gAMA',(45455).to_bytes(4,'big'))
    info.add_text('Description',description)
    Image.fromarray(array).save(path,pnginfo=info,compress_level=7)

def normal_from_height(height_mm,pitch):
    dx=(np.roll(height_mm,-1,1)-np.roll(height_mm,1,1))/(2*pitch)
    dy=(np.roll(height_mm,-1,0)-np.roll(height_mm,1,0))/(2*pitch)
    n=np.stack([-dx,dy,np.ones_like(dx)],-1)
    return n/np.linalg.norm(n,axis=-1,keepdims=True)

def leaf_library(species):
    """Atlas extraction method, adapted locally; no importing writable siblings.

    Retain generated contours and high-frequency tissue, remove all broad
    source illumination. Material midribs are aligned with the relief ridge.
    """
    a=np.array(Image.open(SOURCE/f'{species}_specimens.png').convert('RGBA'))
    rows=3 if species=='mangrove' else 4
    library=[]
    for row in range(rows):
        for col in range(4):
            cut=a[row*a.shape[0]//rows:(row+1)*a.shape[0]//rows,
                  col*a.shape[1]//4:(col+1)*a.shape[1]//4]
            lab,num=ndi.label(cut[...,3]>180)
            counts=np.bincount(lab.ravel());counts[0]=0
            mask=ndi.binary_fill_holes(lab==counts.argmax())
            widths=mask.sum(1)
            ys=np.flatnonzero(widths>widths.max()*.15)
            lo,hi=ys[0],ys[-1]
            centers=[];halves=[]
            for y in range(lo,hi+1):
                xs=np.flatnonzero(mask[y])
                centers.append((xs[0]+xs[-1])*.5 if len(xs) else centers[-1])
                halves.append((xs[-1]-xs[0]+1)*.5 if len(xs) else .1)
            centers=ndi.gaussian_filter1d(np.array(centers),3)
            halves=ndi.gaussian_filter1d(np.array(halves),1.25)
            t=np.linspace(0,1,256);sy=hi-t*(hi-lo)
            cx=np.interp(sy-lo,np.arange(len(centers)),centers)
            hw=np.interp(sy-lo,np.arange(len(halves)),halves)
            sx=cx[:,None]+hw[:,None]*np.linspace(-.96,.96,64)
            sy=np.broadcast_to(sy[:,None],sx.shape)
            tissue=np.stack([ndi.map_coordinates(cut[...,k].astype(float),[sy,sx],order=1) for k in range(3)],-1)
            tissue=np.clip((tissue-ndi.gaussian_filter(tissue,(22,10,0)))*.45,-12,12)
            shape=hw/hw.max()*np.minimum(1,t*20)*np.minimum(1,(1-t)*25)
            library.append(dict(shape=shape.astype(np.float32),tissue=tissue.astype(np.float32)))
    return library

def torus_delta(a,b,size):
    return (a-b+size/2)%size-size/2

def make_clumps(c,rng):
    """Irregular, overlapping shoot mounds with smaller shoulder lobes.

    A sum of smooth, compact contributions produces rounded saddles. A max
    envelope of parabolas was rejected: its polygonal contacts looked stony.
    """
    size=np.array([c['width_mm'],c['height_mm']])
    pts=[rng.random(2)*size]
    for i in range(c['clumps']-1):
        candidates=rng.random((96,2))*size
        d=torus_delta(candidates[:,None],np.asarray(pts)[None],size)
        nearest=np.min(np.sum(d*d,axis=-1),axis=1)
        # Lower candidate count than a packed blue-noise disk leaves variety.
        pts.append(candidates[np.argmax(nearest*rng.uniform(.76,1.24,96))])
    pts=np.asarray(pts)
    dd=np.linalg.norm(torus_delta(pts[:,None],pts[None,:],size),axis=-1)
    dd+=np.eye(len(pts))*1e6
    near=np.sort(dd,axis=1)[:,:3].mean(1)
    clumps=[]
    for i,pt in enumerate(pts):
        diameter=float(np.clip(near[i]*rng.uniform(1.25,1.65),*c['diameter']))
        clumps.append(dict(id=i,center_mm=pt.tolist(),diameter_mm=diameter,
            aspect=float(rng.uniform(.79,1.12)),angle=float(rng.uniform(-np.pi,np.pi)),
            peak=float(rng.uniform(.88,1.06)),phase=float(rng.uniform(-np.pi,np.pi)),
            pigment=float(rng.normal(0,2.8))))
    yy,xx=np.mgrid[:H,:W].astype(np.float32)
    x=(xx+.5)*size[0]/W;y=(yy+.5)*size[1]/H
    high=np.zeros((H,W),np.float32)
    dominant=np.zeros((H,W),np.float32)
    owner=np.zeros((H,W),np.uint16)
    for q in clumps:
        dx=torus_delta(x,q['center_mm'][0],size[0])
        dy=torus_delta(y,q['center_mm'][1],size[1])
        ca,sa=np.cos(q['angle']),np.sin(q['angle'])
        u=(dx*ca+dy*sa)/(q['diameter_mm']*.5)
        v=(-dx*sa+dy*ca)/(q['diameter_mm']*.5*q['aspect'])
        rr=np.hypot(u,v);theta=np.arctan2(v,u)
        rr*=1+.075*np.cos(3*theta+q['phase'])*np.minimum(rr,1)+.035*np.sin(5*theta-q['phase'])*np.minimum(rr,1)
        z=q['peak']*np.exp(-2.9*rr**2)
        # Two unequal shoulder shoots, not concentric rings or little dots.
        z+=q['peak']*.22*np.exp(-8*((u-.42*np.cos(q['phase']))**2+(v-.42*np.sin(q['phase']))**2))
        z+=q['peak']*.14*np.exp(-11*((u+.51*np.sin(q['phase']))**2+(v-.51*np.cos(q['phase']))**2))
        take=z>dominant;dominant[take]=z[take];owner[take]=q['id']
        high+=z
    high=ndi.gaussian_filter(high,1.0,mode='wrap')
    high=(high-high.min())/np.ptp(high)*(c['range_mm']-20)+8
    return clumps,high,owner

class Painter:
    def __init__(self,c,macro,owner,lib,clumps):
        self.c=c;self.pitch=c['width_mm']/W;self.lib=lib
        self.macro=macro;self.owner=owner;self.clumps=clumps
        self.gx=(np.roll(macro,-1,1)-np.roll(macro,1,1))/(2*self.pitch)
        self.gy=(np.roll(macro,-1,0)-np.roll(macro,1,0))/(2*self.pitch)
        self.sun_rgb=np.broadcast_to(np.array(c['sun_mean'],np.float32),(H,W,3)).copy()
        self.shade_rgb=np.broadcast_to(np.array(c['shade_mean'],np.float32),(H,W,3)).copy()
        self.relief=np.zeros((H,W),np.float32)
        self.rough=np.full((H,W),c['rough'],np.float32)
        self.ids=np.zeros((H,W),np.uint32)
        self.kind=np.zeros((H,W),np.uint8)
        self.sun_kind=np.zeros((H,W),np.uint8)
        self.shade_kind=np.zeros((H,W),np.uint8)
        self.coverage=np.zeros((H,W),np.uint16)
        self.records=[]

    def draw(self,r):
        pitch=self.pitch;d=np.array([np.cos(r['angle']),np.sin(r['angle'])]);p=np.array([-d[1],d[0]])
        length=r['length_mm']/pitch;width=r['width_mm']/pitch
        center=np.asarray(r['center_mm'])/pitch
        ext=np.abs(d)*length*.51+np.abs(p)*width*.65+2
        src=self.lib[r['source']]
        for oy in [-H,0,H]:
            for ox in [-W,0,W]:
                cen=center+[ox,oy]
                lo=np.maximum(np.floor(cen-ext).astype(int),0)
                hi=np.minimum(np.ceil(cen+ext).astype(int),[W,H])
                if np.any(hi<=lo):continue
                sl=np.s_[lo[1]:hi[1],lo[0]:hi[0]]
                yy,xx=np.mgrid[lo[1]:hi[1],lo[0]:hi[0]].astype(np.float32)
                dx=xx+.5-cen[0];dy=yy+.5-cen[1]
                t=(dx*d[0]+dy*d[1])/length+.5;tc=np.clip(t,0,1)
                cross=dx*p[0]+dy*p[1]-r['bend']*width*np.sin(np.pi*tc)
                shape=np.interp(tc,np.linspace(0,1,256),src['shape'])
                half=np.maximum(.02,width*.5*shape);v=cross/half
                # Analytic one-pixel coverage, no hard alpha in the material.
                a=np.clip((1-np.abs(v))*half+.5,0,1)*np.clip(np.minimum(t,1-t)*length+.5,0,1)
                mask=a>0
                if not mask.any():continue
                tissue=np.stack([ndi.map_coordinates(src['tissue'][...,k],[tc*255,(np.clip(v,-1,1)+1)*31.5],order=1,mode='nearest') for k in range(3)],-1)
                rib=np.exp(-(cross*pitch/(.36 if r['species']=='oak' else .8))**2)*np.sin(np.pi*tc)**.5
                crown=np.maximum(0,1-v*v)*np.sin(np.pi*tc)
                # Leaf follows the supporting dome; a shallow lifted tip,
                # cupped lamina and roll make it a shingle on that dome.
                z=r['lift']*(tc-.45)+r['cup']*crown+r['roll']*np.clip(v,-1,1)*np.sin(np.pi*tc)+.32*rib
                # A lamina is a locally tangent surface. It bridges a saddle
                # along its silhouette rather than copying a crease through
                # its middle. Keep some curvature for large leathery blades.
                px=int(center[0])%W;py=int(center[1])%H
                tangent_z=self.macro[py,px]+dx*pitch*self.gx[py,px]+dy*pitch*self.gy[py,px]
                z+=.70*(tangent_z-self.macro[sl])
                alpha=a[...,None]
                # One coverage calculation for both ecotypes. Tissue, midrib,
                # contour, painter order and relief are exactly shared.
                shared=tissue+rib[...,None]*np.array([3,4,1.5])
                shared+=np.sin(np.pi*tc)[...,None]*np.array([1.6,1.3,.4])
                for variant,canvas in [('sun',self.sun_rgb),('shade',self.shade_rgb)]:
                    rgb=np.array(r[variant+'_color'])+shared
                    # Warmth follows each blade's own botanical axis; neither
                    # world-space lighting nor a channel gain is involved.
                    if variant=='sun' and r['sun_kind'] in (1,2):
                        rgb+=tc[...,None]**1.6*np.array([5.,3.,-.6])
                    canvas[sl]=canvas[sl]*(1-alpha)+rgb*alpha
                self.relief[sl]=self.relief[sl]*(1-a)+z*a
                rough=r['rough']+tissue[...,1]*.00012
                self.rough[sl]=self.rough[sl]*(1-a)+rough*a
                take=a>=.5
                self.ids[sl][take]=r['id'];self.kind[sl][take]=r['kind']
                self.sun_kind[sl][take]=r['sun_kind'];self.shade_kind[sl][take]=r['shade_kind']
                self.coverage[sl]+=take

def leaves_for_shoot(species,c,rng,origin,axis,clump,shoot_id,terminal=.5,depth=0):
    """Alternate oak/fig ranks; six opposite mangrove pairs on a short axis."""
    leaves=[];size=np.array([c['width_mm'],c['height_mm']])
    mangrove=species=='mangrove'
    count=12 if mangrove else int(rng.integers(6,10))
    axial=rng.uniform(80,110) if mangrove else np.mean(c['blade'])*1.15
    direction=np.array([np.cos(axis),np.sin(axis)])
    # Sun/shade pigments mixed as entire shoots; no relation to slope direction.
    shoot_pigment=rng.normal(0,5)
    sun_tissue=rng.random()<(.18+.68*terminal)
    pigments={'oak':([124.,129.,69.],[98.,108.,62.]),
              'fig':([111.,122.,64.],[89.,103.,57.]),
              'mangrove':([97.,116.,62.],[79.,100.,55.])}
    shoot_color=np.array(pigments[species][0 if sun_tissue else 1])
    fresh=rng.random()<.045
    for j in range(count):
        rank=j//2 if mangrove else j
        nr=5 if mangrove else count-1
        side=(-1 if j%2 else 1)
        angle=axis+side*np.deg2rad(([115,77,125,66,103,39][rank] if mangrove else rng.uniform(60,120)))+rng.normal(0,.16)
        length=float(rng.uniform(*c['blade']))
        width=float(rng.uniform(*c['blade_width']) if 'blade_width' in c else length*rng.uniform(*c['aspect']))
        node=origin+direction*axial*(rank/nr-.5)
        # Shingled rank: rounded outline, broken by complete source contours.
        center=(node+np.array([np.cos(angle),np.sin(angle)])*length*.44)%size
        col=shoot_color+np.array([1,.82,.38])*(shoot_pigment+rng.normal(0,5))
        col+=clump['pigment']*np.array([1,.85,.40])
        kind=1
        r=rng.random()
        if fresh and rank>=nr-1:
            kind=2;col={'oak':np.array([158.,155.,80.]),'fig':np.array([139.,151.,70.]),'mangrove':np.array([145.,158.,73.])}[species]+rng.normal(0,2)
        elif r<.006:
            kind=3;col={'oak':[121.,128.,88.],'fig':[113.,124.,83.],'mangrove':[112.,127.,81.]}[species]+np.array([1,1,.5])*rng.normal(0,3)
        elif r<.009:
            kind=4;col=np.array([111.,98.,58.])+rng.normal(0,3)
        if depth:col-=np.array([6,5,2])
        source=int(rng.integers(0,14 if not mangrove else 10))
        if mangrove and source in [6,7]:source-=2
        if kind==2:source=10 if mangrove else 14
        elif kind==4:source=11 if mangrove else 15
        relief=c['leaf_relief']
        leaves.append(dict(species=species,shoot=shoot_id,clump=clump['id'],
            center_mm=center.tolist(),angle=float(angle),length_mm=length,width_mm=width,
            source=source,kind=kind,color=np.asarray(col).tolist(),terminal_rank=rank>=nr-1,bend=float(rng.uniform(-.07,.07)),
            lift=float(rng.uniform(.4,1.2)*relief),cup=float(rng.uniform(.35,.8)*relief),
            roll=float(rng.uniform(-.28,.28)*relief),rough=float(c['rough']+rng.uniform(-.006,.006)+(kind==3)*.006)))
    return leaves

def paired_pigments(records,species,c):
    """Botanical pigment populations on one immutable geometric composition.

    A separate RNG stream keeps mangrove's round-1 relief byte-identical.
    Shade matures every fresh blade without moving it or changing its source.
    """
    rng=np.random.default_rng(c['seed']+71023)
    shoots={}
    fresh_colors={'oak':[171,167,84],'fig':[156,160,78],'mangrove':[150,161,77]}
    for r in records:
        if r['shoot'] not in shoots:
            shoots[r['shoot']]=(rng.normal(0,4),rng.random()<.16)
        pigment,new_growth=shoots[r['shoot']]
        special=r['kind'] in (3,4)
        fresh=not special and (r['kind']==2 or (new_growth and r['terminal_rank']))
        r['sun_kind']=2 if fresh else r['kind']
        r['shade_kind']=r['kind'] if special else 1
        variation=pigment+rng.normal(0,5)
        chroma=rng.normal(0,1.8)
        sun=np.array(c['sun_mean'],float)-[3.8,2.8,1.0]
        sun+=variation*np.array([1,.83,.33])+chroma*np.array([1,-.25,-.30])
        shade=np.array(c['shade_mean'],float)+variation*np.array([.64,.73,.42])+chroma*np.array([-.35,.2,.65])
        if fresh:sun=np.array(fresh_colors[species])+rng.normal(0,2)*np.array([1,.85,.5])
        if r['kind']==3:
            # Turned undersides stay as rare as round 1, and never bleach out.
            sun=np.array({'oak':[137,143,91],'fig':[124,135,84],'mangrove':[119,136,81]}[species])+variation*.3
            shade=np.array({'oak':[108,122,88],'fig':[98,115,81],'mangrove':[94,113,79]}[species])+variation*.3
        elif r['kind']==4:
            sun=np.array([124.,109.,61.])+variation*.4
            shade=np.array([92.,91.,58.])+variation*.3
        r['sun_color']=sun.tolist();r['shade_color']=shade.tolist()

def build(species):
    c=CONFIG[species];rng=np.random.default_rng(c['seed'])
    print(f'{species}: extracting tissue and composing domes',flush=True)
    lib=leaf_library(species)
    clumps,macro,owner=make_clumps(c,rng)
    painter=Painter(c,macro,owner,lib,clumps)
    size=np.array([c['width_mm'],c['height_mm']]);pitch=c['width_mm']/W
    records=[];shoots=[]
    n=int(c['width_mm']*c['height_mm']/1e6*c['shoots_per_m2'])
    macro_min=float(macro.min());macro_span=float(np.ptp(macro))
    # Jittered dense supporting shoots. Positions, orientations and heights are
    # determined in metric space before rasterisation and wrap on the torus.
    aspect=size[0]/size[1];nx=round(np.sqrt(n*aspect));ny=round(n/nx)
    for row in range(ny):
        for col in range(nx):
            pt=(np.array([col,row])+rng.uniform(.05,.95,2))*size/[nx,ny]
            iy=int(pt[1]/pitch)%H;ix=int(pt[0]/pitch)%W
            q=clumps[int(owner[iy,ix])]
            delta=torus_delta(pt,np.array(q['center_mm']),size)
            radial=np.arctan2(delta[1],delta[0])
            axis=float(radial+rng.normal(0,.65))
            shoot_id=len(shoots)
            shoots.append(dict(id=shoot_id,center_mm=pt.tolist(),clump=q['id'],axis=axis))
            terminal=float(np.clip((macro[iy,ix]-macro_min)/macro_span,0,1))
            records.extend(leaves_for_shoot(species,c,rng,pt,axis,q,shoot_id,terminal=terminal))
    paired_pigments(records,species,c)
    # Lower slopes first, cap leaves last, so overlap wraps over the form.
    for r in records:
        pt=np.array(r['center_mm'])/pitch
        r['support_mm']=float(ndi.map_coordinates(macro,[[pt[1]-.5],[pt[0]-.5]],order=1,mode='grid-wrap')[0])
    records.sort(key=lambda r:r['support_mm']+rng.uniform(-7,7))
    for i,r in enumerate(records):
        r['id']=i+1;painter.draw(r)
    print(f'{species}: {len(clumps)} clumps / {len(shoots)} shoots / {len(records)} leaves; filling interstices',flush=True)
    # Subpixel gaps continue the nearest visible tissue. Toroidal distance on
    # a modest halo suffices; assert the fallback never reaches that halo.
    bare=painter.ids==0
    prefill=float(bare.mean())
    if bare.any():
        halo=64;pad=np.pad(bare,halo,mode='wrap')
        dist,indices=ndi.distance_transform_edt(pad,return_indices=True)
        core=np.s_[halo:halo+H,halo:halo+W]
        assert dist[core].max()<halo
        iy=(indices[0][core]-halo)%H;ix=(indices[1][core]-halo)%W
        for a in [painter.sun_rgb,painter.shade_rgb,painter.relief,painter.rough,painter.ids,painter.kind,painter.sun_kind,painter.shade_kind]:
            a[bare]=a[iy[bare],ix[bare]]
    z=macro+ndi.gaussian_filter(painter.relief,.62,mode='wrap')
    # Preserve authored cap relief; reserve a small range at both ends.
    # The tangent leaf planes can bridge beyond the initial support range.
    # A single global metric normalization preserves their relation to domes.
    z=(z-z.min())/np.ptp(z)*(c['range_mm']-8)+4
    # Concavity only: a small physical kernel finds narrow dome contacts.
    # No dark disc surrounds a clump; most of its underside is ordinary pigment.
    # Contact shading follows actual overlapping leaf edges. It is broken by
    # complete laminae and never outlines each mathematical mound.
    hollow=np.maximum(ndi.gaussian_filter(z,2.8/pitch,mode='wrap')-z-.35,0)
    leaf_contact=np.clip(hollow/(2.1 if species=='oak' else 4.2),0,1)
    broad_valley=np.clip((ndi.gaussian_filter(macro,30/pitch,mode='wrap')-macro)/6,0,1)
    crease=ndi.gaussian_filter(leaf_contact*(.35+.65*broad_valley),.5,mode='wrap')
    # Match the requested AO range across texel pitches: only the deepest
    # 0.01% of these contact samples reach full cavity strength. The mask is
    # still derived from metric concavity, not a colour/luminance substitute.
    crease=np.clip(crease/max(float(np.quantile(crease,.9999)),.15),0,1)
    # Pigment remains unlit: only recesses get the requested cooler floor.
    amount=.58*crease
    variants={}
    for variant,canvas,kinds in [('sun',painter.sun_rgb,painter.sun_kind),('shade',painter.shade_rgb,painter.shade_kind)]:
        rgb=canvas*(1-amount[...,None])+np.array([40,52,38])*amount[...,None]
        # Small additive mean correction on mature tissue only, preserving
        # fresh tips and the rare underside palette. Never a channel gain.
        weight=(1-crease)*(kinds==1)
        for _ in range(3):
            rgb+=(np.array(c[variant+'_mean'])-rgb.mean((0,1)))*weight[...,None]/weight.mean()
            rgb=np.maximum(rgb,[40,52,38])
        variants[variant]=u8(rgb)
    # Compatibility base: arithmetic mean of the delivered sRGB code values,
    # round-to-nearest/ties-even, maximum quantization error half a level.
    base=u8((variants['sun'].astype(float)+variants['shade'])/2)
    ao=np.clip(1-.38*crease-.055*leaf_contact,.6,1)
    rough=np.clip(painter.rough,.90,.97)
    h16=np.rint(z/c['range_mm']*65535).astype(np.uint16)
    prefix=ROOT/f'{species}_skin'
    for variant,rgb in variants.items():
        save_png(str(prefix)+f'_{variant}_base.png',rgb,True,f'{variant.title()} leaf pigment; same geometry/UVs in both ecotypes; opaque periodic sRGB.')
    save_png(str(prefix)+'_base.png',base,True,'Compatibility pigment: arithmetic mean of delivered sun/shade sRGB bytes, nearest/ties-even. Opaque periodic sRGB.')
    save_png(str(prefix)+'_height.png',h16,False,f'Linear 16-bit. Black=0 mm; white={c["range_mm"]:g} mm. White high.')
    # Reopen the exact delivered quantisation before calculating derivatives.
    delivered=np.asarray(Image.open(str(prefix)+'_height.png'),np.float64)/65535*c['range_mm']
    norm=normal_from_height(delivered,pitch)
    save_png(str(prefix)+'_normal.png',u8(norm*127.5+127.5),False,'OpenGL tangent normal: +X right, +Y picture up, +Z outward. Central wrapped metric derivative of delivered height.')
    orm=np.stack([ao,rough,np.zeros_like(ao)],-1)
    save_png(str(prefix)+'_orm.png',u8(orm*255),False,'Linear R=sky occlusion; G=roughness; B=metalness zero.')
    np.savez_compressed(CACHE/f'{species}_structure.npz',macro_mm=macro.astype(np.float32),
        clump_ids=owner,leaf_ids=painter.ids,leaf_kind=painter.kind,sun_kind=painter.sun_kind,shade_kind=painter.shade_kind,crease=crease.astype(np.float32))
    data=dict(config=c,unfilled_fraction_before_tissue_extension=prefill,
              clumps=clumps,shoots=shoots,leaves=records)
    (CACHE/f'{species}_composition.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
    print(f'{species}: saved six maps; sun {variants["sun"].mean((0,1)).round(3)}, shade {variants["shade"].mean((0,1)).round(3)}; height {z.min():.1f}–{z.max():.1f} mm',flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--species',choices=list(CONFIG),nargs='+',default=list(CONFIG))
    args=parser.parse_args()
    SOURCE.mkdir(exist_ok=True)
    CACHE.mkdir(exist_ok=True)
    for species in args.species:build(species)
    manifest={}
    for p in sorted(ROOT.glob('*_skin_*.png')):
        manifest[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
    (SOURCE/'build_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__=='__main__':main()
