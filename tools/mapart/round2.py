"""Scale-aware ink-and-wash finishing. Saved originals are the only paint inputs.

Round two intentionally separates semantic generalization from geographic precision.
Run `round2.py finish Z`, then `round2_measure.py`. See README for provenance.
"""
import argparse, json, math
import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
from common import ROOT, SIZE, B, vectors, burn, save
from reference import grid_at
from finish import load, assemble, sample
from alignment import shore_align

PAPER=np.array([237,225,198],np.float32)
INK=np.array([80,73,51],np.float32)


def wet(a):
    return (a[...,1]-a[...,0]>3)&(a[...,2]-a[...,0]>-18)


def far_register(a,truth):
    """Silhouette-only fit avoids matching invented landmark windows to real blocks."""
    a,info=shore_align(a,truth)
    return a,info


def assemble_far(z,w):
    n=len(w);g=64;s=1152
    out=np.zeros((n,n,3),np.float32);total=np.zeros((n,n),np.float32)
    ramp=np.ones(s,np.float32);ramp[:128]=np.sin(np.linspace(0,np.pi/2,128))**2;ramp[-128:]=ramp[:128][::-1]
    weight=ramp[:,None]*ramp[None,:];padded=np.pad(w,g,mode='edge')
    for y in range(2**z):
        for x in range(2**z):
            p=ROOT/f'paintings/z{z}/{x}_{y}.raw.png'
            a,info=far_register(load(p,(s,s)),padded[y*1024:y*1024+s,x*1024:x*1024+s])
            p.with_name(f'{x}_{y}.registered.json').write_text(json.dumps(info,indent=2))
            xa=max(0,x*1024-g);xb=min(n,(x+1)*1024+g);ya=max(0,y*1024-g);yb=min(n,(y+1)*1024+g)
            u=xa-(x*1024-g);v=ya-(y*1024-g);q=weight[v:v+yb-ya,u:u+xb-xa]
            out[ya:yb,xa:xb]+=a[v:v+yb-ya,u:u+xb-xa]*q[...,None];total[ya:yb,xa:xb]+=q
    return out/np.maximum(total[...,None],1e-6)


def clean_far_coast(raw,w):
    """Remove displaced source shore marks before drawing the measured shore.

    Unlike unrestricted elastic registration this cannot bend architectural ink.
    Only a narrow band beside source and target coasts is repainted.
    """
    sw=wet(raw)
    # Ignore fine paper grain and ink pinholes when finding the painted coast.
    sw=nd.binary_closing(sw,iterations=2,border_value=1)
    sw=nd.binary_opening(sw,iterations=2)
    ds=nd.distance_transform_edt(sw)-nd.distance_transform_edt(~sw)
    dt=nd.distance_transform_edt(w)-nd.distance_transform_edt(~w)
    displaced=(np.abs(ds)<3.5)&(np.abs(dt)<28)&(np.abs(dt)>2)
    clean=cv2.inpaint(np.uint8(np.clip(raw,0,255)),displaced.astype('uint8'),5,cv2.INPAINT_TELEA).astype(np.float32)
    landgood=(~sw)&(~w)&(raw.mean(2)>130)
    den=nd.gaussian_filter(landgood.astype(np.float32),8)
    bad=(~w)&sw&(np.abs(dt)<28)
    for k in range(3):
        field=nd.gaussian_filter(clean[...,k]*landgood,8)/np.maximum(den,.001)
        field=np.where(den>.01,field,PAPER[k])
        clean[...,k][bad]=field[bad]
    return clean,sw


def major_roads(z,n):
    water=np.array(Image.open(ROOT/f'references/z{z}/water.png'))>0
    chosen=[]
    for g,p in vectors('roads'):
        if 'tunl' in (p['name'] or '').lower():continue
        name=p['name'] or ''
        keep=p['mtfcc'] in ['S1100','S1200'] or any(t in name for t in ['Venetian','Dade Blvd'])
        if z==1: keep=keep or name in ['N Miami Ave','S Miami Ave','Washington Ave','Meridian Ave','West Ave','NE 2nd Ave','NW 2nd Ave']
        if z>=2:keep=True
        if keep:chosen.append((g.buffer(p['width_m']/2,cap_style=2,join_style=2),1))
    rd=burn(chosen,n)>0
    # Preserve every causeway, including local road sections over the bay.
    allrd=np.array(Image.open(ROOT/f'references/z{z}/roads.png'))>0
    rd|=allrd&water
    gaps=burn([(g,1) for g,p in vectors('future_changes') if p['kind']=='missing_bridge_span'],n)>0
    return rd&~gaps


def paper_texture(n):
    # Reuse original rag-paper tooth at every zoom; no new random noise field.
    sheet=load(ROOT/'style/style-sheet.png')
    swatch=sheet.mean(2)
    # Only subpixel tooth, never a strip containing drawn dune hatches. The
    # rejected small swatch repeated its strokes visibly across open water.
    swatch=np.clip(swatch-nd.gaussian_filter(swatch,.55),-4,4)*.50
    return np.tile(swatch,(math.ceil(n/swatch.shape[0]),math.ceil(n/swatch.shape[1])))[:n,:n]


def generalized(z):
    """Native geographic drawing plan: only principal roads and spaced anchors."""
    n=1024*2**z;ref=ROOT/f'references/z{z}'
    w=np.array(Image.open(ref/'surface_water.png'))>0
    bio=np.array(Image.open(ref/'biome.png'))
    rd=major_roads(z,n)
    a=np.empty((n,n,3),np.uint8);a[:]=PAPER;a[w]=[113,153,143]
    dw=nd.distance_transform_edt(w);a[w&(dw<7*2**z)]=[173,195,173]
    green=np.isin(bio,[3,4,5])&~w
    g=(nd.gaussian_filter(green.astype(np.float32),4*2**z)>.25)&~w
    a[g]=[182,185,141];a[(bio==6)&~w]=[238,222,182]
    a[rd]=[220,206,173];a[(grid_at('flooded_streets',n)>0)&~w]=[123,159,144]
    a[w&~nd.binary_erosion(w)]=[95,99,68]
    selected=[]
    for geom,props in sorted(vectors('buildings'),key=lambda gp:-gp[0].area):
        x,y=geom.centroid.coords[0];u=(x+4064)/SIZE;v=(4064-y)/SIZE
        if geom.area<1500/(2**z):continue
        if z==0 and not ((.12<u<.28 and .38<v<.8) or (.30<u<.77 and .50<v<.7) or (.86<u<.97 and .28<v<.72)):continue
        if any(geom.centroid.distance(h.centroid)<230/(2**z) for h,_ in selected):continue
        selected.append((geom,props))
        if len(selected)>=32*4**z:break
    mask=burn([(g,1) for g,p in selected],n)>0;a[mask]=[157,147,121]
    save(a,ref/'generalized.png')
    (ROOT/f'paintings/z{z}/landmark-anchors.json').write_text(json.dumps([
        {'source_id':p['id'],'centroid_EN':list(g.centroid.coords[0]),'area_m2':g.area}
        for g,p in selected],indent=2))
    return Image.fromarray(a)


def contexts(z):
    n=1024*2**z;g=64;ref=ROOT/f'references/z{z}';paint=ROOT/f'paintings/z{z}'
    geo=generalized(z)
    par=Image.open(ROOT/f'paintings/z{z-1}/final-master.png').resize((n,n),Image.Resampling.LANCZOS)
    geo=Image.fromarray(np.pad(np.array(geo),((g,g),(g,g),(0,0)),mode='edge'))
    par=Image.fromarray(np.pad(np.array(par),((g,g),(g,g),(0,0)),mode='edge'))
    queue=[]
    for y in range(2**z):
        for x in range(2**z):
            box=(x*1024,y*1024,x*1024+1152,y*1024+1152)
            gp=ref/f'{x}_{y}.context.png';pp=ref/f'{x}_{y}.parent.png'
            geo.crop(box).save(gp);par.crop(box).save(pp)
            prompt=f'''Use case: style-transfer. Paint a new closer district view of our original drowned-Miami expedition atlas. Image 1 is the exact geographic stencil; image 2 is the accepted overview of exactly the same region, for composition and pigment; image 3 is our original style sheet. Preserve image1's EXACT framing, north-up orientation, land silhouettes, islands, coasts, river, canals and main road alignments. There are 64 pixels of neighboring overlap on every edge: keep ALL of it. Render the ENTIRE square, no crop or border. This is zoom 1, district view, tile {x},{y}; show more ruin groups than the overview, but DO NOT fill every city block with buildings or trace every minor street. Keep at least half the land as breathing ivory rag paper with pale sage watercolor and economical directional quill hatching. Landmarks are small, legible drawn symbols: skeletal broken towers grouped at the mainland waterfront; roofless warehouses and rusting gantry cranes on the port island; long Art Deco hotel ruins behind the eastern wild beach; low courtyard shells in western residential quarters; wild palm and mangrove groves in parks and shores. Only draw features actually present in this region. Keep miniature buildings anchored on the gray footprint marks, beside rather than on the principal roads. Different marks and density for each district. Strong post-human story: collapsed bridge ends at image1's exact missing spans, flooded low road corridors, mangroves taking back the quays, ruined open roofs. No intact inhabited city. Maintain the SAME broad palette and district color masses as image2; luminous muted teal water, pale jade shallows following the actual coast, warm ivory paper, olive vegetation, warm-charcoal pen and sparse rusty umber. Exquisite fine pen drawing with varied, tapered, broken shore marks. Do not turn it into a flat tinted street plan. Quiet open water, only gentle currents and paper tooth; never invent islands, vessels or wrecks. Buildings and streets stay on land; coast must be within 1 pixel of image1. No text, lettering, numbers, labels, grid, compass, margin, border, cartouche, page edge or vignette. Full-bleed square map section.'''
            (paint/f'{x}_{y}.prompt.txt').write_text(prompt+'\n')
            queue.append({'z':z,'x':x,'y':y,'prompt':prompt,'references':[str(gp),str(pp),str(ROOT/'style/style-sheet.png')],'output':str(paint/f'{x}_{y}.raw.png')})
    (paint/'queue.json').write_text(json.dumps(queue,indent=2))
    print('round-two contexts',z,flush=True)


def coasts(out,w,bio,z):
    """Subpixel wavering, interrupted ink and doubled quays on a continuous canvas."""
    n=len(w);mpp=SIZE/n
    dw=nd.distance_transform_edt(w).astype(np.float32)
    dl=nd.distance_transform_edt(~w).astype(np.float32)
    yy,xx=np.mgrid[:n,:n].astype(np.float32)
    # At most 0.8 pixel hand variation. Same world phase at all scales.
    u=xx/2**z;v=yy/2**z
    wave=.42*np.sin(u*.41+v*.28)+.24*np.sin(u*.93-v*.71)
    signed=dw-dl
    width=.70+.28*np.sin(u*.19+v*.23)+.22*np.sin(u*.69-v*.31)
    coast=np.maximum(0,1-np.abs(signed-wave)/(width+1.7))
    beach=nd.maximum_filter((bio==6).astype(np.float32),size=5)>0
    coast[beach]*=.15
    # Broken pen lift; never removes the true land/water division.
    lift=np.clip((np.sin(u*.31+v*.17)+.35)*1.5,0,1)
    alpha=coast*(.30+.52*lift)
    out=out*(1-alpha[...,None])+INK*alpha[...,None]
    # A second short stroke on the landward side of urban quays.
    quay=(~w)&(bio!=6)&~np.isin(bio,[3,4,5])
    double=np.exp(-((dl-2.2)/.5)**2)*quay*(np.sin(u*.17-v*.29)>.25)*.24
    out=out*(1-double[...,None])+INK*double[...,None]
    # Contour-following pale wash: land geometry controls every shallow.
    shall=np.exp(-dw/max(3,48/mpp))*w*.32
    out=out*(1-shall[...,None])+np.array([176,197,174])*shall[...,None]
    return out


def story(im,z,rd):
    """Only saved world objects: missing spans and wrecks, at exact locations."""
    n=im.width;mpp=SIZE/n;d=ImageDraw.Draw(im)
    def px(p):return ((p[0]-B[0])/mpp,(B[3]-p[1])/mpp)
    for g,p in vectors('future_changes'):
        if p['kind']=='submerged_wreck':
            pts=[px(t) for t in g.exterior.coords]
            d.line(pts,fill=(74,103,89),width=1)
            angle=math.radians(p['angle_degrees']);dx=math.cos(angle);dy=math.sin(angle)
            cx,cy=p['center'];length=p['length_m'];width=p['width_m']
            for u in np.arange(-length*.36,length*.35,max(5,mpp*1.6)):
                d.line([px((cx+u*dx-v*dy,cy+u*dy+v*dx)) for v in [-width*.45,width*.45]],fill=(77,102,84),width=1)
        elif p['kind']=='missing_bridge_span':
            # End-cap rubble remains inside existing surviving road pixels.
            gm=burn([(g.buffer(mpp*1.5),1)],n)>0
            arr=np.array(im);rim=gm&rd
            arr[rim]=arr[rim]*.48+INK*.52
            im=Image.fromarray(arr);d=ImageDraw.Draw(im)
    return im


def district_ink(out,z):
    """Data-clipped structural drawing: port trusses and beach-hotel galleries."""
    if z<2:return out
    from shapely.geometry import Polygon,LineString
    n=len(out);mpp=SIZE/n
    def world(u,v):return (B[0]+u*SIZE,B[3]-v*SIZE)
    port=Polygon([world(u,v) for u,v in [(.30,.49),(.77,.68),(.75,.70),(.55,.68),(.28,.56)]])
    im=Image.fromarray(np.uint8(np.clip(out,0,255)));d=ImageDraw.Draw(im)
    for geom,p in vectors('buildings'):
        if geom.area<650:continue
        c=geom.centroid;u=(c.x-B[0])/SIZE;v=(B[3]-c.y)/SIZE
        isport=port.contains(c)
        hotel=(u>.89 and .26<v<.73 and geom.area>1100)
        if not (isport or hotel):continue
        corners=np.array(geom.minimum_rotated_rectangle.exterior.coords)[:4]
        sides=np.roll(corners,-1,axis=0)-corners
        j=np.argmax(np.linalg.norm(sides,axis=1));long=sides[j];length=np.linalg.norm(long)
        long/=length;cross=np.array([-long[1],long[0]])
        projected=(corners-np.array([c.x,c.y]))@cross;width=np.ptp(projected)
        if length<25 or width<8:continue
        inner=geom.buffer(-1.5)
        for k,t in enumerate(np.arange(-length*.46,length*.47,11 if isport else 9)):
            if (k+p['id'])%5==0:continue # Missing structural bays, not roofs.
            center=np.array([c.x,c.y])+t*long
            endpoints=[center-cross*width*.48,center+cross*width*.48]
            if isport:endpoints[1]=endpoints[1]+long*4
            line=LineString(endpoints).intersection(inner)
            parts=list(line.geoms) if hasattr(line,'geoms') else [line]
            for part in parts:
                if part.geom_type!='LineString':continue
                pts=[((x-B[0])/mpp,(B[3]-y)/mpp) for x,y in part.coords]
                d.line(pts,fill=(125,99,67) if isport else (143,132,105),width=1)
    return np.asarray(im,dtype=np.float32)


def finish(z):
    n=1024*2**z;mpp=SIZE/n;ref=ROOT/f'references/z{z}'
    w=np.array(Image.open(ref/'surface_water.png'))>0
    b=np.array(Image.open(ref/'buildings.png'))>0
    bio=np.array(Image.open(ref/'biome.png'))
    rd=major_roads(z,n)
    if z==0:
        raw,info=far_register(load(ROOT/'paintings/z0/0_0.raw.png',(n,n)),w)
        (ROOT/'paintings/z0/0_0.registered.json').write_text(json.dumps(info,indent=2))
    elif z==1:
        raw=assemble_far(z,w)
    else:raw=assemble(z)
    save(np.uint8(np.clip(raw,0,255)),ROOT/f'paintings/z{z}/registered.png')
    lum=raw.mean(2);fine=lum-nd.gaussian_filter(lum,.8)
    tooth=paper_texture(n)
    if z<=1:
        out,source_water=clean_far_coast(raw,w)
        # Fill wrongly painted water outside coast with paper only at coastline.
        dl=nd.distance_transform_edt(~w)
        repair=(~w)&wet(out)&(dl<3)&~rd
        out[repair]=PAPER+fine[repair,None]*.35
    else:
        # Preserve the independently painted masonry, trees and courtyards.
        # Exposed substrate is now ivory with original rag tooth, not opaque tan.
        broad=nd.gaussian_filter(raw,(8,8,0))
        out=PAPER[None,None,:]*.72+broad*.28+tooth[...,None]
        nature=np.isin(bio,[3,4,5])
        canopy=np.array(Image.open(ROOT/'base/painted_canopy_fine.png').resize((n,n),Image.Resampling.NEAREST))>0
        nature=(nature|canopy)&~(w|b|rd)
        out[nature]=raw[nature]*.83+np.array([191,193,144])*.17
        # Sparse original drybrush in the paper, rather than all generated roads.
        dry=~(w|b|rd|nature)
        detail=np.clip(fine,-22,12)*.55
        out[dry]+=detail[dry,None]
        beach=(bio==6)&dry
        out[beach]=np.array([238,222,182])+fine[beach,None]*.55+tooth[beach,None]
        masonry=raw.copy()
        # Remove hue errors while allowing warm-grey walls, pale lime and ink.
        ml=masonry.mean(2)
        masonry=masonry*.85+np.stack([ml+10,ml+4,ml-12],-1)*.15
        db=nd.distance_transform_edt(b)
        edge=b&(db<=1)
        masonry[edge]=masonry[edge]*.44+INK*.56
        out[b]=masonry[b]
        # Distinct district treatment, anchored in world coordinates.
        yy,xx=np.mgrid[:n,:n].astype(np.float32);u=xx/n;v=yy/n
        port=(u>.29)&(u<.77)&(v>.49)&(v<.70)&b
        beachhotel=(u>.87)&(v>.28)&(v<.73)&b
        downtown=(u>.13)&(u<.28)&(v>.4)&(v<.79)&b
        out[port]=out[port]*.9+np.array([157,117,74])*.1
        out[beachhotel]=out[beachhotel]*.82+np.array([237,225,199])*.18
        out[downtown]*=.91
    # Paint continuous water from generated pigment, avoiding nearest-fill streaks.
    safe=nd.binary_erosion(wet(raw),iterations=7,border_value=1)&w
    sig=max(18,140/mpp);den=nd.gaussian_filter(safe.astype(np.float32),sig)
    water=raw.copy()
    feather=np.clip(nd.distance_transform_edt(safe)/12,0,1)
    for k in range(3):
        field=nd.gaussian_filter(raw[...,k]*safe,sig)/np.maximum(den,1e-5)
        field=np.where(den>.02,field,[113,153,143][k])
        if z<=1:
            detail=np.clip(raw[...,k]-nd.gaussian_filter(raw[...,k],2),-5,5)
            water[...,k]=field+detail*feather*.65+tooth*.45
        else:
            water[...,k]=raw[...,k]*feather+field*(1-feather)
    # Retain water tooth/current marks but suppress invented submerged objects.
    water=water*.86+np.array([146,174,158])*.14
    out[w]=water[w]
    # Major avenues only in far views; all native road corridors in close views.
    dr=nd.distance_transform_edt(rd)
    rpaint=np.array([235,222,190])+fine[...,None]*.30+tooth[...,None]
    edge=rd&(dr<=1)
    rpaint[edge]=rpaint[edge]*.85+INK*.15
    out[rd]=rpaint[rd]
    if z<=1:
        # Pictorial skyline ink occludes road ribbons as in an illustrated atlas.
        # This is symbol occlusion, not an alternate world-road alignment.
        yy,xx=np.mgrid[:n,:n];u=xx/n;v=yy/n
        skyline=(u>.08)&(u<.25)&(v>.32)&(v<.65)
        symbol=skyline&rd&(raw.mean(2)<155)&(raw[...,0]>raw[...,2]+20)
        out[symbol]=raw[symbol]
        # Preserve the cranes' elevated arms over water. Three local symbols,
        # each based on the new overview original, explicitly not coastline.
        if z==0:
            crane=np.zeros((n,n),bool)
            for x1,y1,x2,y2 in [(354,479,417,534),(462,529,521,582),(567,570,632,632)]:
                crane[y1:y2,x1:x2]=True
            crane &= (raw[...,0]-raw[...,1]>4)&(raw[...,1]-raw[...,2]>18)&(raw.mean(2)<190)
            out[crane]=raw[crane]
    flood=(grid_at('flooded_streets',n)>0)&~b
    # Flood remains the same world layer at every scale, with darker ink banks.
    out[flood]=np.array([123,159,144])+fine[flood,None]*.35
    out=district_ink(out,z)
    out=coasts(out,w,bio,z)
    if z>0:
        # Full RGB broad pigment agreement, separated by coast to avoid halos.
        parent=load(ROOT/f'paintings/z{z-1}/final-master.png',(n,n))
        for material,mask in [('water',w),('land',~w)]:
            mf=mask.astype(np.float32);sig=12;den=nd.gaussian_filter(mf,sig)
            for k in range(3):
                a=nd.gaussian_filter(out[...,k]*mf,sig)/np.maximum(den,.001)
                p=nd.gaussian_filter(parent[...,k]*mf,sig)/np.maximum(den,.001)
                if material=='land' and z>=2:
                    # A uniform pigment calibration avoids local glowing halos.
                    # The final multiscale pass shares the remaining broad error
                    # among the independent paintings, rather than forcing all
                    # of a distant icon's shadow into the closest ground wash.
                    delta=np.clip(np.mean(parent[...,k][mask])-np.mean(out[...,k][mask]),-12,12)
                    out[...,k][mask]+=delta
                else:
                    delta=np.clip(p-a,-100,100)*.98
                    out[...,k][mask]+=delta[mask]
    out=np.uint8(np.clip(out,0,255))
    im=story(Image.fromarray(out),z,rd)
    im.save(ROOT/f'paintings/z{z}/unbalanced-master.png')
    im.save(ROOT/f'paintings/z{z}/final-master.png')
    dest=ROOT/f'tiles/z{z}';dest.mkdir(parents=True,exist_ok=True)
    for y in range(2**z):
        for x in range(2**z):im.crop((x*1024,y*1024,(x+1)*1024,(y+1)*1024)).save(dest/f'{x}_{y}.png')
    im.resize((1024,1024),Image.Resampling.LANCZOS).save(ROOT/f'checks/overview_z{z}.png')
    save(rd.astype('uint8'),ref/'drawn_roads.png')
    print('round-two finish',z,flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('command',choices=['finish','contexts','generalized']);p.add_argument('zoom',type=int);a=p.parse_args()
    {'finish':finish,'contexts':contexts,'generalized':generalized}[a.command](a.zoom)
