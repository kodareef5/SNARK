#!/usr/bin/env python3
"""Offline mangrove head authoring. Writes only alongside this script.

Generated project leaf contours/veins, dimensioned opposite pairs, layered
shoots, and explicit geometric relief. No external imagery or global light.
"""
from pathlib import Path
import json
import math
import hashlib
import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as ndi
from leaf_library import library

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
N, SS = 512, 2
RADIUS = .94 * 256
HEIGHT_MM = 160.
SEED = 20261115
GROUPS = ['sun', 'sun', 'middle', 'middle', 'shade', 'shade', 'underside', 'interior']
TARGETS = [(92,116,50)]*2 + [(68,92,44)]*2 + [(48,70,40)]*2 + [(80,94,56),(28,44,30)]
CEILINGS = [(170,176,76)]*2 + [(151,163,76)]*2 + [(119,141,76)]*2 + [(139,150,88),(66,86,58)]
LUMA = np.array([.2126,.7152,.0722])


def u8(a): return np.clip(np.rint(a),0,255).astype(np.uint8)


def save(a, path, srgb=False, description=''):
    info=PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
        info.add(b'gAMA', (45455).to_bytes(4,'big'))
    info.add_text('Description',description)
    Image.fromarray(a).save(path,pnginfo=info,compress_level=7)


def down(a):
    return a.reshape(N,SS,N,SS,*a.shape[2:]).mean((1,3))


def normalize(a): return a/np.linalg.norm(a,axis=-1,keepdims=True)


def normals(z,pitch,periodic):
    if periodic:
        dx=(np.roll(z,-1,1)-np.roll(z,1,1))/(2*pitch)
        dy=(np.roll(z,-1,0)-np.roll(z,1,0))/(2*pitch)
    else: dy,dx=np.gradient(z,pitch)
    return normalize(np.stack([-dx,dy,np.ones_like(z)],-1))


class Head:
    def __init__(self,index,lib):
        self.index,self.lib=index,lib
        self.periodic=index==7
        self.under=index==6
        self.pitch=2400/512 if self.periodic else 1100/RADIUS
        self.rng=np.random.default_rng(SEED+index*137)
        self.uid=0;self.leaves=[];self.shoots=[];self.twig_count=0
        y,x=np.mgrid[:N*SS,:N*SS].astype(np.float32)
        self.x,self.y=(x+.5)/SS-.5,(y+.5)/SS-.5
        self.radius=np.hypot(self.x-255.5,self.y-255.5)/RADIUS
        self.macro=self.field(self.x,self.y)
        self.tone=np.full(x.shape,-2.0,np.float32)
        self.z=(42+22*self.macro).astype(np.float32)
        self.kind=np.zeros(x.shape,np.uint8)
        self.ids=np.zeros(x.shape,np.uint16)
        self.exposure=np.zeros(x.shape,np.float32)
        self.detail=np.full(x.shape,.5,np.float32)
        self.rough=np.full(x.shape,.86,np.float32)

    def field(self,x,y):
        """Several irregular clumps, no preferred global lighting direction."""
        rng=np.random.default_rng(SEED+self.index*137+11)
        f=np.zeros_like(x,dtype=float)
        for kx,ky in [(1,1),(2,-1),(1,3),(3,2),(2,2),(4,-1)]:
            f+=rng.uniform(.25,.55)*np.cos(2*np.pi*(x*kx+y*ky)/512+rng.uniform(0,2*np.pi))
        return np.tanh(f*.95)

    def at(self,x,y):
        return float(ndi.map_coordinates(self.macro,[[((y+.5)*SS-.5)%1024],[((x+.5)*SS-.5)%1024]],order=1,mode='wrap')[0])

    def patches(self,lo,hi):
        for oy in ([-512,0,512] if self.periodic else [0]):
            for ox in ([-512,0,512] if self.periodic else [0]):
                a=np.maximum(np.floor((lo+[ox,oy]+.5)*SS).astype(int),0)
                b=np.minimum(np.ceil((hi+[ox,oy]+.5)*SS).astype(int),1024)
                if np.any(a>=b):continue
                yy,xx=np.mgrid[a[1]:b[1],a[0]:b[0]].astype(float)
                yield (slice(a[1],b[1]),slice(a[0],b[0])),(xx+.5)/SS-.5-ox,(yy+.5)/SS-.5-oy

    def twig(self,a,b,width,exposure):
        a,b=np.array(a),np.array(b);v=b-a;length=np.linalg.norm(v)
        self.uid+=1;self.twig_count+=1
        for sl,x,y in self.patches(np.minimum(a,b)-width,np.maximum(a,b)+width):
            t=np.clip(((x-a[0])*v[0]+(y-a[1])*v[1])/max(length**2,.01),0,1)
            dist=np.hypot(x-a[0]-t*v[0],y-a[1]-t*v[1]);r=width*(1-.45*t)/2
            mask=dist<r
            self.kind[sl][mask]=5;self.ids[sl][mask]=self.uid
            self.tone[sl][mask]=-.7+exposure*.4
            self.exposure[sl][mask]=exposure
            self.rough[sl][mask]=.84
            self.detail[sl][mask]=.5
            zh=43+22*self.macro[sl]+exposure*8+np.sqrt(np.maximum(0,1-(dist/np.maximum(r,.01))**2))*2
            self.z[sl][mask]=zh[mask]

    def leaf(self,base,angle,length_mm,width_mm,kind,exposure,group):
        self.uid+=1;uid=self.uid;rng=self.rng
        source=int(rng.choice([6,7])) if kind==2 else 10 if kind==3 else 11 if kind==4 else int(rng.choice([0,1,2,3,4,5,8,9]))
        lib=self.lib[source];base=np.array(base);L=length_mm/self.pitch;W=width_mm/self.pitch
        d=np.array([math.cos(angle),math.sin(angle)]);n=np.array([-d[1],d[0]])
        midpoint=base+d*L/2;ext=np.abs(d)*L*.54+np.abs(n)*W*.7+2
        pigment=rng.uniform(-.24,.24);rise=rng.uniform(-4,5);roll=rng.uniform(-1.8,1.8)
        dome=rng.uniform(2.2,3.7);bend=rng.uniform(-.04,.04)
        self.leaves.append(dict(id=uid,group=group,source=source,kind=kind,base_px=base.tolist(),angle_rad=angle,length_mm=length_mm,width_mm=width_mm,exposure=exposure))
        for sl,x,y in self.patches(midpoint-ext,midpoint+ext):
            dx=x-base[0];dy=y-base[1];t=(dx*d[0]+dy*d[1])/L;tc=np.clip(t,0,1)
            widths=np.interp(tc.ravel(),np.linspace(0,1,320),lib['width']).reshape(t.shape)
            curve=np.interp(tc.ravel(),np.linspace(0,1,320),lib['curve']).reshape(t.shape)
            cross=dx*n[0]+dy*n[1]-W*(curve+bend*np.sin(tc*np.pi))
            half=np.maximum(W*.5*widths,.01);u=cross/half;uc=np.clip(u,-1,1)
            mask=(t>0)&(t<1)&(np.abs(u)<1)
            micro=ndi.map_coordinates(lib['micro'],[tc*319,(uc+1)*79.5],order=1,mode='nearest')
            rib=np.exp(-(cross*self.pitch/1.45)**2)*np.sin(tc*np.pi)**.3
            body=(1-uc*uc)*np.sin(tc*np.pi)
            margin=np.exp(-((np.abs(uc)-.87)/.11)**2)*np.sin(tc*np.pi)
            # Leaf-local pigment/rib: no view, normal or world-light dependence.
            tone=-1.75+exposure*2.8+pigment+body*.27+rib*.26+margin*.09+micro*1.3
            if kind==2:tone+=.12
            if kind==3:tone+=.25
            zh=43+22*self.macro[sl]+exposure*9+rise*(tc-.5)+roll*uc+dome*body+rib*.6+margin*.65
            self.tone[sl][mask]=tone[mask];self.z[sl][mask]=zh[mask]
            self.kind[sl][mask]=kind;self.ids[sl][mask]=uid;self.exposure[sl][mask]=exposure
            detail=np.clip(.12+.49*body+.35*rib+micro*.7+pigment*.25,0,1)
            self.detail[sl][mask]=detail[mask]
            rough=[.29,.29,.36,.36,.44,.44,.74,.70][self.index]+(1-exposure)*.12
            if kind==2:rough=max(rough,.68)
            if kind==4:rough=max(rough,.78)
            self.rough[sl][mask]=np.clip(rough+micro[mask]*.09,.24,.88)

    def shoot(self,centre,axis,exposure):
        rng=self.rng;centre=np.array(centre);d=np.array([math.cos(axis),math.sin(axis)])
        length=rng.uniform(70,108)/self.pitch;start=centre-d*length*.5
        count=int(rng.integers(3,5));gid=len(self.shoots)
        self.shoots.append(dict(centre_px=centre.tolist(),axis_rad=axis,pairs=count,exposure=exposure))
        self.twig(start,centre+d*length*.55,.62 if not self.under else .92,exposure)
        for rank in range(count):
            node=start+d*length*rank/(count-1)
            spread=[111,75,103,44][rank]+rng.uniform(-10,10)
            for side in [-1,1]:
                angle=axis+side*math.radians(spread+rng.uniform(-5,5))
                direction=np.array([math.cos(angle),math.sin(angle)])
                base=node+direction*rng.uniform(1.3,2.0)
                self.twig(node,base,.40,exposure)
                r=rng.random();kind=4 if r<.023 else 2 if self.under or r<.065 else 3 if rank==count-1 and r>.91 else 1
                L=rng.uniform(90,130);W=rng.uniform(40,min(60,L*.53))
                self.leaf(base,angle,L,W,kind,exposure,gid)

    def compose(self):
        rng=self.rng
        # Dense dark backing, then shingled sprays. Full blades continue past rim.
        for layer,count in enumerate([430,245,190]):
            candidates=[]
            for _ in range(count):
                p=rng.uniform(0,512,2) if self.periodic else rng.uniform(-30,542,2)
                m=self.at(*p)
                exposure=np.clip([.23,.46,.62][layer]+m*[.10,.42,.62][layer]+rng.uniform(-.10,.10),.06,1)
                candidates.append((exposure,p,m))
            # More exposed shoots overlap darker ones, without a global direction.
            for exposure,p,m in sorted(candidates,key=lambda q:q[0]):
                axis=math.atan2(p[1]-255.5,p[0]-255.5)+rng.uniform(-1.6,1.6) if not self.periodic else rng.uniform(0,2*np.pi)
                self.shoot(p,axis,float(exposure))
        if self.under:
            # A sparse branching framework exposed beneath the leaf backs.
            for k in range(9):
                angle=k*2*np.pi/9+rng.uniform(-.18,.18)
                a=np.array([255.5,255.5])+rng.uniform(-20,20,2)
                d=np.array([math.cos(angle),math.sin(angle)])
                b=a+d*rng.uniform(90,150);c=b+d*rng.uniform(45,75)+rng.uniform(-20,20,2)
                self.twig(a,b,2.0,.52);self.twig(b,c,1.1,.49)
                for s in [-1,1]:
                    ang=angle+s*.6;end=b+np.array([math.cos(ang),math.sin(ang)])*rng.uniform(35,65)
                    self.twig(b,end,.8,.45)
                    self.shoot(end,ang,.74)

    def finish(self):
        tone=down(self.tone);exposure=down(self.exposure);detail=down(self.detail)
        # IDs/kinds nearest sample; supersampled fractional brown coverage is
        # retained separately so no green outlines are applied to brown blades.
        kind=self.kind[::SS,::SS];ids=self.ids[::SS,::SS]
        y,x=np.mgrid[:N,:N];r=np.hypot(x-255.5,y-255.5)/RADIUS
        mask=np.ones((N,N),bool) if self.periodic else r<=1
        brown=down((self.kind==4).astype(float));twig=down((self.kind==5).astype(float))
        leafweight=1-brown-twig
        fit=np.zeros(5)
        if not self.periodic:
            design=np.stack([np.ones_like(r),(x-255.5)/256,(y-255.5)/256,r*r,r**4],-1)
            fit=np.linalg.lstsq(design[mask],tone[mask],rcond=None)[0]
            tone-=fit[1]*design[...,1]+fit[2]*design[...,2]
            # Gentle broad darkening, sharper turning-under ring. No blur.
            # This variant's deepest fold crosses the apex; a stronger
            # radial turnover keeps its lower ring subordinate under filtering.
            radial=.95 if self.index==3 else .52
            turnover=1.65 if self.index==3 else 1.25
            tone-=radial*np.minimum(r,1)**1.7+turnover*np.clip((r-.79)/.40,0,1)
        low=np.array([9,17,11]);high=np.array(CEILINGS[self.index]);target=TARGETS[self.index]
        # Brown pigment is an authored 2.3% leaf population, not RGB noise.
        bcol=np.array([106,73,33])*(.52+.48*exposure[...,None])*(.83+.27*detail[...,None])
        if self.periodic:bcol*=.48
        tcol=np.array([76,70,43])*(.6+.4*exposure[...,None])
        if self.periodic:tcol*=.5
        fixed=bcol*brown[...,None]+tcol*twig[...,None]
        rgb=np.zeros((N,N,3))
        for c in range(3):
            a,b=-12.,12.
            for _ in range(44):
                off=(a+b)/2
                ceiling=low[c]+(high[c]-low[c])*(.79+.21*detail)
                v=low[c]+(ceiling-low[c])/(1+np.exp(-2.05*(tone+off)))
                color=v*leafweight+fixed[...,c]
                if color[mask].mean()<target[c]:a=off
                else:b=off
            rgb[...,c]=color
        rgb=u8(rgb)
        mode='wrap' if self.periodic else 'reflect'
        # Shared relief, not a second painted normal. Modest 0.55-texel
        # relief smoothing avoids needle-like cutout walls; colour stays sharp.
        z=ndi.gaussian_filter(down(self.z),.55,mode=mode)
        z=np.clip(z,1,HEIGHT_MM-1)
        hz=np.rint(z/HEIGHT_MM*65535).astype(np.uint16)
        normal=u8((normals(hz.astype(float)*HEIGHT_MM/65535,self.pitch,self.periodic)*.5+.5)*255)
        recess=np.maximum(0,ndi.gaussian_filter(z,5,mode=mode)-z)
        ao=np.clip(.55+.42*exposure-.09*np.clip(recess/6,0,1),.34,.98)
        if not self.periodic:ao*=1-.12*np.clip(r,0,1)**4
        orm=np.stack([ao,down(self.rough),np.zeros_like(ao)],-1)
        orm=u8(orm.reshape(256,2,256,2,3).mean((1,3))*255)
        np.savez_compressed(SOURCE/f'cell_{self.index}_authored.npz',ids=ids,kind=kind,brown_coverage=brown,exposure=exposure)
        metadata=dict(index=self.index,population=GROUPS[self.index],seed=SEED+self.index*137,pitch_mm=self.pitch,
            mean_rgb=rgb[mask].mean(0).tolist(),brown_visible_fraction=float(brown[mask].mean()),
            height_actual_mm=[float(hz.min()*HEIGHT_MM/65535),float(hz.max()*HEIGHT_MM/65535)],
            removed_axis_plane=fit[1:3].tolist(),leaf_count=len(self.leaves),twig_count=self.twig_count,
            leaves=self.leaves,shoots=self.shoots)
        (SOURCE/f'cell_{self.index}_geometry.json').write_text(json.dumps(metadata,separators=(',',':'))+'\n')
        return rgb,hz,normal,orm,metadata


def main():
    lib=library();base=np.zeros((1024,2048,3),np.uint8);height=np.zeros((1024,2048),np.uint16)
    normal=np.zeros_like(base);orm=np.zeros((512,1024,3),np.uint8);records=[]
    for i in range(8):
        head=Head(i,lib);head.compose();b,h,n,o,record=head.finish()
        row,col=divmod(i,4);sl=np.s_[row*512:(row+1)*512,col*512:(col+1)*512]
        base[sl]=b;height[sl]=h;normal[sl]=n;orm[row*256:(row+1)*256,col*256:(col+1)*256]=o
        records.append({k:v for k,v in record.items() if k not in ['leaves','shoots']})
        print(f'cell {i}: {GROUPS[i]}, {record["leaf_count"]} blades, mean {np.round(record["mean_rgb"],2)}, brown {record["brown_visible_fraction"]:.3%}',flush=True)
    save(base,ROOT/'mangrove_heads_base.png',True,'Opaque mangrove upper-half crown atlas; project leaf library, no directional light.')
    save(height,ROOT/'mangrove_heads_height.png',False,'Linear uint16: black 0 mm, white 160 mm; local foliage relief, no mesh dome.')
    save(normal,ROOT/'mangrove_heads_normal.png',False,'Linear tangent normal: normalize(-dH/dx,+dH/drow,1), from delivered quantized height.')
    save(orm,ROOT/'mangrove_heads_orm.png',False,'Linear RGB: occlusion, roughness, zero metalness. 2x2 area reduction.')
    manifest=dict(size=[2048,1024],cell_size=512,disc_centre=[255.5,255.5],disc_radius_px=RADIUS,
        disc_surface_radius_mm=1100,interior_period_mm=[2400,2400],height_encoding_mm=[0,160],
        source_sha256=hashlib.sha256((SOURCE/'leaves_generated.png').read_bytes()).hexdigest(),
        blade_dimensions_mm=dict(length=[90,130],width=[40,60]),supersampling=SS,cells=records)
    (SOURCE/'layout.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Built all four upper-half maps.')


if __name__=='__main__': main()
