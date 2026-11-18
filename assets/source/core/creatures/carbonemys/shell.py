"""An interlocking carapace, marginal lip, bridges and a separate ventral scute field."""
import math
from layout import SCUTES, carapace, shell_parameters, smooth

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
        # Each scute grew from a displaced nucleus. The costal keels cant
        # outward; the vertebral crest falls abruptly at its trailing end.
        if kind=='spinal':
            center=(.48*x+.52*cx+.023*math.sin(j*1.6),.50*z+.50*cz-.095)
        elif kind=='costal':
            center=(.51*x+.49*cx+.067*(1 if x>0 else -1),.52*z+.48*cz-.085)
        else:
            center=(.43*x+.57*cx,.43*z+.57*cz)
        cells.append((center,poly,kind,j))
    return cells
CELLS=make_cells()

RIDGES={(kind,j,0 if kind!='costal' else (1 if p[0]>0 else -1)):p for p,_,kind,j in CELLS}

def scute_raise(kind,j,t,x,z):
    side=(1 if x>0 else -1) if kind=='costal' else 0
    cx,cz=RIDGES[(kind,j,side)]
    if kind=='marginal':
        return (.035+.070*smooth(.1,.89,-z))*(1-t)**1.3
    dz=z-cz
    if kind=='spinal':
        height=[.081,.126,.101,.062,.059][j]
        skew=.15+.11*math.sin(j*2.12)
        width=.154+.020*math.cos(j*1.73)
        length=.252+.033*math.sin(j*1.57)
    else:
        height=[.071,.097,.068,.049][j]*(1+.096*math.sin(j*2.26+3*side))
        skew=-side*(.61+.23*math.sin(j*2.31))
        width=.14+.015*math.cos(j+side)
        length=.235
    # The high shoulder carries along the shell, then fans into the neighbouring
    # shields. A blunt, abraded crown merges gradually with its buttress.
    cross=(x-cx)-skew*dz-.018*math.sin(dz*9)
    shoulder=math.exp(-(abs(cross)/(width if cross>=0 else width*1.22))**2.1)
    along=math.exp(-((dz-.014)/length)**4)
    seat=1-smooth(.40,.92,t)
    wear=.83+.17*math.sin(3.3*j+side+dz*9)**2
    return .026*(1-t)**1.4 + height*shoulder*along*seat*wear+.012*math.sin(math.pi*t)

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
    for j,(rad,drop) in enumerate([(1.018,.029),(1.008,.062),(.964,.105),(.86,.151),(.70,.236),(.46,.304),(.18,.330)]):
        vs=[];uv=[]
        for x,z,_ in exterior:
            X,Y,Z=carapace(x,z)
            scallop=.011*math.cos(24*math.atan2(x,z))*(1-.27*z)
            neck=smooth(.64,.91,z)*math.exp(-(x/.39)**4)
            # The raised dorsal rim turns inward above the neck. A lower gular
            # lobe projects from the plastron with space between the lips.
            front=[0,0,.035,.230,.395,.150,.018][j]*neck
            gular=[0,0,0,0,0,.43,.23][j]*neck
            py=(Y-drop if j<3 else .79+.035*z-drop)+scallop*(j<3)
            vs.append(s.v((X*rad,py,-.075+(Z+.075)*rad-front+gular),'plastron' if j>=3 else shell_weight(x)))
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
    nx,nz=shell_parameters(x,z)
    X,Y,Z=carapace(nx,nz)
    for (cx,cz),poly,kind,j in CELLS:
        share=0.
        for a,b in zip(poly,poly[1:]+poly[:1]):
            ex=b[0]-a[0];ez=b[1]-a[1];den=ex*(a[1]-cz)-ez*(a[0]-cx)
            if abs(den)>1e-8:share=max(share,(ex*(nz-cz)-ez*(nx-cx))/den)
        if share<=1.000001:return Y+scute_raise(kind,j,min(1.,share),nx,nz)
    return Y
