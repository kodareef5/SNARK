#!/usr/bin/env python3
"""Mangrove set two: deterministic layered leaf composition in millimetres.
Offline inputs: guide/LAYOUT.json and source/set2/leaves_generated.png.
"""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'source' / 'set2'
SEED = 20261114
HEIGHT_MM = 160.0
SS = 2
MATURE = np.array([75., 98., 55.])
REGIONS = json.loads((ROOT / 'guide/LAYOUT.json').read_text())['cells']

def u8(a):
    return np.clip(np.rint(a), 0, 255).astype(np.uint8)

def save(path, a, srgb=False):
    info = PngImagePlugin.PngInfo()
    if srgb: info.add(b'sRGB', b'\x00')
    Image.fromarray(a).save(path, pnginfo=info)

def largest(mask):
    labels, n = ndi.label(mask)
    if not n: raise ValueError('No source leaf')
    counts = np.bincount(labels.ravel()); counts[0] = 0
    return labels == counts.argmax()

def library():
    """Keep generated contours and pigment/venation, remove broad source light."""
    im = np.array(Image.open(SRC / 'leaves_generated.png').convert('RGBA'))
    h, w = im.shape[:2]
    lib = []
    previews = np.zeros((3*320, 4*160, 4), np.uint8)
    for k in range(12):
        row, col = divmod(k, 4)
        sub = im[round(row*h/3):round((row+1)*h/3), round(col*w/4):round((col+1)*w/4)]
        mask = largest(ndi.binary_opening(sub[..., 3] > 225, iterations=2))
        mask = ndi.binary_fill_holes(mask)
        widths = mask.sum(1)
        rows = np.where(widths > widths.max()*.10)[0]
        y0, y1 = rows[0], rows[-1]
        ys = np.arange(y0, y1+1)
        left = np.array([np.where(mask[y])[0][0] for y in ys], float)
        right = np.array([np.where(mask[y])[0][-1] for y in ys], float)
        mid = ndi.gaussian_filter1d((left+right)*.5, 8)
        lum = sub[..., :3].astype(float) @ np.array([.2126, .7152, .0722])
        vein = []
        for y, m, l, r in zip(ys, mid, left, right):
            radius = max(2, (r-l)*.12)
            a, b = max(0, int(m-radius)), min(sub.shape[1], int(m+radius)+1)
            vein.append(a+np.argmax(ndi.gaussian_filter1d(lum[y, a:b], 1)))
        mid = ndi.gaussian_filter1d(vein, 9)
        t = np.linspace(0, 1, 320)
        sy = y1-t*(y1-y0)
        le = np.interp(sy, ys, ndi.gaussian_filter1d(left, 1.7))
        ri = np.interp(sy, ys, ndi.gaussian_filter1d(right, 1.7))
        ce = np.clip(np.interp(sy, ys, mid), le+.5, ri-.5)
        u = np.linspace(-1, 1, 160)[None]
        sx = ce[:, None] + np.where(u < 0, u*(ce-le)[:, None], u*(ri-ce)[:, None])*.97
        sy2 = np.broadcast_to(sy[:, None], sx.shape)
        tissue = np.stack([ndi.map_coordinates(sub[..., c].astype(float), [sy2, sx], order=1) for c in range(3)], -1)
        luminance = tissue @ np.array([.2126, .7152, .0722])
        low = ndi.gaussian_filter(luminance, (18, 12))
        micro = np.clip((luminance-low)/np.maximum(low, 20), -.17, .17)
        width = (ri-le)/(ri-le).max()
        width *= np.minimum(t/.018, 1)*np.minimum((1-t)/.02, 1)
        curve = (ce-(le+ri)*.5)/(ri-le).max()
        lib.append(dict(width=width, curve=curve, micro=micro))
        target = MATURE if k in [0,1,2,3,4,5,8,9] else np.array([107,120,73]) if k<8 else np.array([150,160,72]) if k==10 else np.array([132,87,47])
        previews[row*320:(row+1)*320, col*160:(col+1)*160, :3] = u8(target*(1+micro[::-1, :, None]))
        previews[row*320:(row+1)*320, col*160:(col+1)*160, 3] = 255
    save(SRC / 'rectified_tissue.png', previews, True)
    return lib

class Surface:
    def __init__(self, w, h, width_mm, lib, name, periodic=False):
        self.w, self.h, self.pitch = w, h, width_mm/w
        self.W, self.H = w*SS, h*SS
        self.lib, self.name, self.periodic = lib, name, periodic
        self.rgb = np.zeros((self.H, self.W, 3), np.float32)
        self.z = np.zeros((self.H, self.W), np.float32)
        self.ao = np.ones_like(self.z)
        self.rough = np.full_like(self.z, .925)
        self.ids = np.zeros((self.H, self.W), np.uint16)
        self.kind = np.zeros_like(self.ids, dtype=np.uint8)
        self.depth = np.zeros_like(self.z)
        self.leaf_support = np.zeros_like(self.ids, dtype=bool)
        self.uid = 0
        self.leaves = []
        self.groups = []

    def patches(self, lo, hi):
        xs = [-self.w, 0, self.w] if self.periodic else [0]
        ys = [-self.h, 0, self.h] if self.periodic else [0]
        for oy in ys:
            for ox in xs:
                a = np.maximum(np.floor((lo+[ox,oy])*SS).astype(int), 0)
                b = np.minimum(np.ceil((hi+[ox,oy])*SS).astype(int), [self.W,self.H])
                if np.any(a >= b): continue
                yy, xx = np.mgrid[a[1]:b[1],a[0]:b[0]].astype(np.float32)
                yield (slice(a[1],b[1]),slice(a[0],b[0])), (xx+.5)/SS-ox, (yy+.5)/SS-oy

    def paint(self, sl, mask, rgb, z, ao, rough, kind, depth):
        for dest, val in [(self.rgb,rgb),(self.z,z),(self.ao,ao),(self.rough,rough)]:
            dest[sl][mask] = val[mask] if isinstance(val,np.ndarray) and val.ndim >= 2 else val
        self.ids[sl][mask] = self.uid
        self.kind[sl][mask] = kind
        self.depth[sl][mask] = depth
        if kind != 5: self.leaf_support[sl] |= mask

    def twig(self, a, b, width=3., z=30.):
        a,b = np.asarray(a,float),np.asarray(b,float)
        self.uid += 1
        d=b-a; length=np.linalg.norm(d)
        for sl,x,y in self.patches(np.minimum(a,b)-width, np.maximum(a,b)+width):
            t=np.clip(((x-a[0])*d[0]+(y-a[1])*d[1])/max(length**2,.1),0,1)
            dist=np.hypot(x-a[0]-t*d[0],y-a[1]-t*d[1])
            r=width/2*(1-.25*t)
            mask=dist<r
            grain=np.sin(t*length*1.4+dist*2)*1.2
            nodes=np.exp(-((np.mod(t*length+4,21)-10.5)/1.)**2)
            rgb=np.array([96.,88.,67.])+grain[...,None]+nodes[...,None]*np.array([9,6,2])
            zh=z+np.sqrt(np.maximum(0,1-(dist/np.maximum(r,.1))**2))*r*self.pitch
            self.paint(sl,mask,rgb,zh,.92,.94,5,0)

    def leaf(self, base, angle, length_mm, width_mm, source, rng, depth=1., kind=1, group=-1):
        """Complete blades overwrite earlier blades, never intersecting discs."""
        # A rare bright pair becomes a conspicuous landmark in a 2x2 repeat.
        # Preserve that source's contour/random sequence, but mature its pigment
        # in the repeatable mass. Fresh terminal pairs remain on cell 2.
        if self.periodic and kind==3:kind=1
        self.uid += 1
        uid = self.uid
        base=np.array(base,float)
        L,W=length_mm/self.pitch,width_mm/self.pitch
        d=np.array([math.cos(angle),math.sin(angle)]); n=np.array([-d[1],d[0]])
        midpoint=base+d*L*.5
        ext=np.abs(d)*L*.51+np.abs(n)*W*.68+3
        tiptilt=rng.uniform(20,49)
        rise=min(length_mm*math.tan(math.radians(tiptilt)),132.)
        tiptilt=math.degrees(math.atan(rise/length_mm))
        sign=rng.choice([-1,1],p=[.3,.7])
        roll=rng.uniform(-9,9)
        centre=78+rng.uniform(-5,5)+(depth-.7)*9
        dome=rng.uniform(5.0,9.0)
        twist=rng.uniform(-4,4)
        bend=rng.uniform(-.07,.07)
        lib=self.lib[source]
        pigment=rng.uniform(-15,15)
        target=MATURE+pigment*np.array([1,.93,.52])
        if kind==2:target=np.array([104.,117.,70.])+pigment*.6
        if kind==3:target=np.array([150.,160.,72.])+pigment*.4
        if kind==4:target=np.array([130.,88.,49.])+pigment*.5
        target=target*(.50+.50*depth)+np.array([-1,0,3])*(1-depth)
        self.leaves.append(dict(id=uid,base_px=base.tolist(),angle_rad=angle,projected_length_mm=length_mm,width_mm=width_mm,tilt_deg=tiptilt,tilt_sign=int(sign),roll_deg=roll,source=source,kind=kind,group=group,depth=depth))
        for sl,x,y in self.patches(midpoint-ext,midpoint+ext):
            dx=x-base[0];dy=y-base[1]
            t=(dx*d[0]+dy*d[1])/L
            tc=np.clip(t,0,1)
            widths=np.interp(tc.ravel(),np.linspace(0,1,320),lib['width']).reshape(t.shape)
            curve=np.interp(tc.ravel(),np.linspace(0,1,320),lib['curve']).reshape(t.shape)
            cross=dx*n[0]+dy*n[1]-W*(curve+bend*np.sin(tc*np.pi))
            half=np.maximum(W*.5*widths,.01)
            u=cross/half
            mask=(t>0)&(t<1)&(np.abs(u)<1)
            micro=ndi.map_coordinates(lib['micro'],[tc*319,np.clip((u+1)*.5,0,1)*159],order=1,mode='nearest')
            rib=np.exp(-(cross*self.pitch/.75)**2)*np.sin(tc*np.pi)**.3
            veins=np.zeros_like(t)
            for node in [.18,.31,.44,.57,.70,.82]:
                delta=(tc-node-.15*np.abs(u)+.04*u*u)*length_mm
                veins=np.maximum(veins,np.exp(-(delta/.45)**2)*(1-np.abs(np.clip(u,-1,1)))**.3)
            rgb=target*(1+micro[...,None]*.7)
            rgb+=rib[...,None]*np.array([24.,25.,8.])+veins[...,None]*np.array([5.,6.,1.])
            rgb+=np.sin(tc*np.pi)[...,None]*np.array([1.,1.2,.3])
            z=centre+sign*rise*(tc-.5)+math.tan(math.radians(roll))*cross*self.pitch
            z+=dome*(1-np.clip(u,-1,1)**2)*np.sin(tc*np.pi)+twist*u*np.sin(tc*np.pi)
            z+=rib*.8+veins*.25+micro*.14
            z=np.clip(z,1.5,158.5)
            ao=.75+.245*depth-.025*(1-tc)*np.exp(-u*u*2)
            rough=.921+micro*.025+(kind==2)*.012+(kind==4)*.013
            self.paint(sl,mask,rgb,z,np.clip(ao,.75,1),np.clip(rough,.902,.949),kind,depth)

    def rosette(self, centre, axis, rng, depth=1., fresh=False, underside=.025, brown=False, group=-1, size=1.):
        """Six opposite pairs on a short, twisting terminal shoot."""
        centre=np.array(centre,float)
        direction=np.array([math.cos(axis),math.sin(axis)])
        length=rng.uniform(85,113)*size/self.pitch
        foot=centre-direction*length*.49
        self.twig(foot,centre+direction*length*.55,width=2.1/self.pitch,z=45)
        count=6
        self.groups.append(dict(centre_px=centre.tolist(),axis_rad=axis,pairs=count,depth=depth))
        for rank in range(count):
            node=foot+direction*(rank/(count-1)*length)
            spread=[115,77,125,66,103,39][rank]+rng.uniform(-8,8)
            for side in [-1,1]:
                a=axis+side*math.radians(spread+rng.uniform(-6,6))
                L=rng.uniform(134,169)*size
                W=L*rng.uniform(.47,.60)
                kind=2 if rng.random()<underside else 1
                if fresh and rank==count-1:kind=3
                if brown and rank==2 and side==1:kind=4
                source=int(rng.choice([0,1,2,3,4,5,8,9])) if kind==1 else int(rng.choice([6,7])) if kind==2 else 10 if kind==3 else 11
                petiole=rng.uniform(6,11)/self.pitch
                base=node+np.array([math.cos(a),math.sin(a)])*petiole
                self.twig(node,base+np.array([math.cos(a),math.sin(a)])*2,1.8/self.pitch,z=48)
                self.leaf(base,a,L,W,source,rng,depth,kind,group)

    def finish(self, target):
        mask=self.ids>0
        if self.periodic:
            if not mask.all():
                tiled=np.tile(mask,(3,3)); _,ix=ndi.distance_transform_edt(~tiled,return_indices=True)
                iy=ix[0,self.H:self.H*2,self.W:self.W*2]%self.H
                ix=ix[1,self.H:self.H*2,self.W:self.W*2]%self.W
                for a in [self.rgb,self.z,self.ao,self.rough,self.ids,self.kind,self.depth]:a[~mask]=a[iy[~mask],ix[~mask]]
                mask[:]=True
        else:
            _,ix=ndi.distance_transform_edt(~mask,return_indices=True)
            for a in [self.rgb,self.z,self.ao,self.rough,self.depth]:a[~mask]=a[ix[0][~mask],ix[1][~mask]]
        def down(a):
            if a.ndim==3:return a.reshape(self.h,SS,self.w,SS,a.shape[-1]).mean((1,3))
            return a.reshape(self.h,SS,self.w,SS).mean((1,3))
        rgb=down(self.rgb);z=down(self.z)
        ao=down(self.ao);rough=down(self.rough);depth=down(self.depth)
        ids=self.ids[SS//2::SS,SS//2::SS];kind=self.kind[SS//2::SS,SS//2::SS]
        alpha=down(ndi.gaussian_filter(mask.astype(np.float32),SS*.48,mode='wrap' if self.periodic else 'nearest',truncate=3))
        visible=alpha>=.5
        if self.periodic:
            ao=np.clip(.45+.53*depth, .45,1)
            # Calibrate deeper tissue only; exposed tops keep the card palette.
            for _ in range(4):
                weight=(1-depth)**.75
                rgb+=(np.asarray(target)-rgb.mean((0,1)))[None,None,:]*weight[...,None]/max(weight.mean(),.01)
        else:rgb+=np.array(target)-rgb[visible].mean(0)
        mode='wrap' if self.periodic else 'nearest'
        high=ndi.maximum_filter(z,size=7,mode=mode)
        cavity=np.clip((high-z-8)/90,0,1)
        ao=np.maximum(.45 if self.periodic else .75,ao-cavity*.13)
        # Round 2 changes pigment and mass occlusion only. The original
        # composition, RNG sequence, surface relief and all strip channels stay
        # intact. Recolour after the original palette calibration so protected
        # brown tissue and twigs retain their exact delivered colour.
        rgb,ao,exposure=self.sun_shade(u8(rgb),ao,depth,ids,kind,visible,cavity,down)
        # Reconstruct a continuous height from the authored leaf gradients.
        # Across an ownership edge the raw height step is not a leaf slope:
        # keeping it makes a black outline under every light. Interpolate the
        # surface slopes there, then solve a screened Poisson integration.
        # Normals are still derived exclusively from the final saved height.
        np.savez_compressed(SRC / (self.name+'_surface.npz'),height=z,ids=ids,pitch=self.pitch)
        z=integrate_surfaces(z,ids,self.periodic,self.pitch)
        rgb=u8(rgb)
        if not self.periodic:
            _,ix=ndi.distance_transform_edt(~visible,return_indices=True)
            rgb[~visible]=rgb[ix[0][~visible],ix[1][~visible]]
        self.result=dict(rgb=rgb,alpha=u8(alpha*255),height=z,ao=ao,rough=rough,ids=ids,kind=kind,depth=depth,exposure=exposure)
        support=down(self.leaf_support.astype(float))>0
        if not self.periodic:
            m=np.zeros((self.h,self.w),bool);m[:12]=True;m[-12:]=True;m[:,:12]=True;m[:,-12:]=True
            assert not support[m].any(), f'Leaf geometry violates margins: {self.name}: {np.argwhere(support).min(0)} .. {np.argwhere(support).max(0)}'
        return self.result

    def sun_shade(self,rgb,ao,depth,ids,kind,visible,cavity,down):
        """Pigment by leaf role, independent of the light or surface normal."""
        if self.name.startswith('strip_'):return rgb,ao,depth
        rgb=rgb.astype(np.float64)
        if not self.periodic:
            sun=self.name in ('cell_0','cell_2')
            foliage=(kind>=1)&(kind<=3)&visible
            fresh=(kind==3)&visible
            mature=foliage&~fresh
            target=np.array([104,126,62] if sun else [64,86,56])
            rgb[mature]+=target-np.array([76,98,56])
            if sun:
                yy,xx=np.mgrid[:self.h,:self.w]
                for leaf in self.leaves:
                    if leaf['kind'] not in (1,2):continue
                    x,y=leaf['base_px'];a=leaf['angle_rad']
                    t=((xx+.5-x)*math.cos(a)+(yy+.5-y)*math.sin(a))/(leaf['projected_length_mm']/self.pitch)
                    tip=np.clip((t-.64)/.34,0,1)**2
                    mask=(ids==leaf['id'])&mature
                    rgb[mask]+=tip[mask,None]*np.array([18.,16.,2.])
            if fresh.any():
                rgb[fresh]=np.array([156.,166.,71.])+(rgb[fresh]-rgb[fresh].mean(0))*.55
                rgb[fresh]=np.clip(rgb[fresh],[145,155,66],[164,174,76])
            # Include protected twigs/brown/fresh in the requested cell mean,
            # but apply the small calibration only to mature leaf tissue.
            for _ in range(6):
                rgb[mature]+=(target-rgb[visible].mean(0))*visible.sum()/mature.sum()
                if sun:rgb[mature]=np.minimum(rgb[mature],[154,165,76])
            return rgb,ao,depth

        # Extend the interior pigment to sixteen existing overlying shoots.
        # Whole, overlapping leaf silhouettes bound these pools. No geometry,
        # alpha, height, normal, or original surface-depth record is changed.
        factors=np.ones(self.uid+1,np.float32)
        for leaf in self.leaves:
            if leaf['group']>=2000 and (leaf['group']-2000)%5==2:
                factors[leaf['id']]=.4
        exposure=down(self.depth*factors[self.ids])
        # Retain the original leaf-to-leaf pigment and venation deviations,
        # removing the former depth palette before assigning the new one.
        centred=depth-depth.mean()
        slope=(centred[...,None]*(rgb-rgb.mean((0,1)))).mean((0,1))/np.mean(centred**2)
        residual=rgb-(rgb.mean((0,1))+centred[...,None]*slope)
        low=np.array([24.,36.,30.]);mid=np.array([40.,55.,36.]);top=np.array([64.,86.,56.])
        rgb=np.stack([np.interp(exposure,[0,.4,1],[low[c],mid[c],top[c]]) for c in range(3)],-1)+residual*.65
        exposed=exposure>.93
        top_weight=np.clip((exposure-.85)/.08,0,1)
        rgb+=(top-rgb[exposed].mean(0))*top_weight[...,None]
        # Middle depths absorb the calibration; preserve the cool deepest
        # floor and the shade-leaf upper surfaces.
        weight=4*exposure*(1-exposure)*(1-top_weight)
        for _ in range(12):
            rgb+=(np.array([50,68,44])-rgb.mean((0,1)))*weight[...,None]/weight.mean()
            rgb=np.maximum(rgb,low)
        ao=np.clip(.35+.63*exposure-cavity*.13,.35,.98)
        return rgb,ao,exposure

def integrate_surfaces(z, ids, periodic, pitch):
    """Least-squares height for leaf slopes, with no discontinuous edge wall."""
    valid=ids>0
    if not periodic:
        _,ix=ndi.distance_transform_edt(~valid,return_indices=True)
        ids=ids.copy();ids[~valid]=ids[ix[0][~valid],ix[1][~valid]]
    gx=np.roll(z,-1,1)-z;gy=np.roll(z,-1,0)-z
    mode='wrap' if periodic else 'nearest'
    interior=ndi.minimum_filter(ids,5,mode=mode)==ndi.maximum_filter(ids,5,mode=mode)
    goodx=interior & np.roll(interior,-1,1)
    goody=interior & np.roll(interior,-1,0)
    if not periodic:goodx[:,-1]=False;goody[-1]=False
    for g,good in [(gx,goodx),(gy,goody)]:
        if periodic:
            # Neighbours across the tile boundary must participate in filling
            # leaf-edge slopes, just as they do in the Poisson solve itself.
            pad=48
            gp=np.pad(g,pad,mode='wrap');ok=np.pad(good,pad,mode='wrap')
            _,ix=ndi.distance_transform_edt(~ok,return_indices=True)
            filled=gp[ix[0],ix[1]][pad:-pad,pad:-pad]
            g[~good]=filled[~good]
        else:
            _,ix=ndi.distance_transform_edt(~good,return_indices=True)
            g[~good]=g[ix[0][~good],ix[1][~good]]
        np.clip(g,-1.6*pitch,1.6*pitch,out=g)
    if not periodic:
        # Reflect potential with sign-correct reflected gradients.
        gx=np.concatenate([gx,-gx[:,::-1]],1);gx=np.concatenate([gx,gx[::-1]],0)
        gy=np.concatenate([gy,gy[:,::-1]],1);gy=np.concatenate([gy,-gy[::-1]],0)
        z=np.block([[z,z[:,::-1]],[z[::-1],z[::-1,::-1]]])
    H,W=z.shape
    dx=np.exp(2j*np.pi*np.fft.fftfreq(W))[None,:]-1
    dy=np.exp(2j*np.pi*np.fft.fftfreq(H))[:,None]-1
    anchor=ndi.gaussian_filter(z,12,mode='wrap')
    screen=.0015
    spectrum=(np.conj(dx)*np.fft.fft2(gx)+np.conj(dy)*np.fft.fft2(gy)+screen*np.fft.fft2(anchor))/(np.abs(dx)**2+np.abs(dy)**2+screen)
    out=np.fft.ifft2(spectrum).real
    if not periodic:out=out[:H//2,:W//2]
    out=80+(out-out.mean())*1.45
    # Smoothly compress the rare extremes into the encoded 160 mm interval.
    out=80+77*np.tanh((out-80)/77)
    return out.astype(np.float32)


def build_cluster(i, lib):
    rng=np.random.default_rng(SEED+i*431)
    s=Surface(512,512,800,lib,f'cell_{i}')
    layouts=[
        [(.32,.30,-120),(.65,.32,-55),(.27,.57,-155),(.65,.61,-20),(.47,.74,-85)],
        [(.28,.31,-135),(.62,.34,-62),(.23,.57,-160),(.65,.58,-20),(.46,.74,-95)],
        [(.31,.29,-122),(.64,.32,-51),(.26,.59,-152),(.64,.59,-12),(.46,.74,-85)],
        [(.48,.25,-79),(.32,.43,-131),(.63,.54,-48),(.44,.76,-105)]]
    layouts[i]=[(.50+(x-.50)*.84,.52+(y-.52)*.84,a) for x,y,a in layouts[i]]
    if i==1:layouts[i]=[(x+.026,y,a) for x,y,a in layouts[i]]
    root=np.array([256,514]);joint=np.array([250,390 if i!=3 else 420])
    s.twig(root,joint,7.2,22)
    for j,(x,y,a) in enumerate(layouts[i]):
        p=np.array([x,y])*512
        elbow=joint*.35+p*.65+np.array([rng.uniform(-9,9),10])
        s.twig(joint,elbow,4.3,27);s.twig(elbow,p,2.8,35)
    for j,(x,y,a) in enumerate(layouts[i]):
        s.rosette(np.array([x,y])*512,math.radians(a),rng,depth=rng.uniform(.90,1),fresh=i==2 and j in [0,1,4],underside=.10 if i==3 else .055 if i==1 else .018,brown=i==2 and j==3,group=j)
    s.finish([76,98,56]);return s

def build_spray(i,lib):
    rng=np.random.default_rng(SEED+2000+i)
    s=Surface(512,1024,450,lib,f'strip_{i+1}')
    ys=np.array([1027,890,730,570,415,270,180],float)
    xs=np.array([256,253,260,250,257,250,253],float) if i==0 else np.array([256,215,190,205,270,316,322],float)
    if i:xs=256+(xs-256)*.72
    for j in range(len(xs)-1):s.twig([xs[j],ys[j]],[xs[j+1],ys[j+1]],8.2-j*.8,25+j*3)
    nodes=[(807,107),(692,90),(579,112),(481,78),(396,112),(324,75),(270,108),(222,65),(187,35)]
    for rank,(yy,spread) in enumerate(nodes):
        xx=np.interp(yy,ys[::-1],xs[::-1]);axis=-math.pi/2
        if i:axis+=np.interp(yy,[180,400,700,900],[.0,.43,-.1,-.3])
        for side in [-1,1]:
            a=axis+side*math.radians(spread+rng.uniform(-7,7))
            L=rng.uniform(138,165);W=L*rng.uniform(.46,.57)
            base=np.array([xx,yy])+np.array([math.cos(a),math.sin(a)])*8
            kind=2 if (rank==2 and side==1) or (i==1 and rank==5 and side==-1) else 1
            source=int(rng.choice([6,7] if kind==2 else [0,1,2,3,4,5,8,9]))
            s.twig([xx,yy],base,2.5,45)
            s.leaf(base,a,L,W,source,rng,.97,kind,rank)
    s.finish([76,98,56]);return s

def build_mass(lib):
    rng=np.random.default_rng(SEED+9000)
    s=Surface(2048,1024,4000,lib,'mass',True)
    # Randomly overlapping layers, never a tessellation of bounded rosettes.
    for layer,count,dep in [(0,335,.08),(1,260,.38),(2,80,1.)]:
        centres=[]
        for j in range(count):
            for attempt in range(5000):
                centre=rng.uniform([0,0],[2048,1024])
                if layer!=2 or not centres:break
                delta=np.abs(np.array(centres)-centre)
                delta=np.minimum(delta,np.array([2048,1024])-delta)
                if np.min(np.linalg.norm(delta,axis=1))>88:break
            centres.append(centre)
            axis=rng.uniform(-math.pi,math.pi)
            depth=np.clip(dep+rng.uniform(-.07,.07),0,1)
            s.rosette(centre,axis,rng,depth=depth,fresh=layer==2 and j in [18,67],underside=.012,brown=False,group=layer*1000+j,size=rng.uniform(.97,1.0))
        print(f'mass layer {layer}: {count} shoots',flush=True)
    s.finish([62,82,48]);return s

def normal_from_height(h,pitch,periodic=False):
    if periodic:
        dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*pitch)
        dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*pitch)
    else:dy,dx=np.gradient(h,pitch,pitch)
    n=np.stack([-dx,dy,np.ones_like(h)],-1)
    n/=np.linalg.norm(n,axis=2,keepdims=True)
    return u8((n*.5+.5)*255)

def main():
    SRC.mkdir(parents=True,exist_ok=True);lib=library()
    atlas=np.zeros((2048,2048,4),np.uint8)
    height=np.zeros((2048,2048),np.float32)
    orm=np.zeros((2048,2048,3),np.uint8)
    ids=np.zeros((2048,2048),np.uint16);kinds=np.zeros((2048,2048),np.uint8);depth=np.zeros((2048,2048),np.uint8)
    exposure=np.zeros((2048,2048),np.uint8)
    records=[]
    for i,region in enumerate(REGIONS):
        s=build_cluster(i,lib) if i<4 else build_spray(i-4,lib) if i<6 else build_mass(lib)
        x0,y0,x1,y1=region['box'];sl=(slice(y0,y1),slice(x0,x1));r=s.result
        atlas[sl][...,:3]=r['rgb'];atlas[sl][...,3]=r['alpha']
        height[sl]=r['height'];orm[sl][...,0]=u8(r['ao']*255);orm[sl][...,1]=u8(r['rough']*255)
        ids[sl]=r['ids'];kinds[sl]=r['kind'];depth[sl]=u8(r['depth']*255)
        exposure[sl]=u8(r['exposure']*255)
        records.append(dict(name=s.name,box=region['box'],pitch_mm=s.pitch,leaves=s.leaves,groups=s.groups))
        print(f'{s.name}: {len(s.leaves)} blades',flush=True);del s
    save(ROOT/'mangrove_leaves_base.png',atlas,True)
    save(ROOT/'mangrove_leaves_height.png',np.rint(height/HEIGHT_MM*65535).astype(np.uint16))
    quantized=np.array(Image.open(ROOT/'mangrove_leaves_height.png')).astype(np.float64)*HEIGHT_MM/65535
    normals=np.empty((2048,2048,3),np.uint8)
    for i,r in enumerate(records):
        x0,y0,x1,y1=r['box'];sl=(slice(y0,y1),slice(x0,x1))
        normals[sl]=normal_from_height(quantized[sl],r['pitch_mm'],i==6)
    save(ROOT/'mangrove_leaves_normal.png',normals)
    save(ROOT/'mangrove_leaves_orm.png',orm)
    save(SRC/'composed_master_2048.png',atlas,True)
    save(SRC/'surface_ids.png',ids);save(SRC/'surface_kind.png',kinds);save(SRC/'surface_depth.png',depth)
    save(SRC/'tissue_exposure.png',exposure)
    metadata=dict(seed=SEED,supersampling=SS,height_range_mm=HEIGHT_MM,source_sha256=hashlib.sha256((SRC/'leaves_generated.png').read_bytes()).hexdigest(),regions=records)
    (SRC/'composition.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print('Saved all four aligned 2048 maps.',flush=True)

if __name__=='__main__':main()
