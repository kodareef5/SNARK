"""Rasterize the supplied round-three geometry; dimensions are millimetres.

The PNG masks define ownership exactly. The JSON rings define the geometric
height. No neighbouring project module is imported or changed.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
N = 2048
MM = 3000 / N


def intersection(a, b, c, d):
    u, v = b-a, d-c
    return a + np.linalg.solve(np.column_stack((u, -v)), c-a)[0]*u


def unbroken_quad(p):
    # Extend the four long sides through the clipped corners.
    return np.array([intersection(p[6],p[7],p[0],p[1]),
                     intersection(p[0],p[1],p[2],p[3]),
                     intersection(p[2],p[3],p[4],p[5]),
                     intersection(p[4],p[5],p[6],p[7])])


def triangle(field, xx, yy, points, values):
    a,b,c = np.asarray(points)
    den = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    u = ((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
    v = ((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den
    w = 1-u-v
    inside = (u>=-1e-6)&(v>=-1e-6)&(w>=-1e-6)
    field[inside] = (u*values[0]+v*values[1]+w*values[2])[inside]


def ring_distance(xx, yy, p):
    best = np.full(xx.shape, 1e8, np.float32)
    along = np.zeros(xx.shape, np.float32)
    cumulative = 0.
    for a,b in zip(p,np.roll(p,-1,axis=0)):
        v = b-a; length = np.linalg.norm(v)
        t = np.clip(((xx-a[0])*v[0]+(yy-a[1])*v[1])/(length*length),0,1)
        d = np.hypot(xx-a[0]-t*v[0],yy-a[1]-t*v[1])
        update = d<best
        best[update] = d[update]
        along[update] = (cumulative+t*length)[update]
        cumulative += length
    return best*MM, along*MM, cumulative*MM


def load_geometry():
    layout = json.loads((ROOT/'layout/layout.json').read_text())
    cells = np.asarray(Image.open(ROOT/'layout/cells.png'))
    faces = np.asarray(Image.open(ROOT/'layout/faces.png'))
    ids = np.zeros((N,N),np.uint8)
    face_ids = np.zeros_like(ids)
    patches = []
    macro = np.zeros((N,N),np.float32)
    for i,s in enumerate(layout['stones']):
        own = np.all(cells==s['id_colour'],axis=-1)
        top = np.all(faces==s['id_colour'],axis=-1)
        ids[own] = i+1; face_ids[top] = i+1
        ys,xs = np.where(own)
        x0,x1,y0,y1 = xs.min(),xs.max()+1,ys.min(),ys.max()+1
        sl = np.s_[y0:y1,x0:x1]
        yy,xx = np.mgrid[y0:y1,x0:x1].astype(np.float32)
        xx += .5; yy += .5
        p = np.asarray(s['footprint_pixels'],np.float64)
        f = np.asarray(s['face_pixels'],np.float64)
        quad = unbroken_quad(p)
        lo,hi = quad.min(0),quad.max(0)
        rises = s['face_rise_mm_at_corners']
        def rise(q):
            u,v = np.clip((np.asarray(q)-lo)/(hi-lo),0,1).T
            return (rises[0]*(1-u)+rises[1]*u)*(1-v)+(rises[3]*(1-u)+rises[2]*u)*v
        hz = rise(f)
        center = (lo+hi)/2
        z = np.zeros(xx.shape,np.float32)
        for k in range(8):
            j=(k+1)%8
            triangle(z,xx,yy,[f[k],f[j],center],[hz[k],hz[j],float(rise(center))])
            triangle(z,xx,yy,[p[k],p[j],f[j]],[0,0,hz[j]])
            triangle(z,xx,yy,[p[k],f[j],f[k]],[0,hz[j],hz[k]])
        df,along,perimeter = ring_distance(xx,yy,p)
        dt,_,_ = ring_distance(xx,yy,f)
        mask,face = own[sl],top[sl]
        # A handful of PNG edge pixels are outside the float polygon due to
        # Pillow's integer raster convention. They are stone ownership with
        # zero geometric rise, never an invented widened joint.
        z[~mask]=0
        macro[sl][mask]=z[mask]
        patches.append(dict(stone=s,index=i,sl=sl,xx=xx,yy=yy,foot=p,ring=f,
                            mask=mask,face=face,df=df,dt=dt,along=along,
                            perimeter=perimeter,geometry=z))
    return layout,ids,face_ids,macro,patches
