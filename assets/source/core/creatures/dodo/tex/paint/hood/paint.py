"""Paint the hood onto the bird. Writes only this group's layers/ and source/.

python3 -B tex/paint/hood/paint.py
Millimetre placement follows the baked UV flow and the position-map metric.
The round-7 atlas and accepted body fields are immutable inputs. No API calls.
"""
from pathlib import Path
import hashlib, json, site, sys, time
site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, distance_transform_edt, map_coordinates
from scipy.spatial import cKDTree

ROOT=Path(__file__).resolve().parent
PAINT=ROOT.parent
DODO=ROOT.parents[2]
STUDY=DODO/'tex/studies/hood'
BAKES=DODO/'ref/bakes'
OUT=ROOT/'layers'
N=2048
SEED=704193
HEIGHT_MM=4.2


def input_hashes():
    paths=[PAINT/n for n in ['pieces.json','pieces.png','position_x.png','position_y.png','position_z.png','texel_mm.png']]
    paths += [BAKES/n for n in ['bakes.json','dodo_feather_direction.png','dodo_regions.png']]
    paths += [ROOT/'plumage.py',ROOT/'source/plumage_r7_original.png',ROOT/'source/plumage_r7_prompt.txt']
    paths += [ROOT/'paint.py',ROOT/'wedge.py',ROOT/'body_neck_recipe.py',ROOT/'source/mane_random_state.json']
    body=DODO/'tex/studies/body/source'
    for manifest in ['elements.json']:
        paths.append(body/manifest)
        paths += [body/f['layers'] for f in json.loads((body/manifest).read_text())]
    return {str(p.relative_to(DODO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def lin(x):return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
def srgb(x):return np.where(x<=.0031308,x*12.92,1.055*np.maximum(x,0)**(1/2.4)-.055)
def smooth(x):
    x=np.clip(x,0,1);return x*x*(3-2*x)

def save(name,a,bits=8,colour=False):
    info=PngImagePlugin.PngInfo();info.add(b'gAMA',(45455 if colour else 100000).to_bytes(4,'big'))
    if colour:info.add(b'sRGB',b'\x00')
    Image.fromarray(np.rint(np.clip(a,0,1)*(65535 if bits==16 else 255)).astype(np.uint16 if bits==16 else np.uint8)).save(OUT/name,pnginfo=info)


def sources():
    from plumage import load
    return load()


def sample(a,xy):
    xy=np.asarray(xy);coords=np.stack([xy[...,1],xy[...,0]])
    if a.ndim==2:return map_coordinates(a,coords,order=1,mode='nearest')
    return np.stack([map_coordinates(a[...,i],coords,order=1,mode='nearest') for i in range(a.shape[-1])],axis=-1)


def extended(a,mask):
    idx=distance_transform_edt(~mask,return_distances=False,return_indices=True)
    return a[idx[0],idx[1]]


def geometry():
    meta=json.loads((PAINT/'pieces.json').read_text());piece=next(p for p in meta['pieces'] if p['name']=='shell_hood')
    x0,y0,x1,y1=piece['box'];sl=np.s_[y0:y1,x0:x1]
    own=np.asarray(Image.open(PAINT/'pieces.png'))[sl][...,0]==piece['number']
    xyz=[]
    for i,c in enumerate('xyz'):
        a=np.asarray(Image.open(PAINT/f'position_{c}.png'))[sl].astype(np.float64)/65535
        xyz.append((meta['position_box']['min'][i]+a*(meta['position_box']['max'][i]-meta['position_box']['min'][i]))*1000)
    pos=np.stack(xyz,axis=-1)
    P=extended(pos,own)
    # Use only in-piece neighbours for derivatives; then extend the metric.
    js=[]
    for axis in [1,0]:
        okp=np.roll(own,-1,axis)&own;okm=np.roll(own,1,axis)&own
        dp=np.roll(pos,-1,axis)-pos;dm=pos-np.roll(pos,1,axis)
        j=np.where((okp&okm)[...,None],(dp+dm)*.5,np.where(okp[...,None],dp,dm))
        j=extended(j,own&(okp|okm))
        j=gaussian_filter(j,(1.2,1.2,0),mode='nearest');js.append(j)
    jx,jy=js
    # The bake supplies picture-up v. Here every coordinate is picture-down.
    raw=np.asarray(Image.open(BAKES/'dodo_feather_direction.png'))[sl].astype(np.float64)/255
    flow=np.stack([2*raw[...,0]-1,1-2*raw[...,1]],-1)
    flow=extended(flow,own);flow=gaussian_filter(flow,(2,2,0),mode='nearest')
    flow/=np.maximum(np.linalg.norm(flow,axis=-1,keepdims=True),1e-9)
    gxx=np.sum(jx*jx,-1);gxy=np.sum(jx*jy,-1);gyy=np.sum(jy*jy,-1)
    metric=np.stack([gxx,gxy,gyy],-1)
    area=np.sqrt(np.maximum(gxx*gyy-gxy*gxy,1e-9))
    mm=extended(np.asarray(Image.open(PAINT/'texel_mm.png'))[sl].astype(float)/1000,own)
    # Actual side/contact edge, excluding the shared x=0 mirror boundary.
    # Only the face contact needs miniature feathers. The lower nape boundary
    # must retain full-length vanes all the way to its last texel.
    rim=(distance_transform_edt(own)<1.5)&own&(P[...,0]>4.)&(P[...,1]>550)&(P[...,2]>125)
    edge_distance=cKDTree(P[rim]).query(P.reshape(-1,3),workers=1)[0].reshape(own.shape)
    x,y,z=np.moveaxis(P,-1,0)
    back=smooth((150-z)/55)*smooth((648-y)/36)
    mane=smooth((603-y)/95)
    length=(10+8*back)*(1-mane)+60*mane
    length=9+(length-9)*smooth(edge_distance/9)
    return dict(meta=piece,box=[x0,y0,x1,y1],own=own,pos=P,jx=jx,jy=jy,metric=metric,
                area=area,mm=mm,flow=flow,length=length,edge_distance=edge_distance)


def frame(g,xy,angle=0):
    d=sample(g['flow'],np.atleast_2d(xy))[0]
    gxx,gxy,gyy=sample(g['metric'],np.atleast_2d(xy))[0]
    G=np.array([[gxx,gxy],[gxy,gyy]])
    d=d/np.sqrt(max(d@G@d,1e-9))
    gd=G@d;e=np.array([gd[1],-gd[0]]);e/=np.sqrt(max(e@G@e,1e-9))
    co=np.cos(angle);si=np.sin(angle)
    return co*d+si*e,co*e-si*d


def curved_strip(g,center,length,width,angle):
    # Follow flow in physical steps. Both width and length use the full metric,
    # retaining the UV chart's shear rather than assuming square millimetres.
    steps=12 if length>24 else 6;mid=steps//2
    centers=np.zeros((steps+1,2));centers[mid]=center;step=length/steps
    for sign in [-1,1]:
        for k in range(mid,0 if sign<0 else steps,sign):
            d,_=frame(g,centers[k],angle);half=centers[k]+sign*d*step*.5
            d,_=frame(g,half,angle);centers[k+sign]=centers[k]+sign*d*step
    vertices=[]
    for q in centers:
        _,e=frame(g,q,angle);vertices.append([q-e*width*.5,q+e*width*.5])
    return np.asarray(vertices)


def raster_strip(shape,vertices):
    lo=np.maximum(np.floor(vertices.min((0,1))-1).astype(int),0)
    hi=np.minimum(np.ceil(vertices.max((0,1))+2).astype(int),[shape[1],shape[0]])
    if np.any(hi<=lo):return None
    w,h=hi-lo;uv=np.full((2,h,w),-10.,np.float32);hit=np.zeros((h,w),bool)
    steps=len(vertices)-1
    for k in range(steps):
        q=np.array([vertices[k,0],vertices[k,1],vertices[k+1,1],vertices[k+1,0]])-lo
        st=np.array([[0,k/steps],[1,k/steps],[1,(k+1)/steps],[0,(k+1)/steps]])
        for indices in [[0,1,2],[0,2,3]]:
            t=q[indices];v=st[indices]
            a=np.maximum(np.floor(t.min(0)).astype(int),0);b=np.minimum(np.ceil(t.max(0)).astype(int)+1,[w,h])
            if np.any(b<=a):continue
            yy,xx=np.mgrid[a[1]:b[1],a[0]:b[0]].astype(float);xx+=.5;yy+=.5
            M=np.array([t[1]-t[0],t[2]-t[0]]).T
            if abs(np.linalg.det(M))<1e-8:continue
            inv=np.linalg.inv(M);u=inv[0,0]*(xx-t[0,0])+inv[0,1]*(yy-t[0,1]);z=inv[1,0]*(xx-t[0,0])+inv[1,1]*(yy-t[0,1])
            inside=(u>=-1e-6)&(z>=-1e-6)&(u+z<=1+1e-6)
            coords=v[0,:,None,None]+u*(v[1]-v[0])[:,None,None]+z*(v[2]-v[0])[:,None,None]
            for c in range(2):uv[c,a[1]:b[1],a[0]:b[0]][inside]=coords[c][inside]
            hit[a[1]:b[1],a[0]:b[0]]|=inside
    return lo,hi,uv,hit


def canvas(shape):
    out=np.zeros((5,*shape),np.float32);out[1]=1.1;out[3]=.91
    return out


def stamp(out,feather,vertices,relief,tone=0,lift=0,mirror=False):
    r=raster_strip(out.shape[1:],vertices)
    if r is None:return
    lo,hi,uv,hit=r;u,v=uv;fields=feather['fields'];H,W=fields.shape[1:]
    if mirror:u=1-u
    coord=np.stack([v*H-.5,u*W-.5])
    vals=np.stack([map_coordinates(a,coord,order=1,mode='constant',cval=0,prefilter=False) for a in fields])
    a=vals[0]*hit
    vals[1]=vals[1]*relief+lift;vals[2]+=tone
    dest=out[:,lo[1]:hi[1],lo[0]:hi[0]]
    dest[1:]=dest[1:]*(1-a[None])+vals[1:]*a[None]
    dest[0]=dest[0]*(1-a)+a


def mirror_calm(a,g):
    """Zero cross-midline slope over the final 0.8 mm, with no pale seam stripe."""
    P=g['pos'];distance=np.abs(P[...,0]);m=g['own']&(distance<.8)
    donor=g['own']&(distance>=.8)&(distance<1.6)
    if not donor.any() or not m.any():return a
    rows,cols=np.where(donor);near=cKDTree(P[donor,1:]).query(P[m,1:],workers=1)[1]
    w=smooth(distance[m]/.8)
    a[m]=a[rows[near],cols[near]]*(1-w)+a[m]*w
    return a


def normals(h,mm,mask):
    ds=[]
    for axis in [1,0]:
        p=np.roll(h,-1,axis);q=np.roll(h,1,axis)
        vp=np.roll(mask,-1,axis);vq=np.roll(mask,1,axis)
        diff=np.where(vp&vq,(p-q)*.5,np.where(vp,p-h,np.where(vq,h-q,0)))
        ds.append(diff/np.maximum(mm,1e-3))
    n=np.stack([-ds[0],ds[1],np.ones_like(h)],-1);return n/np.linalg.norm(n,axis=-1,keepdims=True)


def fine_ao(h,mm,mask):
    # Symmetric small-scale horizon, entirely independent of the baked form AO.
    out=np.zeros_like(h)
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
        horizon=np.zeros_like(h)
        for rad in [1,2,4,8]:
            hn=np.roll(h,(dy*rad,dx*rad),axis=(0,1));ok=np.roll(mask,(dy*rad,dx*rad),axis=(0,1))
            slope=np.where(ok,np.maximum(hn-h-.004,0)/(np.maximum(mm,.01)*rad*np.hypot(dx,dy)),0)
            horizon=np.maximum(horizon,np.arctan(slope))
        out+=np.sin(horizon)/8
    return np.clip(1-.60*out,.73,1)


def balance(base,mask,n=None):
    before=float(base[mask].var());coef=np.zeros(3)
    if n is not None:
        X=n[mask].astype(float);X-=X.mean(0);v=base[mask]-base[mask].mean()
        coef=np.linalg.lstsq(X,v,rcond=None)[0];base=base-np.sum((n-n[mask].mean(0))*coef,-1)
    base=np.clip(base,.075,.94)
    for _ in range(3):base=np.clip(base+.5-base[mask].mean(),.075,.94)
    return base,dict(mean_linear=float(base[mask].mean()),std_linear=float(base[mask].std()),
                     variance_retained=float(base[mask].var()/max(before,1e-12)),directional_correction=coef.tolist())


def softened_cap(feather):
    # Round 7 specimens already have joined, softened vanes at extraction.
    return feather


def balance_cap(base,mask,weight,n):
    """Balance the region through the supplied transition weight."""
    before=float(base[mask].var());X=n[mask].astype(float);X-=X.mean(0)
    A=np.column_stack([np.ones(len(X)),X]);w=weight[mask].astype(float)
    coef=np.zeros(4)
    for _ in range(3):
        system=np.einsum('ni,n,nj->ij',A,w,A,optimize=False)
        rhs=np.einsum('ni,n->i',A,base[mask]-.5,optimize=False)
        correction=np.linalg.lstsq(system,rhs,rcond=None)[0]
        v=base[mask]-w*np.einsum('ni,i->n',A,correction,optimize=False)
        base[mask]=np.where(w>0,np.clip(v,.075,.94),v);coef+=correction
    return base,dict(mean_linear=float(base[mask].mean()),std_linear=float(base[mask].std()),
        variance_retained=float(base[mask].var()/max(before,1e-12)),directional_correction=coef[1:].tolist())


def row_centers(g,rng):
    """Soft staggered rows across the flow, spaced in physical millimetres.

    The bake derives its flow from distance to the tail. Integrate row phase
    over that same potential, compensating for its surface gradient and the
    local feather length. Jitter the phase gently, then space neighbours across
    each row by their vane width. No straight UV rows or grid of clones.
    """
    own=g['own'];P=g['pos'];delta=P-np.array([0,255,-238]);order=np.linalg.norm(delta,axis=-1)
    direction=g['jx']*g['flow'][...,0,None]+g['jy']*g['flow'][...,1,None]
    direction/=np.maximum(np.linalg.norm(direction,axis=-1,keepdims=True),1e-8)
    gradient=np.clip(np.abs(np.sum(direction*delta,-1)/order),.22,1)
    step=.68*g['length']*gradient
    bins=np.arange(np.floor(order[own].min()),np.ceil(order[own].max())+2)
    ids=np.clip(np.floor(order-bins[0]).astype(int),0,len(bins)-1)
    counts=np.bincount(ids[own],minlength=len(bins));totals=np.bincount(ids[own],weights=step[own],minlength=len(bins))
    good=counts>0;spacing=np.interp(bins,bins[good],totals[good]/counts[good]);spacing=gaussian_filter(spacing,2)
    phases=np.cumsum(1/np.maximum(spacing,1))
    phase=np.interp(order,bins,phases)+.11*np.sin(P[...,0]/9+P[...,1]/29)+.06*np.sin(P[...,2]/8)
    row=np.rint(phase).astype(int);candidates=own&(np.abs(phase-row)<.09)
    points=[]
    for k in np.unique(row[candidates]):
        yy,xx=np.where(candidates&(row==k));rank=np.argsort(-np.log(np.maximum(rng.random(len(yy)),1e-9))/g['area'][yy,xx])
        accepted=[];radii=[]
        for j in rank:
            y,x=yy[j],xx[j];L=g['length'][y,x];W=L*(.34 if L>30 else .47);point=P[y,x]
            if accepted:
                dist=np.linalg.norm(np.asarray(accepted)-point,axis=1)
                if np.any(dist<(.5*np.asarray(radii)+.5*W)*.48):continue
            accepted.append(point);radii.append(W);points.append((x+rng.uniform(-.3,.3),y+rng.uniform(-.3,.3)))
    return points


def shell(feathers,revised=True):
    # All hood plumage uses the round-7 vanes; archived checks are never inputs.
    drawing=[softened_cap(f) if i<12 and revised else f for i,f in enumerate(feathers)]
    g=geometry();own=g['own'];rng=np.random.default_rng(SEED);L=g['length'];y,x=np.where(own)
    variation=np.random.default_rng(SEED+309)
    # Buried underfeathers fill the fine alpha spaces. The visible population
    # follows softly staggered rows and has substantially flatter relief.
    prob=np.clip((L-20)/24,0,1);aspect=.52*(1-prob)+.35*prob
    weights=(g['area']*3.1/(L*L*aspect*.60))[own]
    count=int(round(weights.sum()));weights/=weights.sum()
    placements=[];out=canvas(own.shape)
    for layer in range(3):
        if layer==2:centers=row_centers(g,rng)
        else:
            chosen=rng.choice(len(y),size=count,p=weights)
            centers=[(x[i]+rng.random(),y[i]+rng.random()) for i in chosen]
        items=[]
        for xy in centers:
            center=np.array(xy);local_length=float(sample(L,center[None])[0])
            length=float(np.clip(local_length*rng.uniform(.91,1.09),8,70))
            p=float(np.clip((length-20)/24,0,1));is_mane=rng.random()<p
            sid=int(rng.integers(12,20) if is_mane else rng.integers(0,12))
            width=length*rng.uniform(.31,.39) if is_mane else length*rng.uniform(.44,.50)
            angle=float(np.deg2rad(np.clip(rng.normal(0,5 if is_mane else 4),-11,11)))
            P=sample(g['pos'],center[None])[0];order=float(np.linalg.norm(P-np.array([0,255,-238])))
            relief=.55+2.25*p
            item=dict(center=center,length=length,width=width,angle=angle,sid=sid,
                        relief=relief,tone=float(rng.normal(0,.010)),lift=1.15-.40*relief+float(rng.uniform(-.015,.015))-.02*(2-layer),mirror=bool(rng.integers(2)))
            if revised and sid<12:
                amount=1-smooth((local_length-20)/10)
                scale=float(variation.uniform(2/3,4/3));new_length=local_length*scale
                item['length']=length*(1-amount)+new_length*amount
                item['width']=width*item['length']/length
                along=float(variation.uniform(-.28,.28)*item['length']*amount)
                across=float(variation.uniform(-.35,.35)*item['width']*amount)
                direction,cross=frame(g,center)
                item['center']=center+direction*along+cross*across
                item['angle']=angle*(1-amount)+float(np.deg2rad(np.clip(variation.normal(0,6),-12,12)))*amount
                item['variation']=dict(nominal_length_mm=local_length,size_scale=scale,
                    along_mm=along,across_mm=across,original_center_px=(center+g['box'][:2]).tolist())
                P=sample(g['pos'],item['center'][None])[0];order=float(np.linalg.norm(P-np.array([0,255,-238])))
            items.append((order,item))
        for _,item in sorted(items,key=lambda q:q[0]):
            vertices=curved_strip(g,item['center'],item['length'],item['width'],item['angle'])
            stamp(out,drawing[item['sid']],vertices,item['relief'],item['tone'],item['lift'],item['mirror'])
            record=dict(layer=layer,source=feathers[item['sid']]['id'],
                center_px=(item['center']+g['box'][:2]).tolist(),length_mm=item['length'],width_mm=item['width'],
                flow_jitter_degrees=float(np.rad2deg(item['angle'])),source_mirrored=item['mirror'])
            if 'variation' in item:record['cap_variation']=item['variation']
            placements.append(record)
        print('shell' if revised else 'preserved nape', 'canopy',layer+1,'/',3,':',len(items),'feathers',flush=True)
    a,h,p,rough,shaft=out
    # Same physical softening as the accepted study, after all overlapping fields.
    sigma=.28/float(np.median(g['mm'][own]));h=gaussian_filter(extended(h,own),sigma)
    h+=(gaussian_filter(extended(p,own),.3)-gaussian_filter(extended(p,own),.9))*.018
    border=distance_transform_edt(own)*g['mm'];mid=np.abs(g['pos'][...,0])<2.
    nape=g['pos'][...,1]<560
    calm=.80+.20*smooth(border/1.5);calm[mid|nape]=1
    h=1.15+(h-1.15)*calm
    h=mirror_calm(h,g);base=mirror_calm(.5+p*(.60+.40*smooth((L-20)/25)),g)
    edge_value=.90+.10*smooth(border/1.0);edge_value[mid|nape]=1
    base=.5+(base-.5)*edge_value
    h=np.rint(np.clip(h/HEIGHT_MM,0,1)*65535)/65535*HEIGHT_MM
    n=normals(h,g['mm'],own)
    base,stats=balance(base,own,n)
    oc=fine_ao(h,g['mm'],own)
    if revised:
        from wedge import finish
        (base,h,rough,oc),added,wedge_stats=finish(g,feathers,(base,h,rough,oc),sys.modules[__name__])
        placements.extend(added);stats['wedge']=wedge_stats
    stats.update(texels=int(own.sum()),feather_instances=len(placements),primary_feathers=sum(p['layer']==2 for p in placements),
                 backing_exposure=float(np.mean((a<.98)[own])),physical_area_mm2=float(g['area'][own].sum()),
                 requested_length_range_mm=[float(L[own].min()),float(L[own].max())],
                 length_percentiles_mm=np.percentile([p['length_mm'] for p in placements],[0,10,50,90,100]).tolist(),
                 median_texel_mm=float(np.median(g['mm'][own])))
    return stats,placements,(base,h,rough,oc)


def write_layers(prefix,box,mask,base,alpha,h,rough,oc,regions):
    x0,y0,x1,y1=box;sl=np.s_[y0:y1,x0:x1]
    rgb=np.repeat(srgb(base)[...,None],3,-1);full=np.zeros((N,N,4),np.float32)
    full[sl]=np.dstack([rgb,np.where(mask,alpha,0)])
    full[sl][~mask]=0
    save(prefix+'_base.png',full,colour=True)
    for name,data in [('height',h/HEIGHT_MM),('rough',rough),('occlusion',oc)]:
        full=np.zeros((N,N),np.float32);full[sl]=np.where(mask,data,0)
        save(prefix+'_'+name+'.png',full,16 if name=='height' else 8)
    full=np.zeros((N,N,3),np.uint8);full[sl]=np.where(mask[...,None],regions,0)
    Image.fromarray(full).save(OUT/(prefix+'_regions.png'))


def flat_vertices(center,length,width,angle,scale):
    co=np.cos(angle);si=np.sin(angle);d=np.array([si,co]);e=np.array([co,-si])
    return np.array([[center-d*length*.5-e*width*.5,center-d*length*.5+e*width*.5],
                     [center+d*length*.5-e*width*.5,center+d*length*.5+e*width*.5]])*scale


def cards(feathers):
    measured=json.loads((PAINT/'pieces.json').read_text())['cards']
    own=np.zeros((N,N),bool);combined=canvas((N,N));records={};stats={}
    rng=np.random.default_rng(SEED+81)
    for kind in ['hood','forehead','mane']:
        measurement=measured[kind];wm,hm=measurement['card_mm']
        mm=np.array(measurement['mm_per_texel'],dtype=float)
        u0,v0,u1,v1=measurement['rect'];box=[round(u0*N),round((1-v1)*N),round(u1*N),round((1-v0)*N)]
        x0,y0,x1,y1=box;w=x1-x0;h=y1-y0;scale=1/mm;out=canvas((h,w));parts=[]
        def add(sid,x,root,L,W,deg=0,mirror=False,layer='main'):
            theta=np.deg2rad(deg);center=np.array([x,root+L*.5])
            v=flat_vertices(center,L,W,theta,scale)
            relief=.85 if kind=='mane' else .55
            specimen=softened_cap(feathers[sid]) if kind=='hood' and sid<12 else feathers[sid]
            stamp(out,specimen,v,relief,lift=(.6 if kind=='mane' else 1.15)-.4*relief,mirror=mirror)
            if kind=='hood':
                for shift in [-wm,wm]:stamp(out,specimen,flat_vertices(center+[shift,0],L,W,theta,scale),relief,lift=1.15-.4*relief,mirror=mirror)
            parts.append(dict(source=feathers[sid]['id'],x_mm=x,root_y_mm=root,length_mm=L,width_mm=W,angle_degrees=deg,mirrored=mirror,layer=layer))
        if kind=='hood':
            # Connected small feather clusters, not isolated decals on skin.
            # Paint tips first, then overlap their roots with the cap canopy.
            rng=np.random.default_rng(SEED+581)
            for i,x in enumerate(np.linspace(0,wm,round(wm/5.2),endpoint=False)):
                x+=float(rng.uniform(-.6,.6));count=int(rng.integers(2,6))
                tip=float(rng.uniform(hm*.77,hm*.99))
                for j in range(count):
                    offset=j-(count-1)/2;L=float(rng.uniform(4,8));W=L*float(rng.uniform(.47,.60))
                    end=tip-abs(offset)*.45
                    # Every specimen ends in a rounded vane, including the
                    # aliases previously occupied by wispy fringe specimens.
                    sid=(i*3+j)%12 if j%3!=2 else 28+(i*3+j)%12
                    root=min(end-L,hm*.5-.5)
                    add(sid,x+offset*1.05,root,L,W,-offset*3+float(rng.uniform(-3,3)),bool(i%2),f'tuft_{i}')
            for row,tip in enumerate([hm*.68,hm*.38,hm*.08]):
                for i,x in enumerate(np.arange(-2,wm+2,2.35)):
                    L=float(rng.uniform(8,11));W=L*float(rng.uniform(.44,.50))
                    x+=float(rng.uniform(-.7,.7));end=tip+float(rng.uniform(-.55,.55))
                    add((row*5+i)%12,float(x),end-L,L,W,float(rng.uniform(-7,7)),bool(i%2),f'cap_{row}')
            out[0,:int(np.ceil(h*.5))]=1
        elif kind=='forehead':
            for i,x in enumerate(np.arange(1,wm,2.5)):
                L=hm*(2/3+.25*(1-abs(x-wm/2)/(wm/2)))
                add(i%12,float(x),-2,L,L*.65,0,bool(i%2),'under')
            for i,(fraction,depth) in enumerate(zip([.13,.26,.39,.5,.61,.74,.87],[.667,.833,.967,1.008,.967,.833,.667])):
                x=wm*fraction;L=hm*depth
                add(28+(i%4),x,-1.3,L,L*.64,(x-wm/2)*1.1,x>wm/2)
            # This single card spans the mirror plane; make its actual artwork symmetric.
            out=(out+out[:,:,::-1])*.5
        else:
            # The mane has its own frozen random stream, independent of the edge.
            rng.bit_generator.state=json.loads((ROOT/'source/mane_random_state.json').read_text())['state']
            # Broad coverts overlap closely. Paint downstream first so each
            # upper row covers the roots of the row below, as on the nape.
            for row,tip in enumerate(np.arange(hm+1.,-1.,-17.)):
                L=float(np.clip(31+17*tip/hm,30,50));W=float(np.clip(L*.55,15,25));pitch=W*.62
                for i,x in enumerate(np.arange(-W*.2,wm+W*.5,pitch)):
                    length=float(np.clip(L*rng.uniform(.96,1.04),30,50))
                    width=float(np.clip(W*rng.uniform(.94,1.05),15,25))
                    end=tip+float(rng.uniform(-3.6,3.6))
                    if row==0:
                        end=hm-1.0-7.2*(.5+.5*np.sin(i*2.39))
                    x+=((row%2)-.5)*pitch*.55+float(rng.uniform(-1.3,1.3))
                    add(12+(row*3+i)%8,float(x),end-length,length,width,float(rng.uniform(-4,4)),bool(i%2),f'row_{row}')
            out[0,:int(np.ceil(2/mm[1]))]=1
        a,height,p,rough,shaft=out;visible=a>=.5
        # Clamp neither the feather's outline nor its RGB to a rectangular leaf.
        # Only transparent fields are continued; the original alpha stays intact.
        height=gaussian_filter(height,(.22/mm[1],.22/mm[0]))
        base,st=balance(.5+p*(.78 if kind=='mane' else .60),visible)
        base=extended(base,visible);height=extended(height,visible);rough=extended(rough,visible)
        oc=fine_ao(height,np.sqrt(np.prod(mm)),np.ones((h,w),bool))
        own[y0:y1,x0:x1]=True
        combined[:,y0:y1,x0:x1]=np.stack([a,height,base-.5,rough,oc])
        records[kind]=dict(box_px=box,size_mm=[wm,hm],mm_per_texel=mm.tolist(),placements=parts)
        st.update(visible_texels=int(visible.sum()),coverage=float(visible.mean()),elements=len(parts),box_px=box,size_mm=[wm,hm],mm_per_texel=mm.tolist())
        stats[kind]=st
    a,h,p,rough,oc=combined;base=.5+p
    # Every rectangle is already balanced independently. Use a fixed final
    # float32 correction so changing one rectangle cannot shift another's value.
    visible=own&(a>=.5);before=float(base[visible].var())
    base=np.clip(base,.075,.94)
    for mean in json.loads((ROOT/'source/mane_random_state.json').read_text())['accepted_card_balance_means']:
        base=np.clip(base+.5-np.float32(mean),.075,.94)
    allstats=dict(mean_linear=float(base[visible].mean()),std_linear=float(base[visible].std()),
                  variance_retained=float(base[visible].var()/max(before,1e-12)),directional_correction=[0.,0.,0.])
    rg=np.zeros((N,N,3),np.uint8);rg[own]=[255,0,255]
    write_layers('cards',[0,0,N,N],own,base,a,h,rough,oc,rg)
    return dict(rectangles=stats,combined=allstats),records


def main():
    start=time.time();OUT.mkdir(exist_ok=True)
    inputs=input_hashes()
    feathers=sources();shell_stats,placements,_=shell(feathers)
    card_stats,card_records=cards(feathers)
    if inputs!=input_hashes():raise SystemExit('Inputs changed during painting; rerun against the completed rebake.')
    info=dict(group='hood',revision=7,height_mm=HEIGHT_MM,cards_height_mm=HEIGHT_MM,
              pieces=['shell_hood'],cards=['hood','forehead','mane'],seed=SEED,
              study='tex/studies/hood',size_px=N,input_sha256=inputs,root_direction='up; tips down in each card rectangle',
              shell=shell_stats,card_metrics=card_stats,card_rectangles={k:{n:v[n] for n in ['box_px','size_mm','mm_per_texel']} for k,v in card_records.items()})
    (OUT/'layers.json').write_text(json.dumps(info,indent=2)+'\n')
    (OUT/'placements.json').write_text(json.dumps(dict(shell=placements,cards=card_records),indent=2)+'\n')
    files=sorted(p.name for p in OUT.glob('*.png'))
    (OUT/'hashes.json').write_text(json.dumps({n:hashlib.sha256((OUT/n).read_bytes()).hexdigest() for n in files},indent=2)+'\n')
    print(json.dumps(dict(seconds=round(time.time()-start,2),shell=shell_stats,cards=card_stats),indent=2),flush=True)

if __name__=='__main__':main()
