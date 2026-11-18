"""Original fitted expedition saddle: hide blanket, wooden tree and harness.

The raised tree keeps a human's knees outside the broad back. Four closed feet
bear on the fitted pad; two girths keep the tree seated, with a breast collar
ahead of the shoulders. The entire rider frame is on chest, like its sockets.
"""

import math
import json
from pathlib import Path
from mathutils import Vector

import bpy
import numpy as np

import rig
from parts import Part, activate, join, smooth_rows
from plan import BODY, GROUND, to_blender

HERE=Path(__file__).resolve().parent
MATERIAL='trike_saddle'
LEATHER=(.02,.02,.48,.98)
WOOD=(.52,.02,.75,.98)
ROPE=(.79,.02,.98,.98)


def part(name,rect=LEATHER):
    return Part(name,MATERIAL,'chest')


def tube(name,path,width,depth=None,rect=WOOD,sides=8,subdivisions=1):
    return part(name).loft([(*p,width,depth or width) for p in path],sides,rect,subdivisions).object()


def flat_beam(name,rows):
    """Wooden bows keep their broad face upright through lateral bends."""
    p=part(name);rows=smooth_rows(rows,2);rings=[]
    for i,row in enumerate(rows):
        tangent=Vector(rows[min(i+1,len(rows)-1)][:3])-Vector(rows[max(i-1,0)][:3]);tangent.normalize()
        up=Vector((0,1,0));up-=tangent*up.dot(tangent);up.normalize()
        across=up.cross(tangent).normalized();centre=Vector(row[:3])
        rings.append([p.point(centre+across*row[3]*math.cos(k*math.tau/8)+up*row[4]*math.sin(k*math.tau/8)) for k in range(8)])
    for j in range(len(rings)-1):
        for k in range(8):
            n=(k+1)%8
            p.face((rings[j][k],rings[j][n],rings[j+1][n],rings[j+1][k]),[(.52+.23*u/8,.02+.96*v/(len(rings)-1)) for u,v in ((k,j),(k+1,j),(k+1,j+1),(k,j+1))])
    for i in (0,len(rings)-1):
        centre=p.point(rows[i][:3])
        for k in range(8):p.face((centre,rings[i][k],rings[i][(k+1)%8]),[(.6,.1),(.61,.1),(.6,.11)])
    return p.object()


def platform(sign):
    p=part(f'foot_rest_{sign}');rings=[]
    outline=[(-.12,-.13),(.12,-.13),(.15,-.10),(.15,.10),(.12,.13),(-.12,.13),(-.15,.10),(-.15,-.10)]
    for y in (2.630,2.667):rings.append([p.point((sign*.42+x,y,.26+z)) for x,z in outline])
    for row,y in enumerate((2.630,2.667)):
        centre=p.point((sign*.42,y,.26))
        for k in range(8):p.face((centre,rings[row][k],rings[row][(k+1)%8]),[(.635,.5),(.52+.23*k/8,.15),(.52+.23*(k+1)/8,.85)])
    for k in range(8):
        n=(k+1)%8;p.face((rings[0][k],rings[0][n],rings[1][n],rings[1][k]),[(.52,.02),(.75,.02),(.75,.07),(.52,.07)])
    return p.object()


def blanket():
    p=part('fitted_hide_blanket');grids=[]
    # Coordinates describe the unshifted anatomical plan. The complete worn
    # mesh receives exactly the same ground shift as the skin at the end.
    for upper in (True,False):
        grid=[]
        for j in range(9):
            z=-.96+1.34*j/8
            cy=np.interp(z,[s[0] for s in BODY],[s[1] for s in BODY])
            w=np.interp(z,[s[0] for s in BODY],[s[2] for s in BODY])
            h=np.interp(z,[s[0] for s in BODY],[s[3] for s in BODY])
            row=[]
            for i in range(11):
                x=(i/10-.5)*1.66
                y=cy+h*math.sqrt(max(.01,1-(x/w)**2))+.035+(.025 if upper else 0)
                row.append(p.point((x,y,z)))
            grid.append(row)
        grids.append(grid)
        for j in range(8):
            for i in range(10):
                f=(grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i])
                p.face(f if upper else tuple(reversed(f)),[(.02+.46*u/10,.02+.96*v/8) for u,v in ((i,j),(i+1,j),(i+1,j+1),(i,j+1))])
    edge=[(0,i) for i in range(11)]+[(j,10) for j in range(1,9)]+[(8,i) for i in range(9,-1,-1)]+[(j,0) for j in range(7,0,-1)]
    for k,(j,i) in enumerate(edge):
        b,a=edge[(k+1)%len(edge)]
        p.face((grids[0][j][i],grids[1][j][i],grids[1][b][a],grids[0][b][a]),[(.02,.02),(.03,.02),(.03,.1),(.02,.1)])
    return p.object()


def build():
    objects=[blanket()]
    # Two curved wooden tree rails, a padded cantle and low pommel. Their
    # broad feet distribute weight rather than mounting a floating chair.
    for sign in (-1,1):
        # Each bow and its flared load-bearing ends are one closed wooden
        # member. The forward bow passes outside the rider's shin/foot volume.
        rail=[(sign*.43,2.49,-.91,.14,.045),(sign*.42,2.50,-.80,.10,.045),
              (sign*.20,2.73,-.64,.062,.050),(sign*.15,2.74,-.15,.062,.050),
              (sign*.18,2.71,.05,.062,.035),(sign*.40,2.62,.23,.065,.020),
              (sign*.68,2.46,.37,.11,.045)]
        objects.append(flat_beam(f'tree_rail_{sign}',rail))
        # One upright, hand-sized grip. The former narrow arch put both of
        # its stems through one grasp volume and its foot through the thigh.
        # The lower stem rises ahead of the thighs before reaching the palm.
        objects.append(tube(f'grip_{sign}',[(sign*.18,2.73,.08),(sign*.18,2.90,.25),(sign*.19,3.15,.25),
                                         (sign*.19,3.23,.02),(sign*.19,3.48,.02)],.017,rect=ROPE,sides=8,subdivisions=1))
        objects.append(tube(f'stirrup_strap_{sign}',[(sign*.25,3.00,-.58),(sign*.72,2.84,-.49),(sign*.72,2.75,.12),(sign*.57,2.647,.26)],.027,.012,rect=LEATHER))
        objects.append(platform(sign))
    objects.append(part('central_seat_tree').loft([(0,2.73,-.33,.12,.20),(0,2.94,-.33,.12,.20)],8,WOOD,1).object())
    objects.append(part('dished_seat').loft([(0,2.96,-.72,.18,.05),(0,3.00,-.57,.29,.065),
        (0,2.97,-.35,.24,.040),(0,2.94,-.12,.17,.025),(0,2.93,.02,.10,.025),(0,2.93,.16,.06,.015)],16,LEATHER,2).object())
    objects.append(tube('cantle',[(-.28,2.98,-.62),(-.23,3.13,-.69),(0,3.17,-.72),(.23,3.13,-.69),(.28,2.98,-.62)],.046,.065,LEATHER,10,2))
    for z in (-.74,.20):
        cy=np.interp(z,[s[0] for s in BODY],[s[1] for s in BODY]);w=np.interp(z,[s[0] for s in BODY],[s[2] for s in BODY])
        up=np.interp(z,[s[0] for s in BODY],[s[3] for s in BODY]);down=np.interp(z,[s[0] for s in BODY],[s[4] for s in BODY])
        path=[]
        for i in range(17):
            a=i*math.tau/16;s=math.sin(a)
            path.append(((w+.025)*math.cos(a),cy+((up if s>0 else down)+.025)*s,z))
        objects.append(tube(f'girth_{z}',path,.024,.045,LEATHER))
    # Paired breast tethers avoid the movable neck/frill. No ornamental strap
    # crosses the jaw or an eye; the rider's grips are fixed to the tree.
    for sign in (-1,1):
        objects.append(tube(f'breast_tether_{sign}',[(sign*.68,2.46,.37),(sign*.80,2.20,.70),(sign*.68,1.80,1.05),(sign*.43,1.44,1.12),(0,1.35,1.12)],.027,.018,LEATHER,6,1))
    # Retain source-part provenance for native triangle contact diagnostics.
    # This ignored file is never a runtime input.
    out=HERE.parents[4]/'var/trike-art';out.mkdir(parents=True,exist_ok=True)
    (out/'saddle-components.json').write_text(json.dumps([
        {'name':o.name,'points':[[v.co.x,v.co.z-GROUND,-v.co.y] for v in o.data.vertices],
         'faces':[list(p.vertices) for p in o.data.polygons]} for o in objects]))
    obj=join(objects,'saddle')
    for vertex in obj.data.vertices:vertex.co.z-=GROUND
    rig.bind(obj)
    material=bpy.data.materials[MATERIAL];material.diffuse_color=(.24,.12,.055,1);material.use_nodes=True
    bs=material.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.74
    path=HERE/'tex/trike_saddle_base.png'
    if path.exists():
        tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(path),check_existing=True)
        material.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    obj.data.calc_loop_triangles()
    print(f'trike saddle: {len(obj.data.loop_triangles)} triangles, original closed parts on chest')


if __name__=='__main__':build()
