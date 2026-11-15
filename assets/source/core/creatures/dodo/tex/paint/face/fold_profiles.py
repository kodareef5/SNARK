"""Give the placed study folds broad fleshy crowns at their physical width.
The accepted crease curves, pigment and fine-skin substrate are retained;
three broad eye rolls replace four narrow-crowned rolls in the same envelope.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter,map_coordinates

MM_PX=205/2048
EYE_WIDTHS=[4.2,4.1,4.0]
EYE_HEIGHTS=[3.20,2.85,2.55]
EYE_PITCH=4.7
MOUTH_WIDTH=4.6
MOUTH_HEIGHT=3.1


def smooth(x):
    t=np.clip(x,0,1);return t*t*(3-2*t)


def bezier(c,t):
    t=t[:,None];return (1-t)**3*c[0]+3*(1-t)**2*t*c[1]+3*(1-t)*t*t*c[2]+t**3*c[3]


def field(shape,curve,width,height,depth,side):
    yy,xx=np.indices(shape);q=np.column_stack([xx.ravel(),yy.ravel()])
    distance,k=cKDTree(curve).query(q,workers=1)
    tangent=np.gradient(curve,axis=0);tangent/=np.linalg.norm(tangent,axis=1)[:,None]
    right=np.column_stack([-tangent[:,1],tangent[:,0]])
    sign=np.sign(((q-curve[k])*right[k]).sum(1))
    d=(side*distance*sign*MM_PX).reshape(shape)
    t=(k/(len(curve)-1)).reshape(shape)
    end=smooth(t/(.10 if side<0 else .20))*smooth((1-t)/(.10 if side<0 else .20))
    # The inner lip rises out of its crease; the outer shoulder settles into
    # the cheek. A closed circular cap makes an isolated cord with two edges.
    radius=width/2
    centre=width*.40
    inner=np.sin(np.clip(d/centre,0,1)*np.pi/2)
    outer=np.exp(-.5*((d-centre)/(width*.52))**2)
    cap=np.where(d<centre,inner,outer)
    cap=gaussian_filter(cap,.25/MM_PX)
    crease=np.exp(-(d/.30)**2)
    relief=(height*cap-depth*crease)*end
    ink=(-.19*crease+.032*cap)*end
    alpha=smooth((width*1.9-abs(d-radius))/(width*.7))*smooth(t/.07)*smooth((1-t)/.10)
    return relief,ink,alpha,crease*end


def remake(src,study):
    meta=json.loads((study/'study.json').read_text())
    paths=[study/meta['folds_reference_skin'][k] for k in ('height','base')]
    plain_h=(np.asarray(Image.open(paths[0]),np.float32)/65535-.5)*8
    b=np.asarray(Image.open(paths[1]),np.float32)[...,0]/255
    plain_b=np.where(b<=.04045,b/12.92,((b+.055)/1.055)**2.4)
    patches=[]
    angle=np.linspace(np.pi-.18,.18,650)
    curves=[]
    for i,(width,height) in enumerate(zip(EYE_WIDTHS,EYE_HEIGHTS)):
        curve=np.column_stack([384+(107+i*10)*np.cos(angle),200+(42+i*EYE_PITCH/MM_PX)*np.sin(angle)])
        curves.append((curve,width,height,[.80,.74,.68][i],1))
    patches.append(([80,80,848,848],curves))
    curve=bezier(np.array([[275,270],[424,250],[422,405],[342,414]]),np.linspace(0,1,650))
    patches.append(([1120,80,1888,848],[(curve,MOUTH_WIDTH,MOUTH_HEIGHT,.90,-1)]))
    for (x0,y0,x1,y1),curves in patches:
        shape=(y1-y0,x1-x0);positive=np.zeros(shape);negative=np.zeros(shape);ink=np.zeros(shape);alpha=np.zeros(shape);crease=np.zeros(shape)
        for curve,width,height,depth,side in curves:
            h,b,a,c=field(shape,curve,width,height,depth,side)
            positive=np.maximum(positive,np.maximum(h,0));negative=np.minimum(negative,np.minimum(h,0))
            ink+=b;alpha=np.maximum(alpha,a);crease=np.maximum(crease,c)
        yy,xx=np.indices(shape,dtype=np.float32)
        border=np.minimum.reduce([xx,yy,shape[1]-1-xx,shape[0]-1-yy]);envelope=smooth((border-12)/28)
        alpha=gaussian_filter(alpha,4)*envelope
        relief=gaussian_filter(positive+negative,.18/MM_PX)*envelope
        crease=smooth(crease)*envelope
        def grain(a,frequency):return map_coordinates(a,[(yy+y0)*frequency,(xx+x0)*frequency],order=1,mode='grid-wrap')
        micro=grain(plain_h,1.15)*(1-crease)+grain(plain_h,1.9)*.40*crease
        pigment=grain(plain_b,1.15)*(1-crease)+(.5+(grain(plain_b,1.9)-.5)*.5)*crease
        # The overlay is a complete skin patch; surrounding accepted fields and
        # the standalone cheek are untouched. No directional light is in base.
        src['height'][y0:y1,x0:x1]=plain_h[y0:y1,x0:x1]*(1-alpha)+micro*.68*alpha+relief
        src['base'][y0:y1,x0:x1]=plain_b[y0:y1,x0:x1]*(1-alpha)+(.5+(pigment-.5)*.75)*alpha+ink*envelope
        src['alpha'][y0:y1,x0:x1]=alpha
    return paths
