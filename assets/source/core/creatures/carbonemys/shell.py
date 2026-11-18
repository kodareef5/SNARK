"""An interlocking carapace, marginal lip, bridges and a separate ventral scute field."""
import math
from layout import SCUTES, carapace

def clip(poly,nx,nz,k):
    out=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        da=nx*a[0]+nz*a[1]-k;db=nx*b[0]+nz*b[1]-k
        if da<=1e-8:out.append(a)
        if (da<0)!=(db<0):
            t=da/(da-db);out.append((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))
    return out

def make_cells():
    circle=[(math.sin(2*math.pi*i/96),math.cos(2*math.pi*i/96))for i in range(96)]
    cells=[]
    for i,(x,z,kind,j) in enumerate(SCUTES):
        poly=circle[:]
        for k,(xx,zz,_,_) in enumerate(SCUTES):
            if i==k:continue
            # The metric is in metres: wide costal shields share long sloping seams.
            gx=(xx-x)*.85;gz=(zz-z)
            poly=clip(poly,gx,gz,(gx*(x+xx)+gz*(z+zz))*.5)
        # Clipping through a circle vertex can emit that corner twice.
        poly=[a for n,a in enumerate(poly) if math.dist(a,poly[n-1])>1e-7]
        if len(poly)<3:continue
        cx=sum(q[0] for q in poly)/len(poly);cz=sum(q[1] for q in poly)/len(poly)
        center=(.65*x+.35*cx,.55*z+.45*cz-.034*(kind!='marginal'))
        cells.append((center,poly,kind,j))
    return cells
CELLS=make_cells()

def scute_raise(kind,j,t,x,z):
    # Concentrate the oldest growth off centre, with a worn bevel around the foot.
    peak=({'spinal':.211,'costal':.176,'marginal':.071}[kind])*(1+.18*math.sin(2.7*j+x*3))
    if kind=='spinal' and j in [2,3]:peak*=.58 if j==2 else .81
    return peak*(1-t)**1.18+.025*math.sin(math.pi*t)**.85

def top_uv(x,z):return (.02+.48*(x+1),.52+.232*(z+1))
def under_uv(x,z):return (.02+.48*(x+1),.015+.19*(z+1))

def shell_weight(x):
    return 'shell_l' if x>.49 else 'shell_r' if x<-.49 else 'shell'

def build(s):
    shared={};locations={};edge_uses={}
    for center,poly,kind,j in CELLS:
        cx,cz=center;edge=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            steps=max(1,round(math.dist(a,b)/.074))
            for h in range(steps):
                t=h/steps;edge.append((a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t))
        X,Y,Z=carapace(cx,cz)
        apex=s.v((X,Y+scute_raise(kind,j,0,cx,cz),Z),shell_weight(cx))
        previous=None
        for t in [.14,.34,.57,.78,.925,1.]:
            rings=[];uvs=[]
            for ex,ez in edge:
                x=(1-t)*cx+t*ex;z=(1-t)*cz+t*ez;k=(round(x,7),round(z,7))
                X,Y,Z=carapace(x,z)
                if t==1 and k in shared:v=shared[k]
                else:
                    v=s.v((X,Y+scute_raise(kind,j,t,x,z),Z),shell_weight(x))
                    if t==1:
                        shared[k]=v
                        locations[v]=(x,z,v)
                rings.append(v);uvs.append(top_uv(x,z))
            for q in range(len(edge)):
                r=(q+1)%len(edge)
                if previous is None:s.f([apex,rings[q],rings[r]],[top_uv(cx,cz),uvs[q],uvs[r]],0)
                else:s.f([old[q],rings[q],rings[r],old[r]],[old_uv[q],uvs[q],uvs[r],old_uv[r]],0)
                if t==1:
                    k=tuple(sorted((rings[q],rings[r])));edge_uses[k]=edge_uses.get(k,0)+1
            previous=True;old=rings;old_uv=uvs
    border={v for edge,count in edge_uses.items() if count==1 for v in edge}
    exterior=[locations[v] for v in border]
    exterior.sort(key=lambda q:math.atan2(q[0],q[1]));n=len(exterior)
    old=[q[2] for q in exterior]
    # The rolled perimeter flares toward the trailing edge. It folds into a
    # thinner bridge above the feet, leaving the darker skin visible below.
    for j,(rad,drop) in enumerate([(1.020,.036),(1.014,.078),(.982,.112),(.88,.145),(.73,.23),(.48,.31),(.18,.335)]):
        vs=[];uv=[]
        for x,z,_ in exterior:
            X,Y,Z=carapace(x,z)
            scallop=.011*math.cos(24*math.atan2(x,z))*(1-.27*z)
            vs.append(s.v((X*rad,Y-drop+scallop*(j<3),-.075+(Z+.075)*rad),'plastron' if j>=3 else shell_weight(x)))
            uv.append(under_uv(x*rad,z*rad))
        for q in range(n):
            k=(q+1)%n
            if j<3:
                ringuv=lambda u,v:(.012+.976*u,.418+.067*v)
                coords=[ringuv(q/n,j/3),ringuv((q+1)/n,j/3),ringuv((q+1)/n,(j+1)/3),ringuv(q/n,(j+1)/3)]
            else:coords=[prev_uv[q],prev_uv[k],uv[k],uv[q]]
            s.f([old[k],old[q],vs[q],vs[k]],[coords[i] for i in [1,0,3,2]],0)
        old=vs;prev_uv=uv
    center=s.v((0,.445,-.075),'plastron')
    for q in range(n):
        k=(q+1)%n;s.f([old[k],old[q],center],[prev_uv[k],prev_uv[q],under_uv(0,0)],0)

def roof(x,z):
    nz=(z+.075)/1.70;nx=x/(1.245*(1-.083*nz-.04*nz*nz))
    X,Y,Z=carapace(nx,nz)
    for (cx,cz),poly,kind,j in CELLS:
        share=0.
        for a,b in zip(poly,poly[1:]+poly[:1]):
            ex=b[0]-a[0];ez=b[1]-a[1];den=ex*(a[1]-cz)-ez*(a[0]-cx)
            if abs(den)>1e-8:share=max(share,(ex*(nz-cz)-ez*(nx-cx))/den)
        if share<=1.000001:return Y+scute_raise(kind,j,min(1.,share),nx,nz)
    return Y
