"""Finish UV topology on the actual continuous skin, then expose bake fields.

Projection of an overlapping muscle blockout is never used as the final UV
parameterization. We transfer skin weights separately in model.py, cut connected
anatomical seams here, and unwrap the union before painting into its atlas.
"""
from pathlib import Path
import heapq
import json
import math
import subprocess
import bpy
import bmesh
import numpy as np
import rig


def seam_anatomy(obj):
    mesh = obj.data
    labels = mesh.attributes['anatomical_chart']
    edge_faces = [[] for _ in mesh.edges]
    edge_lookup = {tuple(sorted(e.vertices)): e.index for e in mesh.edges}
    vertices = [rig.E(v.co) for v in mesh.vertices]
    groups = {}
    for face in mesh.polygons:
        chart = labels.data[face.index].value
        groups.setdefault(chart, set()).update(face.vertices)
        for edge in face.edge_keys:
            if chart==1:
                center=rig.E(face.center)
                section=0 if center.z < -1.9 else 1 if center.z < 1.5 else 2 if center.z < 2.35 else 3
                seam_chart=100+section*2+(1 if center.x>0 else 0)
            else:seam_chart=chart
            edge_faces[edge_lookup[tuple(sorted(edge))]].append(seam_chart)
    for edge, faces in zip(mesh.edges, edge_faces):
        if len(set(faces)) > 1:
            edge.use_seam = True
    adjacency = [[] for _ in vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        length = (vertices[a] - vertices[b]).length
        adjacency[a].append((b, edge.index, length))
        adjacency[b].append((a, edge.index, length))

    def path(start, ends, allowed, cost):
        best = {start: 0.0}
        previous = {}
        queue = [(0.0, start)]
        end = None
        while queue:
            distance, at = heapq.heappop(queue)
            if distance != best[at]:
                continue
            if at in ends:
                end = at
                break
            for to, edge, length in adjacency[at]:
                if to not in allowed:
                    continue
                candidate = distance + length * cost(vertices[to])
                if candidate < best.get(to, math.inf):
                    best[to] = candidate
                    previous[to] = (at, edge)
                    heapq.heappush(queue, (candidate, to))
        while end in previous:
            end, edge = previous[end]
            mesh.edges[edge].use_seam = True

    # The single trunk/tail chart opens on the ventral midline, out of the
    # principal side and top views. The cut reaches both closed tips.
    body = groups[1]
    start = min(body, key=lambda i: vertices[i].z)
    end = max(body, key=lambda i: vertices[i].z)
    path(start, {end}, body,
         lambda p: 1 + 12 * abs(p.x) + 8 * max(0, p.y - 1.25))
    # A separated arm/leg leaves a hole in each torso side. Connect that
    # attachment ring to the ventral cut, as in an authored creature unwrap;
    # otherwise the solver collapses the crotch while trying to flatten a
    # multiply-connected torso island.
    belly_seam={i for i in body if abs(vertices[i].x)<.045 and vertices[i].y<1.45}
    for chart,members in groups.items():
        if chart==1 or len(members)<200:continue
        attachment=members&body
        if attachment and belly_seam:
            start=min(attachment,key=lambda i:vertices[i].y)
            path(start,belly_seam,body,lambda p:1+3*max(0,p.y-1.15))
    # Each limb chart opens down its medial/underside surface from the buried
    # shoulder/hip boundary to the end of the foot.
    for chart, members in groups.items():
        if chart == 1 or len(members) < 20:
            continue
        boundary = {v for e in mesh.edges if e.use_seam for v in e.vertices if v in members}
        if not boundary:
            continue
        start = min(members, key=lambda i: vertices[i].y)
        # A toe's material boundary is not the limb-root boundary. Opening to
        # the nearest hole leaves the long sleeve closed and collapses its UVs.
        root_height=max(vertices[i].y for i in boundary)
        root_boundary={i for i in boundary if vertices[i].y>root_height-.08}
        path(start, root_boundary, members, lambda p: 1 + 2 * abs(p.x))


def existing_seams(mesh):
    """Keep the designed seams on closed face/plate/spike components."""
    uv = mesh.uv_layers.active.data
    anatomy = mesh.attributes.get('anatomical_chart')
    records = {}
    for face in mesh.polygons:
        loops = list(face.loop_indices)
        for a, b in zip(loops, loops[1:] + loops[:1]):
            va, vb = mesh.loops[a].vertex_index, mesh.loops[b].vertex_index
            key = tuple(sorted((va, vb)))
            pair = (tuple(uv[a].uv), tuple(uv[b].uv)) if va < vb else (tuple(uv[b].uv), tuple(uv[a].uv))
            records.setdefault(key, []).append((pair, face.material_index, anatomy.data[face.index].value if anatomy else 0))
    for edge in mesh.edges:
        entries = records.get(tuple(sorted(edge.vertices)), [])
        if len(entries)==2 and entries[0][2]>0 and entries[1][2]>0:
            # Original overlapping muscle UVs are paint metadata only. The
            # actual union already has explicit connected anatomical seams.
            if entries[0][1]!=entries[1][1]:edge.use_seam=True
        elif len(entries) != 2 or entries[0][:2] != entries[1][:2]:
            edge.use_seam = True


def seam_orbits(mesh):
    """Open each recessed orbital bowl at its concealed anatomical rim.

    A deep bowl forced into the whole cheek island can fold a tiny Boolean
    rim triangle. The cavity receives one coherent disk chart; its geometry
    and native precision gates remain unchanged.
    """
    mesh.update()
    regions=[]
    for face in mesh.polygons:
        p=rig.E(face.center);normal=rig.E(face.normal);region=0
        for side in [-1,1]:
            d=np.array([p.x-side*.223,p.y-1.322,p.z-rig.shape((0,0,3.025))[2]])
            radius=np.array([.033,.031,.037]);q=d/radius
            gradient=d/(radius*radius)
            facing=float(np.dot(np.array(normal),gradient))/max(1e-9,float(np.linalg.norm(gradient)))
            if .84<float(np.dot(q,q))<1.025 and facing<-.35:region=side
        regions.append(region)
    adjacent={}
    for face in mesh.polygons:
        for edge in face.edge_keys:adjacent.setdefault(tuple(sorted(edge)),[]).append(regions[face.index])
    for edge in mesh.edges:
        group=adjacent[tuple(sorted(edge.vertices))]
        if len(set(group))>1:edge.use_seam=True


def prioritize_charts(bm, material):
    """Allocate face/foot detail intentionally within the existing 2048 atlas."""
    uv=bm.loops.layers.uv.active
    unseen={f for f in bm.faces if f.material_index==material}
    while unseen:
        start=unseen.pop();island={start};pending=[start]
        while pending:
            face=pending.pop()
            for edge in face.edges:
                if edge.seam:continue
                for other in edge.link_faces:
                    if other in unseen:
                        unseen.remove(other);island.add(other);pending.append(other)
        vertices={v for f in island for v in f.verts}
        center=sum((rig.E(v.co)for v in vertices),rig.E((0,0,0)))/len(vertices)
        factor=2.1 if center.z>2.35 else 1.35 if center.y<.4 else 1
        if factor==1:continue
        loops=[loop for f in island for loop in f.loops]
        midpoint=sum((loop[uv].uv.copy()for loop in loops),loops[0][uv].uv.copy()*0)/len(loops)
        for loop in loops:loop[uv].uv=midpoint+(loop[uv].uv-midpoint)*factor


def stabilize_uv_precision(mesh):
    """Relax sub-texel slivers against the actual stored 16-bit UV grid.

    This edits the authored charts before tangent generation. Every face must
    retain its island orientation with nonzero area after packing; no checker
    tolerance, per-triangle island, or lighting exception is introduced.
    """
    mesh.calc_loop_triangles()
    data=mesh.uv_layers.active.data
    ids={};points=[];loop_nodes=[]
    for loop,q in zip(mesh.loops,data):
        key=(loop.vertex_index,*q.uv)
        if key not in ids:ids[key]=len(points);points.append(tuple(q.uv))
        loop_nodes.append(ids[key])
    triangles=np.array([[loop_nodes[i]for i in t.loops]for t in mesh.loop_triangles],dtype=np.int32)
    uv=np.asarray(points,dtype=np.float64);original=uv.copy()
    parents=list(range(len(points)))
    def find(a):
        while parents[a]!=a:parents[a]=parents[parents[a]];a=parents[a]
        return a
    for a,b,c in triangles:
        parents[find(b)]=find(a);parents[find(c)]=find(a)
    roots=np.array([find(int(t[0]))for t in triangles])
    def areas(q):
        a,b,c=q[triangles[:,0]],q[triangles[:,1]],q[triangles[:,2]]
        return (b[:,0]-a[:,0])*(c[:,1]-a[:,1])-(c[:,0]-a[:,0])*(b[:,1]-a[:,1])
    initial=areas(uv);dominant={r:1 if initial[roots==r].sum()>=0 else -1 for r in set(roots)}
    signs=np.array([dominant[r]for r in roots]);minimum=64/(65535*65535)
    before=int(np.sum(signs*areas(np.round(uv*65535)/65535)<=0))
    for iteration in range(200):
        q=np.round(uv*65535)/65535
        bad=np.where(signs*areas(q)<minimum)[0]
        if not len(bad):uv=q;break
        for idx in bad:
            corners=triangles[idx];a,b,c=uv[corners];sign=signs[idx]
            area=sign*((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))
            gradient=sign*np.array([[b[1]-c[1],c[0]-b[0]],[c[1]-a[1],a[0]-c[0]],[a[1]-b[1],b[0]-a[0]]])
            norm=np.sum(gradient*gradient)
            if norm>1e-20:uv[corners]+=gradient*((minimum*2-area)/norm)
    quantized=np.round(uv*65535)/65535
    # A nearly collinear shared face can round back across its long edge
    # even after the continuous correction. Move one chart vertex on the
    # exact packed lattice, checking every adjacent triangle at each trial.
    grid=np.rint(quantized*65535).astype(np.int64)
    for idx in np.where(signs*areas(quantized)<=0)[0]:
        for node in triangles[idx]:
            incident=np.flatnonzero(np.any(triangles==node,axis=1))
            local=triangles[incident]
            def local_areas():
                a,b,c=grid[local[:,0]],grid[local[:,1]],grid[local[:,2]]
                return signs[incident]*((b[:,0]-a[:,0])*(c[:,1]-a[:,1])-(c[:,0]-a[:,0])*(b[:,1]-a[:,1]))
            if np.all(local_areas()>0):break
            start=grid[node].copy();best=None
            for dx,dy in sorted(((x,y) for x in range(-8,9) for y in range(-8,9)),key=lambda q:q[0]*q[0]+q[1]*q[1]):
                grid[node]=start+(dx,dy)
                if np.all(local_areas()>0):best=grid[node].copy();break
            grid[node]=start if best is None else best
            if best is not None:break
    quantized=grid/65535
    remaining=int(np.sum(signs*areas(quantized)<=0))
    if remaining:
        failed=[]
        for index in np.where(signs*areas(quantized)<=0)[0]:
            tri=mesh.loop_triangles[int(index)]
            failed.append({'triangle':int(index),'positions':[list(rig.E(mesh.vertices[v].co))for v in tri.vertices],'uv':quantized[triangles[index]].tolist(),'area':float(areas(quantized)[index]),'sign':int(signs[index])})
        (Path.cwd()/'var/stego-review/uv-failed.json').write_text(json.dumps(failed,indent=2))
        raise RuntimeError(f'{remaining} UV faces remain inverted at native precision')
    for loop,node in enumerate(loop_nodes):data[loop].uv=quantized[node]
    report={'initial_quantized_inversions':before,'remaining':remaining,'iterations':iteration+1,'maximum_move_pixels_at_2048':float(np.max(np.linalg.norm(quantized-original,axis=-1))*2048)}
    (Path.cwd()/'var/stego-review/uv-precision.json').write_text(json.dumps(report,indent=2))


def unwrap_and_bake_fields(obj):
    mesh = obj.data
    existing_seams(mesh)
    old = np.array([tuple(q.uv) for q in mesh.uv_layers.active.data], dtype=np.float32)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # Each material owns a full atlas. Island padding is real texture space,
    # including the later sixteen-pixel dilated border.
    for material in range(2):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='DESELECT')
        bm = bmesh.from_edit_mesh(mesh)
        for face in bm.faces:
            face.hide_set(face.material_index != material)
            face.select_set(face.material_index == material)
        bmesh.update_edit_mesh(mesh)
        bpy.ops.uv.unwrap(method='MINIMUM_STRETCH', no_flip=True, iterations=64, margin=.009)
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.average_islands_scale()
        prioritize_charts(bmesh.from_edit_mesh(mesh),material)
        bmesh.update_edit_mesh(mesh)
        bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION', margin=.009)
        bpy.ops.mesh.reveal(select=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    out = Path.cwd() / 'var/stego-review'
    out.mkdir(parents=True, exist_ok=True)
    stabilize_uv_precision(mesh)
    mesh.calc_loop_triangles()
    mesh.calc_tangents(uvmap=mesh.uv_layers.active.name)
    size = 2048
    for material, name in enumerate(['stego_skin', 'stego_horn']):
        plate_order = mesh.attributes["plate_order"]
        fields = np.zeros((size, size, 13), dtype=np.float32)
        valid = np.zeros((size, size), dtype=bool)
        for tri in mesh.loop_triangles:
            if mesh.polygons[tri.polygon_index].material_index != material:
                continue
            loops = list(tri.loops)
            uv = np.array([tuple(mesh.uv_layers.active.data[i].uv) for i in loops])
            uv[:, 1] = 1 - uv[:, 1]
            uv = uv * size - .5
            lo = np.maximum(0, np.floor(uv.min(axis=0)).astype(int))
            hi = np.minimum(size-1, np.ceil(uv.max(axis=0)).astype(int))
            if np.any(hi < lo):
                continue
            a, b, c = uv
            det = (b[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(b[1]-a[1])
            if abs(det) < 1e-10:
                continue
            yy, xx = np.mgrid[lo[1]:hi[1]+1, lo[0]:hi[0]+1]
            w1 = ((xx-a[0])*(c[1]-a[1]) - (yy-a[1])*(c[0]-a[0])) / det
            w2 = ((b[0]-a[0])*(yy-a[1]) - (b[1]-a[1])*(xx-a[0])) / det
            w0 = 1-w1-w2
            inside = (w0 >= -1e-5) & (w1 >= -1e-5) & (w2 >= -1e-5)
            values=[]
            for i in loops:
                loop=mesh.loops[i]
                values.append([*rig.E(mesh.vertices[loop.vertex_index].co), *rig.E(loop.normal), *rig.E(loop.tangent), loop.bitangent_sign, *old[i], plate_order.data[tri.polygon_index].value])
            values=np.asarray(values,dtype=np.float32)
            interpolated=w0[...,None]*values[0]+w1[...,None]*values[1]+w2[...,None]*values[2]
            fields[lo[1]:hi[1]+1,lo[0]:hi[0]+1][inside]=interpolated[inside]
            valid[lo[1]:hi[1]+1,lo[0]:hi[0]+1][inside]=True
        np.savez_compressed(out/(name+'-fields.npz'),fields=fields,valid=valid)
    subprocess.run(['python3', str(rig.ROOT/'tex/paint.py'), '--fields', str(out)], check=True)
    for image in bpy.data.images:
        if image.filepath and image.name.startswith('stego_'):
            image.reload()
