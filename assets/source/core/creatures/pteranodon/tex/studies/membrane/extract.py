#!/usr/bin/env python3
"""Trace the generated membrane's vessels; no invented vascular curves.

Chromatic/dark-line separation, Zhang-Suen thinning, connected pixel graph,
short-spur removal. Drawing is retained; only its physical stroke width changes.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import (gaussian_filter, gaussian_filter1d, binary_closing,
                           label, distance_transform_edt)
HERE=Path(__file__).resolve().parent


def thin(mask):
    p=np.pad(mask,1).astype(bool)
    for _ in range(100):
        changed=0
        for phase in range(2):
            ns=[p[:-2,1:-1],p[:-2,2:],p[1:-1,2:],p[2:,2:],
                p[2:,1:-1],p[2:,:-2],p[1:-1,:-2],p[:-2,:-2]]
            count=sum(x.astype(np.uint8) for x in ns)
            transitions=sum((~ns[i]&ns[(i+1)%8]).astype(np.uint8) for i in range(8))
            a,b,c,d=ns[0],ns[2],ns[4],ns[6]
            condition=(~(a&b&c)&~(b&c&d)) if phase==0 else (~(a&b&d)&~(a&c&d))
            erase=p[1:-1,1:-1]&(count>=2)&(count<=6)&(transitions==1)&condition
            changed+=int(erase.sum());p[1:-1,1:-1][erase]=False
        if changed==0: break
    return p[1:-1,1:-1]


def extract():
    a=np.asarray(Image.open(HERE/'source/membrane_refined_original.png').convert('RGB'),dtype=np.float32)
    n=a.shape[0]
    lum=a.mean(2)
    chroma=gaussian_filter(a[:,:,0]-a[:,:,1],1.05)
    dark=gaussian_filter(lum,15)-gaussian_filter(lum,1.4)
    field=np.maximum(0,chroma-gaussian_filter(chroma,24))
    mask=(field>0.45)&(dark>1.25)
    mask=binary_closing(mask,iterations=1)
    labels,count=label(mask,np.ones((3,3)))
    sizes=np.bincount(labels.ravel()); keep=sizes>100; keep[0]=False
    mask=keep[labels]
    sk=thin(mask)
    # Pixel adjacency: eliminate redundant diagonal links at right-angle turns.
    coords=set(map(tuple,np.argwhere(sk)))
    graph={}
    for y,x in coords:
        nei=[]
        for dy,dx in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
            q=(y+dy,x+dx)
            if q not in coords: continue
            if dy and dx and ((y+dy,x) in coords or (y,x+dx) in coords): continue
            nei.append(q)
        graph[(y,x)]=nei
    # Repeatedly remove tiny terminal spurs created by the source's raster noise.
    for _ in range(6):
        remove=set()
        for start,nei in graph.items():
            if len(nei)!=1: continue
            path=[start];prev=start;cur=nei[0]
            while len(graph[cur])==2 and len(path)<20:
                path.append(cur);nxt=[q for q in graph[cur] if q!=prev][0];prev,cur=cur,nxt
            if len(path)<16: remove.update(path)
        if not remove: break
        graph={p:[q for q in ns if q not in remove] for p,ns in graph.items() if p not in remove}
    visited=set(); paths=[]
    nodes=[p for p,ns in graph.items() if len(ns)!=2]
    radius=distance_transform_edt(mask)
    def key(a,b): return tuple(sorted((a,b)))
    for start in sorted(nodes):
        for q in graph[start]:
            if key(start,q) in visited: continue
            pts=[start,q];visited.add(key(start,q));prev,cur=start,q
            while len(graph[cur])==2:
                nxt=[v for v in graph[cur] if v!=prev][0]
                if key(cur,nxt) in visited: break
                visited.add(key(cur,nxt));pts.append(nxt);prev,cur=cur,nxt
            if len(pts)<2: continue
            pix=np.asarray(pts)
            # Preserve bends; 2 source-pixel smoothing only removes stair-steps.
            smooth=gaussian_filter1d(pix.astype(np.float32),2.,axis=0,mode='nearest')
            smooth[0]=pix[0];smooth[-1]=pix[-1]
            width=gaussian_filter1d(np.clip(.40+.48*radius[pix[:,0],pix[:,1]],.5,2.8),7)
            strength=gaussian_filter1d(np.clip(field[pix[:,0],pix[:,1]]/4.0,.32,1),7)
            indices=np.unique(np.r_[np.arange(0,len(pts),3),len(pts)-1])
            points=smooth[indices,::-1]/(n-1)
            # Natural terminal branches fade into skin, including border endpoints.
            start_terminal=len(graph[start])==1
            end_terminal=len(graph[cur])==1
            paths.append(dict(points=points.round(7).tolist(),width=float(width[0]),end=float(width[-1]),
                  widths_mm=width[indices].round(4).tolist(),strengths=strength[indices].round(4).tolist(),
                  strength=float(strength.mean()),kind='painted_vessel',root=False,
                  start_node=list(map(int,start)),end_node=list(map(int,cur)),start_terminal=start_terminal,end_terminal=end_terminal))
    # Contract raster-scale junction clusters and tiny triangle artifacts.
    parent={}
    def find(k):
        parent.setdefault(k,k)
        if parent[k]!=k: parent[k]=find(parent[k])
        return parent[k]
    for p in paths:
        a0,b0=tuple(p['start_node']),tuple(p['end_node'])
        if len(p['points'])<5:
            a0,b0=find(a0),find(b0);parent[b0]=a0
    merged={}
    for k in list(parent): merged.setdefault(find(k),[]).append(k)
    centres={k:np.mean(v,axis=0) for k,v in merged.items()}
    cleaned=[]
    for p in paths:
        a0,b0=find(tuple(p['start_node'])),find(tuple(p['end_node']))
        if a0==b0: continue
        p['start_node']=list(a0);p['end_node']=list(b0)
        pts=np.asarray(p['points']);pts[0]=np.asarray(centres.get(a0,a0))[::-1]/(n-1)
        pts[-1]=np.asarray(centres.get(b0,b0))[::-1]/(n-1)
        p['points']=pts.round(7).tolist();cleaned.append(p)
    paths=cleaned
    # Any 4-way junction in the painted extraction is an artifact: drop its
    # weakest connected edge, keeping a planar Y rather than a vessel crossing.
    for _ in range(8):
        incident={}
        for i,p in enumerate(paths):
            for side in ['start_node','end_node']: incident.setdefault(tuple(p[side]),[]).append(i)
        bad=[v for v in incident.values() if len(v)>3]
        if not bad: break
        remove={min(v,key=lambda i:paths[i]['strength']*len(paths[i]['points'])) for v in bad}
        paths=[p for i,p in enumerate(paths) if i not in remove]
    # Small isolated source fragments are not blood vessels. Keep components
    # with substantial branching or length, rather than detached hair marks.
    incident={}
    for i,p in enumerate(paths):
        for side in ['start_node','end_node']: incident.setdefault(tuple(p[side]),[]).append(i)
    visited=set(); kept=[]
    for i in range(len(paths)):
        if i in visited: continue
        comp=set(); todo=[i]
        while todo:
            k=todo.pop()
            if k in comp: continue
            comp.add(k)
            for side in ['start_node','end_node']: todo.extend(j for j in incident[tuple(paths[k][side])] if j not in comp)
        visited.update(comp)
        if sum(len(paths[k]['points']) for k in comp)>180:
            kept.extend(paths[k] for k in sorted(comp))
    paths=kept
    incident={}
    for i,p in enumerate(paths):
        for side in ['start_node','end_node']: incident.setdefault(tuple(p[side]),[]).append(i)
    for p in paths:
        p['start_terminal']=len(incident[tuple(p['start_node'])])==1
        p['end_terminal']=len(incident[tuple(p['end_node'])])==1
    # Orient along flow from each component's upper-left root, then enforce
    # continuous taper and a smaller daughter at every bifurcation.
    import heapq
    remaining=set(incident);distance={};node_width={};edge_done=set()
    # Three roots visible in the generated original, each rooted independently:
    # two enter at the top and one at the left. Loops can connect their trees.
    root_targets=[(.036,.01),(.482,.005),(.008,.38)]
    roots=[min(incident,key=lambda q:(q[1]/n-x)**2+(q[0]/n-y)**2) for x,y in root_targets]
    queue=[]
    for root in roots:
        distance[root]=0;node_width[root]=2.8;heapq.heappush(queue,(0,root))
    while remaining:
        if not queue:
            root=min(remaining,key=lambda q:q[0]+q[1]);roots.append(root)
            distance[root]=0;node_width[root]=2.8;heapq.heappush(queue,(0,root))
        while queue:
            dist,node=heapq.heappop(queue)
            if node not in remaining: continue
            remaining.remove(node)
            outgoing=[]
            for i in incident[node]:
                if i in edge_done: continue
                p=paths[i]
                if tuple(p['end_node'])==node:
                    for key in ['points','widths_mm','strengths']: p[key]=p[key][::-1]
                    p['start_node'],p['end_node']=p['end_node'],p['start_node']
                    p['start_terminal'],p['end_terminal']=p['end_terminal'],p['start_terminal']
                outgoing.append(i)
            outgoing.sort(key=lambda i:np.mean(paths[i]['widths_mm'][:5]),reverse=True)
            for rank,i in enumerate(outgoing):
                p=paths[i];pts=np.asarray(p['points'])
                arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(pts,axis=0),axis=1))]
                candidate=np.asarray(p['widths_mm'])
                cap=node_width[node]*(.985 if rank==0 else .72)
                w0=min(cap,float(np.percentile(candidate,70)))
                w1=max(.5,min(w0*.98,float(np.percentile(candidate[-min(5,len(candidate)):],50)),w0*np.exp(-arc[-1]*.55)))
                widths=np.linspace(max(.5,w0),w1,len(pts))
                if p['end_terminal']: widths=np.linspace(max(.5,w0),.5,len(pts))
                p['widths_mm']=widths.round(4).tolist();p['width']=float(widths[0]);p['end']=float(widths[-1])
                p['root']=node in roots
                nxt=tuple(p['end_node']);newdist=dist+float(arc[-1])
                if newdist<distance.get(nxt,1e10):
                    distance[nxt]=newdist;node_width[nxt]=float(widths[-1]);heapq.heappush(queue,(newdist,nxt))
                edge_done.add(i)
    data=dict(units='metres; width, end and widths_mm in millimetres',
       source='membrane_refined_original.png; traced painted centreline geometry, not a procedural tree',
       source_pixels=n,paths=paths,extraction=dict(path_count=len(paths),max_node_degree=max(map(len,incident.values()))))
    (HERE/'source/paths.json').write_text(json.dumps(data,indent=2)+'\n')
    preview=Image.open(HERE/'source/membrane_refined_original.png').convert('RGB')
    draw=ImageDraw.Draw(preview)
    for p in paths: draw.line([(round(x*(n-1)),round(y*(n-1))) for x,y in p['points']],fill=(220,65,50),width=1)
    preview.save(HERE/'checks/painted_vessel_trace.png')
    Image.fromarray((mask*255).astype(np.uint8)).save(HERE/'checks/extraction_mask.png')
    print(data['extraction'])
    return paths

if __name__=='__main__': extract()
