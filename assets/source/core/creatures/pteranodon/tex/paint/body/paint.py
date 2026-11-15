#!/usr/bin/env python3
"""Paint the body from the live accepted studies. No Blender; only writes here.

python3 tex/paint/body/paint.py
The animal-space patch field is shared across UV islands. All sampling, filtering
and relief are in physical units, and the bake is read anew on every invocation.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
PAINT = HERE.parent
ASSET = PAINT.parent.parent
F = np.float32
N = 2048
HEIGHT_MM = 0.8
OWN = ['torso', 'neck', 'leg'] + [f'toe_{i}' for i in range(4)] + [f'hand_{i}' for i in range(3)]
COLOURS = {0: (255,0,0), 2: (0,0,255), 5: (255,255,0), 6: (0,0,0)}
INPUTS = {}


def read(path):
    path = Path(path)
    INPUTS[str(path.relative_to(ASSET))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return path


def metadata(path):
    return json.loads(read(path).read_text())


def picture(path):
    return np.asarray(Image.open(read(path)))


def lin(a):
    a = np.asarray(a, F)
    return np.where(a <= .04045, a/12.92, ((a+.055)/1.055)**2.4)


def srgb(a):
    a = np.clip(a,0,1)
    return np.where(a <= .0031308, a*12.92, 1.055*a**(1/2.4)-.055)


def smooth(a):
    a = np.clip(a,0,1)
    return a*a*(3-2*a)


def unit(a):
    return a / np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-9)


def ensure_study(name, sets):
    """Missing ignored layers rebuild in a private copy, never in another painter's folder."""
    source = ASSET/'tex/studies'/name
    if all((source/f'{s}_{l}.png').exists() for s in sets for l in ['base','height','packed','regions']):
        return source
    target = HERE/'checks/rebuilt_studies'/name
    shutil.copytree(source,target,dirs_exist_ok=True,ignore=shutil.ignore_patterns('checks','superseded','__pycache__'))
    subprocess.run([sys.executable,str(target/'build.py')],check=True)
    return target


class Study:
    def __init__(self, folder, name):
        self.folder, self.name = folder, name
        self.spec = metadata(folder/'study.json')['sets'][name]
        self.base = lin(picture(folder/f'{name}_base.png')[...,:3]/255)
        self.h = picture(folder/f'{name}_height.png').astype(F)/65535*self.spec['height_mm']
        packed = picture(folder/f'{name}_packed.png').astype(F)/255
        self.r, self.ao = packed[...,1], packed[...,0]
        self.mean = [self.base.mean((0,1)),float(self.h.mean()),float(self.r.mean()),float(self.ao.mean())]

    def sample(self, u, v, mm, physical_scale=1, repeat=True):
        """Prefilter at a conservative target footprint; all four layers stay aligned."""
        px_mm = self.spec['span_m']*1000/N*physical_scale
        footprint = max(float(np.median(mm))/px_mm, 1)
        sigma = max(.45*np.sqrt(footprint**2-1),0)
        mode = 'wrap' if repeat else 'nearest'
        coords = [v,u]
        def get(a):
            a = gaussian_filter(a,sigma,mode=mode) if sigma>.05 else a
            return map_coordinates(a,coords,order=1,mode='grid-wrap' if repeat else 'nearest',prefilter=False)
        b = np.stack([get(self.base[...,i]) for i in range(3)],-1)
        return b, get(self.h), get(self.r), get(self.ao)


def derivatives(pos, pieces, axis):
    plus,minus=np.roll(pos,-1,axis),np.roll(pos,1,axis)
    ok1=np.roll(pieces,-1,axis)==pieces
    ok0=np.roll(pieces,1,axis)==pieces
    return np.where((ok1&ok0)[...,None],(plus-minus)*.5,
                    np.where(ok1[...,None],plus-pos,np.where(ok0[...,None],pos-minus,0)))


def hash_nodes(nodes):
    # Integer-only hash: fixed across processes and platforms.
    n=nodes.astype(np.int64)
    h=(n[:,0]*73856093)^(n[:,1]*19349663)^(n[:,2]*83492791)^281403
    return (h & 0x7fffffff).astype(np.int64)


def patch_field(study, p, tangent, normal, mm, elements):
    """Overlapping 40 mm surface frames, globally anchored in animal space.

    Hermite weights avoid lattice seams. Variance compensation preserves the
    source's fine drawing; no random noise or imitation fibres replace the study.
    """
    spacing=.040
    lattice=p/spacing
    cell=np.floor(lattice).astype(np.int32)
    f=smooth(lattice-cell)
    unique_nodes=np.unique(np.concatenate([cell+np.array([a,b,c]) for a in [0,1] for b in [0,1] for c in [0,1]]),axis=0)
    # Use an evenly subsampled atlas for stable, economical surface frame queries.
    sel=np.arange(0,len(p),3)
    tree=cKDTree(p[sel])
    _,near=tree.query(unique_nodes*spacing,k=6)
    ids=sel[near]
    nn=unit(normal[ids].mean(1))
    tt=unit(tangent[ids].mean(1))
    tt=unit(tt-nn*(tt*nn).sum(1)[:,None])
    bb=unit(np.cross(tt,nn))
    node_lookup={tuple(k):i for i,k in enumerate(unique_nodes)}
    # The reusable element library determines patch origins, not a frozen old tile.
    patches=[v for v in elements.values() if v['source_set']=='fuzz']
    boxes=np.array([v['box_px'] for v in patches],F)
    hashes=hash_nodes(unique_nodes)
    centers=(boxes[hashes%len(boxes),:2]+boxes[hashes%len(boxes),2:])*.5
    centers += np.stack([(hashes//11)%773-386,(hashes//829)%773-386],1)
    # Scale changes are per frame, avoiding stretching derivatives of a spatially varying UV.
    node_p=unique_nodes*spacing
    finer=smooth((node_p[:,1]-1.14)/.18)
    shin=smooth((-node_p[:,2]-.80)/.23)*smooth((.69-node_p[:,1])/.10)
    scale=1-.5*np.maximum(finer,shin)
    accum=[np.zeros((len(p),3),F)]+[np.zeros(len(p),F) for _ in range(3)]
    variance=np.zeros(len(p),F)
    # Filter once per study/channel and sample the local frame coordinates below.
    px_per_m=N/study.spec['span_m']
    filtered=[]
    sig=max(.45*np.sqrt(max((float(np.median(mm))*px_per_m/1000)**2-1,0)),.1)
    for arr in [study.base[...,0],study.base[...,1],study.base[...,2],study.h,study.r,study.ao]:
        filtered.append(gaussian_filter(arr,sig,mode='wrap'))
    for a in [0,1]:
        for b in [0,1]:
            for c in [0,1]:
                nodes=cell+np.array([a,b,c])
                # Unique inverse avoids one dictionary operation per texel.
                un,inv=np.unique(nodes,axis=0,return_inverse=True)
                ni=np.array([node_lookup[tuple(k)] for k in un])[inv]
                delta=p-nodes*spacing
                u=centers[ni,0]+(delta*bb[ni]).sum(1)*px_per_m/scale[ni]
                v=centers[ni,1]+(delta*tt[ni]).sum(1)*px_per_m/scale[ni]
                w=np.prod(np.where(np.array([a,b,c]),f,1-f),axis=1).astype(F)
                variance+=w*w
                for j,arr in enumerate(filtered):
                    val=map_coordinates(arr,[v,u],order=1,mode='grid-wrap',prefilter=False)
                    mean=study.mean[0][j] if j<3 else study.mean[j-2]
                    if j<3:accum[0][:,j]+=(val-mean)*w
                    else:accum[j-2]+=(val-mean)*w*(scale[ni] if j==3 else 1)
    gain=1/np.sqrt(np.maximum(variance,.125))
    for j in range(4):
        accum[j]*=gain[:,None] if j==0 else gain
        accum[j]+=study.mean[j] if j!=1 else HEIGHT_MM*.5
    return accum


def tube_coordinates(mask, pos, mm):
    """Unwrap distance along a tube from its live world-position bake, in metres."""
    yy,xx=np.nonzero(mask)
    rows=np.arange(yy.min(),yy.max()+1)
    centers=np.stack([np.median(pos[y,mask[y]],axis=0) if mask[y].any() else [np.nan]*3 for y in rows])
    for k in range(3):
        good=np.isfinite(centers[:,k])
        centers[:,k]=np.interp(rows,rows[good],centers[good,k])
    centers=gaussian_filter1d(centers,3,axis=0)
    dist=np.r_[0,np.cumsum(np.linalg.norm(np.diff(centers,axis=0),axis=1))]
    row=yy-rows[0]
    # The atlas strips are nearly vertical; transverse derivative gives true circumference.
    xmin=np.array([np.flatnonzero(mask[y]).min() for y in rows])
    xmax=np.array([np.flatnonzero(mask[y]).max() for y in rows])
    frac=(xx-xmin[row])/np.maximum(xmax[row]-xmin[row],1)
    circumference=np.array([np.sum(np.linalg.norm(np.diff(pos[y,mask[y]],axis=0),axis=1)) for y in rows])
    circumference=gaussian_filter1d(circumference,4)
    return dist[row].astype(F), ((frac-.5)*circumference[row]).astype(F), frac.astype(F)


def mantle_distance(p):
    x,y,z=p.T
    # Measured concept silhouette: a rounded shoulder saddle tapering to the hips.
    stations=np.array([-.69,-.62,-.54,-.40,-.22,-.05,.06,.13,.20,.29,.40,.60])
    # Keep the accepted saddle below z=.20; carry the neck colour around both
    # sides of its rear surface so that it also survives the profile view.
    nape=metadata(HERE/'source/joins.json')['nape']
    half_width=nape['full_width_m']*.5
    widths=np.array([0,.045,.080,.114,.146,.158,.145,.095,.045,.040,half_width,half_width])
    width=np.interp(z,stations,widths)
    # C1 smoothing of the width function rather than a face-step threshold.
    zz=np.linspace(-.75,.65,2801)
    ww=gaussian_filter1d(np.interp(zz,stations,widths),18)
    width=np.interp(z,zz,ww)
    cy=np.interp(z,[-.82,-.66,-.48,-.17,.10],[.668,.706,.733,.745,.752])
    top=y-cy
    # Follow the curved neck's centre line. The old straight diagonal passed
    # within the edge fringe of the dorsal meridian under the head; final study
    # pale locks could then cut right across the stripe in the rider's view.
    path=np.array(nape['centreline_yz_m'])
    slope=np.interp(y,path[:,0],np.gradient(path[:,1],path[:,0]))
    back=(np.interp(y,path[:,0],path[:,1])-z)/np.sqrt(1+slope*slope)
    neck=smooth((z-.10)/.13)
    facing=top*(1-neck)+back*neck
    # Distance positive inside; x is absolute, so both midlines are exactly symmetric.
    return np.minimum.reduce([width-x,facing*.72,(z+.675)*.75]).astype(F)


def mantle_ids(folder, p, distance):
    """Read the live mantle_edge categorical drawing, including its wandering locks."""
    spec=metadata(folder/'study.json')['sets']['mantle_edge']
    rg=picture(folder/'mantle_edge_regions.png')
    dark=(rg[...,0]==255)&(rg[...,1]==0)
    # Locate the principal edge from region coverage, ignoring the quieter tile wrap.
    row=np.arange(N)
    center=int(np.argmin(np.abs(dark.mean(1)[N//3:2*N//3]-.5)))+N//3
    x,y,z=p.T
    # Long contour coordinate; the edge's full 500 mm cycle is not repeated in short rows.
    along=-z+.24*y+.16*x
    u=(along/spec['span_m']*N+317)%N
    # The fringe shortens with the face-scale pile at the neck's upper end.
    # Body-sized locks here would reach across most of the narrow nape band.
    edge_scale=1-.5*smooth((y-1.14)/.18)
    v=center-distance/(spec['span_m']*edge_scale)*N
    # Main band's natural wandering is retained at half amplitude (about 7 mm).
    profile=np.sum(dark[N//4:3*N//4],axis=0)+N//4
    coarse=gaussian_filter1d(profile.astype(F),30,mode='wrap')
    shift=map_coordinates(coarse,[u],order=1,mode='grid-wrap')-center
    v+=shift*.5
    out=map_coordinates(dark.astype(F),[np.clip(v,0,N-1),u],order=0,mode='nearest')>.5
    out[distance>.035*edge_scale]=True
    out[distance<-.035*edge_scale]=False
    return out


def main():
    start=time.monotonic()
    out=HERE/'layers';out.mkdir(exist_ok=True)
    checks=HERE/'checks';checks.mkdir(exist_ok=True)
    fuzzdir=ensure_study('fuzz',['fuzz','fuzz_face','mantle_edge'])
    skindir=ensure_study('skin',['skin','scutes','claw'])
    fuzzmeta=metadata(fuzzdir/'study.json')
    elements=metadata(fuzzdir/fuzzmeta.get('elements_manifest','elements/elements.json'))
    # Read and verify every aligned reusable element, so a stale library is never silently used.
    for name,elem in elements.items():
        for layer in ['base','height','packed','regions']:
            crop=picture(fuzzdir/'elements'/f'{name}_{layer}.png')
            parent=picture(fuzzdir/f"{elem['source_set']}_{layer}.png")
            x0,y0,x1,y1=elem['box_px']
            if not np.array_equal(crop,parent[y0:y1,x0:x1]):
                raise ValueError(f'Stale study element {name}/{layer}; finish the fuzz build first')
    meta=metadata(PAINT/'pteranodon_pieces.json')
    pieces=picture(PAINT/'pteranodon_pieces.png')[...,0]
    numbers={v['name']:v['number'] for v in meta['pieces']}
    owned=np.isin(pieces,[numbers[k] for k in OWN])
    lo,hi=np.array(meta['position_box']['min'],F),np.array(meta['position_box']['max'],F)
    pos=np.stack([picture(PAINT/f'pteranodon_position_{a}.png').astype(F)/65535*(hi[i]-lo[i])+lo[i] for i,a in enumerate('xyz')],-1)
    sign=-1 if np.median(pos[...,0][owned])<0 else 1
    pos[...,0]=np.abs(pos[...,0])
    mm=picture(PAINT/'pteranodon_texel_mm.png').astype(F)/1000
    normal=picture(ASSET/'ref/bakes/pteranodon_normal_object.png')[...,:3].astype(F)/127.5-1
    # The legacy normal bake stores +X on this mirrored half; the position bake
    # stores -X. Resolve their handedness independently before sharing frames.
    shell_normals=np.isin(pieces,[numbers["torso"],numbers["neck"]])
    normal[...,0]*=1 if np.median(normal[...,0][shell_normals])>=0 else -1
    normal=unit(normal)
    flow=picture(ASSET/'ref/bakes/pteranodon_flow.png')[...,:3].astype(F)/255
    du=derivatives(pos,pieces,1);dv=-derivatives(pos,pieces,0)
    tangent=unit(du*(flow[...,0:1]*2-1)+dv*(flow[...,1:2]*2-1))
    fallback=np.broadcast_to(np.array([0,-.5,-1],F),pos.shape).copy()
    fallback-=normal*(fallback*normal).sum(-1)[...,None]
    tangent=np.where((flow[...,2]>.2)[...,None],tangent,unit(fallback))
    del du,dv,fallback,flow
    base=np.zeros((N,N,3),F);height=np.zeros((N,N),F);rough=np.zeros((N,N),F);ao=np.zeros((N,N),F)
    regions=np.full((N,N),6,np.uint8)
    fuzzy=np.isin(pieces,[numbers[k] for k in ['torso','neck','leg']])
    study=Study(fuzzdir,'fuzz')
    b,h,r,o=patch_field(study,pos[fuzzy],tangent[fuzzy],normal[fuzzy],mm[fuzzy],elements)
    # Calm both mirror meridians over 2 mm, without a flat strip or a hard parting.
    calm=.72+.28*smooth(pos[fuzzy,0]/.002)
    b=.5+(b-.5)*calm[:,None];h=.4+(h-.4)*calm
    tail=1-.025*np.exp(-((pos[fuzzy,2]+.765)/.045)**2)
    b*=tail[:,None]
    base[fuzzy],height[fuzzy],rough[fuzzy],ao[fuzzy]=b,h,r,o
    regions[fuzzy]=5
    shell=np.isin(pieces,[numbers['torso'],numbers['neck']])
    d=mantle_distance(pos[shell])
    dark=mantle_ids(fuzzdir,pos[shell],d)
    regions[shell]=np.where(dark,0,5)
    del study,b,h,r,o
    guide=picture(ASSET/'ref/bakes/pteranodon_regions.png')[...,:3]
    skin,scutes,claw=[Study(skindir,s) for s in ['skin','scutes','claw']]
    piece_facts={}
    for name in ['leg']+[f'toe_{i}' for i in range(4)]+[f'hand_{i}' for i in range(3)]:
        mask=pieces==numbers[name]
        s,c,frac=tube_coordinates(mask,pos,mm)
        p=pos[mask];n=normal[mask];density=mm[mask]
        small=name.startswith('hand')
        scale=.70 if small else 1.0
        offset=(numbers[name]*.037)%skin.spec['span_m']
        sb,sh,sr,so=skin.sample((s+offset)/(.2*scale)*N,(c+.083)/(.2*scale)*N,density,scale)
        cb,ch,cr,co=scutes.sample((s+offset)/(.2*scale)*N,(c+.102)/(.2*scale)*N,density,scale)
        dorsal=n[:,1] if small else -n[:,1]
        w=smooth((dorsal-.08)/.68)
        # A toe's dorsal broad scales turn into small pebbles around its sides.
        bb=sb*(1-w[:,None])+cb*w[:,None]
        hh=sh*(1-w)+ch*w;rr=sr*(1-w)+cr*w;oo=so*(1-w)+co*w
        if name=='leg':
            # The transition follows the ankle in space; softly thins over 28 mm.
            transition=(p[:,2]+1.015)/.028
            amount=smooth(transition+.5)
            # Fine source-derived tufts interleave pure region IDs, never an alpha fade.
            strand=np.clip((base[mask,0]-.5)/.11,-1,1)
            fuzzid=transition+strand*.18>0
            b0,h0,r0,o0=base[mask],height[mask],rough[mask],ao[mask]
            bb=bb*(1-amount[:,None])+b0*amount[:,None]
            hh=.4+(hh-float(np.mean(hh)))*(1-amount)+(h0-.4)*amount
            rr=rr*(1-amount)+r0*amount;oo=oo*(1-amount)+o0*amount
            regions[mask]=np.where(fuzzid,5,2)
            piece_facts[name]={'soft_fuzz_transition_z_m':[-1.029,-1.001],'skin_scales':scale}
        else:
            bare=(guide[mask]==0).all(1)
            # Preserve the actual claw assignment, but smooth its collar in length.
            claw_start=float(np.percentile(s[bare],2))
            claw_end=float(s.max())
            use=s>=claw_start
            t=np.clip((s-claw_start)/max(claw_end-claw_start,1e-5),0,1)
            elem=claw.spec['elements'][0]
            line=np.array(elem['centerline'],F)
            arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(line,axis=0),axis=1))]
            target=t*arc[-1]
            u=np.interp(target,arc,line[:,0]);v=np.interp(target,arc,line[:,1])
            dx=np.interp(target,arc,np.gradient(line[:,0]));dy=np.interp(target,arc,np.gradient(line[:,1]))
            norm=np.maximum(np.hypot(dx,dy),1)
            # Sample the curved horn's transverse grain around the claw; period closes the underside seam.
            across=np.sin(frac*2*np.pi)*.0024/(claw.spec['span_m']/N)
            u+=-dy/norm*across;v+=dx/norm*across
            kb,kh,kr,ko=claw.sample(u,v,density,repeat=False)
            bb[use],hh[use],rr[use],oo[use]=kb[use],kh[use],kr[use],ko[use]
            # Same physical baseline on both sides of the keratin collar.
            hh=.4+hh-np.median(hh)
            regions[mask]=np.where(use,6,2)
            piece_facts[name]={'mapped_length_m':float(s.max()),'claw_curve_m':claw_end-claw_start,'skin_scales':scale}
        base[mask],height[mask],rough[mask],ao[mask]=bb,hh,rr,oo
        print(f'{name}: painted {int(mask.sum())} texels',flush=True)
    # Mean and neutrality are enforced on our own drawing, before the composer sees it.
    means={}
    for region in [0,2,5]:
        m=owned&(regions==region)
        value=base[m].mean(-1)
        value += .5-float(value.mean())
        base[m]=np.clip(value[:,None],.06,.94)
        means[str(region)]=float(lin(np.round(srgb(base[m])*255)/255).mean())
    rgba=np.zeros((N,N,4),np.uint8)
    rgba[owned,:3]=np.uint8(srgb(base[owned])*255+.5);rgba[owned,3]=255
    Image.fromarray(rgba).save(out/'pteranodon_base.png')
    for name,arr in [('rough',rough),('occlusion',ao)]:
        Image.fromarray(np.uint8(np.clip(arr,0,1)*255+.5)).save(out/f'pteranodon_{name}.png')
    height=np.where(owned,np.clip(height,0,HEIGHT_MM),0)
    Image.fromarray(np.uint16(height/HEIGHT_MM*65535+.5)).save(out/'pteranodon_height.png')
    rgb=np.zeros((N,N,3),np.uint8)
    for r,col in COLOURS.items():rgb[owned&(regions==r)]=col
    Image.fromarray(rgb).save(out/'pteranodon_regions.png')
    (out/'layers.json').write_text(json.dumps({'pteranodon_height_mm':HEIGHT_MM},indent=2)+'\n')
    facts={'owned_texels':int(owned.sum()),'pieces':piece_facts,'mean_linear':means,
           'fuzz_round':fuzzmeta.get('round'),'height_mm':HEIGHT_MM,
           'occupied_relief_mm':{name:float(np.ptp(height[pieces==numbers[name]])) for name in OWN},
           'input_sha256':dict(sorted(INPUTS.items())),
           'output_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.iterdir()) if p.is_file()}}
    (checks/'build_metrics.json').write_text(json.dumps(facts,indent=2)+'\n')
    # A dye-correct unlit overview; shade and normal previews belong to check.py.
    preview=np.full((N,N,3),.19,F)
    dye={0:'2E3134',2:'C8662E',5:'E9E4D8',6:None}
    for r,col in dye.items():
        m=owned&(regions==r)
        colour=lin(np.array([int(col[i:i+2],16) for i in (0,2,4)],F)/255) if col else None
        preview[m]=base[m]*colour/.5 if col else base[m]
    Image.fromarray(np.uint8(srgb(preview)*255+.5)).save(checks/'unlit_atlas.png')
    print(json.dumps({k:facts[k] for k in ['owned_texels','mean_linear','occupied_relief_mm']},indent=2))
    print(f'Body build complete in {time.monotonic()-start:.1f}s; fuzz round {fuzzmeta.get("round")}',flush=True)


if __name__=='__main__':main()
