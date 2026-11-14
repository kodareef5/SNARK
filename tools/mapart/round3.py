"""Round three: localized land pictures, painted data-led water, continuous cuts.

Retained-paint.png is the frozen accepted round-two finish, a production input.
New generated originals supply the native hand. Bathymetry controls the broad
underwater structure; the existing source coast remains authoritative.
"""
import argparse, json
import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
from common import ROOT, SIZE, vectors
from round2 import far_register, assemble_far, wet, major_roads, INK
from round3_bathy import pigment
from finish import load

R=ROOT/'reports/round3'
# Soft editorial selection, in overview pixels. Pictorial symbols, not world
# footprint additions. Far diagrams only; z2/z3 retain all source-bound rooms.
PLACES=[('banyan_arcade',125,241,100,86),('drowned_towers',172,447,90,115),
        ('reed_bowl',208,554,62,56),('deco_gallery',915,479,72,70),
        ('tank_grove',714,925,87,72),('belle_loggia',737,355,37,34)]

def far_land_mask(n):
    y,x=np.mgrid[:n,:n].astype(np.float32);x*=1024/n;y*=1024/n
    mask=np.zeros((n,n),np.float32)
    for _,cx,cy,rx,ry in PLACES:
        r=np.sqrt(((x-cx)/rx)**2+((y-cy)/ry)**2)
        mask=np.maximum(mask,np.clip((1-r)/.18,0,1))
    return mask

def register(z):
    n=1024*2**z;w=np.array(Image.open(ROOT/f'references/z{z}/surface_water.png'))>0
    cache=ROOT/f'paintings/z{z}/round3.registered.png'
    if cache.exists():return load(cache)
    if z==0:
        a,info=far_register(load(ROOT/'paintings/z0/0_0.raw.png',(n,n)),w)
        (R/'z0-registration.json').write_text(json.dumps(info,indent=2))
        (ROOT/'paintings/z0/0_0.registered.json').write_text(json.dumps(info,indent=2))
    elif z==1:a=assemble_far(z,w)
    else:
        from alignment import shore_align
        g=64;s=1152;a=np.zeros((n,n,3),np.float32);total=np.zeros((n,n),np.float32)
        ramp=np.ones(s,np.float32);ramp[:128]=np.sin(np.linspace(0,np.pi/2,128))**2;ramp[-128:]=ramp[:128][::-1]
        weight=ramp[:,None]*ramp[None,:];padded=np.pad(w,g,mode='edge');logs={}
        for y in range(2**z):
            for x in range(2**z):
                source=load(ROOT/f'paintings/z{z}/{x}_{y}.raw.png',(s,s))
                source_water=(source[...,1]-source[...,0]>1)&(source[...,2]-source[...,0]>-48)
                tile,info=shore_align(source,padded[y*1024:y*1024+s,x*1024:x*1024+s],source_water)
                logs[f'{x}_{y}']=info
                (ROOT/f'paintings/z{z}/{x}_{y}.registered.json').write_text(json.dumps(info,indent=2))
                xa=max(0,x*1024-g);xb=min(n,(x+1)*1024+g);ya=max(0,y*1024-g);yb=min(n,(y+1)*1024+g)
                u=xa-(x*1024-g);v=ya-(y*1024-g);q=weight[v:v+yb-ya,u:u+xb-xa]
                a[ya:yb,xa:xb]+=tile[v:v+yb-ya,u:u+xb-xa]*q[...,None];total[ya:yb,xa:xb]+=q
                print('registered water',x,y,flush=True)
        a/=np.maximum(total[...,None],.0001)
        (R/'z2-registration.json').write_text(json.dumps(logs,indent=2))
    Image.fromarray(np.uint8(np.clip(a,0,255))).save(cache)
    # Read the same frozen precision used on cache hits; cache existence must
    # never change the exported artwork by a rounding unit.
    return load(cache)

def extend_water(raw,w):
    """Inpaint displaced land pigment only within authoritative surface water.

    This does not soften an entire coast or invent a luminous shore-distance
    field. The source strokes survive throughout correctly painted water.
    """
    # Pale green shoals are still water. The older open-teal classifier would
    # wrongly erase them and form conspicuous nearest-neighbour polygons.
    source=(raw[...,1]-raw[...,0]>1)&(raw[...,2]-raw[...,0]>-48)
    bad=w&~source
    a=cv2.inpaint(np.uint8(np.clip(raw,0,255)),bad.astype(np.uint8),5,cv2.INPAINT_TELEA).astype(np.float32)
    return a

def paint_water(raw,w,z):
    n=len(w);guide=pigment(n)
    # Slightly soften the ten-metre DEM's interpolation facets, not the shore.
    guide=nd.gaussian_filter(guide,(.8*2**z,.8*2**z,0))
    a=raw if z==3 else extend_water(raw,w)
    # Normalized filtering avoids dark shore ink or ivory land making halos.
    sigma=12 if z<2 else 22
    den=nd.gaussian_filter(w.astype(np.float32),sigma)
    out=guide.copy()
    for k in range(3):
        broad=nd.gaussian_filter(a[...,k]*w,sigma)/np.maximum(den,.0001)
        detail=a[...,k]-broad
        if z<3:detail=np.clip(detail,-24,24)
        if z<=2:
            # Keep the fresh quill/wash marks. Data, not generated contour drift,
            # carries all low-frequency depth structure.
            bias=np.clip(broad-guide[...,k],-10,10)*.3
            out[...,k]+=detail*.80+bias
        else:
            # Existing fine watercolor is accepted: change its large wash only.
            out[...,k]+=detail
    return out

def living_coast(out,w,z):
    """Trace real vectors with a subpixel pen; no staircase or regular dashes."""
    if z>1:return out
    n=len(w);s=3
    layer=Image.new('RGBA',(n*s,n*s));d=ImageDraw.Draw(layer)
    from shapely.ops import unary_union
    # TIGER splits one continuous bay into records. Their internal boundaries
    # are NOT coast and must never become ink strokes across the sea.
    for g in [unary_union([g for g,p in vectors('areawater')])]:
        polys=list(g.geoms) if g.geom_type=='MultiPolygon' else [g]
        for poly in polys:
            for ring in [poly.exterior,*poly.interiors]:
                pts=np.array(ring.coords,np.float64)
                px=np.stack([(pts[:,0]+4064)/SIZE*n,(4064-pts[:,1])/SIZE*n],-1)
                phase=0.
                for q0,q1 in zip(px[:-1],px[1:]):
                    delta=q1-q0;length=np.linalg.norm(delta)
                    if length<.1:continue
                    normal=np.array([-delta[1],delta[0]])/length
                    for t in np.arange(0,length,1.5):
                        tt=min(t+1.6,length);pos=phase+t
                        # Continuous bounded irregular pen pressure, not dots.
                        strength=.47+.18*np.sin(pos*.13)+.12*np.sin(pos*.63+1.8)
                        width=.55+.20*np.sin(pos*.22+.4)
                        j0=.45*np.sin(pos*.61)+.18*np.sin(pos*1.31)
                        j1=.45*np.sin((phase+tt)*.61)+.18*np.sin((phase+tt)*1.31)
                        a=q0+delta*t/length+normal*j0;b=q0+delta*tt/length+normal*j1
                        # Beaches retain the original delicate treatment.
                        u,v=a/n
                        if u<.29 and v<.66:
                            strength=.82+.16*np.sin(pos*.13)+.10*np.sin(pos*.63+1.8)
                            width=1.03+.35*np.sin(pos*.22+.4)
                        if u>.91 or v>.82 and u>.49:strength*=.32
                        if min(a)<1 or max(a)>n-2:continue
                        d.line([tuple(a*s),tuple(b*s)],fill=(76,78,53,int(210*strength)),width=max(1,round(width*s)))
                    phase+=length
    layer=layer.resize((n,n),Image.Resampling.LANCZOS)
    return np.array(Image.alpha_composite(Image.fromarray(np.uint8(np.clip(out,0,255))).convert('RGBA'),layer).convert('RGB'),np.float32)

def finish(z):
    n=1024*2**z
    print('load accepted paint',z,flush=True)
    old=load(ROOT/f'paintings/z{z}/retained-paint.png')
    w=np.array(Image.open(ROOT/f'references/z{z}/surface_water.png'))>0
    rd=major_roads(z,n)
    print('native masks ready',z,flush=True)
    raw=register(z) if z<3 else old
    out=old.copy()
    if z<2:
        mask=far_land_mask(n)*(~w)
        # Keep every principal road at its native source alignment.
        mask[rd]=0
        land=raw.copy()
        wrong=(~w)&wet(raw)&(nd.distance_transform_edt(~w)<14)
        land[wrong]=old[wrong]
        out=out*(1-mask[...,None])+land*mask[...,None]
    print('paint water',z,flush=True)
    wp=paint_water(raw,w,z);out[w]=wp[w]
    print('water ready',z,flush=True)
    # Accepted crane arms project beyond the port's physical land silhouette.
    # Retain those warm ink marks, not a new strip of land beneath the cranes.
    if z<2:
        yy,xx=np.mgrid[:n,:n]
        port=(xx/n>.30)&(xx/n<.77)&(yy/n>.45)&(yy/n<.66)
        crane=port&w&(old[...,0]-old[...,1]>2)&(old[...,1]-old[...,2]>12)&(old.mean(2)<205)
        out[crane]=old[crane]
    if z<2:
        # Remove the old mechanical double shore trace on the mainland only.
        dl=nd.distance_transform_edt(~w)
        y,x=np.mgrid[:n,:n];mainland=(x/n<.29)&(y/n<.66)
        band=mainland&~w&(dl<3.8)&~rd
        if band.any():
            mask=band.astype(np.uint8)
            repaired=cv2.inpaint(np.uint8(np.clip(out,0,255)),mask,3,cv2.INPAINT_TELEA)
            out[band]=repaired[band]
    out=living_coast(out,w,z)
    im=Image.fromarray(np.uint8(np.clip(out,0,255)))
    im.save(ROOT/f'paintings/z{z}/unbalanced-master.png')
    im.save(ROOT/f'paintings/z{z}/final-master.png')
    im.resize((1024,1024),Image.Resampling.LANCZOS).save(R/f'z{z}-study.png')
    print('round3 finish',z,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('zoom',type=int);a=p.parse_args();finish(a.zoom)
