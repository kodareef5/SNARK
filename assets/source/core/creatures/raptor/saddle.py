"""A fitted field saddle with a quilted liner, low seat, pommel, girth and irons."""
import math
import numpy as np
from parts import Part, join
from plan import AXIS
from rig import bind

A=np.array(AXIS)
SLOTS=[((i+.04)/4,.02,(i+.96)/4,.98) for i in range(4)]
def flank(z,a,offset=0):
    w,low,top=[np.interp(z,A[:,0],A[:,i]) for i in (1,2,3)]
    return ((w+offset)*math.sin(a),(top+low)/2+((top-low)/2+offset)*math.cos(a),z)
def build():
    parts=[]
    def rail(name,coords,r,slot,sides=10):
        part=Part(name,"raptor_saddle","chest")
        parts.append(part.loft([(*v,r,r) for v in coords],sides,SLOTS[slot],2).object())
    def panel(name,zs,widths,profile,slot):
        p=Part(name,"raptor_saddle","chest")
        rows=[]
        for j,(z,w) in enumerate(zip(zs,widths)):
            rows.append([[p.point((w*t,profile(t,z,w,j)+off,z)) for t in np.linspace(-1,1,13)] for off in (0,.020)])
        for j,(a,b) in enumerate(zip(rows,rows[1:])):
            for i in range(12):
                for l in (0,1):
                    inds=[a[l][i],a[l][i+1],b[l][i+1],b[l][i]]
                    p.face(inds,[((slot+.04+.92*x/12)/4,.02+.96*y/(len(rows)-1)) for x,y in ((i,j),(i+1,j),(i+1,j+1),(i,j+1))])
            for i in (0,12): p.face((a[0][i],a[1][i],b[1][i],b[0][i]))
        for a in (rows[0],rows[-1]):
            for i in range(12): p.face((a[0][i],a[0][i+1],a[1][i+1],a[1][i]))
        parts.append(p.object())
    zs=[-.32,-.25,-.12,.01,.16,.25,.31]
    widths=[.122,.193,.227,.230,.201,.171,.110]
    def top(t,z,w,j):
        a=math.asin(min(.998,abs(t*w)/np.interp(z,A[:,0],A[:,1])))
        return flank(z,a,.010)[1]
    panel("quilted blanket",zs,widths,top,3)
    zs=[-.239,-.189,-.12,-.040,.021,.087,.144,.196,.220]
    widths=[.120,.149,.151,.140,.131,.116,.099,.084,.046]
    heights=[1.397,1.412,1.383,1.362,1.354,1.359,1.373,1.392,1.385]
    panel("seat",zs,widths,lambda t,z,w,j: heights[j]-.071*t*t,0)
    for z in (-.15,.19):
        p=Part("girth","raptor_saddle","chest"); rings=[]
        for i in range(48):
            a=math.tau*i/48
            rings.append([p.point(flank(z+shift,a,d)) for d,shift in ((.006,-.018),(.022,-.018),(.022,.018),(.006,.018))])
        for i,row in enumerate(rings):
            other=rings[(i+1)%48]
            for j in range(4):
                k=(j+1)%4
                p.face((row[j],row[k],other[k],other[j]),[(.02,.025),(.21,.025),(.21,.975),(.02,.975)])
        parts.append(p.object())
    for sg in (-1,1):
        rail("seat edging",[(sg*w,heights[i]-.051,z) for i,(z,w) in enumerate(zip(zs,widths))],.013,1)
        for z in (.048,.165):
            rail("stirrup strap",[(sg*.121,1.35,z-.10),(sg*.212,1.27,z-.062),(sg*.266,1.13,z-.018),(sg*.286,.989,z)],.014,0)
        rail("bronze stirrup",[(sg*.286,.995,.048),(sg*.302,.958,.06),(sg*.303,.957,.155),(sg*.286,.995,.165)],.012,2)
    rail("pommel", [(-.104,1.375,.169),(-.100,1.462,.190),(-.067,1.482,.194),(0,1.483,.194),
                      (.067,1.482,.194),(.100,1.462,.190),(.104,1.375,.169)],.017,1)
    saddle=join(parts,"saddle")
    bind(saddle)
if __name__=="__main__": build()
