"""Continue the body's plain neck vanes and finish the hood's narrowing nape.

All source access is read-only. No cached outputs are inputs: the locally kept
body field/station recipe supplies the neck treatment and row phase.
"""
import importlib.util
import json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, distance_transform_edt, binary_dilation
from scipy.spatial import cKDTree


def body_recipe(path):
    spec=importlib.util.spec_from_file_location('hood_body_recipe',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def neck_fields(g,red,api):
    body=body_recipe(api.ROOT/'body_neck_recipe.py')
    sources=body.fields()['plain']
    mask=g['own']&(g['pos'][...,1]<545)
    P=g['pos'][mask];D=body.norm((g['jx']*g['flow'][...,0,None]+g['jy']*g['flow'][...,1,None])[mask])
    normal=body.norm(np.cross(g['jx'],g['jy'])[mask]);E=body.norm(np.cross(D,normal))
    target=dict(rec=dict(name='shell_body'),P=P,D=D,E=E,n=normal,tree=cKDTree(P),coords=np.argwhere(mask))
    rng=np.random.default_rng(body.SEED);stations=body.stations(target,rng)
    for s in stations:
        s.update(family='plain',length=float(np.clip(s['length'],25,30)),width=float(np.clip(s['width'],24,29)))
    c=np.zeros((6,len(P)),np.float32);c[0]=.6;c[1]=.5;c[2]=.91;c[5]=-1
    for s in stations:
        under=dict(s);under['centre']=s['centre']+E[s['k']]*s['width']*.3+D[s['k']]*s['length']*.28
        body.stamp(target,c,under,sources[(s['source']+7)%len(sources)],True)
    for j in range(80):
        gaps=np.flatnonzero(c[4]<.8)
        if not len(gaps):break
        k=int(gaps[(j*7919)%len(gaps)])
        s=dict(k=k,centre=P[k],width=25.,length=29.,angle=0.,family='plain',source=j%len(sources),row=-1,level=0,col=1,mirror=P[k,0]<1)
        body.stamp(target,c,s,sources[s['source']],True)
    for s in stations:body.stamp(target,c,s,sources[s['source']%len(sources)])
    fields=[]
    for v in c[:3]:
        a=np.zeros(mask.shape,np.float32);a[mask]=v;fields.append(api.extended(a,mask))
    height=gaussian_filter(fields[0],.70);base=fields[1];rough=fields[2]
    # The neighbouring painter calms its UV cut to these same physical values.
    # Only the actual piece boundary is calmed, not the interior colour wedge.
    rim=(distance_transform_edt(g['own'])<1.5)&g['own']&(g['pos'][...,0]>3)
    distance=cKDTree(g['pos'][rim]).query(g['pos'].reshape(-1,3))[0].reshape(mask.shape)
    weight=api.smooth(distance/2)
    height=.6+(height-.6)*weight;base=.5+(base-.5)*weight
    n=api.normals(height,g['mm'],g['own']);n[...,2]=0
    base,stats=api.balance(base,red,n)
    ao=np.clip(1-np.maximum(gaussian_filter(height,4)-height,0)*.04,.98,1)
    records=[dict(layer='neck',source=sources[s['source']%len(sources)]['id'],
                  center_px=(target['coords'][s['k']][::-1]+g['box'][:2]).tolist(),
                  center_mm=s['centre'].tolist(),length_mm=s['length'],width_mm=s['width'],
                  flow_jitter_degrees=float(np.rad2deg(s['angle'])),source_mirrored=s['mirror']) for s in stations]
    stats.update(texels=int(red.sum()),main_feathers=len(stations),coverage=float(np.mean(c[4][red[mask]])),
                 length_mm=[min(s['length'] for s in stations),max(s['length'] for s in stations)])
    return (base,height,rough,ao),records,stats


def finish(g,feathers,old,api):
    box=g['box'];regions=np.asarray(Image.open(api.BAKES/'dodo_regions.png'))[box[1]:box[3],box[0]:box[2]]
    red=g['own']&np.all(regions==[255,0,0],axis=-1)
    hood=g['own']&np.all(regions==[255,0,255],axis=-1)
    body,records,stats=neck_fields(g,red,api)
    own=g['own'];P=g['pos'];rng=np.random.default_rng(api.SEED+404)
    target=dict(g);target['own']=own&(P[...,1]<610)
    target['length']=31+16*api.smooth((590-P[...,1])/110)
    out=api.canvas(own.shape)
    centres=api.row_centers(target,rng)
    items=[]
    for layer in [0,1]:
        for xy in centres:
            centre=np.array(xy);d,e=api.frame(g,centre)
            if layer==0:centre+=d*9+e*8
            L=float(np.clip(api.sample(target['length'],centre[None])[0]*rng.uniform(.94,1.06),30,50))
            W=float(np.clip(L*rng.uniform(.49,.57),15,25));sid=int(rng.integers(12,20))
            angle=float(rng.uniform(-.075,.075));Q=api.sample(P,centre[None])[0]
            items.append((layer,float(Q[1]),centre,L,W,sid,angle))
    # Place a separate last row with free tips landing just inside the wedge.
    edge=hood&binary_dilation(red)&(P[...,1]<520)
    yy,xx=np.where(edge);selected=[]
    for k in np.argsort(P[edge,1]):
        xy=np.array([xx[k],yy[k]],float);q=P[yy[k],xx[k]]
        if selected and np.min(np.linalg.norm(np.array(selected)-q,axis=1))<10:continue
        selected.append(q);L=float(rng.uniform(31,39));W=float(rng.uniform(18,23));d,_=api.frame(g,xy)
        centre=xy-d*(L*.47)
        items.append((2,float(q[1]+L*.5),centre,L,W,int(rng.integers(12,20)),0.))
    for layer,_,centre,L,W,sid,angle in sorted(items,key=lambda item:(item[0],item[1])):
        api.stamp(out,feathers[sid],api.curved_strip(g,centre,L,W,angle),.85,lift=.6-.4*.85,mirror=bool(sid%2))
        records.append(dict(layer='wedge_tip' if layer==2 else 'nape',source=feathers[sid]['id'],center_px=(centre+box[:2]).tolist(),
                            length_mm=L,width_mm=W,flow_jitter_degrees=float(np.rad2deg(angle)),source_mirrored=bool(sid%2)))
    a,h,p,r,_=out
    h=gaussian_filter(api.extended(h,own),.30/np.median(g['mm'][own]));base=.5+p*.78
    weight=api.smooth((605-P[...,1])/35)*hood
    b0,h0,r0,o0=old
    b=b0*(1-weight)+base*weight;h=h0*(1-weight)+h*weight;r=r0*(1-weight)+r*weight
    # Keep a soft low contact where the two physical feather beds meet.
    distance=distance_transform_edt(~red)*g['mm']
    contact=(1-api.smooth(distance/3))*hood
    h=h*(1-contact)+body[1]*contact
    for dest,src in [(b,body[0]),(h,body[1]),(r,body[2])]:dest[red]=src[red]
    h=np.rint(np.clip(h/api.HEIGHT_MM,0,1)*65535)/65535*api.HEIGHT_MM
    n=api.normals(h,g['mm'],own)
    b,headstats=api.balance_cap(b,hood,weight,n)
    # The red region's own mean stays separate from the umber hood's mean.
    rb,bodybalance=api.balance(b,red,np.dstack([n[...,:2],np.zeros(own.shape)]));b[red]=rb[red]
    ao=api.fine_ao(h,g['mm'],own);ao[weight==0]=o0[weight==0];ao[red]=body[3][red]
    api.write_layers('dodo',box,own,b,own.astype(float),h,r,ao,regions)
    stats.update(head=headstats,body_balance=bodybalance,edge_tip_feathers=len(selected),broad_nape_feathers=len(items))
    return (b,h,r,ao),records,stats
