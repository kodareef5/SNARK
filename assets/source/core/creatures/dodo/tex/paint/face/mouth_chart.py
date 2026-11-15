"""Place the accepted mouth crescent along the visible gape and jowl surface."""
import numpy as np
from scipy.spatial import cKDTree
from scipy.interpolate import CubicSpline
from scipy.ndimage import gaussian_filter1d


def unit(a):return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-12)


def bezier(control,t):
    t=np.asarray(t)[:,None]
    return (1-t)**3*control[0]+3*(1-t)**2*t*control[1]+3*(1-t)*t*t*control[2]+t**3*control[3]


# Y,Z millimetres: begin inside the gape, turn back and down, then soften
# forward into the lower jowl. X and the local normal come from the bake.
TARGET_YZ=np.array([[547.,214.2],[548.,205.],[539.,200.],[533.,205.]])
SOURCE_PX=np.array([[1395.,350.],[1544.,330.],[1542.,485.],[1462.,494.]])


def build(points,normals):
    t=np.linspace(0,1,501)
    yz=bezier(TARGET_YZ,t)
    distance,ix=cKDTree(points[:,1:]).query(yz,k=12)
    w=1/np.maximum(distance,.04)**3;w/=w.sum(1)[:,None]
    x=(points[ix,0]*w).sum(1)
    n=unit((normals[ix]*w[...,None]).sum(1))
    x=gaussian_filter1d(x,3,mode='nearest')
    n=unit(gaussian_filter1d(n,4,axis=0,mode='nearest'))
    curve=np.column_stack([x,yz])
    return dict(curve=CubicSpline(t,curve),normal=CubicSpline(t,n),
                tree=cKDTree(curve),source=CubicSpline(t,bezier(SOURCE_PX,t)),
                length_mm=float(np.linalg.norm(np.diff(curve,axis=0),axis=1).sum()))


def coordinates(p,chart):
    _,ix=chart['tree'].query(p,workers=1)
    t=ix/500
    for _ in range(2):
        c=chart['curve'](t);d=chart['curve'](t,1)
        t=np.clip(t+np.sum((p-c)*d,axis=1)/np.sum(d*d,axis=1),0,1)
    c=chart['curve'](t);tangent=unit(chart['curve'](t,1))
    right=unit(np.cross(tangent,unit(chart['normal'](t))))
    delta=p-c
    across=np.sum(delta*right,axis=1)
    along=np.sum(delta*tangent,axis=1)
    source=chart['source'](t);st=unit(chart['source'](t,1))
    sr=np.column_stack([-st[:,1],st[:,0]])
    source+=(across[:,None]*sr+along[:,None]*st)*(2048/205)
    radius=np.linalg.norm(delta,axis=1)
    fade=np.clip((14-radius)/4,0,1);fade=fade*fade*(3-2*fade)
    return (source[:,0]-1468)*(205/2048),(source[:,1]-440)*(205/2048),fade
