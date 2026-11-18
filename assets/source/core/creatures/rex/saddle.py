"""A fitted riding tree over the adult's shoulder. Coordinates are in the rested game frame."""
import math
import numpy as np
import bpy
from mathutils.bvhtree import BVHTree
from mathutils import Vector
from parts import Part, join
from plan import to_blender
from rig import bind

LEATHER=(.04,.04,.45,.96)
WOOD=(.52,.05,.71,.96)
BRASS=(.77,.05,.97,.97)

def build():
    body=bpy.data.objects['rex_model']
    tree=BVHTree.FromObject(body,bpy.context.evaluated_depsgraph_get())
    def top(x,z):
        hit=tree.ray_cast(to_blender((x,5,z)),Vector((0,0,-1)))[0]
        if hit is None:raise RuntimeError(f'no back under {x}, {z}')
        return hit.z
    def flank(angle,z):
        origin=to_blender((0,3.0,z))
        direction=to_blender((math.sin(angle), math.cos(angle),0))
        hit=tree.ray_cast(origin+direction*2.3,-direction)[0]
        if hit is None:raise RuntimeError('girth did not meet the skin')
        return (hit.x+.023*direction.x,hit.z+.023*direction.z,-hit.y)
    parts=[]
    def part(name):return Part(name,'rex_saddle','chest')
    def path(name,p,r,rect=LEATHER,sides=8,sub=1):
        parts.append(part(name).loft([(*a,r,r) for a in p],sides,rect,sub).object())
    def panel(name,rows,widths,profile,rect=LEATHER):
        p=part(name);rings=[];cross=np.linspace(-1,1,13)
        for i,(z,w) in enumerate(zip(rows,widths)):
            ring=[]
            for layer in (0,1):
                for u in cross:
                    x=u*w
                    ring.append(p.point((x,profile(x,z,u,i,layer),z)))
            rings.append(ring)
        k=len(cross)
        for i in range(len(rows)-1):
            for j in range(k-1):
                for layer in (0,k):
                    inds=(rings[i][layer+j],rings[i][layer+j+1],rings[i+1][layer+j+1],rings[i+1][layer+j])
                    p.face(inds,[(rect[0]+(rect[2]-rect[0])*a/(k-1),rect[1]+(rect[3]-rect[1])*b/(len(rows)-1)) for a,b in [(j,i),(j+1,i),(j+1,i+1),(j,i+1)]])
            for j in (0,k-1):p.face((rings[i][j],rings[i+1][j],rings[i+1][k+j],rings[i][k+j]))
        for ring in (rings[0],rings[-1]):
            for j in range(k-1):p.face((ring[j],ring[j+1],ring[k+j+1],ring[k+j]))
        parts.append(p.object())
    z=[-.26,-.14,.09,.38,.66,.90,1.10,1.23]
    widths=[.43,.60,.68,.68,.66,.59,.46,.31]
    panel('quilting',z,widths,lambda x,z,u,i,l:top(x,z)+.016+l*(.038+.018*(1-u*u)))
    seat_z=[-.06,.05,.22,.39,.54,.72,.86,.97]
    seat_w=[.24,.34,.345,.31,.28,.235,.185,.12]
    seat_y=[4.21,4.23,4.16,4.127,4.122,4.137,4.18,4.21]
    panel('seat',seat_z,seat_w,lambda x,z,u,i,l:seat_y[i]-.052*u*u-(1-l)*.085)
    for sign in (-1,1):
        path('skirt_welt',[(sign*w,top(sign*w,a)+.045,a) for a,w in zip(z,widths)],.016)
        path('tree_rail',[(sign*x,y,a) for x,y,a in [(.25,3.99,-.05),(.30,4.06,.23),(.24,4.06,.61),(.14,4.13,.94)]],.050,WOOD,10,2)
        path('grip',[(sign*x,y,a) for x,y,a in [(.16,4.135,.74),(.18,4.33,.77),(.19,4.41,.86),(.18,4.39,.94),(.13,4.19,1.00)]],.027,WOOD,10,2)
        path('grip_wrap',[(sign*.19,4.397,.83),(sign*.19,4.41,.86),(sign*.189,4.409,.89)],.030,LEATHER,10,2)
        for a in (.64,.92):
            path('stirrup_leather',[(sign*.29,4.08,a-.13),(sign*.48,3.94,a-.08),(sign*.60,3.80,a-.03),(sign*.646,3.62,a)],.028,LEATHER,8,2)
        path('stirrup_iron',[(sign*.646,3.64,.64),(sign*.654,3.59,.68),(sign*.656,3.59,.88),(sign*.646,3.64,.92)],.025,BRASS,10,2)
    for z0 in (.16,.94):
        # Closed girths made from two concentric strap surfaces, contoured to
        # the evaluated skin rather than the axial design ellipse.
        p=part('girth');rings=[]
        for a in np.linspace(0,math.tau,49)[:-1]:
            ring=[]
            for d,z1 in [(.002,z0-.045),(.002,z0+.045),(.025,z0+.045),(.025,z0-.045)]:
                x,y,z2=flank(a,z1)
                ring.append(p.point((x+d*math.sin(a),y+d*math.cos(a),z2)))
            rings.append(ring)
        for i,ring in enumerate(rings):
            nxt=rings[(i+1)%len(rings)]
            for j in range(4):
                k=(j+1)%4
                p.face((ring[j],ring[k],nxt[k],nxt[j]),[(.04+.39*u,.03+.94*v/len(rings)) for u,v in [(0,i),(1,i),(1,i+1),(0,i+1)]])
        parts.append(p.object())
    path('cantle',[(x,4.23+.085*(1-(x/.31)**2),.028) for x in np.linspace(-.31,.31,13)],.042,WOOD,10)
    saddle=join(parts,'saddle');bind(saddle)
    print('rex fitted saddle:',sum(len(f.vertices)-2 for f in saddle.data.polygons),'triangles')
if __name__=='__main__':build()
