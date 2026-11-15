#!/usr/bin/env python3
"""Build physically scaled, periodic limestone maps. Python + Pillow + NumPy + SciPy.
All source images are untouched. No network or generative service is used on rebuild.
"""
from pathlib import Path
import hashlib, json, time
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import Delaunay
from scipy.interpolate import LinearNDInterpolator

ROOT=Path(__file__).resolve().parent
N=2048
MM_PER_PIXEL=1500/N
RANGE_MM=40.
SEED=141126
# Freeze the original ICC bytes: regenerating a profile adds a creation date
# and would change otherwise identical PNG hashes on each rebuild.
SRGB=(ROOT/'source/srgb.icc').read_bytes()
META={"seed":SEED,"size":N,"tile_mm":1500,"height_range_mm":40,"mm_per_pixel":MM_PER_PIXEL,"sources":{},"quilts":{}}


def blur(a,s):
    return gaussian_filter(a,s,mode='wrap')


def unit(a):
    a=a.astype(np.float32)
    return (a-a.mean())/(a.std()+1e-8)


def noise(rng,scale):
    return unit(blur(rng.normal(size=(N,N)).astype(np.float32),scale))


def smoothstep(a):
    a=np.clip(a,0,1)
    return a*a*(3-2*a)


def path_mask(cost):
    """Minimum-energy vertical path through a narrow overlapping strip."""
    rows,cols=cost.shape
    acc=cost[0].copy()
    back=np.zeros((rows,cols),np.int16)
    for y in range(1,rows):
        opts=np.stack([np.r_[np.inf,acc[:-1]],acc,np.r_[acc[1:],np.inf]])
        k=opts.argmin(axis=0)
        back[y]=np.arange(cols)+k-1
        acc=cost[y]+opts[k,np.arange(cols)]
    path=np.zeros(rows,np.int16)
    path[-1]=acc.argmin()
    for y in range(rows-2,-1,-1):path[y]=back[y+1,path[y+1]]
    # Only 1.5 pixels of transition: preserve features instead of broad crossfade.
    return smoothstep((np.arange(cols)[None,:]-path[:,None]+.75)/1.5)


def quilt(source,seed,key,patch=288,overlap=48,step=208):
    """Random rotated source crops, four-sided min-cost seams, periodic indexing.
    No copied/mirrored edge strips. Every seam is part of the same torus.
    """
    rng=np.random.default_rng(seed)
    size=source.shape[0]
    y,x=np.indices((N,N))
    out=source[y%size,x%size].copy()
    starts=np.linspace(0,N,round(N/step),endpoint=False).astype(int)
    placements=[]
    for passno in range(2):
        positions=[(int(y),int(x)) for y in starts for x in starts]
        rng.shuffle(positions)
        for cy,cx in positions:
            cy+=int(rng.integers(-24,25));cx+=int(rng.integers(-24,25))
            sy=int(rng.integers(0,size-patch+1));sx=int(rng.integers(0,size-patch+1))
            rot=int(rng.integers(4));flip=bool(rng.integers(2))
            p=np.rot90(source[sy:sy+patch,sx:sx+patch],rot)
            if flip:p=p[:,::-1]
            yy=(np.arange(patch)+cy)%N;xx=(np.arange(patch)+cx)%N
            old=out[np.ix_(yy,xx)]
            err=(old-p)**2
            if err.ndim==3:err=err.mean(axis=2)
            # Edge energy also discourages cutting across a steep pore wall.
            err+=.03*(np.gradient(p if p.ndim==2 else p.mean(2),axis=0)**2)
            m=np.ones((patch,patch),np.float32)
            m[:,:overlap]*=path_mask(err[:,:overlap])
            m[:,-overlap:]*=path_mask(err[:,-overlap:][:,::-1])[:,::-1]
            m[:overlap,:]*=path_mask(err[:overlap,:].T).T
            m[-overlap:,:]*=path_mask(err[-overlap:,:][::-1].T).T[::-1]
            # Exactly keep the outer pixel, so the two sides of a wrapped patch join.
            m[[0,-1],:]=0;m[:,[0,-1]]=0
            if p.ndim==3:m=m[:,:,None]
            out[np.ix_(yy,xx)]=old*(1-m)+p*m
            placements.append([cy,cx,sy,sx,rot,int(flip)])
    META['quilts'][key]={"source_work_size":size,"patch":patch,"overlap":overlap,"passes":2,"placements":placements}
    return out.astype(np.float32)


def load_source(name,size,grey=True):
    path=ROOT/'source'/name
    im=Image.open(path)
    META['sources'][name]={"size":list(im.size),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}
    im=im.convert('L' if grey else 'RGB').resize((size,size),Image.Resampling.LANCZOS)
    return np.asarray(im,dtype=np.float32)/255


def stamp_pores(rng,count,radii,depths):
    depth=np.zeros((N,N),np.float32)
    rim=np.zeros_like(depth)
    for i in range(count):
        cx,cy=rng.uniform(0,N,2)
        r=float(np.exp(rng.uniform(np.log(radii[0]),np.log(radii[1]))))
        aspect=rng.uniform(.58,1)
        angle=rng.uniform(0,2*np.pi)
        reach=int(np.ceil(r*1.5))+2
        ix=np.arange(int(cx)-reach,int(cx)+reach+1)
        iy=np.arange(int(cy)-reach,int(cy)+reach+1)
        X,Y=np.meshgrid(ix-cx,iy-cy)
        u=(X*np.cos(angle)+Y*np.sin(angle))/r
        v=(-X*np.sin(angle)+Y*np.cos(angle))/(r*aspect)
        t=np.arctan2(v,u)
        shape=1+.13*np.sin(3*t+rng.uniform(0,6.28))+.08*np.sin(5*t+rng.uniform(0,6.28))
        d=np.sqrt(u*u+v*v)/shape
        # Flatish floors, steep walls, chipped perimeter. No hemisphere bubbles.
        pit=(1-smoothstep((d-.28)/.72))**.65
        a=rng.uniform(*depths)*np.clip(r/5,.35,1)
        pit*=a
        edge=np.exp(-((d-1.025)/.10)**2)*rng.uniform(.12,.52)
        idx=np.ix_(iy%N,ix%N)
        depth[idx]=np.maximum(depth[idx],pit)
        rim[idx]=np.maximum(rim[idx],edge)
    return depth,rim


def fossil_inclusions(rng,fresh):
    """Small partly broken shell arcs and corallite sections, made at target scale.
    Same masks drive relief, mineral colour and roughness.
    """
    field=np.zeros((N,N),np.float32)
    catalogue=[]
    for i in range(640 if fresh else 95):
        cx,cy=rng.integers(0,N,2)
        r=rng.uniform(1.8,14) if fresh else rng.uniform(3,16)
        k=int(np.ceil(r*1.4))+3
        iy=np.arange(cy-k,cy+k+1);ix=np.arange(cx-k,cx+k+1)
        X,Y=np.meshgrid(ix-cx,iy-cy)
        a=rng.uniform(0,6.28)
        u=(X*np.cos(a)+Y*np.sin(a))/r
        v=(-X*np.sin(a)+Y*np.cos(a))/(r*rng.uniform(.4,.8))
        R=np.sqrt(u*u+v*v);T=np.arctan2(v,u)
        edge=np.exp(-((R-1)/((.035+.55/r) if fresh else (.065+1/r)))**2)
        broken=smoothstep((np.sin(T+rng.uniform(0,6.28))+.12)/.5)
        if fresh:
            broken*=smoothstep((np.cos(T*2+rng.uniform(0,6.28))+.7)/.4)
        rib=.75+.25*np.cos(T*rng.integers(12,25))**2
        frag=edge*broken*rib
        if i%4==0:
            frag+=.5*np.exp(-((R-.72)/(.05+1/r))**2)*broken
        idx=np.ix_(iy%N,ix%N)
        field[idx]=np.maximum(field[idx],frag)
        catalogue.append({"x":int(cx),"y":int(cy),"radius_mm":round(r*MM_PER_PIXEL,2)})
    return field,catalogue


def save_png(name,a,kind):
    info=PngImagePlugin.PngInfo()
    info.add_text('physical_tile_mm','1500 x 1500')
    if kind=='height':
        info.add_text('height_range_mm','40; black=0; white=40; linear')
        im=Image.fromarray(a.astype(np.uint16))
    else:
        im=Image.fromarray(np.clip(np.rint(a),0,255).astype(np.uint8))
        info.add_text('encoding','sRGB' if kind=='base' else 'linear data')
        if kind=='normal':info.add_text('normal_convention','OpenGL: +X right, +Y image-up, +Z outward')
    kwargs={'icc_profile':SRGB} if kind=='base' else {}
    im.save(ROOT/name,pnginfo=info,**kwargs)


def colour_to_mean(a,target):
    # Iterating after clipping avoids a mean drift at saturated values.
    for _ in range(3):
        a=np.clip(a,1,254)
        a+=np.asarray(target)-a.mean(axis=(0,1),dtype=np.float64)
    return np.clip(a,0,255)


def normals_from_saved(path):
    h=np.asarray(Image.open(path),dtype=np.float32)*RANGE_MM/65535
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*MM_PER_PIXEL)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*MM_PER_PIXEL)
    normal=np.stack([-dx,dy,np.ones_like(h)],axis=-1)
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    return (normal*.5+.5)*255


def fracture_facets(rng):
    """Continuous fracture planes: shared vertices eliminate artificial cell cracks."""
    points=rng.uniform(0,N,(12500,2))
    values=rng.uniform(-2.7,2.7,len(points))
    copies=[];z=[]
    for oy in [-N,0,N]:
        for ox in [-N,0,N]:
            p=points+np.array([ox,oy])
            keep=((p>-80)&(p<N+80)).all(axis=1)
            copies.append(p[keep]);z.append(values[keep])
    interp=LinearNDInterpolator(Delaunay(np.concatenate(copies)),np.concatenate(z))
    yy,xx=np.indices((N,N),dtype=np.float32)
    f=interp(xx,yy).astype(np.float32)
    # Small curved fracture shoulders interrupt the planes, without gaps.
    f+=noise(rng,4)*.10
    return blur(f,.25)


def fracture_steps(rng):
    """Short, open hackle edges with 2–8 mm throws and curved recovery ramps.

    Isolated tears interrupt a continuous fracture surface. No closed cell
    boundaries, black crack network, or independently shaded facet pigment.
    """
    field=np.zeros((N,N),np.float32)
    cut=np.zeros_like(field)
    catalogue=[]
    for _ in range(3700):
        cx,cy=rng.integers(N,size=2)
        rx=rng.uniform(6,18);ry=rx*rng.uniform(.38,.82)
        angle=rng.uniform(0,2*np.pi)
        reach=int(np.ceil(rx*1.5))+3
        iy=np.arange(cy-reach,cy+reach+1);ix=np.arange(cx-reach,cx+reach+1)
        X,Y=np.meshgrid(ix-cx,iy-cy)
        u=(X*np.cos(angle)+Y*np.sin(angle))/rx
        v=(-X*np.sin(angle)+Y*np.cos(angle))/ry
        # Uneven, gently curved fracture lip, sharp over about one texel.
        edge=-.45+.18*v*v+.07*np.sin(6*v+angle)
        wall=smoothstep((u-edge)*rx/.85)
        back=1-smoothstep((u-edge)/1.35)
        side=1-smoothstep((np.abs(v)-.38)/.62)
        depth=float(rng.uniform(2,8))
        p=wall*back*side*depth
        idx=np.ix_(iy%N,ix%N)
        field[idx]=np.maximum(field[idx],p)
        cut[idx]=np.maximum(cut[idx],wall*back*side)
        catalogue.append({'x':int(cx),'y':int(cy),'throw_mm':round(depth,4),'width_mm':round(2*ry*MM_PER_PIXEL,4)})
    return field,cut,catalogue


def mineral_grit(rng):
    """1–3 mm limestone grains and sparse iron-bearing specks at native size.

    These masks are mineral composition, not normal-facing illumination.
    """
    pale=np.zeros((N,N),np.float32);dark=np.zeros_like(pale)
    for i in range(40000):
        cx,cy=rng.uniform(0,N,2)
        r=rng.uniform(.65,2.05)
        k=int(np.ceil(r))+2
        ix=np.arange(int(cx)-k,int(cx)+k+1);iy=np.arange(int(cy)-k,int(cy)+k+1)
        X,Y=np.meshgrid(ix-cx,iy-cy)
        angle=rng.uniform(0,2*np.pi)
        u=(X*np.cos(angle)+Y*np.sin(angle))/r
        v=(-X*np.sin(angle)+Y*np.cos(angle))/(r*rng.uniform(.45,1))
        mask=1-smoothstep((np.sqrt(u*u+v*v)-.48)/.65)
        idx=np.ix_(iy%N,ix%N)
        dst=dark if i%9==0 else pale
        dst[idx]=np.maximum(dst[idx],mask*rng.uniform(.5,1))
    return pale,dark


def revised_colour(base,h,cavity,fossil,name,rng):
    """Pigment/grime tied to concavity; independent of any light direction."""
    fresh=name=='fresh'
    pale,dark=mineral_grit(rng)
    grit=noise(rng,.38)*(.95 if fresh else 1.25)
    ooids=noise(rng,.66)
    if fresh:
        h+=ooids*.055+pale*.15-dark*.06
    # The source and new native pores both contribute, including shallow pits.
    bowl=np.clip((blur(h,3.5)-h)/(.95 if fresh else 1.35),0,1)
    pore=np.maximum(cavity, bowl*(.55 if fresh else .82))
    scour=np.clip((h-blur(h,2.3))/.65,0,1)
    b=base.copy()
    b-=pore[:,:,None]*np.array([26,27,25] if fresh else [49,48,39])
    b+=scour[:,:,None]*np.array([2.5,3,4] if fresh else [7,8,10])
    b+=(grit+ooids*(3.6 if fresh else 2.8))[:,:,None]
    b+=pale[:,:,None]*np.array([15,19,26] if fresh else [20,23,28])
    b-=dark[:,:,None]*np.array([38,37,30] if fresh else [51,49,40])
    b+=fossil[:,:,None]*np.array([23,31,48] if fresh else [13,17,23])
    ochre=np.clip(noise(rng,4.5)-1.2,0,1)*np.clip(noise(rng,16)+.2,0,1)
    b+=ochre[:,:,None]*np.array([3,-5,-15])*(.45 if fresh else 1)
    b=colour_to_mean(b,(222,208,176) if fresh else (196,178,140))
    return b,{'pore':pore,'pale_grit':pale,'dark_grit':dark,'ooids':ooids}


def fossil_sections(rng):
    """Sparse real generated fossil fragments, each only 15–25 mm across."""
    im=Image.open(ROOT/'source/fresh_relief.png').convert('L')
    boxes=[(150,265,285,405),(995,795,1125,925),(790,130,905,235)]
    height=np.zeros((N,N),np.float32);pigment=np.zeros_like(height);support=np.zeros_like(height)
    catalogue=[]
    for i in range(15):
        size=int(rng.integers(21,35));kind=i%3
        a=np.asarray(im.crop(boxes[kind]).resize((size,size),Image.Resampling.LANCZOS),dtype=np.float32)/255
        a=np.rot90(a,int(rng.integers(4)))
        y,x=np.indices(a.shape,dtype=np.float32)
        r=np.sqrt(((x-(size-1)/2)/(size/2))**2+((y-(size-1)/2)/(size/2))**2)
        mask=1-smoothstep((r-.62)/.32)
        relief=(a-gaussian_filter(a,3))*mask
        mineral=smoothstep((a-gaussian_filter(a,1.3)-.005)/.13)*mask
        cx,cy=rng.integers(0,N,2)
        idx=np.ix_((np.arange(size)+cy)%N,(np.arange(size)+cx)%N)
        height[idx]+=relief*5.8
        pigment[idx]=np.maximum(pigment[idx],mineral)
        support[idx]=np.maximum(support[idx],mask)
        catalogue.append({'kind':'coral' if kind==2 else 'gastropod section','x':int(cx),'y':int(cy),'width_mm':size*MM_PER_PIXEL})
    return height,pigment,support,catalogue


def build(name):
    fresh=name=='fresh'
    print(f'{name}: constructing periodic relief',flush=True)
    seed=SEED+int(fresh)*100
    rng=np.random.default_rng(seed)
    src=load_source(name+'_relief.png',320 if fresh else 640)
    # Remove very broad variations from the scalar source, not its pores.
    src=src-gaussian_filter(src,25,mode='reflect')+src.mean()
    q=quilt(src,seed+1,name,patch=256 if fresh else 288)
    q=blur(q,.38)
    lo,hi=np.percentile(q,[.5,99.5])
    q=np.clip((q-lo)/(hi-lo),0,1)
    # Relief source is interpreted as elevation artwork, never as albedo shading.
    middle=blur(q,.8 if fresh else 1.25)
    fine=q-middle
    if fresh:
        h=26+(middle-.5)*1.2+fine*.3+fracture_facets(rng)*.85
        steps,step_mask,step_catalogue=fracture_steps(rng)
        h-=steps
        META['fresh_steps']={'count':len(step_catalogue),'nominal_throw_mm':[2,8],
                             'realized_throw_percentiles_mm':np.percentile(steps[steps>1],[50,95,99,100]).tolist(),
                             'examples':step_catalogue[:64]}
        dep,rim=stamp_pores(rng,1600,(.7,6.5),(1.5,6.0))
        dp,rp=stamp_pores(rng,5000,(.55,1.7),(.4,1.8))
        dep=np.maximum(dep,dp);rim=np.maximum(rim,rp)
    else:
        h=28+(middle-.55)*6.0+fine*.75-5*np.clip((.43-middle)/.43,0,1)**1.2
        dep,rim=stamp_pores(rng,2100,(1.8,18),(5.5,19.5))
        dp,rp=stamp_pores(rng,7300,(.65,3.2),(1.0,4.5))
        dep=np.maximum(dep,dp);rim=np.maximum(rim,rp)
    native_grain=noise(rng,.6)*.045+noise(rng,1.4)*.07
    fossil,cat=fossil_inclusions(rng,fresh)
    if fresh:
        fh,fp,fs,sections=fossil_sections(rng)
        # Fossil calcite replaces part of the matrix, rather than stacking
        # an icon on top of unrelated high-frequency fracture relief.
        h=h*(1-.78*fs)+blur(h,3)*(.78*fs)+fh
        fossil=np.maximum(fossil,fp)
        META['fresh_sections']=sections
    # Existing solution pits cannot receive a second full cavity depth.
    # Attenuate extra erosion toward a 3 mm floor without clipping the height.
    h=h-dep*np.clip((h-3)/24,0,1)+rim+native_grain+fossil*(.48 if fresh else 1.15)
    h=blur(h,.32)
    if h.min()<.5 or h.max()>39.5:raise ValueError(f'Height clipping: {h.min()}, {h.max()}')
    cavity=np.maximum(np.clip((.32-q)/.32,0,1),np.clip(dep/(5 if fresh else 12),0,1))
    print(f'{name}: constructing pigment',flush=True)
    # Mineral pigment: separate from lighting. Chroma and diffuse mottling only.
    pig=load_source('limestone_pigment.png',768,False)
    pigment=quilt(pig,seed+2,name+'_pigment',patch=288)
    lum=pigment.mean(2)
    tint=pigment-lum[:,:,None]
    tint-=tint.mean((0,1))
    medium=noise(rng,18)
    broad=noise(rng,65)*.6+noise(rng,115)*.4
    mineral=unit(blur(lum,2)-blur(lum,40))
    warm=noise(rng,39)
    granule=unit(lum-blur(lum,1.3))
    target=(222,208,176) if fresh else (196,178,140)
    base=np.zeros((N,N,3),np.float32)+np.array(target,dtype=np.float32)
    base+=(broad*(.65 if fresh else 2.0)+medium*(.8 if fresh else 1.5)+mineral*(1.1 if fresh else 3.0))[:,:,None]
    base+=warm[:,:,None]*np.array([.9,.15,-1.4] if fresh else [2.4,.3,-3.8])
    base+=tint*(20 if fresh else 40)
    base+=granule[:,:,None]*1.0
    # A restrained mineral change associated with grains, with zero direction.
    base+=fossil[:,:,None]*np.array([13,14,17] if fresh else [7,8,10])
    # Faint cavity AO: never copy source brightness into the base colour.
    base-=cavity[:,:,None]*(4 if fresh else 7)
    base=colour_to_mean(base,target)
    rough=np.clip(.89+.016*medium+.020*cavity+.011*granule-.018*fossil,.81,.99)
    if not fresh:
        # Reproduce the accepted crust from its original pigment and random
        # stream BEFORE revising the clean colour. Its relief is unchanged.
        mottles=.48*noise(rng,9)+.34*noise(rng,27)+.18*noise(rng,70)
        peaks=np.clip((q-.69)/.28,0,1)
        # Patchy microcrystalline coating: pits and exposed points take more crust.
        bare_ridges=np.exp(-((middle-.64)/.12)**2)*(1-cavity)
        cover=np.clip(.70+.065*mottles+.30*cavity+.19*peaks-.24*bare_ridges, .12,.98)
        crust=base*(1-cover[:,:,None])+np.array([66,69,65])*cover[:,:,None]
        crust=colour_to_mean(crust,(120,116,106))
        save_png('weathered_crust_base.png',crust,'base')
        crust_rough=np.clip(rough-.065*cover*peaks-.012*cover,.80,.98)
        save_png('weathered_crust_rough.png',crust_rough*255,'rough')
    print(f'{name}: adding registered mineral colour and writing maps',flush=True)
    base,detail=revised_colour(base,h,cavity,fossil,name,np.random.default_rng(seed+811))
    if fresh:
        rough=np.clip(rough-.02*detail['pale_grit']+.012*detail['dark_grit']-.018*fossil,.81,.99)
    save_png(name+'_base.png',base,'base')
    quantized=np.rint(h/RANGE_MM*65535).astype(np.uint16)
    save_png(name+'_height.png',quantized,'height')
    save_png(name+'_normal.png',normals_from_saved(ROOT/(name+'_height.png')),'normal')
    save_png(name+'_rough.png',rough*255,'rough')
    pore=detail['pore'];bright=(pore<.1)&(fossil<.1)
    pigment_y=base[:,:,0]*.2126+base[:,:,1]*.7152+base[:,:,2]*.0722
    deep=pore>.85
    META[name]={"height_minmax_mm":[float(h.min()),float(h.max())],"fossil_inclusions":cat,
                "native_pore_count":6600 if fresh else 9400,"grain_rms_mm":float(native_grain.std()),
                "source_scalar_percentiles":[float(lo),float(hi)],
                "height_quantization_max_mm":float(np.max(np.abs(h.astype(np.float64)-quantized.astype(np.float64)*40/65535))),
                "pore_fraction_over_half":float((pore>.5).mean()),
                "pore_luma":float(pigment_y[deep].mean()),"ridge_luma":float(pigment_y[bright].mean()),
                "pore_to_ridge_luma_ratio":float(pigment_y[deep].mean()/pigment_y[bright].mean()),
                "fossil_mean_rgb":base[fossil>.5].mean(0,dtype=np.float64).tolist()}
    if not fresh:
        META[name]['crust_point_roughness_drop']=float((rough-crust_rough)[peaks>.5].mean())
    print(f'{name}: height {h.min():.3f}–{h.max():.3f} mm',flush=True)


def main():
    start=time.perf_counter()
    build('weathered')
    build('fresh')
    META['build_seconds']=round(time.perf_counter()-start,2)
    (ROOT/'build_metadata.json').write_text(json.dumps(META,indent=2)+'\n')
    print(f'Build complete in {META["build_seconds"]} s',flush=True)

if __name__=='__main__':main()
