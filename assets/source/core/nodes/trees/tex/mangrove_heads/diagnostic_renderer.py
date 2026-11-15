#!/usr/bin/env python3
"""Independent file checks and CPU material diagnostics, not game captures.

Closed ellipsoid, two polar charts meeting below the equator, tangent-space
normal mapping, linear-light mip filtering, Lambert diffuse + small roughness
dependent specular. Core-only render has no silhouette foliage; optional mangrove spray planes are a separate diagnostic.
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
REF=ROOT/'source'
RADIUS=240.64
LUMA=np.array([.2126,.7152,.0722])
HEIGHT_MM=160.


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
        world_width=2.0 if buffers else 1.4
        x=(xx+.5-count/2)*world_width/(diameter*ss)
        y=-(yy+.5-count/2)*world_width/(diameter*ss)
        el=np.deg2rad(elevation)
        view=np.array([0,-np.cos(el),np.sin(el)])
        right=np.array([1,0,0]);up=np.cross(view,right)
        axes=np.array([.70,.70,.46])
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
        ambient=(.30+.10*np.maximum(nmesh[...,2],0))[...,None]*np.array([.84,.94,1.18])
        diffuse=ambient*ao[...,None]+(.86*ndotl*direct_gate)[...,None]
        half=normalize(sun+view)
        ndoth=np.maximum(0,np.sum(normal*half,axis=-1))
        spec=.018*(1-rough)*ndoth**(2+25*(1-rough))*direct_gate
        lit=mat[...,:3]*diffuse+spec[...,None]
        background=linear(np.array([178,197,211],float))
        lit=np.where(valid[...,None],lit,background)
        if buffers:return dict(lit=lit,depth=np.where(valid,t,-1e9),origin=origin,view=view,size=size,ss=ss)
        lit=lit.reshape(size,ss,size,ss,3).mean((1,3))
        return Image.fromarray(srgb(lit))


class AssemblyRenderer:
    """Twelve fixed radial cutout cards with exact existing mangrove material.

    Approximate one 2m assembly, 1.4m opaque core (0.7 reach). This is a local
    integration diagnostic, not the game's layout, shader or a proposed mesh.
    """
    def __init__(self,renderer,phone=False):
        self.renderer=renderer
        root=ROOT/'source'
        b=np.asarray(Image.open(root/'sprays_base.png'),float)
        n=np.asarray(Image.open(root/'sprays_normal.png'),float)/127.5-1
        o=np.asarray(Image.open(root/'sprays_orm.png'),float)/255
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
            centre=radial*np.array([.61,.61,.44])
            denom=float(view@face)
            if abs(denom)<.03:continue
            t=np.sum((centre-origin)*face,axis=-1)/denom
            delta=origin+t[...,None]*view-centre
            u=(np.sum(delta*tangent,axis=-1)/.8+.5)*512-.5
            v=(.5-np.sum(delta*along,axis=-1)/.8)*512-.5
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
            ambient=(.30+.10*np.maximum(shell[...,2],0))[...,None]*np.array([.84,.94,1.18])
            rough=mat[...,7];ndoth=np.maximum(0,np.sum(normal*half,axis=-1))
            spec=.018*(1-rough)*ndoth**(2+25*(1-rough))*gate
            rgb=mat[...,:3]*(ambient*mat[...,6,None]+(.86*ndotl*gate)[...,None])+spec[...,None]
            lit=np.where(active[...,None],rgb,lit);depth=np.where(active,t,depth)
        n,ss=buf['size'],buf['ss']
        return Image.fromarray(srgb(lit.reshape(n,ss,n,ss,3).mean((1,3))))

