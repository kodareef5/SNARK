"""Measured broad AquaTheater fittings beyond the two textured source stages.

All coordinates remain prototype-local. Fine meshes and physical parts are
untouched. Replay with tools/cruise/aquatheater.ts; stage 3's pod certificate is
an explicitly sampled visible P95, not a maximum-error claim, and is tied to
the actual room/fixture placement. Complete cell capacity is checked separately.
"""
import math
from model_aquatheater import _leaf, _pillow


def _sheet(mesh,points,tag):
    n=len(points)
    mesh.indexed(points,[tuple(range(n)),tuple(range(n-1,-1,-1))],tag)


def _disc(mesh,x,z,y,rx,rz,sides,tag,fit=False):
    grow=2/(1+math.cos(math.pi/sides)) if fit else 1
    _sheet(mesh,[(x+rx*max(-1,min(1,grow*math.cos(i*math.tau/sides))),y,z+rz*max(-1,min(1,grow*math.sin(i*math.tau/sides)))) for i in range(sides)],tag)


def _solid_disc(mesh,x,z,y0,y1,rx,rz,sides,tag):
    mesh.loft([[(x+rx*math.cos(i*math.tau/sides),y,z+rz*math.sin(i*math.tau/sides)) for i in range(sides)] for y in(y0,y1)],tag)


def _arc(mesh,section,steps,tag,fit=False,edge_tags=None,start=-2.57,end=2.57):
    grow=(1+math.cos((end-start)/72))/(1+math.cos((end-start)/(steps*2))) if fit else 1
    rings=[[(rx*(1 if i in(0,steps) else grow)*math.sin(start+(end-start)*i/steps),y,-.12+rz*(1 if i in(0,steps) else grow)*math.cos(start+(end-start)*i/steps))
            for rx,rz,y in section] for i in range(steps+1)]
    if len(section)==2:
        # Each paired patch is its own zero-volume island. Sharing indexed
        # hinge edges gives four incident faces, so the general solid winding
        # walk cannot choose a unique neighbour and can flip a sheet side.
        for a,b in zip(rings,rings[1:]):_sheet(mesh,[a[0],a[1],b[1],b[0]],tag)
        return
    first=len(mesh.f);mesh.loft(rings,tag)
    if edge_tags:
        for i in range(steps*len(section)):mesh.tags[first+i]=edge_tags[i%len(section)]


def _pillow_sheets(mesh,x,z,angle,planes):
    ca,sa=math.cos(angle),math.sin(angle)
    for depth in planes:
        points=[]
        for px,py in((-.30,0),(.30,0),(.30,.52),(-.30,.52)):
            yy=py*.985-depth*.173;zz=py*.173+depth*.985
            points.append((x+px*ca+zz*sa,.55+yy,z-px*sa+zz*ca))
        _sheet(mesh,points,'ivory')


def _plant_crown(mesh,x,plant,count=4):
    base=(x,.58,1.73)
    tips=[]
    for i in range(count):
        angle=math.tau*(i/count+plant*.13)
        tips.append((x+.34*math.cos(angle),1.43+.13*math.sin(angle),1.73+.21*math.sin(angle)))
    for i in range(count):_sheet(mesh,[base,tips[i],tips[(i+1)%count]],'leaf')


def _pod(mesh,prototype):
    level=mesh.level
    if level>=4:
        # Connected shell plus real support-top/lining surfaces: these thin
        # gaps are visible through the entrance and cannot simply disappear.
        _arc(mesh,[(1.12,.43,.10),(2.26,1.48,.10),(2.38,1.60,.35),(2.34,1.56,1.12),
                   (1.96,1.18,1.06),(1.88,1.10,.54),(1.20,.51,.54)],6,'ivory',True,
             ['oak','ivory','ivory','ivory','purple','purple','oak'])
        _arc(mesh,[(1.12,.43,.40),(2.12,1.34,.40)],6,'oak',True)
        _disc(mesh,0,-.29,.0385,1.52,1.17,6,'stone',True)
        for x in(-.60,.60):
            _disc(mesh,x,-.70,.585,.40,.30,4,'ivory',True)
            _sheet(mesh,[(x-.047,.132,-.70),(x+.047,.132,-.70),(x+.047,.553,-.70),(x-.047,.553,-.70)],'steel')
        for plant,x in enumerate((-1.08,0,1.08)):_plant_crown(mesh,x,plant)
        for y in(.11,.24):_sheet(mesh,[(-1.5,y,1.53),(1.5,y,1.53),(1.5,y,1.93),(-1.5,y,1.93)],'oak')
        for x,z,angle in((-1.49,.22,-.78),(1.49,.22,.78),(-.63,.81,-.29),(.63,.81,.29)):_pillow_sheets(mesh,x,z,angle,(0,))
        return
    if level==3:
        # Preserve the connected outline, then retain the exposed support and
        # rear lining. Plant tips use the original eight angular stations.
        _arc(mesh,[(1.12,.43,.10),(2.26,1.48,.12),(2.38,1.60,.35),(2.38,1.60,1.08),
                   (2.29,1.51,1.16),(2.12,1.34,1.16),(2.10,1.32,1.02),(1.96,1.18,1.06),
                   (1.88,1.10,.94),(1.88,1.10,.54),(1.20,.51,.54),(1.14,.45,.48)],8,'ivory',True,
             ['oak','ivory','ivory','ivory','ivory','ivory','purple','purple','purple','purple','purple','oak'])
        _arc(mesh,[(1.12,.43,.37),(2.12,1.34,.37)],8,'oak',True)
        _arc(mesh,[(2.08,1.30,.38),(2.08,1.30,1.04)],8,'purple',True)
        _disc(mesh,0,-.29,.068,1.52,1.17,9,'stone',True)
    else:
        _arc(mesh,[(2.26,1.48,.12),(2.38,1.60,.35),(2.38,1.60,1.08),(2.29,1.51,1.16),
                   (2.12,1.34,1.16),(2.10,1.32,1.02),(2.10,1.32,.38),(2.14,1.36,.12)],18,'ivory')
        _arc(mesh,[(1.12,.43,.10),(1.92,1.14,.10),(1.92,1.14,.335),(1.12,.43,.335)],18,'oak')
        _arc(mesh,[(1.16,.47,.35),(1.82,1.04,.35),(1.87,1.09,.43),(1.84,1.06,.54),
                   (1.20,.51,.54),(1.14,.45,.48)],12,'purple',True)
        _arc(mesh,[(2.06,1.28,.52),(2.06,1.28,1.01),(1.96,1.18,1.06),(1.88,1.10,.94),
                   (1.88,1.10,.54)],12,'purple',True)
        _solid_disc(mesh,0,-.29,.012,.065,1.52,1.17,18,'stone')
    for x in(-.60,.60):
        if level==2:
            _solid_disc(mesh,x,-.70,.073,.125,.25,.23,10,'ivory')
            _solid_disc(mesh,x,-.70,.56,.61,.40,.30,10,'ivory')
            mesh.tube([(x,.132,-.70),(x,.553,-.70)],.047,'steel',n=4)
        else:
            _disc(mesh,x,-.70,.585,.40,.30,6,'ivory',True)
            _sheet(mesh,[(x-.047,.132,-.70),(x+.047,.132,-.70),(x+.047,.553,-.70),(x-.047,.553,-.70)],'steel')
    for x,z,angle in((-1.49,.22,-.78),(1.49,.22,.78),(-.63,.81,-.29),(.63,.81,.29)):
        if level==2:
            old=mesh.level;mesh.level=1;_pillow(mesh,x,z,angle);mesh.level=old
        else:_pillow_sheets(mesh,x,z,angle,(-.055,.055))
    mesh.box([-1.50,.04,1.53],[1.50,.31,1.93],'oak')
    for plant,x in enumerate((-1.08,0,1.08)):
        if level==2:mesh.tube([(x,.32,1.73),(x,.91,1.73)],.024,'steel',n=4)
        else:_sheet(mesh,[(x-.024,.32,1.73),(x+.024,.32,1.73),(x+.024,.91,1.73),(x-.024,.91,1.73)],'steel')
        if level==3:
            _plant_crown(mesh,x,plant,8)
            continue
        for i in range(8):
            angle=math.tau*(i/8+plant*.13)
            tip=[x+.34*math.cos(angle),1.43+.13*math.sin(angle),1.73+.21*math.sin(angle)]
            base=[x,.53+.10*(i%2),1.73]
            _leaf(mesh,base,tip,.095)


def _row(mesh,item):
    x,y,z=item['at'];sx,sy,sz=item['size'];finish=item.get('finish','purple');level=mesh.level
    left=-sx/2+.025;right=sx/2-.025
    def box(lo,hi,tag=finish):
        old=mesh.level
        if level==2 and tag==finish:mesh.level=1
        mesh.box([x+lo[0],y+lo[1],z+lo[2]],[x+hi[0],y+hi[1],z+hi[2]],tag,bevel=.035 if level==2 and tag==finish else 0)
        mesh.level=old
    def horizontal(height,z0,z1,tag=finish):_sheet(mesh,[(x+left,y+height,z+z0),(x+right,y+height,z+z0),(x+right,y+height,z+z1),(x+left,y+height,z+z1)],tag)
    if level>=4:
        for h in(.378,.636):horizontal(h,-.48*sz,.23*sz)
        for depth in(.29*sz,.42*sz):
            _sheet(mesh,[(x+left,y+.58*sy,z+depth),(x+right,y+.58*sy,z+depth),
                         (x+right,y+sy,z+depth),(x+left,y+sy,z+depth)],finish)
        horizontal(.135,-.25*sz,.32*sz,'steel')
        return
    box([left,.24*sy,-.48*sz],[right,.58*sy,.23*sz])
    box([left,.58*sy,.23*sz],[right,sy,.48*sz])
    box([-.48*sx,0,-.25*sz],[.48*sx,.24*sy,.32*sz],'steel')
    count=max(1,round(sx/.72))
    for i in range(1,count):
        # At the middle tier retain six of nine chair divisions; the native
        # bidirectional P95 remains below .031 m for the entire row.
        if level==3 and i%3==0:continue
        gap=-sx/2+i*sx/count
        for xx in((gap-.0125,gap+.0125) if level==2 else(gap,)):
            _sheet(mesh,[(x+xx,y+yy*sy,z+zz*sz) for yy,zz in((.24,-.48+.0175/sz),(.58,-.48+.0175/sz),(.58,.23+.0175/sz),(1,.23+.0175/sz),(1,.48-.0175/sz),(.24,.48-.0175/sz))],finish)
    for i in range(count):
        ax=-sx/2+i*sx/count+.025
        for xx in((ax+.015,ax+.045) if level==2 else(ax+.03,)):
            _sheet(mesh,[(x+xx,y+.58*sy,z-.40*sz),(x+xx,y+.69*sy,z-.40*sz),
                         (x+xx,y+.69*sy,z+.23*sz),(x+xx,y+.58*sy,z+.23*sz)],'oak')


def fitting(mesh,prototype,instance):
    if mesh.level<2 or instance.get('section')!='aquatheater':return False
    if prototype['art']['kind']=='aquadome_pod':
        _pod(mesh,prototype);return True
    if prototype['art']['kind']!='furniture':return False
    if any(item['kind'] not in('seating_row','stage') for item in prototype['art']['items']):return False
    for item in prototype['art']['items']:
        if item['kind']=='seating_row':_row(mesh,item)
        elif item['kind']=='stage':
            x,y,z=item['at'];sx,sy,sz=item['size']
            mesh.box([x-sx/2,y,z-sz/2],[x+sx/2,y+sy,z+sz/2],item.get('finish','navy'))
    return True
