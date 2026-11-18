"""Native finest rider vertex penetration audit, not a continuous collision proof.

Run in Blender after fit.ts. Three-direction parity finds candidates and exact
oriented solid angle confirms them against actual posed hide/plates and saddle.
Contact-sized distances need visual review; this sampled vertex audit does not
certify every edge/triangle, overlapping-part union or slider interval.
"""
import json,sys,numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

folder=Path('var/stego-review')
prefix='rider-outfit'if '--outfits'in sys.argv else'rider'
rows=json.loads((folder/(prefix+'-native-geometry.json')).read_text())
report=[]
directions=[Vector(v).normalized()for v in [(1,.371,.217),(-.319,1,.413),(.271,-.193,1)]]
def inside(tree,point):
    votes=0
    for direction in directions:
        at=point.copy();crossings=0
        for _ in range(128):
            hit,normal,face,distance=tree.ray_cast(at,direction,25)
            if hit is None:break
            crossings+=1;at=hit+direction*.0001
        if crossings%2:votes+=1
    return votes>=2
def winding(triangles,point):
    # Ray hits at an edge can count the same thin piece unevenly. The closed
    # surface's solid angle distinguishes that candidate from a real interior.
    a,b,c=np.moveaxis(triangles-np.array(point),1,0)
    la,lb,lc=[np.linalg.norm(v,axis=1)for v in [a,b,c]]
    numerator=np.einsum('ij,ij->i',a,np.cross(b,c))
    denominator=la*lb*lc+np.einsum('ij,ij->i',a,b)*lc+np.einsum('ij,ij->i',b,c)*la+np.einsum('ij,ij->i',c,a)*lb
    return float(np.sum(2*np.arctan2(numerator,denominator))/(4*np.pi))
for row in rows:
    targets={}
    for mesh in row['meshes']:
        if 'human_' in mesh['id']:continue
        p=mesh['positions'];points=[Vector(p[i:i+3])for i in range(0,len(p),3)]
        ids=mesh['indices'];faces=[ids[i:i+3]for i in range(0,len(ids),3)]
        targets[mesh['id']]=(BVHTree.FromPolygons(points,faces,all_triangles=True),np.array(p).reshape(-1,3)[np.array(faces)])
    groups=[]
    for mesh in row['meshes']:
        if 'human_' not in mesh['id']:continue
        p=mesh['positions'];points=[Vector(p[i:i+3])for i in range(0,len(p),3)]
        for name,(tree,triangles) in targets.items():
            deepest=0.;witness=None;count=0
            for index,point in enumerate(points):
                hit,normal,face,distance=tree.find_nearest(point)
                signed=(point-hit).dot(normal)
                if distance>.004 and inside(tree,point) and abs(winding(triangles,point))>.5:
                    count+=1
                    if distance>deepest:deepest=distance;witness={'vertex':index,'at':list(point),'nearestSurface':list(hit)}
            groups.append({'mesh':mesh['id'],'target':name,'verticesDeeperThan4mm':count,'deepestPenetration':deepest,'witness':witness})
    entry={k:row[k]for k in ['sex','profile','footwear','clip','frame','residual']};entry['groups']=groups;report.append(entry)
    print(row['sex'],row['profile'],row['footwear'],row['clip'],[(g['mesh'].split('/')[-1],g['target'],g['verticesDeeperThan4mm'],round(g['deepestPenetration'],4))for g in groups if g['verticesDeeperThan4mm']],flush=True)
(folder/(prefix+'-clearance.json')).write_text(json.dumps({'scope':__doc__,'samples':report},indent=2)+'\n')
