"""Actual 16 m visual cells, clipped closed solids and temporary triangle ownership."""
import json,math,hashlib,os,struct,bmesh,bpy
from collections import defaultdict
from pathlib import Path
from mathutils import Vector
from parts import Mesh,LOOK,SIGNS
from layout_cells import axes,snap
from layout_json import dumps as compact_records
from model_far_pearl import pearl as far_pearl
from model_far_lifeboat import lifeboat as far_lifeboat
from model_far_aquatheater import fitting as far_aquatheater
from model_far_slides import slides as far_slides
from model_far_facades import facade_panel,facade_panels,forebody as far_forebody

# Source convex hulls pass through Blender float32 coordinates. Ten micrometres
# identifies a coincident authored grid plane, far below native vertex precision.
EPS=1e-5
def key(p):return tuple(round(v,6) for v in p)
def normal(ps):
 n=[0.,0.,0.]
 for a,b in zip(ps,ps[1:]+ps[:1]):
  n[0]+=(a[1]-b[1])*(a[2]+b[2]);n[1]+=(a[2]-b[2])*(a[0]+b[0]);n[2]+=(a[0]-b[0])*(a[1]+b[1])
 return n
def atlas(points,tag,custom=None):
 n=normal(points);axis=max(range(3),key=lambda k:abs(n[k]));axes={0:[2,1],1:[0,2],2:[0,1]}[axis]
 lo=[min(p[k] for p in points) for k in axes];hi=[max(p[k] for p in points) for k in axes]
 sign=tag.startswith('sign:');cell=SIGNS[tag[5:]] if sign else LOOK[tag]['cell'];cx=cell%8;cy=cell//8;out=[]
 if tag=='clear':
  # A small finite UV footprint stays in the transparent cell's center even
  # under minification, while preserving nondegenerate native tangent frames.
  return [((cx+.49+.02*(p[axes[0]]-lo[0])/max(hi[0]-lo[0],1e-7))/8,
           1-(cy+.49+.02*(p[axes[1]]-lo[1])/max(hi[1]-lo[1],1e-7))/8) for p in points]
 for j,p in enumerate(points):
  uv=list(custom[j]) if custom else [.04+.92*(p[k]-lo[t])/max(hi[t]-lo[t],1e-7) for t,k in enumerate(axes)]
  if sign:
   if axis in(0,2) and n[axis]*(-1 if axis==0 else 1)<0:uv[0]=1-uv[0]
   uv=[.03+.94*(uv[0]-.04)/.92,.29+.42*(uv[1]-.04)/.92]
  out.append(((cx+uv[0])/8,1-(cy+1-uv[1])/8))
 return out
def clipped(faces,axis,plane,keep,convex=False):
 out=[];segments=[]
 for points,uv,tag in faces:
  ps=[];us=[];cross=[]
  for j,(a,b) in enumerate(zip(points,points[1:]+points[:1])):
   a=list(a);b=list(b)
   if abs(a[axis]-plane)<EPS:a[axis]=plane
   if abs(b[axis]-plane)<EPS:b[axis]=plane
   ua=uv[j];ub=uv[(j+1)%len(uv)];ia=(a[axis]-plane)*keep>=-EPS;ib=(b[axis]-plane)*keep>=-EPS
   if ia:ps.append(a);us.append(ua)
   if ia!=ib:
    t=(plane-a[axis])/(b[axis]-a[axis]);p=[a[k]+(b[k]-a[k])*t for k in range(3)];p[axis]=plane
    ps.append(p);us.append([ua[k]+(ub[k]-ua[k])*t for k in range(2)]);cross.append(p)
  clean=[];clean_uv=[]
  for p,u in zip(ps,us):
   if not clean or math.dist(p,clean[-1])>EPS:clean.append(p);clean_uv.append(u)
  if len(clean)>1 and math.dist(clean[0],clean[-1])<EPS:clean.pop();clean_uv.pop()
  if len(clean)>=3 and math.sqrt(sum(v*v for v in normal(clean)))>EPS*EPS:out.append((clean,clean_uv,tag))
  if len(cross)==2 and math.dist(*cross)>EPS:segments.append((cross[0],cross[1],tag))
 if not segments:return out
 if convex:
  # Every clipped box, straight tube and convex pane has one convex cut rim.
  # Sorting its actual boundary vertices also retains collinear triangulation
  # intersections; a greedy edge walk can choose the wrong branch at a pole.
  unique={key(p):p for a,b,_ in segments for p in(a,b)}
  cap=list(unique.values());other=[k for k in range(3) if k!=axis]
  center=[sum(p[k] for p in cap)/len(cap) for k in other]
  cap.sort(key=lambda p:math.atan2(p[other[1]]-center[1],p[other[0]]-center[0]))
  if len(cap)>=3:
   if normal(cap)[axis]*keep>0:cap.reverse()
   tag=segments[0][2];out.append((cap,atlas(cap,tag),tag))
  return out
 points={};edges=defaultdict(list);edge_tags={}
 for a,b,tag in segments:
  ka,kb=key(a),key(b);points[ka]=a;points[kb]=b
  if kb not in edges[ka]:edges[ka].append(kb);edges[kb].append(ka);edge_tags[frozenset((ka,kb))]=tag
 used=set()
 for start,neighbors in list(edges.items()):
  for first in neighbors:
   edge=frozenset((start,first))
   if edge in used:continue
   loop=[start];previous=start;current=first;used.add(edge)
   while current!=start:
    loop.append(current);nxt=[p for p in edges[current] if p!=previous and frozenset((current,p)) not in used]
    if not nxt:break
    nxt=nxt[0];used.add(frozenset((current,nxt)));previous,current=current,nxt
   if current!=start or len(loop)<3:continue
   cap=[points[p] for p in loop]
   if normal(cap)[axis]*keep>0:cap.reverse()
   tag=edge_tags[edge];out.append((cap,atlas(cap,tag),tag))
 return out
def clipped_shell(faces,lo,hi):
 # Work on one closed shell island at a time. A thin curved shell can cut into
 # several nested rims; native BMesh triangle_fill preserves those holes, while
 # a single Sutherland-Hodgman polygon cannot represent disconnected pieces.
 bm=bmesh.new();vertices={};names=sorted(set(tag for _,_,tag in faces))
 for points,_,tag in faces:
  vs=[]
  for p in points:
   ident=key(p)
   if ident not in vertices:vertices[ident]=bm.verts.new(p)
   vs.append(vertices[ident])
  bm.faces.new(vs).material_index=names.index(tag)
 for axis in range(3):
  for bound,sign in((lo[axis],1),(hi[axis],-1)):
   co=Vector((0,0,0));co[axis]=bound;no=Vector((0,0,0));no[axis]=sign
   result=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=1e-6,
                               plane_co=co,plane_no=no,clear_inner=True,clear_outer=False)
   edges=[e for e in result['geom_cut'] if isinstance(e,bmesh.types.BMEdge) and len(e.link_faces)==1]
   if edges:bmesh.ops.triangle_fill(bm,edges=edges,use_beauty=True,use_dissolve=False,normal=-no)
 if bm.faces:
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update()
  edges=[e for e in bm.edges if len(e.link_faces)==2 and e.link_faces[0].material_index==e.link_faces[1].material_index
         and e.link_faces[0].normal.dot(e.link_faces[1].normal)>.999999]
  if edges:bmesh.ops.dissolve_edges(bm,edges=edges,use_verts=False,use_face_split=False)
  straight=[v for v in bm.verts if len(v.link_edges)==2 and (v.link_edges[0].other_vert(v).co-v.co).cross(v.link_edges[1].other_vert(v).co-v.co).length<1e-7]
  if straight:bmesh.ops.dissolve_verts(bm,verts=straight,use_face_split=False,use_boundary_tear=False)
 result=[([tuple(v.co) for v in f.verts],[(0,0)]*len(f.verts),names[f.material_index]) for f in bm.faces]
 bm.free();return result
def append_solid(mesh,faces,owner):
 verts=[];indices={};polys=[];tags=[];uvs=[]
 for points,uv,tag in faces:
  face=[];aligned=[]
  for point,coordinate in zip(points,uv):
   k=key(point)
   if k not in indices:indices[k]=len(verts);verts.append(point)
   if not face or face[-1]!=indices[k]:face.append(indices[k]);aligned.append(coordinate)
  if len(face)>1 and face[0]==face[-1]:face.pop();aligned.pop()
  if len(set(face))<3:continue
  polys.append(face);tags.append(tag);uvs.append(aligned)
 if not polys:return
 start=len(mesh.f);mesh.owner=owner;mesh.indexed(verts,polys);mesh.tags[start:]=tags;mesh.uv[start:]=uvs
def box_of(faces,owner,category,rounding=True):
 points=[p for face,_,_ in faces for p in face];lo=[min(p[k] for p in points) for k in range(3)];hi=[max(p[k] for p in points) for k in range(3)];tags=[None]*6
 for points,uv,tag in faces:
  axis=next((k for k in range(3) if max(p[k] for p in points)-min(p[k] for p in points)<EPS),None)
  if axis is None:return None
  side=0 if abs(points[0][axis]-lo[axis])<EPS else 1 if abs(points[0][axis]-hi[axis])<EPS else -1
  if side<0:return None
  index=axis*2+side
  if tags[index] is not None and tags[index]!=tag:return None
  tags[index]=tag
 if any(tag is None for tag in tags):return None
 # At distant levels, reconcile sub-millimetre placement rounding before
 # joining visually continuous bands. The maximum2.5mm movement is far below
 # these authored levels' visible error; near geometry is never rounded.
 if rounding:lo=[round(v*200)/200 for v in lo];hi=[round(v*200)/200 for v in hi]
 return {'lo':lo,'hi':hi,'tags':tuple(tags),'owner':owner,'category':category}
def facade_surface(mesh,boxes,axis):
 # A continuous closed wall, with colour changes on its outside face instead
 # of separately capped boxes for every sill/window/head. Its 2D occupancy is
 # the union of real rectangles, so authored door gaps remain genuine holes.
 along=2 if axis==0 else 0;us=sorted(set(b[s][along] for b in boxes for s in('lo','hi')));ys=sorted(set(b[s][1] for b in boxes for s in('lo','hi')))
 low=min(b['lo'][axis] for b in boxes);high=max(b['hi'][axis] for b in boxes)
 if mesh.level>=4:
  centers=[(b['lo'][axis]+b['hi'][axis])/2 for b in boxes];center=(min(centers)+max(centers))/2
  thickness=max(b['hi'][axis]-b['lo'][axis] for b in boxes);low=center-thickness/2;high=center+thickness/2
  span=28.9 if boxes[0]['category'][1]=='deckhouse' else 32.9 if boxes[0]['category'][1]=='bridge' else None
  if axis==0 and span:
   if any(abs(b['lo'][axis]+span)<.003 for b in boxes):low=-span
   if any(abs(b['hi'][axis]-span)<.003 for b in boxes):high=span
 front=1 if low+high>0 else 0
 occupied={}
 for u in range(len(us)-1):
  for y in range(len(ys)-1):
   cu=(us[u]+us[u+1])/2;cy=(ys[y]+ys[y+1])/2
   covering=[b for b in boxes if b['lo'][along]-EPS<=cu<=b['hi'][along]+EPS and b['lo'][1]-EPS<=cy<=b['hi'][1]+EPS]
   if covering:occupied[u,y]=next((b for b in covering if b['tags'][axis*2+front]=='navy'),covering[0])['tags'][axis*2+front]
 # At this distance the glazing reads as a horizontal band. Keep real entrance
 # gaps, but absorb the narrow colour-only cabin mullion rhythm into that band.
 for y in range(len(ys)-1):
  dark=[u for u in range(len(us)-1) if occupied.get((u,y))=='navy']
  if dark:
   if us[dark[0]]-us[0]<=.35:
    for u in range(dark[0]):occupied[u,y]='navy'
   if us[-1]-us[dark[-1]+1]<=.35:
    for u in range(dark[-1]+1,len(us)-1):occupied[u,y]='navy'
  for a,b in zip(dark,dark[1:]):
   if b>a+1 and us[b]-us[a+1]<=.65:
    for u in range(a+1,b):occupied[u,y]='navy'
 # The thin floor band is structural white shell, not an opening between
 # accommodation rows. Close only sub-35cm vertical seams; real doors remain.
 for u in range(len(us)-1):
  filled=[y for y in range(len(ys)-1) if (u,y) in occupied]
  for a,b in zip(filled,filled[1:]):
   if b>a+1 and ys[b]-ys[a+1]<=.35:
    for y in range(a+1,b):occupied[u,y]='enamel'
 verts=[];lookup={};faces=[];tags=[]
 boxfaces=[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)]
 for (u,y),tag in occupied.items():
  lo=[0,ys[y],0];hi=[0,ys[y+1],0];lo[axis]=low;hi[axis]=high;lo[along]=us[u];hi[along]=us[u+1]
  corners=[(x,yy,z) for x in(lo[0],hi[0]) for yy in(lo[1],hi[1]) for z in(lo[2],hi[2])]
  for side,f in enumerate(boxfaces):
   a=side//2;direction=side%2
   if a==along and (u+(1 if direction else -1),y) in occupied:continue
   if a==1 and (u,y+(1 if direction else -1)) in occupied:continue
   indices=[]
   for k in f:
    point=corners[k]
    if point not in lookup:lookup[point]=len(verts);verts.append(point)
    indices.append(lookup[point])
   faces.append(indices);tags.append(tag if a==axis and direction==front else 'enamel')
 bm=bmesh.new();vs=[bm.verts.new(p) for p in verts];names=sorted(set(tags))
 for face,tag in zip(faces,tags):bm.faces.new([vs[i] for i in face]).material_index=names.index(tag)
 bm.normal_update()
 dissolve=[e for e in bm.edges if len(e.link_faces)==2 and e.link_faces[0].material_index==e.link_faces[1].material_index and e.link_faces[0].normal.dot(e.link_faces[1].normal)>.999999]
 bmesh.ops.dissolve_edges(bm,edges=dissolve,use_verts=False,use_face_split=False)
 straight=[v for v in bm.verts if len(v.link_edges)==2 and (v.link_edges[0].other_vert(v).co-v.co).cross(v.link_edges[1].other_vert(v).co-v.co).length<1e-7]
 if straight:bmesh.ops.dissolve_verts(bm,verts=straight,use_face_split=False,use_boundary_tear=False)
 bm.verts.index_update();start=len(mesh.f);mesh.owner=boxes[0]['owner']
 mesh.indexed([tuple(v.co) for v in bm.verts],[tuple(v.index for v in f.verts) for f in bm.faces])
 mesh.tags[start:]=[names[f.material_index] for f in bm.faces];bm.free()
def merged_boxes(mesh,boxes):
 # Exact unions only: two rectangular pieces with equal spans on the other
 # axes and touching/overlapping intervals. No doorway or stair hole is filled.
 changed=True
 while changed:
  changed=False
  for axis in range(3):
   groups=defaultdict(list)
   for box in boxes:
    signature=(box['category'],box['tags'],tuple(round(box[side][k],5) for k in range(3) if k!=axis for side in('lo','hi')))
    groups[signature].append(box)
   boxes=[]
   for group in groups.values():
    group.sort(key=lambda b:b['lo'][axis]);current=group[0]
    for other in group[1:]:
     if other['lo'][axis]<=current['hi'][axis]+EPS:
      current['hi'][axis]=max(current['hi'][axis],other['hi'][axis]);changed=True
     else:boxes.append(current);current=other
    boxes.append(current)
 facades=defaultdict(list)
 for box in boxes:
  thin=min(range(3),key=lambda k:box['hi'][k]-box['lo'][k])
  if mesh.level>=3 and box['category'][0] in('facade','wall') and thin in(0,2) and box['hi'][thin]-box['lo'][thin]<=.30:
   facades[(box['category'],thin)].append(box);continue
  start=len(mesh.f);mesh.owner=box['owner'];mesh.box(box['lo'],box['hi']);mesh.tags[start:]=box['tags']
 for (_,axis),group in facades.items():
  group.sort(key=lambda b:b['lo'][axis]+b['hi'][axis]);batch=[];minimum=None
  for box in group:
   mid=(box['lo'][axis]+box['hi'][axis])/2
   if batch and mid-minimum>(.24 if mesh.level>=4 else .08):facade_surface(mesh,batch,axis);batch=[]
   if not batch:minimum=mid
   batch.append(box)
  if batch:facade_surface(mesh,batch,axis)
def area(poly):return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))/2
def hull2(points):
 ps=sorted(set(tuple(p) for p in points))
 def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 lower=[];upper=[]
 for p in ps:
  while len(lower)>=2 and cross(lower[-2],lower[-1],p)<=EPS:lower.pop()
  lower.append(p)
 for p in reversed(ps):
  while len(upper)>=2 and cross(upper[-2],upper[-1],p)<=EPS:upper.pop()
  upper.append(p)
 return lower[:-1]+upper[:-1]
def intersection(subject,clip):
 for a,b in zip(clip,clip[1:]+clip[:1]):
  result=[]
  for p,q in zip(subject,subject[1:]+subject[:1]):
   dp=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);dq=(b[0]-a[0])*(q[1]-a[1])-(b[1]-a[1])*(q[0]-a[0])
   if dp>=-EPS:result.append(p)
   if (dp>=-EPS)!=(dq>=-EPS):
    t=dp/(dp-dq);result.append(tuple(p[k]+(q[k]-p[k])*t for k in range(2)))
  subject=result
  if not subject:break
 return subject
def floor_of(faces,owner,category,sheet=False):
 points=[p for face,_,_ in faces for p in face];low=min(p[1] for p in points);high=max(p[1] for p in points)
 # Cutting triangulated vertical sides can introduce intermediate-Y boundary
 # vertices; the authored floor remains the same horizontal extruded polygon.
 tops=[tag for face,uv,tag in faces if all(abs(p[1]-high)<EPS for p in face)]
 if not tops or len(set(tops))!=1:return None
 poly=hull2([(round(p[0]*200)/200,round(p[2]*200)/200) for p in points])
 if len(poly)<3:return None
 return {'poly':poly,'lo':round(low*200)/200,'hi':round(high*200)/200,'tag':tops[0],'owner':owner,'category':category,'sheet':sheet}
def merged_floors(mesh,floors):
 groups=defaultdict(list)
 for p in floors:groups[(p['lo'],p['hi'],p['tag'],p['category'],p.get('sheet',False))].append(p)
 for group in groups.values():
  changed=True
  while changed:
   changed=False
   for i,a in enumerate(group):
    for j in range(i+1,len(group)):
     b=group[j];combined=hull2(a['poly']+b['poly'])
     union=area(a['poly'])+area(b['poly'])-area(intersection(a['poly'],b['poly']))
     if abs(area(combined)-union)>EPS:continue
     a['poly']=combined;group.pop(j);changed=True;break
    if changed:break
  for p in group:
   poly=p['poly'];n=len(poly)
   if p.get('sheet'):
    # Both broad faces remain. Authored floor slabs are24cm; balcony slabs16–18cm.
    y=(p['lo']+p['hi'])/2;mesh.owner=p['owner']
    mesh.indexed([[x,y,z] for x,z in poly],[tuple(range(n)),tuple(reversed(range(n)))],p['tag'])
    mesh.tags[-2]='enamel';continue
   vertices=[[x,y,z] for y in(p['lo'],p['hi']) for x,z in poly]
   faces=[tuple(range(n)),tuple(reversed(range(n,2*n)))]+[(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)]
   start=len(mesh.f);mesh.owner=p['owner'];mesh.indexed(vertices,faces,'enamel');mesh.tags[start+1]=p['tag']
def orient(mesh):
 # Orient each original indexed solid once, before clipping. This avoids asking
 # Blender to infer outside across coincident caps from adjacent clipped solids.
 for v0,v1,f0,f1 in mesh.islands:
  edges=defaultdict(list)
  for f in range(f0,f1):
   face=mesh.f[f]
   for a,b in zip(face,face[1:]+face[:1]):edges[tuple(sorted((a,b)))].append((f,a<b))
  flips={};queue=[]
  for seed in range(f0,f1):
   if seed in flips:continue
   flips[seed]=False;queue=[seed];component=[]
   while queue:
    f=queue.pop();component.append(f);face=mesh.f[f]
    for a,b in zip(face,face[1:]+face[:1]):
     for other,direction in edges[tuple(sorted((a,b)))]:
      if other==f or other in flips:continue
      flips[other]=flips[f] ^ ((a<b)==direction);queue.append(other)
   for f in component:
    if flips[f]:
     mesh.f[f]=tuple(reversed(mesh.f[f]))
     if mesh.uv[f]:mesh.uv[f]=list(reversed(mesh.uv[f]))
   volume=0
   for f in component:
    face=mesh.f[f];a=mesh.v[face[0]]
    for j in range(1,len(face)-1):
     b=mesh.v[face[j]];c=mesh.v[face[j+1]]
     volume+=a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0])
   if volume<0:
    for f in component:
     mesh.f[f]=tuple(reversed(mesh.f[f]))
     if mesh.uv[f]:mesh.uv[f]=list(reversed(mesh.uv[f]))
def visible(instance,prototype,level):
 if level<2:return True
 cat=prototype['category'];kind=prototype['art']['kind']
 if cat=='furniture' and instance['section']=='aquatheater':return True
 if cat=='furniture':return level<4 and instance['section'] in ('furnished-7','furnished-8','furnished-15','furnished-17','furnished-18')
 if cat=='stairs':return True
 if cat in('guard','rail'):return level<3
 if cat=='hull_detail':return level<3
 if cat=='fitting' and instance['section']!='stern' and not instance['id'].startswith('slide_support_'):return level<4
 if level>=4 and cat=='wall' and kind=='wall':return False
 if cat=='sign' or kind=='cabin':return False
 return True
def pane_interior(instance,strict=False):
 section=instance['section'];at=instance['at']
 if section=='upper-accommodation':return [0,68.65]
 if section=='public-interior' and instance['id'].startswith('bridge_'):return [0,130]
 if section=='tier-enclosure':return [0,0]
 if section in('promenade-enclosure','pearl-panorama'):return [0,at[2]]
 if strict:raise ValueError('No authored interior reference for glazing '+instance['id'])
 return [0,0]
def pane_side(instance,box):
 axis=min(range(3),key=lambda k:box['half'][k]);c,s=axes(instance['yaw']);at=instance['at']
 # Each enclosure's own interior determines its outside; upper aft is -Z.
 inside=pane_interior(instance,True);dx,dz=at[0]-inside[0],at[2]-inside[1]
 projection=dx*c-dz*s if axis==0 else dx*s+dz*c
 if abs(projection)<1e-6:raise ValueError('Ambiguous glazing orientation '+instance['id'])
 return axis,1 if projection>=0 else 0
def source_form(mesh,prototype,build,instance=None):
 level=mesh.level;kind=prototype['art']['kind'];cat=prototype['category']
 if far_aquatheater(mesh,prototype,instance):return
 if level<2 and kind=='window_wall':
  build(mesh,prototype)
  for index in prototype['art'].get('glassBoxes',[]):
   b=prototype['boxes'][index];start=len(mesh.f)
   mesh.box([b['at'][k]-b['half'][k] for k in range(3)],[b['at'][k]+b['half'][k] for k in range(3)],'clear')
   axis,side=pane_side(instance,b);mesh.tags[start+axis*2+side]='dome_glaze'
 elif level<2 and kind=='dome_dense':
  for a,b in prototype['art']['beams']:mesh.tube([a,b],.105,'steel',n=8 if level==0 else 7)
  for hull in prototype['hulls']:
   points=hull['points'];inner={key(p) for p in points[:4]};start=len(mesh.f);mesh.convex(points,'dome_glaze')
   for face in range(start,len(mesh.f)):
    if all(key(mesh.v[v]) in inner for v in mesh.f[face]):mesh.tags[face]='clear'
 elif level>=2 and prototype['id'].startswith('cruise:accommodation_cell_'):
  # These cells are sealed accommodation, not advertised playable cabins.
  # Their outside window front hides the rear and party walls at flat tiers.
  for index,b in enumerate(prototype['boxes'][3:],3):
   if level>=3 and index>=5:continue
   lo=[b['at'][k]-b['half'][k] for k in range(3)];hi=[b['at'][k]+b['half'][k] for k in range(3)]
   if level>=3:lo[2]=prototype['visualBounds']['min'][2];hi[2]=prototype['visualBounds']['max'][2]
   mesh.box(lo,hi,'enamel')
 elif level>=2 and kind=='wall':
  for b in prototype['boxes']:
   mesh.box([b['at'][k]-b['half'][k] for k in range(3)],[b['at'][k]+b['half'][k] for k in range(3)],'enamel')
 elif level>=4 and kind=='stair':
  # The mid-step ramp differs by at most half one actual riser. Retain the
  # structural walkway even where it is seen through a distant opening.
  a=prototype['art'];offset=abs(a['y1']-a['y0'])/a['steps']/2
  mesh.convex([[x,y+offset,z] for x,y,z in prototype['hulls'][0]['points']],'stone')
 elif level in(2,3) and kind=='stair':
  a=prototype['art'];n=a['steps']
  for i in range(n):
   za=a['z0']+(a['z1']-a['z0'])*i/n;zb=a['z0']+(a['z1']-a['z0'])*(i+1)/n
   ya=a['y0']+(a['y1']-a['y0'])*i/n;yb=a['y0']+(a['y1']-a['y0'])*(i+1)/n
   mesh.box([a['x0'],max(ya,yb)-.26,za],[a['x1'],max(ya,yb),zb],'stone')
 elif level>=3 and kind=='landing':
  b=prototype['boxes'][0];mesh.box([b['at'][k]-b['half'][k] for k in range(3)],[b['at'][k]+b['half'][k] for k in range(3)],'stone')
 elif level>=2 and kind=='guard':
  a,b=prototype['art']['ends'];mesh.tube([[a[0],a[1]+1.12,a[2]],[b[0],b[1]+1.12,b[2]]],.025,'steel',n=4)
  if level==2:
   for q in(a,b):mesh.tube([[q[0],q[1]+.025,q[2]],[q[0],q[1]+1.12,q[2]]],.022,'steel',n=4)
 elif level>=2 and kind=='window_wall':
  glass=set(prototype['art'].get('glassBoxes',[]))
  for index,b in enumerate(prototype['boxes']):
   if index not in glass and min(b['half'])<.025:continue
   if level>=4 and index not in glass and sorted(b['half'])[1]<=.13:continue
   mesh.box([b['at'][k]-b['half'][k] for k in range(3)],[b['at'][k]+b['half'][k] for k in range(3)],'navy' if index in glass else 'enamel')
 elif level>=4 and kind=='pool':
  for b in prototype['boxes']:
   mesh.box([b['at'][k]-b['half'][k] for k in range(3)],[b['at'][k]+b['half'][k] for k in range(3)],'tile')
  a=prototype['art'];w=a.get('width',10);length=a.get('length',16);y=a['waterY']-.006
  # A deliberate back-to-back surface replaces the12mm decorative water slab;
  # both visible sides remain, with a measured6mm displacement at most.
  mesh.indexed([[-w/2+.02,y,-length/2+.02],[w/2-.02,y,-length/2+.02],
                [w/2-.02,y,length/2-1.52],[-w/2+.02,y,length/2-1.52]],
               [(0,1,2,3),(3,2,1,0)],'water')
 elif level>=2 and kind=='lifeboat':far_lifeboat(mesh,level)
 elif level>=4 and instance['id'].startswith('slide_support_'):
  # Two paired crossing sheets retain each20cm column's broad silhouette.
  # Every point of the original square section is within10cm of a sheet.
  for hull in prototype['hulls']:
   points=hull['points'];lo=[min(p[k] for p in points) for k in range(3)];hi=[max(p[k] for p in points) for k in range(3)]
   assert hi[0]-lo[0]<=.201 and hi[2]-lo[2]<=.201
   x=(lo[0]+hi[0])/2;z=(lo[2]+hi[2])/2
   for vertices in [[[x,lo[1],lo[2]],[x,hi[1],lo[2]],[x,hi[1],hi[2]],[x,lo[1],hi[2]]],
                    [[lo[0],lo[1],z],[hi[0],lo[1],z],[hi[0],hi[1],z],[lo[0],hi[1],z]]]:
    mesh.indexed(vertices,[(0,1,2,3),(3,2,1,0)],'enamel')
 elif level>=2 and kind=='dome_dense':
  raise ValueError('Distant dome must use its continuous shell with the real entrance')
 elif level>=2 and kind=='balcony':
  for index in(0,2,3):
   b=prototype['boxes'][index];lo=[b['at'][k]-b['half'][k] for k in range(3)];hi=[b['at'][k]+b['half'][k] for k in range(3)]
   if level>=4 and index==2:
    z=b['at'][2];mesh.indexed([[lo[0],lo[1],z],[hi[0],lo[1],z],[hi[0],hi[1],z],[lo[0],hi[1],z]],[(0,1,2,3),(3,2,1,0)],'enamel')
   else:mesh.box(lo,hi,'enamel')
  if level<3:
   b=prototype['boxes'][1];lo=[b['at'][k]-b['half'][k] for k in range(3)];hi=[b['at'][k]+b['half'][k] for k in range(3)]
   axis=0 if hi[0]-lo[0]>hi[2]-lo[2] else 2;a=b['at'][:];c=a[:];a[axis]=lo[axis]+.035;c[axis]=hi[axis]-.035;a[1]=c[1]=hi[1]-.03
   mesh.tube([a,c],.025,'steel',n=4)
   if level==2:
    for point in(a,c):bottom=point[:];bottom[1]=lo[1]+.025;mesh.tube([bottom,point],.025,'steel',n=4)
 elif level>=3 and kind=='solids' and cat=='facade':
  for b in prototype['art'].get('visualBoxes',prototype['boxes']):
   if sorted(b['half'])[1]<=.13:continue
   mesh.box([b['at'][k]-b['half'][k] for k in range(3)],[b['at'][k]+b['half'][k] for k in range(3)],prototype['art']['finish'])
  for h in prototype['hulls']:mesh.convex(h['points'],prototype['art']['finish'])
 elif level==2 and cat=='furniture':
  detail=mesh.level;mesh.level=3;build(mesh,prototype);mesh.level=detail
 else:build(mesh,prototype)
def appearance_signature(obj,textured):
 """Exact exported float32 triangles, winding, material and (near) atlas UVs."""
 triangles=[];me=obj.data;uv=me.uv_layers.active.data if textured else None
 for face in me.polygons:
  corners=[]
  for vi,li in zip(face.vertices,face.loop_indices):
   p=me.vertices[vi].co
   corners.append(struct.pack('<3f',*p)+(struct.pack('<2f',*uv[li].uv) if uv else b''))
  triangle=min(b''.join(corners[i:]+corners[:i]) for i in range(3))
  triangles.append(struct.pack('<I',face.material_index)+triangle)
 return hashlib.sha256(bytes([textured])+b''.join(sorted(triangles))).hexdigest()
def distant_shell(D,kind,level):
 """Continuous outside shells, replacing hidden sector caps at long range."""
 m=Mesh(level)
 if kind=='dome_dense':
  a=D['aquadome'];n=64 if level<4 else 40;bands=8
  rx=a['outerBeam']/2-.105;ry=a['outerHeight']-.21;rz=a['length']/2-.105;base=a['baseY']+.105
  # Match the near panel stations and keep the real entry gap. A filled
  # convex half-ellipsoid incorrectly sealed that public doorway at distance.
  angles=sorted(set([i*math.tau/n for i in range(n)]+[45*math.tau/64,51*math.tau/64]))
  vertices=[];faces=[];lookup={};station={};N=len(angles)
  # At250m the single visible envelope balances the real105mm frame and
  # glazing surfaces. Keep the crown and separate lower C rim full-size.
  for layer,offset in enumerate((-.055,.060) if level==3 else (-.03,.105)):
   for j in range(bands+1):
    t=j*math.pi/(2*bands)
    for i,u in enumerate(angles):
     q=[rx*math.cos(t)*math.cos(u),base+ry*math.sin(t),a['centerZ']+rz*math.cos(t)*math.sin(u)]
     normal=[math.cos(t)*math.cos(u)/rx,math.sin(t)/ry,math.cos(t)*math.sin(u)/rz]
     fitted=.105 if level==3 and layer==1 and j==bands else offset
     length=math.sqrt(sum(v*v for v in normal));point=tuple(q[k]+fitted*normal[k]/length for k in range(3));ident=key(point)
     if ident not in lookup:lookup[ident]=len(vertices);vertices.append(point)
     station[layer,j,i]=lookup[ident]
  active={(j,i) for j in range(bands) for i in range(N)
          if not(j==0 and 45*math.tau/64-EPS<=(angles[i]+(angles[(i+1)%N]+(math.tau if i+1==N else 0)))/2<=51*math.tau/64+EPS)}
  def face(ids):
   unique=[]
   for v in ids:
    if not unique or unique[-1]!=v:unique.append(v)
   if len(unique)>1 and unique[0]==unique[-1]:unique.pop()
   if len(set(unique))>=3:faces.append(tuple(unique))
  for j,i in sorted(active):
   nxt=(i+1)%N
   for layer in(0,1):
    ids=[station[layer,j,i],station[layer,j,nxt],station[layer,j+1,nxt],station[layer,j+1,i]]
    face(ids if layer else list(reversed(ids)))
   for neighbour,edge in [((j-1,i),[(j,i),(j,nxt)]),((j+1,i),[(j+1,nxt),(j+1,i)]),
                          ((j,(i-1)%N),[(j+1,i),(j,i)]),((j,nxt),[(j,nxt),(j+1,nxt)])]:
    if neighbour in active:continue
    v,w=edge;face([station[0,*v],station[0,*w],station[1,*w],station[1,*v]])
  m.indexed(vertices,faces,'dome_glaze')
  if level==3:
   # These seven real doorway beams project tangentially beyond the shell.
   # Reuse their snapped centerlines; the source has only the right jamb.
   prototypes={p['id']:p for p in D['prototypes']};beams=[]
   for inst in D['instances']:
    proto=prototypes[inst['prototype']]
    if proto['art']['kind']!='dome_dense':continue
    at=[snap(v) for v in inst['at']];c,s=axes(inst['yaw'])
    for beam in proto['art']['beams']:
     beams.append([[at[0]+c*p[0]+s*p[2],at[1]+p[1],at[2]-s*p[0]+c*p[2]] for p in beam])
   def portal(j,i):
    t=j*math.pi/16;u=i*math.tau/64
    return [rx*math.cos(t)*math.cos(u),base+ry*math.sin(t),a['centerZ']+rz*math.cos(t)*math.sin(u)]
   wanted=[(portal(0,51),portal(1,51))]+[(portal(1,i),portal(1,i+1)) for i in range(45,51)]
   for start,end in wanted:
    def distance(beam):return min(max(math.dist(beam[0],start),math.dist(beam[1],end)),max(math.dist(beam[1],start),math.dist(beam[0],end)))
    beam=min(beams,key=distance)
    if distance(beam)>.002:raise ValueError('Missing authored AquaDome portal frame')
    m.tube(beam,.105,'steel',n=6)
  if level==2:
   # Retain every triangulated frame line, but join its hidden segment caps.
   # Canonical stations differ from snapped near members by less than1mm.
   def station(j,i):
    t=j*math.pi/16;u=i*math.tau/64
    return [rx*math.cos(t)*math.cos(u),base+ry*math.sin(t),D['aquadome']['centerZ']+rz*math.cos(t)*math.sin(u)]
   for i in range(64):
    first=1 if 45<=i<=50 else 0
    m.tube([station(j,i) for j in range(first,9)],.105,'steel',n=6,transport=True)
    # The diagonal's five-sided profile is within20.1mm of its105mm
    # circular radius; primary meridians and horizontal rings retain six.
    m.tube([station(j,i+j) for j in range(first,9)],.105,'steel',n=5,transport=True)
   for j in range(8):
    indexes=range(51,110) if j==0 else range(65)
    m.tube([station(j,i) for i in indexes],.105,'steel',n=6)
  if level>=3:
   # A continuous C-shaped lower frame preserves the real doorway and the
   # published lowest edge. Hidden caps between its old64 beam pieces vanish.
   rings=[]
   for i in range(51,110):
    a=i*math.tau/64;nx=math.cos(a)/rx;nz=math.sin(a)/rz;length=math.hypot(nx,nz);nx/=length;nz/=length
    center=[rx*math.cos(a),base,D['aquadome']['centerZ']+rz*math.sin(a)]
    rings.append([[center[0]+nx*r,center[1]+y,center[2]+nz*r] for r,y in[(.105,0),(0,.105),(-.105,0),(0,-.105)]])
   if level>=4:
    # Keep the visible lower outline as a paired vertical ribbon. The
    # original round frame is at most105mm from it; its lowest point stays.
    for i in range(len(rings)-1):
     # Independent paired quads have no volumetric cut cap. Treating the
     # whole curved ribbon as one solid would cap its separated cell cuts.
     m.indexed([rings[i][1],rings[i][3],rings[i+1][3],rings[i+1][1]],[(0,1,2,3),(3,2,1,0)],'steel')
   else:m.loft(rings,'steel')
 elif kind.startswith('funnel_'):
  # One closed tapered shell retains every real color station. Separate
  # band caps were hidden inside the joined funnel and consumed cell budgets.
  prototypes={p['id']:p for p in D['prototypes']};rings=[];tags=[];n=20
  instances=sorted((i for i in D['instances'] if i['id'].startswith(kind+'_band')),key=lambda i:int(i['id'].rsplit('band',1)[1]))
  for instance in instances:
   p=prototypes[instance['prototype']];at=[snap(v) for v in instance['at']];c,s=axes(instance['yaw'])
   source=[]
   for y,rx,rz,shift in p['art']['profile']:
    source.append([[at[0]+c*rx*math.cos(k*math.tau/n)+s*(shift+rz*math.sin(k*math.tau/n)),
                    at[1]+y,at[2]-s*rx*math.cos(k*math.tau/n)+c*(shift+rz*math.sin(k*math.tau/n))] for k in range(n)])
   if rings:
    assert max(math.dist(a,b) for a,b in zip(rings[-1],source[0]))<.002
    rings[-1]=[[(a[k]+b[k])/2 for k in range(3)] for a,b in zip(rings[-1],source[0])]
   else:rings.append(source[0])
   rings.extend(source[1:]);tags.extend([p['art']['finish']]*(len(source)-1))
  start=len(m.f);m.loft(rings,'enamel')
  for band,tag in enumerate(tags):m.tags[start+band*n:start+(band+1)*n]=[tag]*n
 elif kind.startswith('slide_'):far_slides(m,D,int(kind.split('_')[1]))
 elif kind=='forebody_rake' and level>=4:far_forebody(m,D,level)
 elif kind=='forebody_rake':
  xs=[-27+i*54/24 for i in range(25)];ys=[22.6,28.8,30.7,33.5,35.4,38.56];vertices=[];faces=[];tags=[];n=len(xs)*len(ys)
  for depth in(-.18,0):
   for y in ys:
    t=(y-22.6)/(38.56-22.6);flat=8+8*t;center=166-23*t
    for x in xs:
     bend=max(0,min(1,(abs(x)-flat)/(27-flat)))
     vertices.append([x,y,118+(center-118)*math.sqrt(max(0,1-bend*bend))+depth])
  for layer in(0,1):
   for j in range(len(ys)-1):
    for i in range(len(xs)-1):
     a=layer*n+j*len(xs)+i;b=a+1;c=b+len(xs);d=a+len(xs)
     faces.append((a,b,c,d) if layer else(d,c,b,a));tags.append('navy' if layer and j in(1,3) else 'enamel')
  for j in range(len(ys)-1):
   for i in(0,len(xs)-1):
    a=j*len(xs)+i;b=a+len(xs);faces.append((a,b,b+n,a+n));tags.append('enamel')
  for j in(0,len(ys)-1):
   for i in range(len(xs)-1):
    a=j*len(xs)+i;b=a+1;faces.append((a,a+n,b+n,b));tags.append('enamel')
  start=len(m.f);m.indexed(vertices,faces);m.tags[start:]=tags
 else:far_pearl(m,D,level)
 return m
def render(D,build,HERE):
 prototypes={p['id']:p for p in D['prototypes']};instances={i['id']:(number,i) for number,i in enumerate(D['instances'])}
 cache={};raw=Path(os.environ.get('CRUISE_RAW_DIR',HERE/'ref/raw-cells'));raw.mkdir(parents=True,exist_ok=True)
 source=HERE.parents[3]/'content/landmarks/cruise-layout.json'
 index={'version':1,'layoutSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'meshes':[]}
 files=sorted(set(HERE.glob('model*.py'))|set(HERE.glob('slide_courses.py'))|{HERE/'parts.py',HERE/'materials.json',HERE/'signs.json',HERE/'layout_cells.py',HERE/'census.py'})
 source_hash=hashlib.sha256(b''.join(p.name.encode()+b'\0'+p.read_bytes() for p in files)).hexdigest()
 candidate_start=int(os.environ.get('CRUISE_CANDIDATE_START','0'))
 if candidate_start and not os.environ.get('CRUISE_RAW_DIR'):raise ValueError('Partial candidate diagnostics require a separate CRUISE_RAW_DIR')
 limited=bool(os.environ.get('CRUISE_CELL_LIMIT') or os.environ.get('CRUISE_CELL_START') or candidate_start)
 census=bool(os.environ.get('CRUISE_CENSUS')) or limited
 expected=None
 if not census:
  expected=json.loads((HERE/'ref/cell-levels.json').read_text())
  if expected['layoutSHA256']!=index['layoutSHA256'] or expected['sourceSHA256']!=source_hash:
   raise ValueError('Cruise cell census is stale; run census.py before ordinary art discovery/export')
  expected={c['id']:c for c in expected['cells']}
 report={'version':1,'layoutSHA256':index['layoutSHA256'],'sourceSHA256':source_hash,'cells':[],'totals':[0]*6,
         'notes':['True 16 m XYZ cells; temporary per-triangle owners survive every clip and cap.','Identical consecutive candidate appearances share one native level; textured-to-flat is a material distinction.']}
 for cnumber,cell in enumerate(D['cells']):
  if cnumber<int(os.environ.get('CRUISE_CELL_START','0')):continue
  if os.environ.get('CRUISE_CELL_LIMIT') and cnumber>=int(os.environ['CRUISE_CELL_LIMIT']):break
  entry={'id':cell['id'],'origin':cell['origin'],'yaw':cell['yaw'],'levels':[]};counts=[];signatures=[];retained=[];errors=[]
  for level in range(candidate_start,6):
   m=Mesh(level);m.direct_uv=True;lo=cell['bounds']['min'];hi=cell['bounds']['max'];boxes=[];floors=[];panels=[];shells=set()
   for member in cell['members']:
    owner,inst=instances[member['instance']];proto=prototypes[member['prototype']]
    if not visible(inst,proto,level):continue
    rake=level>=3 and inst['id'].startswith('forebody_rake_')
    slide=proto['art']['kind']=='slide' and inst['id'].startswith('slide_') and inst['id'].split('_')[1].isdigit()
    funnel=level>=4 and proto['art']['kind']=='funnel_band'
    distant=rake or slide or funnel or level>=2 and proto['art']['kind']=='dome_dense' or level>=3 and proto['art']['kind']=='pearl'
    shell='forebody_rake' if rake else '_'.join(inst['id'].split('_')[:2]) if slide or funnel else proto['art']['kind'] if distant else None
    if shell in shells:continue
    if distant:shells.add(shell)
    side=pane_side(inst,proto['boxes'][proto['art']['glassBoxes'][0]]) if level<2 and proto['art']['kind']=='window_wall' and proto['art'].get('glassBoxes') else None
    ck=('@'+shell if distant else proto['id'],level,side,inst['section']=='aquatheater')
    if ck not in cache:
     source_mesh=distant_shell(D,shell,level) if distant else Mesh(level)
     if not distant:source_form(source_mesh,proto,build,inst)
     orient(source_mesh)
     source_mesh.face_uv=[atlas([source_mesh.v[i] for i in f],tag,uv) if level<2 else [(0,0)]*len(f)
                          for f,tag,uv in zip(source_mesh.f,source_mesh.tags,source_mesh.uv)]
     cache[ck]=source_mesh
    source_mesh=cache[ck]
    c,s=(1,0) if distant else axes(inst['yaw']);at=[0,0,0] if distant else [snap(v) for v in inst['at']]
    for island,(v0,v1,f0,f1) in enumerate(source_mesh.islands):
     world=[[at[0]+c*x+s*z,at[1]+y,at[2]-s*x+c*z] for x,y,z in source_mesh.v[v0:v1]]
     if not distant and proto['art']['kind']=='dome_dense' and source_mesh.tags[f0] in('dome_glaze','clear'):
      # Independently snapped origins displaced the authored cardinal pane
      # stations by under1mm. Restore each actual symmetry plane before
      # clipping, including the lower rim as well as the roof pole.
      for point in world:
       if abs(point[0])<.003:point[0]=0
       if abs(point[2]-D['aquadome']['centerZ'])<.003:point[2]=D['aquadome']['centerZ']
     minimum=[min(p[k] for p in world) for k in range(3)];maximum=[max(p[k] for p in world) for k in range(3)]
     # Intended back-to-back sheets on a cell boundary belong to the cell
     # whose lower plane contains them. Solids still require positive overlap.
     if any((minimum[k]<lo[k]-EPS or minimum[k]>=hi[k]-EPS) if maximum[k]-minimum[k]<EPS
            else (maximum[k]<=lo[k]+EPS or minimum[k]>=hi[k]-EPS) for k in range(3)):continue
     if level<2 and all(minimum[k]>=lo[k]-EPS and maximum[k]<=hi[k]+EPS for k in range(3)):
      start=len(m.f);m.owner=owner;m.indexed(world,[[i-v0 for i in f] for f in source_mesh.f[f0:f1]])
      m.tags[start:]=source_mesh.tags[f0:f1];m.uv[start:]=source_mesh.face_uv[f0:f1];continue
     faces=[]
     for f in range(f0,f1):
      points=[source_mesh.v[i] for i in source_mesh.f[f]];tag=source_mesh.tags[f]
      faces.append(([world[i-v0] for i in source_mesh.f[f]],source_mesh.face_uv[f],tag))
     if distant and shell=='dome_dense' and island==0:faces=clipped_shell(faces,lo,hi)
     else:
      for k in range(3):
       if minimum[k]<lo[k]-EPS:faces=clipped(faces,k,lo[k],1,source_mesh.convexes[island])
       if maximum[k]>hi[k]+EPS:faces=clipped(faces,k,hi[k],-1,source_mesh.convexes[island])
     if not faces:continue
     category=(proto['category'],proto['art'].get('measurement'))
     is_floor=proto['art']['kind']=='floor' or level>=2 and proto['art']['kind']=='balcony' and maximum[1]-minimum[1]<.3
     if proto['art']['kind']=='balcony' and not is_floor:category=('facade',category[1])
     candidate=floor_of(faces,owner,('floor',category[1]),level>=4) if level>=2 and is_floor else None
     if candidate:floors.append(candidate);continue
     if level>=4 and category[0] in('facade','wall'):
      panel=facade_panel(faces,owner,category,pane_interior(inst))
      if panel:panels.append(panel);continue
     candidate=box_of(faces,owner,category,level>=3) if level>=3 or level==2 and category[0] in('facade','wall') else None
     if candidate:boxes.append(candidate)
     else:append_solid(m,faces,owner)
   if panels:facade_panels(m,panels)
   if boxes:
    merged_boxes(m,boxes)
   if floors:
    merged_floors(m,floors)
   if not m.f:raise ValueError(f"{cell['id']} level{level}: empty real cell; fix ownership or structural far surfaces")
   name=cell['id'][7:]+'_CANDIDATE'+str(level);file=f'{name}.triangles'
   if os.environ.get('CRUISE_CELL_LIMIT'):
    print('diagnostic cell',name,'vertices',len(m.v),'polygons',len(m.f),flush=True)
   m.raw=raw/file;obj=m.object(name,cell['origin']);count=len(obj.data.polygons)
   error=max([0,.0125,.025,.06,.13,.25][level],getattr(m,'far_facade_error',0))
   errors.append(error);counts.append(count);report['totals'][level]+=count;signature=appearance_signature(obj,m.textured);signatures.append(signature)
   if len(signatures)>1 and signature==signatures[-2]:
    mesh=obj.data;bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(mesh);m.raw.unlink();Path(str(m.raw)+'.clear').unlink();continue
   native=len(retained);retained.append(level)
   actual=cell['id'][7:]+('' if native==0 else '_LOD'+str(native));obj.name=actual;obj.data.name=actual
   actualfile=actual+'.triangles';m.raw.replace(raw/actualfile)
   clearfile=actualfile+'.clear';Path(str(m.raw)+'.clear').replace(raw/clearfile)
   entry['levels'].append({'level':native,'authoredLevel':level,'file':actualfile,'clearFile':clearfile,'triangles':count,'statedError':error})
  entry['flat']=sum(level<2 for level in retained)
  if expected and (expected[cell['id']]['retained']!=retained or expected[cell['id']]['triangles']!=counts or expected[cell['id']]['errors']!=errors):
   raise ValueError(cell['id']+': exported candidates differ from the committed pre-export census')
  report['cells'].append({'id':cell['id'],'triangles':counts,'errors':errors,'signatures':signatures,'retained':retained,'flat':entry['flat']});index['meshes'].append(entry)
  if cnumber%20==0:print('cruise cells',cnumber+1,'/',len(D['cells']),'triangles',counts,flush=True)
 for p in D['prototypes']:
  if p['mesh']=='none' or p['mesh'].startswith('cruise:cell_'):continue
  for level,source_level in enumerate((0,5)):
   m=Mesh(source_level);m.textured=level==0;build(m,p);m.object(p['mesh'][7:]+('' if level==0 else '_LOD'+str(level)),[0,0,0])
 if limited:
  (raw/'diagnostic-report.json').write_text(json.dumps(report,indent=2)+'\n')
  (raw/'diagnostic-index.json').write_text(json.dumps(index,indent=2)+'\n')
 else:
  (raw/'index.json').write_text(json.dumps(index,indent=2)+'\n')
  (HERE/'ref/geometry-report.json').write_text(compact_records(report))
  if census:
   table={k:report[k] for k in('version','layoutSHA256','sourceSHA256')}
   table['cells']=[{k:c[k] for k in('id','triangles','errors','retained','flat')} for c in report['cells']]
   (HERE/'ref/cell-levels.json').write_text(compact_records(table))
 print('cruise cell totals',report['totals'],flush=True)
