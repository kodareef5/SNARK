"""Actual native vertex clearance from the upper hide; a sampled audit, not interval proof."""
import json
import numpy as np
from collections import defaultdict

rows=json.load(open('var/trike-art/rider-native-geometry.json'))
report=[];supports=[]
for row in rows:
    body=next(m for m in row['meshes'] if m['id']=='core:trike')
    points=np.asarray(body['positions']).reshape(-1,3)
    triangles=points[np.asarray(body['indices']).reshape(-1,3)]
    bins=defaultdict(list);step=.12
    for k,t in enumerate(triangles):
        lo=np.floor(t[:,[0,2]].min(0)/step).astype(int);hi=np.floor(t[:,[0,2]].max(0)/step).astype(int)
        for x in range(lo[0],hi[0]+1):
            for z in range(lo[1],hi[1]+1):bins[x,z].append(k)
    groups=[]
    for mesh in row['meshes']:
        if 'human_' not in mesh['id']:continue
        p=np.asarray(mesh['positions']).reshape(-1,3);worst=float('inf');witness=None
        for v,(x,y,z) in enumerate(p):
            ids=bins[int(np.floor(x/step)),int(np.floor(z/step))]
            if not ids:continue
            t=triangles[ids];a,b,c=t[:,0],t[:,1],t[:,2]
            det=(b[:,2]-c[:,2])*(a[:,0]-c[:,0])+(c[:,0]-b[:,0])*(a[:,2]-c[:,2]);good=abs(det)>1e-9
            t=t[good];a,b,c=a[good],b[good],c[good];det=det[good]
            w0=((b[:,2]-c[:,2])*(x-c[:,0])+(c[:,0]-b[:,0])*(z-c[:,2]))/det
            w1=((c[:,2]-a[:,2])*(x-c[:,0])+(a[:,0]-c[:,0])*(z-c[:,2]))/det;w2=1-w0-w1
            valid=(w0>=-1e-8)&(w1>=-1e-8)&(w2>=-1e-8)
            heights=(w0*a[:,1]+w1*b[:,1]+w2*c[:,1])[valid]
            if not len(heights):continue
            gap=y-heights.max()
            if gap<worst:worst=float(gap);witness={'vertex':v,'at':[float(x),float(y),float(z)],'hide':float(heights.max())}
        groups.append({'mesh':mesh['id'],'minimum_vertical_clearance':None if np.isinf(worst) else worst,'witness':witness})
    entry={k:row[k] for k in ['sex','profile','outfit','clip','frame','residual']};entry['groups']=groups;report.append(entry)
    if 'targets' in row:
        frame=np.asarray(row['seatFrame']);turn=frame[3:].reshape(3,3)
        saddle=next(m for m in row['meshes'] if m['id']=='core:saddle_trike/worn')
        plate=(np.asarray(saddle['positions']).reshape(-1,3)-frame[:3])@turn
        feet=next(m for m in row['meshes'] if 'human_' in m['id'] and m['id'].endswith('/feet'))
        foot=(np.asarray(feet['positions']).reshape(-1,3)-frame[:3])@turn
        for side in range(2):
            at=19+side*3;centre=np.asarray(row['targets'][at:at+3]);half=np.asarray(row['targets'][25:27])
            candidates=plate[(abs(plate[:,0]-centre[0])<half[0]+.001)&(abs(plate[:,2]-centre[2])<half[1]+.001)&(abs(plate[:,1]-centre[1])<.003)]
            if not len(candidates):raise RuntimeError('No native physical plate top at the authored sole socket')
            top=float(np.median(candidates[:,1]));own=foot[foot[:,0]*(1 if side==0 else -1)>0]
            witness=own[np.argmin(own[:,1])];delta=abs(witness[[0,2]]-centre[[0,2]])
            supports.append({**{k:row[k] for k in ['sex','profile','outfit','clip','frame']},'side':side,
                'native_plate_top':top,'plate_coplanarity':float(np.ptp(candidates[:,1])),
                'minimum_foot_clearance':float(witness[1]-top),'witness_in_seat_frame':witness.tolist(),
                'rectangle_margin':float(np.min(half-delta)),
                # The source tread has3cm clipped corners, not a whole rectangle.
                'beveled_corner_margin':float(half.sum()-.03-delta.sum())})
    print(row['sex'],row['profile'],row['outfit'],row['clip'],[(x['mesh'].split('/')[-1],round(x['minimum_vertical_clearance'],3) if x['minimum_vertical_clearance'] is not None else None) for x in groups])
json.dump({'scope':'Native finest bare/cloth/hide human vertices above the actual posed Trike upper hide, 4 extreme looks x3 outfits x5 poses. Does not certify triangle/triangle collision, platform contact, or all creator intervals.','samples':report},open('var/trike-art/rider-clearance.json','w'),indent=2)
json.dump({'scope':'Actual native finest foot/boot minimum against the quantized finite plate top, in the exact posed seat frame. Signed separation includes native pack rounding; negative means penetration. Both complete foot pieces include cuffs/calves.','samples':supports},open('var/trike-art/rider-support-contact.json','w'),indent=2)
