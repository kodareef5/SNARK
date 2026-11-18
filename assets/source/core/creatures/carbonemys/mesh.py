"""Small indexed-surface builder. Faces carry their own UV seam corners."""
import math
import bpy,bmesh
from mathutils import Vector
from rig import B

class Surface:
    def __init__(self,name,materials):
        self.name=name;self.materials=materials;self.points=[];self.weights=[];self.faces=[];self.uvs=[];self.mats=[]
    def v(self,p,weights):
        self.points.append(B(p));self.weights.append({weights:1} if isinstance(weights,str) else weights)
        return len(self.points)-1
    def f(self,ids,uvs,mat):
        self.faces.append(ids);self.uvs.append(uvs);self.mats.append(mat)
    def done(self):
        mesh=bpy.data.meshes.new(self.name);mesh.from_pydata(self.points,[],self.faces);mesh.update()
        obj=bpy.data.objects.new(self.name,mesh);bpy.context.collection.objects.link(obj)
        for name in self.materials:mesh.materials.append(bpy.data.materials.get(name) or bpy.data.materials.new(name))
        uv=mesh.uv_layers.new(name='Surface')
        for f,coords,mat in zip(mesh.polygons,self.uvs,self.mats):
            f.use_smooth=True;f.material_index=mat
            for i,c in zip(f.loop_indices,coords):uv.data[i].uv=c
        bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
        arm=bpy.data.objects['carbonemys'];obj.parent=arm
        modifier=obj.modifiers.new('Native rig','ARMATURE');modifier.object=arm
        groups={}
        for i,weights in enumerate(self.weights):
            for key,share in weights.items():
                if share<=.00001:continue
                if key not in groups:groups[key]=obj.vertex_groups.new(name=key)
                groups[key].add([i],share,'REPLACE')
        return obj

def uvbox(box,u,v):
    x,y,w,h=box
    return (x+w*u,y+h*v)

def tube(s,sections,weights,mat,box,sides=18,space='along',power=1):
    """Closed loft through original oriented sections, first transverse axis horizontal."""
    rings=[]
    for i,(p,rx,ry) in enumerate(sections):
        p=Vector(p)
        d=(Vector(sections[min(i+1,len(sections)-1)][0])-Vector(sections[max(0,i-1)][0])).normalized()
        if space=='z':axis=Vector((1,0,0));up=Vector((0,1,0))
        else:
            seed=Vector((0,1,0)) if abs(d.y)<.93 else Vector((0,0,1))
            axis=d.cross(seed).normalized();up=axis.cross(d).normalized()
        ring=[]
        for j in range(sides):
            a=2*math.pi*j/sides;ca=math.cos(a);sa=math.sin(a)
            h=math.copysign(abs(ca)**power,ca);v=math.copysign(abs(sa)**power,sa)
            ring.append(s.v(p+axis*rx*h+up*ry*v,weights[i]))
        rings.append(ring)
    def uv(j,i):return uvbox(box,j/sides,(i+1)/(len(rings)+1))
    for i in range(len(rings)-1):
        for j in range(sides):
            k=(j+1)%sides
            s.f([rings[i][j],rings[i][k],rings[i+1][k],rings[i+1][j]],[uv(j,i),uv(j+1,i),uv(j+1,i+1),uv(j,i+1)],mat)
    for i in [0,len(rings)-1]:
        at=s.v(sections[i][0],weights[i]);y=(i+1)/(len(rings)+1)
        for j in range(sides):
            k=(j+1)%sides
            s.f([at,rings[i][j],rings[i][k]],[uvbox(box,(j+.5)/sides,0 if i==0 else 1),uv(j,i),uv(j+1,i)],mat)

def oval(s,p,r,weight,mat,box,sides=20,levels=9):
    x,y,z=p;rx,ry,rz=r
    sections=[]
    for i in range(levels):
        a=-math.pi/2+.035+(math.pi-.07)*i/(levels-1)
        sections.append(((x,y,z+rz*math.sin(a)),rx*math.cos(a),ry*math.cos(a)))
    tube(s,sections,[weight]*levels,mat,box,sides,'z')
