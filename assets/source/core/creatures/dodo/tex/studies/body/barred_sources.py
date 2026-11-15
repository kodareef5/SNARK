"""Final adjustment: extract the IMAGE-DRAWN pale barb ends; never synthesize a tip mask.

Called by build.py after its map helpers are defined. Coordinates and distances
are aligned with the physically resampled generated RGBA cells. No image-generation call
is required to rebuild the committed maps.
"""
import json, hashlib
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, gaussian_filter1d, distance_transform_edt, label, map_coordinates

def prepare(b):
    src=b.SRC
    atlas=np.asarray(Image.open(src/'generated_barred_atlas_round5_beards.png').convert('RGBA'),np.float32)/255
    ah,aw=atlas.shape[:2];elements=[];records=[]
    for i in range(16):
        row,col=divmod(i,4)
        bounds=[round(col*aw/4),round(row*ah/4),round((col+1)*aw/4),round((row+1)*ah/4)]
        raw=atlas[bounds[1]:bounds[3],bounds[0]:bounds[2]].copy()
        original=raw.copy()
        # Physical placement profile: restore the terminal 30% to 115%
        # of its original length, compressing the upper vane to keep the full
        # feather's physical length. Every channel uses the same transform;
        # no colour boundary is drawn or displaced relative to a barb.
        lab,_=label(raw[:,:,3]>=.5);counts=np.bincount(lab.ravel());counts[0]=0
        ay,ax=np.where(lab==counts.argmax());lo,hi=ay.min(),ay.max()
        y,x=np.indices(raw.shape[:2],dtype=np.float32)
        q=(y-lo)/(hi-lo)
        inv=np.where(q<=.655,q/(.655/.7),.7+(q-.655)/1.15)
        coords=np.stack((lo+inv*(hi-lo),x))
        raw=np.stack([map_coordinates(raw[:,:,k],coords,order=1,mode='constant',cval=0,prefilter=False) for k in range(4)],-1)
        raw=np.rint(np.clip(raw,0,1)*255)/255
        alpha=raw[:,:,3].copy()
        # Isolate this specimen from detached generation specks in the gutters.
        # Preserve its generated alpha, including all attached fringe and nearby wisps.
        labels,count=label(alpha>=.5)
        sizes=np.bincount(labels.ravel());sizes[0]=0;main=labels==sizes.argmax()
        near=distance_transform_edt(~main)<=2
        alpha=np.where(near,alpha,0)
        mask=alpha>=.5;hh,ww=mask.shape
        yy,xx=np.indices(mask.shape,dtype=np.float32)
        ys,xs=np.where(mask);x0,x1=int(xs.min()),int(xs.max());y0,y1=int(ys.min()),int(ys.max())
        v=np.clip((yy-y0)/(y1-y0),0,1)
        # Warm ivory and cool slate are separable in the generated drawing.
        # The broad lower-half gate excludes isolated warm pixels in the root;
        # it does not draw a boundary or extend any pale strands.
        warmth=(raw[:,:,0]-raw[:,:,2])*255 + .6*(raw[:,:,0]-raw[:,:,1])*255
        bar=(warmth>7.5)&(v>.58)&mask
        lum=np.sum(b.srgb_to_linear(raw[:,:,:3])*np.array([.2126,.7152,.0722]),axis=-1)
        lum=b.bleed(lum,mask)
        # Remove source colour and broad source light within each material.
        # Fine strand contrast stays in albedo, including the actual cream barbs.
        broad=np.zeros_like(lum)
        for region in [mask&~bar,bar]:
            weight=gaussian_filter(region.astype(float),8)
            avg=gaussian_filter(lum*region,8)/np.maximum(weight,1e-8)
            broad[region]=avg[region]
        detail=b.bleed(np.clip(lum-broad,-.20,.20),mask)
        fine=detail-gaussian_filter(detail,2.2)
        # Follow the visible middle shaft, stopping before the pointed brush.
        ridge=gaussian_filter(lum,(3,.65))-gaussian_filter(lum,(3,7))
        path=np.zeros(hh,np.float32);ry=int(np.quantile(ys,.015))
        rx=float(np.median(np.flatnonzero(mask[ry])));prev=rx
        for y in range(hh):
            if y<ry:path[y]=rx;continue
            lo=max(int(ww*.30),int(prev-10));hi=min(int(ww*.70),int(prev+11))
            path[y]=lo+np.argmax(ridge[y,lo:hi]);prev=path[y]
        path=gaussian_filter1d(path,3.0)
        shaft=np.exp(-((xx-path[:,None])/1.15)**2)*np.clip((.81-v)/.18,0,1)*np.clip(v/.08,0,1)*alpha
        rng=np.random.default_rng(31427+i)
        width=float(rng.uniform(50,56));length=float(rng.uniform(50,56))
        dx=width/(x1-x0+1);dy=length/(y1-y0+1)
        dist=distance_transform_edt(mask,sampling=(dy,dx))
        edge_mask=np.zeros_like(mask)
        for x in range(ww):
            occupied=np.flatnonzero(mask[:,x])
            if len(occupied) and occupied[-1]>y0+.52*(y1-y0):edge_mask[occupied[-1],x]=True
        edge=distance_transform_edt(~edge_mask,sampling=(dy,dx)).astype(np.float32)
        dome=np.sin(np.clip(dist/18,0,1)*np.pi/2)
        # A soft vane: tip colour contributes no relief. Fade fine image detail
        # where ivory starts, because its pigment transition is not a ridge.
        vane_fine=fine*(1-np.clip((warmth-3)/12,0,1))
        height=b.bleed(.40+.65*v+.32*dome+.04*shaft+vane_fine*.22,mask)
        pigment=b.bleed(np.clip(.5+detail*1.8+.040*shaft+.14*(v-.5),.16,.84),mask)
        pigment=b.same_regions_mean(pigment,bar,mask)
        rough=np.clip(.89-.045*shaft+.04*abs(detail)+.018*(1-dome),.80,.95)
        ident=f'barred_feather_{i+1:02d}'
        b.save(src/(ident+'_original.png'),original,srgb=True)
        b.save(src/(ident+'_physical_original.png'),raw,srgb=True)
        b.save(src/(ident+'_cutout.png'),np.dstack((np.repeat(b.linear_to_srgb(pigment)[:,:,None],3,axis=2),alpha)),srgb=True)
        b.save(src/(ident+'_height.png'),height/b.HEIGHT_MM,bits=16)
        b.save(src/(ident+'_shaft.png'),shaft,bits=16)
        b.save(src/(ident+'_free_edge_distance.png'),edge/b.EDGE_RANGE_MM,bits=16)
        b.save(src/(ident+'_free_edge.png'),edge_mask.astype(float))
        b.save(src/(ident+'_bar_regions.png'),np.stack((np.ones_like(alpha),bar.astype(float),np.zeros_like(alpha)),-1))
        np.savez_compressed(src/(ident+'_layers.npz'),alpha=alpha,height_mm=height.astype(np.float32),
            pigment_linear=pigment.astype(np.float32),shaft=shaft,free_edge_distance_mm=edge,
            roughness=rough.astype(np.float32),bar_generated=bar,warmth=warmth)
        # Root and tip coordinates are real occupied source pixels.
        tip_y=int(ys.max());tip_x=int(np.median(np.flatnonzero(mask[tip_y])))
        rec=dict(id=ident,atlas='generated_barred_atlas_round5_beards.png',atlas_box=bounds,
            box_px=[x0,y0,x1+1,y1+1],root_px=[rx,ry],tip_px=[tip_x,tip_y],
            length_mm=length,width_mm=width,pixel_mm=[dx,dy],height_mm=b.HEIGHT_MM,
            physical_profile=dict(terminal_start=.7,terminal_length_factor=1.15,total_length_preserved=True),
            free_edge_distance_range_mm=b.EDGE_RANGE_MM,
            free_edge_definition='Euclidean mm to the generated alpha-0.5 distal contour.',
            bar_field_definition='Generated warm ivory strands: (R-B)+0.6(R-G)>7.5 byte levels in lower vane. No analytic tip mask.',
            files={k:ident+'_'+k+'.png' for k in ['original','physical_original','cutout','height','shaft','free_edge_distance','free_edge','bar_regions']},layers=ident+'_layers.npz')
        records.append(rec)
        elements.append(dict(alpha=alpha,height=height/b.HEIGHT_MM,pigment=pigment,rough=rough,shaft=shaft,
            bar_generated=bar.astype(np.float32),edge=edge,taper=np.ones_like(alpha),accepted_edge=edge,meta=rec))
    (src/'barred_elements.json').write_text(json.dumps(records,indent=2)+'\n')
    provenance=dict(tool='image_gen.imagegen',mode='built-in generation from concept reference',prompt='prompt_round5_beards.txt',
        image='generated_barred_atlas_round5_beards.png',references=['concept_bars_review.png'],
        sha256=hashlib.sha256((src/'generated_barred_atlas_round5_beards.png').read_bytes()).hexdigest(),
        native_size=[aw,ah],alpha='Generated alpha retained on the main feather and nearby fringe; detached gutter specks excluded',specimens=16)
    (src/'generation_round5.json').write_text(json.dumps(provenance,indent=2)+'\n')
    return elements

def accepted_plain_elements(b):
    records=json.loads((b.SRC/'elements.json').read_text());out=[]
    for rec in records:
        z=np.load(b.SRC/rec['layers']);alpha=z['alpha'];edge=z['free_edge_distance_mm']
        out.append(dict(alpha=alpha,height=z['height_mm']/b.HEIGHT_MM,pigment=z['pigment_linear'],rough=z['roughness'],
            shaft=z['shaft'],edge=edge,taper=np.ones_like(alpha),accepted_edge=edge,meta=rec))
    return out
