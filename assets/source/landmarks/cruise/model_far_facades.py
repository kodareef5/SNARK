"""Paired distant facade sheets and the raised bow's closed outside skin.

These helpers are for authored far candidates only. They never change collision
or the detailed source pieces. Facade occupancy keeps real openings; neighboring
small facade depth steps become a bounded continuous field, without inner caps.
"""
import math
from collections import defaultdict

EPS = 1e-5
# Source spatial identity, independent of generated cell numbering. The stepped
# promenade fronts here need a measured 140 mm visible error, approved separately.
PROMENADE_ERROR_CELL = (-2, 1, 6)


def _visible_error(boxes):
    grid = tuple(math.floor((min(b['lo'][a] for b in boxes)+max(b['hi'][a] for b in boxes))/32)
                 for a in range(3))
    return .14 if grid == PROMENADE_ERROR_CELL else .13


def _emit(mesh, vertices, faces, tags, owner):
    """Join coplanar same-colour faces before the ordinary native triangulator."""
    import bmesh
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in vertices]
    names = sorted(set(tags))
    for face, tag in zip(faces, tags):
        bm.faces.new([vs[i] for i in face]).material_index = names.index(tag)
    # Removing an internal edge can expose another collinear boundary vertex.
    # Repeat topology cleanup, never a distance-based decimation or a hole fill.
    for _ in range(3):
        bm.normal_update()
        old = (len(bm.faces), len(bm.verts))
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and
                 e.link_faces[0].material_index == e.link_faces[1].material_index and
                 e.link_faces[0].normal.dot(e.link_faces[1].normal) > .99999]
        if edges:
            bmesh.ops.dissolve_edges(bm, edges=edges, use_verts=False, use_face_split=False)
        straight = []
        for vertex in bm.verts:
            if len(vertex.link_edges) != 2:
                continue
            a, b = [edge.other_vert(vertex).co-vertex.co for edge in vertex.link_edges]
            # Blender stores world-metre positions as float32. Compare the
            # perpendicular distance, not an unscaled cross-product, so a
            # few micrometres of rounding cannot keep dozens of false corners.
            if a.dot(b) < 0 and a.cross(b).length <= 1e-5*(a.length+b.length):
                straight.append(vertex)
        if straight:
            bmesh.ops.dissolve_verts(bm, verts=straight, use_face_split=False, use_boundary_tear=False)
        if old == (len(bm.faces), len(bm.verts)):
            break
    if mesh.level >= 4:
        # Mirror the SAME triangulation. Independently tessellated material
        # bands on opposite sheet sides produce unmatched collinear edges.
        bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method='BEAUTY', ngon_method='BEAUTY')
    bm.verts.index_update()
    start = len(mesh.f)
    mesh.owner = owner
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    tags = [names[f.material_index] for f in bm.faces]
    if mesh.level >= 4:
        faces += [tuple(reversed(face)) for face in faces]
        tags += tags[:]
    mesh.indexed([tuple(v.co) for v in bm.verts], faces)
    mesh.tags[start:] = tags
    bm.free()


def _section(box, along, value):
    """Main-face depth interval, bounded by its actual 16 m source cell."""
    polygon = box.get('polygon')
    axis = 2-along
    if 'line' in box:
        slope, lo, hi = box['line']
        center = (box['lo'][axis]+box['hi'][axis])/2
        cell = math.floor(center/16)*16
        return max(cell, slope*value+lo), min(cell+16, slope*value+hi)
    if polygon is None:
        return box['lo'][axis], box['hi'][axis]
    value = min(box['hi'][along], max(box['lo'][along], value))
    hits = []
    for a, b in zip(polygon, polygon[1:]+polygon[:1]):
        if min(a[along], b[along])-EPS <= value <= max(a[along], b[along])+EPS:
            if abs(b[along]-a[along]) < EPS:
                hits.extend((a[axis], b[axis]))
            else:
                t = (value-a[along])/(b[along]-a[along])
                hits.append(a[axis]+t*(b[axis]-a[axis]))
    return min(hits), max(hits)


def facade_panel(faces, owner, category, interior=(0, 0)):
    """Recognize a clipped, possibly rotated vertical box without using its AABB.

    Only convex horizontal extrusions with two Y endpoints are accepted. The
    raised sloping skin, floors and other authored forms stay in their own path.
    """
    points = [p for face, _, _ in faces for p in face]
    if not points:
        return None
    ys = sorted({round(p[1], 6) for p in points})
    if len(ys) != 2 or ys[1]-ys[0] < EPS:
        return None
    ps = sorted({(round(p[0], 6), round(p[2], 6)) for p in points})
    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    lower, upper = [], []
    for point in ps:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 1e-10:
            lower.pop()
        lower.append(point)
    for point in reversed(ps):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 1e-10:
            upper.pop()
        upper.append(point)
    plan = lower[:-1]+upper[:-1]
    if len(plan) < 3:
        return None
    a, b = max(zip(plan, plan[1:]+plan[:1]), key=lambda ab:math.dist(*ab))
    dx, dz = b[0]-a[0], b[1]-a[1]
    length = math.hypot(dx, dz)
    normal = (-dz/length, dx/length)
    depths = [x*normal[0]+z*normal[1] for x, z in plan]
    if max(depths)-min(depths) > .30+EPS:
        return None
    axis = 0 if abs(dz) >= abs(dx) else 2
    along = 2-axis
    polygon = [(x, 0, z) for x, z in plan]
    slope = (b[0]-a[0])/(b[1]-a[1]) if axis == 0 else (b[1]-a[1])/(b[0]-a[0])
    offsets = [p[axis]-slope*p[along] for p in polygon]
    lo = [min(p[k] for p in points) for k in range(3)]
    hi = [max(p[k] for p in points) for k in range(3)]
    front = 1 if (lo[axis]+hi[axis])/2 >= interior[axis//2] else 0
    sign = 1 if front else -1
    broad = [(a, b) for a, b in zip(polygon, polygon[1:]+polygon[:1])
             if ((b[2]-a[2]) if axis == 0 else (a[0]-b[0]))*sign > EPS]
    if not broad:
        return None
    a, b = max(broad, key=lambda ab:abs(ab[1][along]-ab[0][along]))
    # The outer face's ends define the visible aperture. Using the whole
    # rotated box's AABB would extend a jamb into a real doorway by its depth.
    lo[along], hi[along] = min(a[along], b[along]), max(a[along], b[along])
    # Same 5 mm far-only seam reconciliation as box_of; depth follows the
    # actual sloping face equations, not a world-axis bounding-box wall.
    for k in (along, 1):
        lo[k] = round(lo[k]*200)/200
        hi[k] = round(hi[k]*200)/200
    tag = 'navy' if any(tag == 'navy' for _, _, tag in faces) else faces[0][2]
    return {'lo':lo, 'hi':hi, 'tags':(tag,)*6, 'owner':owner,
            'category':category, 'polygon':polygon, 'axis':axis,
            'line':(slope, min(offsets), max(offsets)),
            'front':front}


def facade_panels(mesh, panels):
    """Join only adjacent, similarly facing strips; never distant canyon walls."""
    groups = defaultdict(list)
    for panel in panels:
        axis = panel['axis']
        side = panel['front']
        groups[(tuple(panel['category']), axis, side)].append(panel)
    for (_, axis, _), group in groups.items():
        along = 2-axis
        parent = list(range(len(group)))
        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        for i, a in enumerate(group):
            for j, b in enumerate(group[:i]):
                u0, u1 = max(a['lo'][along], b['lo'][along]), min(a['hi'][along], b['hi'][along])
                y0, y1 = max(a['lo'][1], b['lo'][1]), min(a['hi'][1], b['hi'][1])
                if u1 < u0-EPS or y1 < y0-.35-EPS:
                    continue
                u = (u0+u1)/2
                da, db = _section(a, along, u), _section(b, along, u)
                if abs(sum(da)-sum(db)) <= .52+EPS:
                    parent[find(i)] = find(j)
        components = defaultdict(list)
        for i, panel in enumerate(group):
            components[find(i)].append(panel)
        for component in components.values():
            facade_surface(mesh, component, axis)


def facade_surface(mesh, boxes, axis):
    """Append paired colour-band sheets. Caller groups one neighboring facade.

    Axis is its thin X or Z direction. Box groups must share category/measurement;
    distant parallel walls remain separate groups. Local center differences above
    0.26 m stay separate components, retaining substantial architectural steps.
    """
    if mesh.level < 4:
        raise ValueError('Facade sheets are only authored candidates 4/5')
    if axis not in (0, 2) or not boxes:
        raise ValueError('A facade needs boxes and an X/Z thickness axis')
    if any(b['category'] != boxes[0]['category'] for b in boxes):
        raise ValueError('Facade categories and measurement ownership cannot mix')
    declared_error = _visible_error(boxes)
    allowance = .139 if declared_error == .14 else .125
    mesh.far_facade_error = max(getattr(mesh, 'far_facade_error', 0), declared_error)
    along = 2-axis
    us = sorted({b[s][along] for b in boxes for s in ('lo', 'hi')})
    ys = sorted({b[s][1] for b in boxes for s in ('lo', 'hi')})
    low = min(b['lo'][axis] for b in boxes)
    high = max(b['hi'][axis] for b in boxes)
    front = boxes[0].get('front', 1 if low+high > 0 else 0)
    occupied = {}
    depth = {}
    profile = {}
    for u in range(len(us)-1):
        for y in range(len(ys)-1):
            cu, cy = (us[u]+us[u+1])/2, (ys[y]+ys[y+1])/2
            covering = [b for b in boxes if b['lo'][along]-EPS <= cu <= b['hi'][along]+EPS and
                        b['lo'][1]-EPS <= cy <= b['hi'][1]+EPS]
            if covering:
                occupied[u, y] = next((b for b in covering if b['tags'][axis*2+front] == 'navy'),
                                      covering[0])['tags'][axis*2+front]
                sections = [_section(b, along, cu) for b in covering]
                depth[u, y] = (min(d[0] for d in sections), max(d[1] for d in sections))
    # Retain the established far treatment of narrow mullion/floor seams. Wide
    # entrance gaps remain absent cells, with their own real closed jamb surfaces.
    for y in range(len(ys)-1):
        dark = [u for u in range(len(us)-1) if occupied.get((u, y)) == 'navy']
        if dark:
            if us[dark[0]]-us[0] <= .35:
                for u in range(dark[0]):
                    occupied[u, y] = 'navy'
            if us[-1]-us[dark[-1]+1] <= .35:
                for u in range(dark[-1]+1, len(us)-1):
                    occupied[u, y] = 'navy'
        for a, b in zip(dark, dark[1:]):
            if b > a+1 and us[b]-us[a+1] <= .65:
                for u in range(a+1, b):
                    occupied[u, y] = 'navy'
    # Distant glazing is a horizontal colour band. Repaint only a narrow
    # minority of white mullions inside an already occupied connected run;
    # never create occupancy or bridge a true doorway with this colour step.
    for y in range(len(ys)-1):
        run = []
        def band(cells):
            width = sum(us[u+1]-us[u] for u in cells)
            blue = sum(us[u+1]-us[u] for u in cells if occupied[u, y] == 'navy')
            if width >= 3 and blue/width >= .5:
                for u in cells:
                    occupied[u, y] = 'navy'
        for u in range(len(us)-1):
            if (u, y) in occupied:
                run.append(u)
            elif run:
                band(run)
                run = []
        if run:
            band(run)
    for u in range(len(us)-1):
        filled = [y for y in range(len(ys)-1) if (u, y) in occupied]
        for a, b in zip(filled, filled[1:]):
            if b > a+1 and ys[b]-ys[a+1] <= .35:
                for y in range(a+1, b):
                    occupied[u, y] = 'enamel'
    # A column's frame and glazing already describe one thin wall. Their inset
    # is surface detail at these distances; retain it in the error constraints.
    for u in range(len(us)-1):
        column = [d for (x, _), d in depth.items() if x == u]
        if not column:
            continue
        lo, hi = min(d[0] for d in column), max(d[1] for d in column)
        covering = [b for b in boxes if b['lo'][along]-EPS <= (us[u]+us[u+1])/2 <= b['hi'][along]+EPS]
        ends = []
        for value in (us[u], us[u+1]):
            ds = [_section(b, along, value) for b in covering]
            ends.append((min(d[0] for d in ds), max(d[1] for d in ds)))
        for key in [k for k in occupied if k[0] == u]:
            if hi-lo <= .30:
                depth[key] = (lo, hi)
                profile[key] = ends
            elif key not in depth:
                nearest = min((k for k in depth if k[0] == u), key=lambda k:abs(k[1]-key[1]))
                depth[key] = depth[nearest]
    for key in occupied:
        if key not in depth:
            nearest = min(depth, key=lambda k:abs(k[0]-key[0])+abs(k[1]-key[1]))
            depth[key] = depth[nearest]
    if mesh.level < 4:
        depth = {key:(low, high) for key in occupied}
        profile = {}
    unseen = set(occupied)
    while unseen:
        seed = min(unseen)
        unseen.remove(seed)
        component = {seed}
        queue = [seed]
        while queue:
            u, y = queue.pop()
            for other in ((u-1, y), (u+1, y), (u, y-1), (u, y+1)):
                if other not in unseen:
                    continue
                if abs(sum(depth[u, y])-sum(depth[other])) > .52+EPS:
                    continue
                unseen.remove(other)
                component.add(other)
                queue.append(other)
        corners = defaultdict(list)
        for u, y in component:
            for key in ((u, y), (u+1, y), (u, y+1), (u+1, y+1)):
                corners[key].append(profile.get((u, y), [depth[u, y]]*2)[key[0]-u])
        # A distant facade reads as a smooth profile through its real panel
        # centers. Fit inside the approved source-face error intervals, retaining
        # extrema and substantial stepped forms. This bounds displacement;
        # the normal native surface-error measurement still records the result.
        by_u = defaultdict(list)
        for (u, y), ds in corners.items():
            by_u[u].extend(ds)
        values, constraints = {}, {}
        ylo = min(ys[y] for _, y in component)
        yhi = max(ys[y+1] for _, y in component)
        for u in by_u:
            contributing = [box for box in boxes if box['lo'][along]-EPS <= us[u] <= box['hi'][along]+EPS and
                            box['lo'][1] < yhi+EPS and box['hi'][1] > ylo-EPS]
            targets = [_section(box, along, us[u])[front] for box in contributing]
            if not targets:
                targets = [d[front] for d in by_u[u]]
            least, most = min(targets), max(targets)
            if most-least > 2*allowance+EPS:
                raise ValueError('A facade depth step exceeds its source-face error allowance')
            center = (least+most)/2
            constraints[u] = (most-allowance, least+allowance)
            # Retain genuine authored measurement extrema, not an invented proxy.
            span = {'deckhouse':28.9, 'bridge':32.9}.get(boxes[0]['category'][1])
            if axis == 0 and span:
                for target in targets:
                    if abs(abs(target)-span) < .003:
                        center = target
                        constraints[u] = (target, target)
            values[u] = (center, center)
        ordered = sorted(values)
        # Fit a line INSIDE every source-face error interval, rather than
        # forcing it through arbitrary central samples. This removes harmless
        # stepped mullion rhythm while giving a bound along each linear panel.
        def fit(start, end, fixed):
            xs = [us[ordered[j]]-us[ordered[start]] for j in range(start, end+1)]
            limits = [constraints[ordered[j]] for j in range(start, end+1)]
            if fixed is not None:
                limits[0] = (fixed, fixed)
            lower, upper = -math.inf, math.inf
            for i in range(len(xs)):
                for j in range(i+1, len(xs)):
                    span = xs[j]-xs[i]
                    lower = max(lower, (limits[j][0]-limits[i][1])/span)
                    upper = min(upper, (limits[j][1]-limits[i][0])/span)
            if lower > upper+1e-10:
                return None
            mid = [(a+b)/2 for a, b in limits]
            mean_x, mean_y = sum(xs)/len(xs), sum(mid)/len(mid)
            variance = sum((x-mean_x)**2 for x in xs)
            slope = sum((x-mean_x)*(y-mean_y) for x, y in zip(xs, mid))/variance if variance else 0
            slope = max(lower, min(upper, slope))
            lo = max(a-slope*x for x, (a, _) in zip(xs, limits))
            hi = min(b-slope*x for x, (_, b) in zip(xs, limits))
            offset = max(lo, min(hi, mean_y-slope*mean_x))
            return slope, offset
        profile_u, start, fixed = {}, 0, None
        while start < len(ordered)-1:
            end, line = start+1, fit(start, start+1, fixed)
            if line is None:
                raise ValueError('Facade profile cannot preserve its source bounds')
            while end+1 < len(ordered):
                candidate = fit(start, end+1, fixed)
                if candidate is None:
                    break
                end, line = end+1, candidate
            slope, offset = line
            for j in range(start, end+1):
                u = ordered[j]
                value = offset+slope*(us[u]-us[ordered[start]])
                profile_u[u] = (value, value)
            fixed = profile_u[ordered[end]][0]
            start = end
        vertices, faces, tags, lookup = [], [], [], {}
        for (u, y), ds in corners.items():
            for side in (0, 1):
                value = profile_u[u][front] if mesh.level >= 4 else profile_u[u][side]
                # Constant portions keep their exact extrema naturally. Do not
                # pin a top-edge corner differently from the same column below:
                # that invents a twist in an otherwise straight facade strip.
                p = [0, ys[y], 0]
                p[axis], p[along] = value, us[u]
                lookup[u, y, side] = len(vertices)
                vertices.append(p)
        for u, y in sorted(component):
            # Same six orientations as Mesh.box; use physical XYZ corner order.
            quad = [lookup[u+du, y+dy, side] for du, dy, side in
                    ((0,0,0),(1,0,0),(0,1,0),(1,1,0),(0,0,1),(1,0,1),(0,1,1),(1,1,1))]
            if axis == 2:
                quad = [quad[k] for k in (0,4,2,6,1,5,3,7)]
            boxfaces = ((0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3))
            for side, face in enumerate(boxfaces):
                a, direction = side//2, side%2
                if mesh.level >= 4 and (a != axis or direction != front):
                    continue
                if a == along and (u+(1 if direction else -1), y) in component:
                    continue
                if a == 1 and (u, y+(1 if direction else -1)) in component:
                    continue
                faces.append(tuple(quad[k] for k in face))
                tags.append(occupied[u, y] if a == axis and direction == front else 'enamel')
        _emit(mesh, vertices, faces, tags, boxes[0]['owner'])



def forebody(mesh, layout, level):
    """Keep the authored outer bow skin and simplify only its pale inner side.

    The outside vertices, navy bands, extrema and silhouette are unchanged.
    Inner rows at 30.7/35.4 m lie at most 0.123225 m outside their retained chords;
    the chords move inward, so they cannot protrude through the outer skin.
    """
    if level < 4:
        raise ValueError('Continuous forebody is a far representation')
    xs = [-27+i*54/24 for i in range(25)]
    ys = [22.6, 28.8, 30.7, 33.5, 35.4, 38.56]
    back = [22.6, 28.8, 33.5, 38.56]
    def row(y, depth):
        t = (y-22.6)/(38.56-22.6)
        flat, center = 8+8*t, 166-23*t
        return [(x, y, 118+(center-118)*math.sqrt(max(0, 1-max(0,min(1,(abs(x)-flat)/(27-flat)))**2))+depth)
                for x in xs]
    vertices = [p for y in back for p in row(y, -.18)]
    offset = len(vertices)
    vertices.extend(p for y in ys for p in row(y, 0))
    width = len(xs)
    faces, tags = [], []
    for j in range(len(back)-1):
        for i in range(width-1):
            a = j*width+i
            faces.append((a+width,a+width+1,a+1,a))
            tags.append('enamel')
    for j in range(len(ys)-1):
        for i in range(width-1):
            a = offset+j*width+i
            faces.append((a,a+1,a+width+1,a+width))
            tags.append('navy' if j in (1,3) else 'enamel')
    for i in (0,width-1):
        faces.append(tuple([j*width+i for j in range(len(back))]+
                           [offset+j*width+i for j in reversed(range(len(ys)))]))
        tags.append('enamel')
    for bj, fj in ((0,0),(len(back)-1,len(ys)-1)):
        for i in range(width-1):
            a, b = bj*width+i, offset+fj*width+i
            faces.append((a,b,b+1,a+1))
            tags.append('enamel')
    start = len(mesh.f)
    mesh.indexed(vertices, faces)
    mesh.tags[start:] = tags
