"""Measure the published saddle surface; no modeller code or Blender imports.

The layout stores a packed stream of UV corners, without polygon arities or
vertex indices. Recover its unique triangle/quad partition from convex UV
polygons and piece ownership. Fit both possible quad diagonals to the current
16-bit position bake, then weld coincident measured corners. All distances and
paths are remeasured on each run; no model-space shape is cached here.
"""
import base64
from functools import lru_cache
import json
from types import SimpleNamespace

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree


def pixels(uv, size, triangles):
    """Texel centres and barycentric corner weights, in polygon order."""
    p = np.asarray(uv, float) * [size, -size] + [0, size]
    lower = np.maximum(np.floor(p.min(0)).astype(int), 0)
    upper = np.minimum(np.ceil(p.max(0)).astype(int), size - 1)
    yy, xx = np.mgrid[lower[1]:upper[1]+1, lower[0]:upper[0]+1]
    weights = np.zeros((*xx.shape, len(p)))
    covered = np.zeros(xx.shape, bool)
    for tri in triangles:
        q = p[list(tri)]
        matrix = np.vstack([q.T, np.ones(3)])
        if abs(np.linalg.det(matrix)) < 1e-10:
            continue
        w = np.linalg.solve(matrix, np.array([xx.ravel()+.5, yy.ravel()+.5, np.ones(xx.size)]))
        w = w.T.reshape(*xx.shape, 3)
        inside = (w >= -1e-6).all(-1)
        weights[inside] = 0
        for k, corner in enumerate(tri):
            weights[..., corner][inside] = w[..., k][inside]
        covered |= inside
    return yy[covered], xx[covered], weights[covered]


def polygons(record, ids, number):
    """Decode the packed corners without consulting the private face builder."""
    uv = np.frombuffer(base64.b64decode(record['uv']), '<f4').reshape(-1, 2)
    count = len(record['face'])
    size = len(ids)

    @lru_cache(None)
    def valid(at, corners, piece):
        q = uv[at:at+corners].astype(float)
        e = np.roll(q, -1, axis=0) - q
        nxt = np.roll(e, -1, axis=0)
        cross = e[:, 0]*nxt[:, 1] - e[:, 1]*nxt[:, 0]
        if not ((cross > 1e-12).all() or (cross < -1e-12).all()):
            return False
        # Interior samples avoid antialiased boundaries and subpixel cut edges.
        samples = np.vstack([q*.4+q.mean(0)*.6, q.mean(0)])
        xy = np.clip((samples*[size, -size]+[0, size]).astype(int), 0, size-1)
        return np.all(ids[xy[:, 1], xy[:, 0]] == number[piece])

    @lru_cache(None)
    def partition(face, at):
        if face == count:
            return [()] if at == len(uv) else []
        answers = []
        for corners in (4, 3):
            left = len(uv)-at-corners
            if not 3*(count-face-1) <= left <= 4*(count-face-1):
                continue
            piece = record['pieces'][record['piece'][face]]
            if valid(at, corners, piece):
                answers.extend((corners,)+tail for tail in partition(face+1, at+corners))
            if len(answers) > 1:
                break
        return answers[:2]

    answers = partition(0, 0)
    if len(answers) != 1:
        raise ValueError('Published UV corner stream has no unique triangle/quad partition')
    at = 0
    result = {}
    for fi, pi, count in zip(record['face'], record['piece'], answers[0]):
        result[fi] = (record['pieces'][pi], uv[at:at+count].copy())
        at += count
    return result


def read(asset, position=None):
    """Reconstruct only the published half-surface from its quantized bakes."""
    paint = asset/'tex/paint'
    mat = 'pteranodon_saddle'
    meta = json.loads((paint/f'{mat}_pieces.json').read_text())
    ids = np.asarray(Image.open(paint/f'{mat}_pieces.png'))[..., 0]
    number = {p['name']:p['number'] for p in meta['pieces']}
    if position is None:
        lo = np.array(meta['position_box']['min'])
        hi = np.array(meta['position_box']['max'])
        position = np.stack([np.asarray(Image.open(paint/f'{mat}_position_{a}.png'))/65535 for a in 'xyz'], -1)*(hi-lo)+lo
        position[..., 0] = abs(position[..., 0])
    parts = {}
    for name, record in json.loads((asset/'saddle_layout.json').read_text())['parts'].items():
        pinned = polygons(record, ids, number)
        faces, triangles, estimates = {}, {}, []
        fit_error = 0
        for fi, (piece, uv) in pinned.items():
            choices = [[(0, 1, 2)]] if len(uv) == 3 else [
                [(0, 1, 2), (0, 2, 3)], [(0, 1, 3), (1, 2, 3)]]
            fits = []
            for tris in choices:
                y, x, weights = pixels(uv, meta['size'], tris)
                own = ids[y, x] == number[piece]
                w = weights[own]
                q = position[y[own], x[own]]
                if len(w) < len(uv) or np.linalg.matrix_rank(w) < len(uv):
                    raise ValueError(f'{name} face {fi}: insufficient baked surface samples')
                corners = np.linalg.lstsq(w, q, rcond=None)[0]
                residual = np.linalg.norm(np.einsum("ij,jk->ik", w, corners)-q, axis=1)
                fits.append((float(np.mean(residual**2)), corners, tris, float(residual.max())))
            _, corners, tris, error = min(fits, key=lambda f:f[0])
            if error > .00008:
                raise ValueError(f'{name} face {fi}: layout/position bakes disagree by {error*1000:.3f} mm')
            fit_error = max(fit_error, error)
            faces[fi] = tuple(range(len(estimates), len(estimates)+len(corners)))
            estimates.extend(corners)
            triangles[fi] = tris
        estimates = np.array(estimates)
        # At most 0.06 mm, far below a texel and the thinnest (5 mm) cut.
        # Sort both pairs and roots so hash randomization cannot alter painting.
        parent = list(range(len(estimates)))
        def root(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        for a, b in sorted(cKDTree(estimates).query_pairs(.00006)):
            a, b = root(a), root(b)
            parent[max(a, b)] = min(a, b)
        groups = {}
        for i in range(len(estimates)):
            groups.setdefault(root(i), []).append(i)
        vertices = {r:i for i, r in enumerate(groups)}
        points = np.array([estimates[g].mean(0) for g in groups.values()])
        points[abs(points[:, 0]) < .00003, 0] = 0
        faces = {fi:tuple(vertices[root(v)] for v in face) for fi, face in faces.items()}
        parts[name] = SimpleNamespace(name=name, points=points, faces=faces,
            pinned=pinned, islands={i:p for i, (p, _) in pinned.items()}, triangles=triangles,
            fit_error_mm=fit_error*1000)
    return parts


def edges(part, faces=None):
    result = {}
    for fi in part.faces if faces is None else faces:
        face = part.faces[fi]
        for a, b in zip(face, face[1:]+face[:1]):
            result.setdefault(tuple(sorted((a, b))), []).append(fi)
    return result


def chain(edge_list, points, start=None):
    adj = {}
    for a, b in edge_list:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    if any(len(v) > 2 for v in adj.values()):
        raise ValueError('Branched surface boundary')
    ends = [k for k, v in adj.items() if len(v) == 1]
    if start is None:
        start = max(ends or list(adj), key=lambda k:(points[k, 2], points[k, 1], -k))
    out = [start]
    previous = None
    while True:
        nxt = sorted(i for i in adj[out[-1]] if i != previous)
        if not nxt:
            break
        previous = out[-1]
        out.append(nxt[0])
        if out[-1] == start:
            break
    if len(set(out)) != len(adj):
        raise ValueError('Disconnected surface boundary')
    return out


def boundary_ids(part, piece, mirror_cut=True):
    line = [e for e, fs in edges(part, [i for i, n in part.islands.items() if n == piece]).items()
            if len(fs) == 1 and not (mirror_cut and np.max(abs(part.points[list(e), 0])) < .00003)]
    return chain(line, part.points)


def components(edge_list):
    """Connected vertex sets, ordered by their lowest index."""
    adj = {}
    for a, b in edge_list:
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    result = []
    unseen = set(adj)
    while unseen:
        todo = [min(unseen)]
        group = set()
        while todo:
            v = todo.pop()
            if v in group:
                continue
            group.add(v)
            todo.extend(sorted(adj[v]-group, reverse=True))
        unseen -= group
        result.append(group)
    return result


def tube_sections(part):
    """Walk cylinder quads from their published end rings, including twin ropes.

    A ring is a boundary of the quad surface, independent of UV seams and caps.
    Opposite quad edges carry it along the tube. Face order fixes the accepted
    winding/phase; vertex positions supply length, direction and radius.
    """
    quads = [i for i, f in part.faces.items() if len(f) == 4]
    quad_edges = edges(part, quads)
    result = []
    for group in components(quad_edges):
        fs = [i for i in quads if part.faces[i][0] in group]
        local = edges(part, fs)
        border = [e for e, faces in local.items() if len(faces) == 1]
        ends = components(border)
        if len(ends) != 2:
            raise ValueError(f'{part.name}: expected two measured tube ends')
        first, second = part.faces[fs[0]], part.faces[fs[1]]
        start = next(e for e in ends if len(e.intersection(first)) == 2)
        a = next(v for v in first if v in start and v not in second)
        b = next(v for v in first if v in start and v in second)
        ring = chain([e for e in border if e[0] in start], part.points, a)[:-1]
        if ring[1] != b:
            ring = [ring[0], *ring[:0:-1]]
        rings = [ring]
        visited = set()
        while True:
            ring = rings[-1]
            next_ring = {}
            for a, b in zip(ring, ring[1:]+ring[:1]):
                pending = [i for i in local[tuple(sorted((a, b)))] if i not in visited]
                if not pending:
                    continue
                if len(pending) != 1:
                    raise ValueError(f'{part.name}: ambiguous tube direction')
                fi = pending[0]
                face = part.faces[fi]
                for v, other in ((a, b), (b, a)):
                    k = face.index(v)
                    next_ring[v] = next(n for n in (face[k-1], face[(k+1)%4]) if n != other)
                visited.add(fi)
            if not next_ring:
                break
            if len(next_ring) != len(ring):
                raise ValueError(f'{part.name}: incomplete tube ring')
            rings.append([next_ring[v] for v in ring])
        if visited != set(fs):
            raise ValueError(f'{part.name}: unmeasured tube quads')
        points = part.points[rings]
        centres = points.mean(1)
        arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(centres, axis=0), axis=1))]*1000
        radii = np.linalg.norm(points-centres[:, None], axis=2)
        caps = [i for i, f in part.faces.items() if len(f) == 3 and len(group.intersection(f)) == 2]
        result.append(SimpleNamespace(rings=rings, centres=centres, arc=arc,
            radius=float(np.median(radii)), faces=fs+caps,
            mirrored=bool(np.any(np.max(abs(points[:, :, 0]), axis=1) < .00003))))
    return result


def tube_values(part, section):
    arc = section.arc
    total = arc[-1]*(2 if section.mirrored else 1)
    lookup = {v:(i, j) for i, ring in enumerate(section.rings) for j, v in enumerate(ring)}
    around = len(section.rings[0])
    values = {}
    for fi in section.faces:
        face = part.faces[fi]
        rows = [lookup[v][0] for v in face if v in lookup]
        theta = np.array([lookup[v][1]/around if v in lookup else np.nan for v in face])
        if np.ptp(theta[np.isfinite(theta)]) > .5:
            theta = np.where(theta < .5, theta+1, theta)
        theta[~np.isfinite(theta)] = np.nanmean(theta)
        s = [arc[lookup[v][0]] if v in lookup else arc[rows[0]] for v in face]
        values[fi] = np.stack([s, theta, np.full(len(face), total), np.full(len(face), len(face)==3)], -1)
    return values


def join_boundary(part, first, second):
    selected = [e for e, fs in edges(part).items()
                if {part.islands[i] for i in fs} == {first, second}]
    ends = components(selected)
    if len(ends) != 1:
        raise ValueError(f'{part.name}: disconnected {first}/{second} boundary')
    adj = {}
    for a, b in selected:
        adj[a] = adj.get(a, 0)+1
        adj[b] = adj.get(b, 0)+1
    start = max((v for v, degree in adj.items() if degree == 1), key=lambda v:part.points[v, 1])
    return chain(selected, part.points, start)


def plate_grid(part):
    """The published plate is a two-quad-wide strip; walk its cross edges."""
    outer = [i for i, n in part.islands.items() if n == 'cantle_plate_out']
    rows = []
    for a, b in zip(outer[::2], outer[1::2]):
        fa, fb = part.faces[a], part.faces[b]
        # Published outer winding: first quad's first edge is the upper rim;
        # its opposite edge joins the second quad down the plate.
        if not rows:
            rows.append([fa[0], fa[3], fb[3]])
        rows.append([fa[1], fa[2], fb[2]])
    return np.array(rows)


def boss_frame(part):
    """Measure the two half-rings of the boss from its side quads and cap fans."""
    quads = [f for f in part.faces.values() if len(f) == 4]
    # The two circumferential edge chains do not include the mirror-plane cut.
    first = sorted({v for f in quads for v in f[:2]})
    second = sorted({v for f in quads for v in f[2:]})
    rings = [part.points[first], part.points[second]]
    centres = []
    for ring in rings:
        interior = ring[abs(ring[:, 0]) > .00003]
        full = np.vstack([ring, interior*[-1, 1, 1]])
        centres.append(full.mean(0))
    # The broad basal ring supports the smaller worn crown.
    radii = [np.mean(np.linalg.norm(ring-centre, axis=1)) for ring, centre in zip(rings, centres)]
    if radii[1] > radii[0]:
        centres.reverse()
        rings.reverse()
    n = centres[1]-centres[0]
    n /= np.linalg.norm(n)
    radius = float(np.mean(np.linalg.norm(rings[0]-centres[0], axis=1)))*1000
    return centres[0], n, radius
