"""Compact trail saddle, shaped to the Parasaur's ribs and short withers."""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector
from sculpt import Sculpt, material, skin, split_uv_signs
from plan import AXIS, interpolate

PROFILE=interpolate(AXIS,8)
def back(z,x):
    w,low,hi=[np.interp(z,PROFILE[:,0],PROFILE[:,i]) for i in range(1,4)]
    return (low+hi)/2+(hi-low)/2*max(0,1-(x/w)**2)**.49

class Tack(Sculpt):
    def __init__(self):
        super().__init__()
        self.tags=[]
    def part(self,rows,tag):
        start=len(self.f);self.rings(rows);self.tags.extend([tag]*(len(self.f)-start))
    def tube(self,points,radii,tag,n=10):
        vectors=[Vector(p) for p in points]
        rows=[]
        previous=None
        for i,(p,r) in enumerate(zip(vectors,radii)):
            axis=(vectors[min(len(points)-1,i+1)]-vectors[max(i-1,0)]).normalized()
            ref=Vector((0,1,0)) if abs(axis.y)<.85 else Vector((0,0,1))
            u=axis.cross(ref).normalized() if previous is None else (previous-axis*previous.dot(axis)).normalized()
            v=axis.cross(u).normalized();previous=u
            rows.append([tuple(p+r*(u*math.cos(j*math.tau/n)+v*math.sin(j*math.tau/n))) for j in range(n)])
        self.part(rows,tag)
    def leather(self,zfront,zback,width,raise_by,depth,tag):
        rows=[]
        for t in np.linspace(0,1,23):
            z=zback+(zfront-zback)*t
            w=width*(.91+.09*math.sin(math.pi*t))*(1-.21*math.exp(-((t-.72)/.2)**2))
            row=[]
            for a in np.arange(36)*math.tau/36:
                x=w*math.cos(a)
                h=back(z,x)+raise_by(t,x/w)+depth*math.sin(a)
                row.append((x,h,z))
            rows.append(row)
        self.part(rows,tag)
    def ribbon(self,pts,width,thick,tag):
        rows=[]
        for x,h,z in pts:
            rows.append([(x+math.copysign(thick,x)*math.cos(a),h+.009*math.cos(a),z+width*math.sin(a)) for a in np.arange(12)*math.tau/12])
        self.part(rows,tag)

def build():
    m=Tack()
    m.leather(1.139,.03,.455,lambda t,u:.050,.022,0)
    m.leather(1.035,.205,.354,lambda t,u:.105+.103*(abs(2*t-1)**2)-.030*u*u,.040,1)
    # Curved cantle and pommel span the saddle tree; their edges taper to flaps.
    for z,h in [(.235,.196),(.994,.157)]:
        pts=[(x,back(z,x)+h+.07*(1-(x/.356)**2),z) for x in np.linspace(-.355,.355,23)]
        m.tube(pts,[.035+.017*math.sin(math.pi*t) for t in np.linspace(0,1,len(pts))],2)
    for z in [.290,.916]:
        # Continuous load-bearing girth wrapping under the sternum.
        w,low,hi=[np.interp(z,PROFILE[:,0],PROFILE[:,i]) for i in range(1,4)]
        rows=[]
        for t in np.linspace(.66,math.tau-.66,56):
            row=[]
            for a in np.arange(12)*math.tau/12:
                depth=.018+.012*math.cos(a)
                row.append(((w+depth)*math.sin(t),(low+hi)/2+((hi-low)/2+depth)*math.cos(t),z+.044*math.sin(a)))
            rows.append(row)
        m.part(rows,2)
    for sign in [-1,1]:
        def p(x,h,z):return (sign*x,h,z)
        m.ribbon([p(.31,back(.75,.31)+.095,.75),p(.450,2.27,.771),p(.56,2.085,.787),p(.603,1.85,.799),p(.61,1.718,.805)],.032,.011,2)
        # Forged stirrup with the bar directly below the rider's instep.
        stirrup=[p(.61,1.739,.804),p(.638,1.708,.736),p(.651,1.587,.697),p(.651,1.564,.705),
                 p(.651,1.557,.887),p(.651,1.588,.909),p(.632,1.707,.854),p(.611,1.732,.812)]
        m.tube(stirrup,[.017]*len(stirrup),3)
        for z in [.301,.911]:
            pts=[p(.542,2.04,z-.061),p(.548,2.001,z-.061),p(.549,1.973,z-.053),
                 p(.549,1.973,z+.05),p(.548,2.00,z+.061),p(.542,2.042,z+.061),p(.543,2.039,z-.048)]
            m.tube(pts,[.009]*len(pts),3,8)
        m.tube([p(.175,2.499,1.017),p(.192,2.567,1.056),p(.196,2.61,1.088),
                p(.195,2.637,1.160),p(.178,2.57,1.178),p(.161,2.473,1.136)],
               [.024,.023,.022,.021,.022,.025],2)
    obj=m.obj('saddle')
    obj.data.materials.append(material('parasaur_tack'))
    skin(obj,'chest')
    uv=obj.data.uv_layers.new(name='Tack')
    # Tile small original woven/stitched/leather/metal swatches along the cuts.
    for face,tag in zip(obj.data.polygons,m.tags):
        face.use_smooth=True
        normal=face.normal
        axis=max(range(3),key=lambda k:abs(normal[k]))
        for j in face.loop_indices:
            p=obj.data.vertices[obj.data.loops[j].vertex_index].co
            a,b=[p[k] for k in range(3) if k!=axis]
            uv.data[j].uv=((tag+.40+.13*a+.035*b)/4,.42+.108*b-.04*a)
    bm=bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm,faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()
    split_uv_signs(obj.data)
if __name__=='__main__':
    build()
