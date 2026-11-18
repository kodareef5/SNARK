"""Exact triangle-pair checks after native BVH broad phase.

Run with Blender --background --python tools/trike/intersections.py after fit.ts.
Touching grasp/seat surfaces are reported too; this tool does not waive them.
"""
import json
from collections import Counter
import numpy as np
from mathutils.bvhtree import BVHTree

def mesh_of(mesh):
    p=np.asarray(mesh['positions']).reshape(-1,3)
    f=np.asarray(mesh['indices']).reshape(-1,3)
    return p[f],BVHTree.FromPolygons(p.tolist(),f.tolist(),all_triangles=True,epsilon=0)

def actual_overlap(a,b):
    # Triangle separating axes, including in-plane edge normals for coplanar
    # pairs. Zero-length axes cannot separate. Contact tolerance is0.1mm.
    ea=np.roll(a,-1,axis=0)-a;eb=np.roll(b,-1,axis=0)-b
    na=np.cross(ea[0],ea[1]);nb=np.cross(eb[0],eb[1])
    axes=np.concatenate(([na,nb],np.cross(ea[:,None,:],eb[None,:,:]).reshape(-1,3),np.cross(na,ea),np.cross(nb,eb)))
    size=np.linalg.norm(axes,axis=1);axes=axes[size>1e-10]/size[size>1e-10,None]
    pa=a@axes.T;pb=b@axes.T
    return bool(np.all(np.minimum(pa.max(0),pb.max(0))-np.maximum(pa.min(0),pb.min(0))>=-.0001))

# AABB overlap alone must not count disjoint coplanar triangles as collision.
assert not actual_overlap(np.array([[0.,0,0],[1,0,0],[0,1,0]]),np.array([[1.,1,0],[.6,1,0],[1,.6,0]]))
assert actual_overlap(np.array([[0.,0,0],[1,0,0],[0,1,0]]),np.array([[.2,.2,-1],[.2,.2,1],[.4,.4,0]]))

out=[]
components={p['name']:BVHTree.FromPolygons(p['points'],p['faces'],epsilon=0) for p in json.load(open('var/trike-art/saddle-components.json'))}
for row in json.load(open('var/trike-art/rider-native-geometry.json')):
    subjects={m['id']:mesh_of(m) for m in row['meshes']}
    entry={k:row[k] for k in ['sex','profile','outfit','clip','frame']};entry['contacts']=[]
    for obstacle in ['core:trike','core:saddle_trike/worn']:
        other,tree=subjects[obstacle]
        for name,(triangles,bvh) in subjects.items():
            if 'human_' not in name:continue
            actual=[]
            for a,b in tree.overlap(bvh):
                if actual_overlap(other[a],triangles[b]):actual.append((a,b))
            if actual:
                points=np.concatenate([triangles[b] for _,b in actual])
                labels=Counter();part_points={}
                if obstacle=='core:saddle_trike/worn':
                    # Invert the actual rigid chest/seat transform, including
                    # walk and charge pitch, to identify each source member.
                    frame=np.asarray(row['seatFrame']);turn=frame[3:].reshape(3,3)
                    for a,b in actual:
                        point=(other[a].mean(0)-frame[:3])@turn+np.array([0,2.975-.55,-.25])
                        label=min(components,key=lambda k:components[k].find_nearest(point)[3]);labels[label]+=1
                        part_points.setdefault(label,[]).append(point)
                bounds={k:[np.min(v,axis=0).tolist(),np.max(v,axis=0).tolist()] for k,v in part_points.items()}
                entry['contacts'].append({'obstacle':obstacle,'human':name,'pairs':len(actual),'bounds':[points.min(0).tolist(),points.max(0).tolist()],'first_pairs':actual[:12],'source_parts':dict(labels),'part_centroid_bounds':bounds})
    print(entry['sex'],entry['profile'],entry['outfit'],entry['clip'],[(c['human'].split('/')[-1],c['obstacle'],c['pairs']) for c in entry['contacts']])
    out.append(entry)
json.dump({'scope':'Native finest exact triangle intersections at 60 rendered poses: two sexes, two extreme looks, bare/cloth/hide outfits, five animations. Hands/seat/support contact is reported, not automatically waived. Does not cover unrendered poses or creator intervals.','samples':out},open('var/trike-art/rider-intersections.json','w'),indent=2)
