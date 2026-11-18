"""Report distinct physical surfaces painted into the same native source chart.

Mirroring left/right is deliberate, so compare absolute X. This diagnoses
projection collisions; it is not a replacement for the native texture review.
"""
import json
from pathlib import Path
import numpy as np

root=Path(__file__).resolve().parents[2]
data=np.load(root/'var/trike-art/layout.npz')
meta=json.loads((root/'var/trike-art/layout.json').read_text())
size=512
charts={name:(np.zeros((size,size,3),np.float32),np.full((size,size),-1,np.int32))
        for name in ('trike_skin','trike_frill')}
errors=[]
for index,(tri,uv,material) in enumerate(zip(data['triangles'],data['uvs'],data['materials'])):
    name=meta['materials'][material]
    if name not in charts:continue
    xyz,owner=charts[name]
    chart=uv.copy()*size;chart[:,1]=size-chart[:,1]
    lo=np.maximum(0,np.floor(chart.min(axis=0)).astype(int));hi=np.minimum(size,np.ceil(chart.max(axis=0)).astype(int)+1)
    x0,y0=lo;x1,y1=hi
    if x1<=x0 or y1<=y0:continue
    a,b,c=chart
    det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    if abs(det)<1e-8:continue
    y,x=np.mgrid[y0:y1,x0:x1];x=x+.5;y=y+.5
    w0=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det
    w1=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det;w2=1-w0-w1
    mask=(w0>=-.0001)&(w1>=-.0001)&(w2>=-.0001)
    p=data['points'][tri]
    points=w0[...,None]*p[0]+w1[...,None]*p[1]+w2[...,None]*p[2]
    points[...,0]=abs(points[...,0])
    old=owner[y0:y1,x0:x1]
    overlap=mask&(old>=0)
    distance=np.linalg.norm(points-xyz[y0:y1,x0:x1],axis=-1)
    for yy,xx in zip(*np.where(overlap&(distance>.04))):
        errors.append({'material':name,'distance_m':float(distance[yy,xx]),'triangles':[int(old[yy,xx]),index],
                       'points':[xyz[y0+yy,x0+xx].tolist(),points[yy,xx].tolist()]})
    xyz[y0:y1,x0:x1][mask]=points[mask];old[mask]=index
errors.sort(key=lambda e:e['distance_m'],reverse=True)
report={'geometry_sha256':meta['geometry_sha256'],'grid':size,
        'scope':'Physical aliasing at 512px texel centres, with deliberate X mirroring. Reports separations above 4cm; inspect native imagery for smaller visible seams.',
        'by_material':{name:{'samples':sum(e['material']==name for e in errors),
                             'maximum_m':max((e['distance_m'] for e in errors if e['material']==name),default=0)}
                       for name in charts},
        'samples_above_4cm':len(errors),'worst':errors[:30]}
(root/'var/trike-art/uv-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
