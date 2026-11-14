"""Register generated pigment, then constrain every visible feature to world geometry."""
import argparse,json,hashlib,inspect
import numpy as np
from PIL import Image,ImageDraw
from scipy import ndimage as nd
from common import *
from reference import grid_at
from alignment import feature_align,shore_align

def load(path,size=None):
    im=Image.open(path).convert('RGB')
    if size:im=im.resize(size,Image.Resampling.LANCZOS)
    return np.asarray(im,dtype=np.float32)

def water_rgb(a):return (a[...,1]-a[...,0]>3)&(a[...,2]-a[...,0]>-18)

def sample(a,y,x):
    if a.ndim==2:return nd.map_coordinates(a,[y,x],order=1,mode='nearest')
    return np.stack([nd.map_coordinates(a[...,i],[y,x],order=1,mode='nearest') for i in range(3)],-1)

def register(a,truth,reference=None):
    """Small smooth shoreline correction; final geometry is imposed separately."""
    aligned=False
    register.last_info={}
    if reference is not None:
        a,aligned,info=feature_align(a,reference)
        register.last_info['feature_fit']=info
        print('features',info,flush=True)
    if not aligned and .002<truth.mean()<.998:
        a,info=shore_align(a,truth)
        register.last_info['shore_similarity']=info
        print('shore similarity',info,flush=True)
        aligned=True
    if not aligned and a.shape[0]==1152:
        # Measured fallback for this image tool's expanded framing. Broad water
        # scenes lack unique corners; allow only small shoreline refinements.
        y,x=np.mgrid[:1152,:1152].astype(np.float32)
        a=sample(a,y/1.082,x/1.082)
    wet=water_rgb(a)
    ss=nd.gaussian_filter(nd.distance_transform_edt(wet)-nd.distance_transform_edt(~wet),1)
    ts=nd.gaussian_filter(nd.distance_transform_edt(truth)-nd.distance_transform_edt(~truth),1)
    sy,sx=np.gradient(ss)
    yy,xx=np.mgrid[:truth.shape[0],:truth.shape[1]].astype(np.float32)
    ux=np.zeros_like(xx);uy=np.zeros_like(yy)
    band=np.exp(-(np.abs(ts)/24)**4)
    for _ in range(12):
        delta=ts-sample(ss,yy+uy,xx+ux)
        gy=sample(sy,yy+uy,xx+ux);gx=sample(sx,yy+uy,xx+ux)
        den=gx*gx+gy*gy+(delta/2)**2+1e-4
        ux=nd.gaussian_filter(ux+nd.gaussian_filter(delta*gx/den,1)*band,.65)
        uy=nd.gaussian_filter(uy+nd.gaussian_filter(delta*gy/den,1)*band,.65)
        ux=np.clip(ux,-4,4);uy=np.clip(uy,-4,4)
    a=sample(a,yy+uy,xx+ux)
    # Repair only water, using open-water pigment clear of any inked land.
    # Keep land's original brushwork intact; semantic palettes handle invented
    # inland pools later without nearest-neighbor patchwork across tree crowns.
    wet=water_rgb(a)
    safe=nd.binary_erosion(wet,iterations=10,border_value=1)
    if safe.any():
        inds=nd.distance_transform_edt(~safe,return_distances=False,return_indices=True)
        bad=truth&~safe
        a[bad]=a[inds[0][bad],inds[1][bad]]
        smooth=nd.gaussian_filter(a,(1.6,1.6,0))
        blend=nd.gaussian_filter(bad.astype(np.float32),1.6)*truth
        a=a*(1-blend[...,None])+smooth*blend[...,None]
    return a

def cached_register(path,reference_path,truth,size):
    cache=path.with_name(path.name.replace('.raw.png','.registered.png'))
    meta=cache.with_suffix('.json')
    fingerprint=hashlib.sha256(path.read_bytes()+reference_path.read_bytes()+truth.tobytes()+
          inspect.getsource(register).encode()+inspect.getsource(feature_align).encode()+inspect.getsource(shore_align).encode()).hexdigest()
    if cache.exists() and meta.exists() and json.loads(meta.read_text()).get('fingerprint')==fingerprint:
        return load(cache)
    a=register(load(path,(size,size)),truth,load(reference_path))
    save(np.uint8(np.clip(a,0,255)),cache)
    meta.write_text(json.dumps({'fingerprint':fingerprint,'raw':path.name,**register.last_info},indent=2))
    return load(cache)

def assemble(z,partial=False):
    n=1024*2**z;count=2**z; ref=ROOT/'references'/f'z{z}'
    truth=np.array(Image.open(ref/'surface_water.png'))>0
    if z==0:return cached_register(ROOT/'paintings/z0/0_0.raw.png',ref/'whole.png',truth,n)
    # Overlapping native-scale paintings; smooth partition of unity in the gutters.
    out=np.zeros((n,n,3),np.float32);total=np.zeros((n,n),np.float32)
    g=64;size=1024+2*g
    ramp=np.ones(size,np.float32);ramp[:2*g]=np.sin(np.linspace(0,np.pi/2,2*g))**2
    ramp[-2*g:]=ramp[:2*g][::-1]
    weight=ramp[:,None]*ramp[None,:]
    padded=np.pad(truth,g,mode='edge')
    for y in range(count):
        for x in range(count):
            p=ROOT/'paintings'/f'z{z}'/f'{x}_{y}.raw.png'
            if not p.exists():
                if not partial:raise FileNotFoundError(p)
                continue
            target=padded[y*1024:y*1024+size,x*1024:x*1024+size]
            a=cached_register(p,ref/f'{x}_{y}.context.png',target,size)
            xa=max(0,x*1024-g);xb=min(n,(x+1)*1024+g)
            ya=max(0,y*1024-g);yb=min(n,(y+1)*1024+g)
            u=xa-(x*1024-g);v=ya-(y*1024-g)
            w=weight[v:v+yb-ya,u:u+xb-xa].copy()
            if x==0:w[:,:g]=ramp[v:v+yb-ya,None]
            if y==0:w[:g,:]=ramp[None,u:u+xb-xa]
            if x==count-1:w[:,-g:]=ramp[v:v+yb-ya,None]
            if y==count-1:w[-g:,:]=ramp[None,u:u+xb-xa]
            if x==0 and y==0:w[:g,:g]=1
            if x==count-1 and y==0:w[:g,-g:]=1
            if x==0 and y==count-1:w[-g:,:g]=1
            if x==count-1 and y==count-1:w[-g:,-g:]=1
            out[ya:yb,xa:xb]+=a[v:v+yb-ya,u:u+xb-xa]*w[...,None]
            total[ya:yb,xa:xb]+=w
    out/=np.maximum(total[...,None],1e-6)
    if partial:
        parent_path=ROOT/'paintings'/f'z{z-1}'/'final-master.png'
        if not parent_path.exists():parent_path=ROOT/'checks'/f'partial_z{z-1}.png'
        parent=load(parent_path,(n,n));missing=total<.999
        out[missing]=out[missing]*total[missing,None]+parent[missing]*(1-total[missing,None])
    return out

def pigment(lum,rg,gb):
    # Distinct physical pigment families make geometry measurable directly in RGB.
    g=np.clip(lum,gb+2,253-rg)
    return np.stack([g+rg,g,g-gb],-1)

def finish(z,partial=False):
    n=1024*2**z;mpp=SIZE/n; ref=ROOT/'references'/f'z{z}'
    raw=assemble(z,partial)
    save(np.uint8(np.clip(raw,0,255)),ROOT/'paintings'/f'z{z}'/'registered.png')
    w=np.array(Image.open(ref/'surface_water.png'))>0
    rd=np.array(Image.open(ref/'roads.png'))>0
    b=np.array(Image.open(ref/'buildings.png'))>0
    bio=np.array(Image.open(ref/'biome.png'))
    # Remove invented architectural boundaries, retain gently varying wash.
    l=raw.mean(2);soft=nd.gaussian_filter(l,2.2+z*.65)
    fine=np.clip(l-nd.gaussian_filter(l,.65),-22,22)
    # Bare paper receives a broad wash, not blurred ghosts of generated trees or
    # invented houses. Crisp detail is reserved for the constrained feature masks.
    paper=nd.gaussian_filter(l,18)
    out=pigment(190+(paper-174)*.22+fine*.16,19,40)
    nature=np.isin(bio,[3,4,5])
    if (ROOT/'base/painted_canopy_fine.png').exists():
        crown=np.asarray(Image.open(ROOT/'base/painted_canopy_fine.png').resize((n,n),Image.Resampling.NEAREST))>0
    else:
        # Pilot only. Final acceptance uses one frozen finest-scale canopy layer
        # for ALL zooms, including world data, rather than independent tree guesses.
        crown=((raw[...,1]-raw[...,0]>-5)&(raw[...,1]-raw[...,2]>30))|((raw[...,1]-raw[...,0]>-18)&(raw[...,1]-raw[...,2]>48)&(raw[...,1]<170))
        crown=nd.binary_closing(crown,iterations=1)
    nature=(nature|crown)&~(w|rd|b)
    green=raw.copy();green[...,1]=np.clip(150+(raw[...,1]-150)*.85,70,195)
    green[...,0]=green[...,1]+np.clip(raw[...,0]-raw[...,1],-8,12)
    green[...,2]=green[...,1]-np.clip(raw[...,1]-raw[...,2],46,66)
    out[nature]=green[nature]
    beach=bio==6
    out[beach]=pigment(211+(l-190)*.30,19,50)[beach]
    # Water is kept as generated watercolor, with exact coast repair.
    water=raw.copy()
    water[...,1]=np.maximum(water[...,1],water[...,0]+12)
    water[...,2]=np.maximum(water[...,2],water[...,0]+1)
    dw=nd.distance_transform_edt(w).astype(np.float32)
    # A continuous wet wash softens pigment extended across registration gaps.
    # Normalize inside water so nearby masonry never bleeds into the shallows.
    sigma=max(1.5,12/mpp)
    mf=w.astype(np.float32);den=nd.gaussian_filter(mf,sigma)
    blend=np.exp(-dw/max(2,48/mpp))*.85*w
    for k in range(3):
        wash=nd.gaussian_filter(water[...,k]*mf,sigma)/np.maximum(den,.001)
        water[...,k]=water[...,k]*(1-blend)+wash*blend
    out[w]=water[w]
    # Pale shallows and crisp ink at the measured water edge.
    # Hide nearest-pigment extension streaks with a continuous shallow wash.
    near=np.exp(-dw/max(2,32/mpp))*.72*w
    shallow=np.stack([153+fine*.15,181+fine*.15,165+fine*.15],-1)
    out=out*(1-near[...,None])+shallow*near[...,None]
    shore=w&(dw<=1)
    out[shore]=out[shore]*.40+np.array([45,72,63],np.float32)*.60
    landedge=(~w)&(nd.distance_transform_edt(~w)<=1)&~b&~rd
    out[landedge]*=.62
    # Exact road corridors, with economical shoulder lines, no invented lanes.
    rdist=nd.distance_transform_edt(rd).astype(np.float32)
    rl=211+np.clip((raw[...,1]-190)*.42,-28,18)+fine*.28
    if z>0:rl=rl-np.where(rdist<=1,22,0).astype(np.float32)
    out[rd]=pigment(rl,7,38)[rd]
    # Footprint-specific ruined masonry, preserving true courtyards and holes.
    db=nd.distance_transform_edt(b).astype(np.float32)
    bl=174+(soft-174)*.20+fine*.32 if z<2 else 174+(l-174)*.75+fine*.20
    if z==0:bl-=np.where(db<=1,43,0).astype(np.float32)
    else:bl-=np.where(db<=1,67,np.where(db<=2,10,0)).astype(np.float32)
    yy,xx=np.indices((n,n),dtype=np.int32)
    if z>=1:
        # Restrained quill hatch along interior walls; tied to map coordinates.
        hatch=((xx+yy*2)%(8+z)==0)&(db>1)&(db<4+z)
        bl[hatch]-=25
        # Unequal interior coursing; never spills beyond a building footprint.
        courses=((xx*3-yy)%19==0)&(db>3)
        bl[courses]-=10
    out[b]=pigment(bl,16,23)[b]
    # An explicit authored standing-water layer, not an extra invented coastline.
    flood=(grid_at('flooded_streets',n)>0)&rd&~b
    out[flood]=np.array([119,155,146])+fine[flood,None]*.2
    # Match broad pigment fields to accepted parent while retaining native detail.
    # Material-local luminance matching avoids smearing a coast into neighboring land.
    if z>0:
        parent_path=ROOT/'paintings'/f'z{z-1}'/'final-master.png'
        if not parent_path.exists():parent_path=ROOT/'checks'/f'partial_z{z-1}.png'
        parent=load(parent_path,(n,n))
        masks=[w,rd&~b&~flood,b,nature&~rd&~b,beach&~rd&~b,~(w|rd|b|nature|beach)]
        for mask in masks:
            mf=mask.astype(np.float32)
            den=nd.gaussian_filter(mf,12)
            a=nd.gaussian_filter(out[...,1]*mf,12)/np.maximum(den,.01)
            p=nd.gaussian_filter(parent[...,1]*mf,12)/np.maximum(den,.01)
            delta=np.clip(p-a,-50,50)*.96
            out[mask]+=delta[mask,None]
        # Water hue, not just brightness, must agree with the accepted parent.
        mf=w.astype(np.float32);den=nd.gaussian_filter(mf,8)
        for k in [0,2]:
            a=nd.gaussian_filter(out[...,k]*mf,8)/np.maximum(den,.01)
            p=nd.gaussian_filter(parent[...,k]*mf,8)/np.maximum(den,.01)
            delta=np.clip(p-a,-55,55)
            out[...,k][w]+=delta[w]
    # Reassert visible pigment categories after color transfer and clipping.
    out=np.clip(out,0,255)
    dry=~(w|rd|b|flood)
    # Keep shaded shore ink in its own material family too. Otherwise darkened
    # olive can accidentally acquire the ochre road family's RGB differences.
    out[dry&~nature&~beach]=pigment(out[...,1],19,40)[dry&~nature&~beach]
    out[dry&beach]=pigment(out[...,1],19,50)[dry&beach]
    forest=dry&nature&~beach
    g=np.clip(out[...,1],68,241)
    green=np.stack([g+np.clip(out[...,0]-out[...,1],-8,12),g,
                    g-np.clip(out[...,1]-out[...,2],46,66)],-1)
    out[forest]=green[forest]
    for mask,rg,gb in [(b,16,23),(rd&~b&~flood,7,38)]:out[mask]=pigment(out[...,1],rg,gb)[mask]
    out[...,0][w|flood]=np.minimum(out[...,0][w|flood],245)
    out[...,1][w|flood]=np.maximum(out[...,1][w|flood],out[...,0][w|flood]+10)
    out[...,2][w|flood]=np.maximum(out[...,2][w|flood],out[...,0][w|flood]+1)
    out=np.uint8(np.clip(out,0,255))
    if (ROOT/'base/future_changes.geojson').exists():
        # Sunken wrecks are authored world objects. Teal ink keeps them visibly
        # beneath the water, and their exact polygons are saved for the engine.
        from shapely.geometry import LineString
        im=Image.fromarray(out);draw=ImageDraw.Draw(im)
        def pixel(x,y):return ((x-B[0])/mpp,(B[3]-y)/mpp)
        for geom,props in vectors('future_changes'):
            if props['kind']!='submerged_wreck' or z==0:continue
            pts=[pixel(x,y) for x,y in geom.exterior.coords]
            draw.line(pts,fill=(61,88,77),width=1)
            import math
            angle=math.radians(props['angle_degrees']);dx=math.cos(angle);dy=math.sin(angle)
            cx,cy=props['center'];length=props['length_m'];width=props['width_m']
            if z>=2:
                for u in np.arange(-length*.4,length*.35,5):
                    draw.line([pixel(cx+u*dx-v*dy,cy+u*dy+v*dx) for v in [-width*.4,width*.4]],fill=(72,100,87),width=1)
        out=np.asarray(im)
    dest=ROOT/'tiles'/f'z{z}'
    save(out,ROOT/'checks'/f'partial_z{z}.png' if partial else ROOT/'paintings'/f'z{z}'/'final-master.png')
    im=Image.fromarray(out)
    for y in range(2**z):
        for x in range(2**z):
            if partial and not (ROOT/'paintings'/f'z{z}'/f'{x}_{y}.raw.png').exists():continue
            dest.mkdir(parents=True,exist_ok=True)
            im.crop((x*1024,y*1024,(x+1)*1024,(y+1)*1024)).save(dest/f'{x}_{y}.png')
    im.resize((1024,1024),Image.Resampling.LANCZOS).save(ROOT/'checks'/f'overview_z{z}.png')
    print('finished',z,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('zoom',type=int);p.add_argument('--partial',action='store_true');a=p.parse_args();finish(a.zoom,a.partial)
