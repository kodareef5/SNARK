"""Manual sampled exterior P95 bound. Invoked by dome-error.ts under Blender.

Geometry remains untouched. Whole raw occluders are overlaid with native-quantized
candidate cells. Every ray respects the actual clear sidecar and front faces.
"""
import hashlib
import json
import math
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

CONFIG = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text())
RAW, NATIVE = Path(CONFIG['raw']), Path(CONFIG['native'])
LAYOUT = json.loads(Path(CONFIG['layout']).read_text())
INDEX = json.loads((RAW / 'index.json').read_text())
OVERLAY = {c['id']: c for c in json.loads((NATIVE / 'index.json').read_text())['meshes']}
PROTOTYPES = {p['id']: p for p in LAYOUT['prototypes']}
TARGETS = set(CONFIG['cells'])
RECORD = np.dtype([('owner', '<u4'), ('p', '<f4', (3, 3))])
STARTED = time.time()
FINGERPRINT = hashlib.sha256()
THRESHOLD = .06


def raw(cell, stage):
    directory = NATIVE if cell['id'] in OVERLAY else RAW
    cell = OVERLAY.get(cell['id'], cell)
    level = [l for l in cell['levels'] if l['authoredLevel'] <= stage][-1]
    geometry = (directory / level['file']).read_bytes()
    materials = (directory / level['clearFile']).read_bytes()
    FINGERPRINT.update(cell['id'].encode() + str(stage).encode() + geometry + materials)
    records = np.frombuffer(geometry, dtype=RECORD)
    clear = np.frombuffer(materials, dtype=np.uint8)
    assert len(clear) == len(records)
    return records['owner'], records['p'].astype(np.float64) + np.array(cell['origin'])[None, None, :], clear


def samples(cell, stage):
    owners, triangles, clears = raw(cell, stage)
    for triangle, (owner, points, clear) in enumerate(zip(owners, triangles, clears)):
        if clear or PROTOTYPES[LAYOUT['instances'][int(owner)]['prototype']]['art']['kind'] != 'dome_dense':
            continue
        local = points - np.array(cell['origin'])
        # This only identifies artificial clipping caps; it never welds geometry.
        if any(all(abs(float(v) - side) < .0003 for v in local[:, axis]) for axis in range(3) for side in (-8, 8)):
            continue
        a, b, c = map(Vector, points)
        normal = (b - a).cross(c - a)
        area = normal.length / 2
        if area < 1e-9:
            continue
        normal.normalize()
        for label, point in [('centroid', (a + b + c) / 3), ('a', a), ('b', b), ('c', c)]:
            yield dict(owner=int(owner), cell=cell['id'], triangle=triangle, sample=label,
                       point=point, normal=normal, area=area, centroid=(a + b + c) / 3)


def key(sample):
    return sample['cell'], tuple(sample['point']), tuple(round(v, 6) for v in sample['normal'])


def point_key(sample):
    return sample['cell'], tuple(sample['point'])


class Scene:
    def __init__(self, stage):
        vertices, faces = [], []
        self.owners, self.clear = [], []
        for cell in INDEX['meshes']:
            owner, points, clear = raw(cell, stage)
            unique, indices = np.unique(points.reshape(-1, 3), axis=0, return_inverse=True)
            offset = len(vertices)
            vertices.extend(map(tuple, unique))
            faces.extend(map(tuple, indices.reshape(-1, 3) + offset))
            self.owners.extend(owner)
            self.clear.extend(clear)
        self.tree = BVHTree.FromPolygons(vertices, faces, all_triangles=True)
        print('scene', stage, 'triangles', len(faces), flush=True)

    def ray(self, eye, direction, distance):
        travelled, point = 0, eye
        last = None
        for _ in range(512):
            hit, normal, face, d = self.tree.ray_cast(point, direction, distance - travelled)
            if hit is None:
                return None
            owner = LAYOUT['instances'][self.owners[face]]['id']
            last = dict(owner=owner, point=list(hit), distance=travelled + d)
            if not self.clear[face] and normal.dot(direction) < -1e-7:
                return last
            # A grazing BVH distance may be slightly negative; never walk backward.
            travelled += max(d, 0) + .00001
            if travelled >= distance:
                return None
            point = eye + direction * travelled
        # Keep the original bound. An unresolved ray is never called hidden.
        return dict(unresolved=True, reason='512 alpha/backface skips', last=last)


CENTER = Vector((0, 46.8, LAYOUT['aquadome']['centerZ']))
EYES = []
for elevation in (-10, -5, 0, 5, 10, 20, 35, 50, 70, 90):
    e = math.radians(elevation)
    for azimuth in range(0, 360, 10):
        a = math.radians(azimuth)
        eye = CENTER + Vector((250 * math.cos(e) * math.cos(a), 250 * math.sin(e), 250 * math.cos(e) * math.sin(a)))
        if eye.y >= 0 and (abs(eye.x) > 33 or abs(eye.z) > 183 or eye.y > 75):
            EYES.append((f'outside250:{azimuth}:{elevation}', eye))
for route in LAYOUT['routes']:
    for j, p in enumerate(route['anchors']):
        eye = Vector((p[0], p[1] + 1.7, p[2]))
        if p[1] >= 35 and (eye - CENTER).length >= 95:
            EYES.append((f'route:{route["id"]}:{j}', eye))


def viewpoints(sample):
    result = list(EYES)
    normal, point = sample['normal'], sample['point']
    directions = [normal]
    for axis in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, -1)):
        direction = normal * .5 + Vector(axis) * .5
        if direction.length > 1e-6:
            directions.append(direction.normalized())
    for j, direction in enumerate(directions):
        eye = point + direction * 250
        if eye.y >= 0 and (abs(eye.x) > 33 or abs(eye.z) > 183 or eye.y > 75):
            result.append((f'normal-offset:{j}', eye))
    return result


def witness(sample, label, eye, hit=None):
    return dict(cell=sample['cell'], triangle=sample['triangle'], sample=sample['sample'],
                owner=LAYOUT['instances'][sample['owner']]['id'], point=list(sample['point']),
                normal=list(sample['normal']), error=sample['error'], eye=list(eye), eyeLabel=label, hit=hit)


near, far = Scene(0), Scene(3)
selected = {}
for cell in INDEX['meshes']:
    if cell['id'] not in TARGETS:
        continue
    for sample in samples(cell, 0):
        ident = key(sample)
        if ident in selected:
            selected[ident]['multiplicity'] += 1
        else:
            sample['multiplicity'] = 1
            sample['error'] = far.tree.find_nearest(sample['point'])[3]
            selected[ident] = sample
bad = [s for s in selected.values() if s['error'] > THRESHOLD]
counts, rays, bad_witnesses, unresolved = Counter(), 0, [], []
bad_points = set()
for sample in sorted(bad, key=lambda s: -s['error']):
    counts[sample['cell'] + ':overThreshold'] += 1
    uncertain, visible = False, False
    for label, eye in viewpoints(sample):
        if (eye - sample['point']).dot(sample['normal']) <= 0:
            continue
        direction = sample['point'] - eye
        distance = direction.length
        direction.normalize()
        rays += 1
        blocker = near.ray(eye, direction, distance - .002)
        if blocker is not None:
            if blocker.get('unresolved'):
                uncertain = True
                if len(unresolved) < 12:
                    unresolved.append(witness(sample, label, eye, blocker))
            continue
        visible = True
        counts[sample['cell'] + ':visibleBad'] += 1
        bad_points.add(point_key(sample))
        bad_witnesses.append(witness(sample, label, eye))
        sample['visibleEye'] = eye
        break
    if not visible:
        if uncertain:
            counts[sample['cell'] + ':unresolvedBad'] += 1
            bad_points.add(point_key(sample))
        else:
            counts[sample['cell'] + ':occludedBad'] += 1

# Count every raw non-cap corner/middle occurrence at a potentially visible bad
# position, even when another face normal was hidden. This also bounds the
# expanded-vertex sampling weights rather than relying only on deduplication.
bad_weight = Counter()
for sample in selected.values():
    if point_key(sample) in bad_points:
        bad_weight[sample['cell']] += sample['multiplicity']
good = {cell: [] for cell in TARGETS}
for sample in selected.values():
    cell = sample['cell']
    wanted = max(40, 20 * bad_weight[cell])
    if len(good[cell]) >= wanted or sample['sample'] != 'centroid' or sample['area'] < .001 or sample['error'] > .059:
        continue
    for label, eye in EYES:  # A shared subset of the bad-sample viewpoint family.
        direction = sample['point'] - eye
        distance = direction.length
        direction.normalize()
        if sample['normal'].dot(-direction) < .1:
            continue
        blocker = near.ray(eye, direction, distance - .002)
        if blocker is not None:
            continue
        hit = near.ray(eye, direction, distance + .002)
        if hit is None or hit.get('unresolved') or abs(hit['distance'] - distance) > .002:
            continue
        good[cell].append(witness(sample, label, eye, hit))
        break
    if all(len(good[c]) >= max(40, 20 * bad_weight[c]) for c in TARGETS):
        break

reverse = []
for cell in INDEX['meshes']:
    if cell['id'] not in TARGETS:
        continue
    errors, seen, excess = [], set(), []
    for sample in samples(cell, 3):
        if key(sample) in seen:
            continue
        seen.add(key(sample))
        error = near.tree.find_nearest(sample['point'])[3]
        errors.append(error)
        if error > THRESHOLD:
            excess.append(dict(triangle=sample['triangle'], sample=sample['sample'], point=list(sample['point']), error=error))
    reverse.append(dict(cell=cell['id'], samples=len(errors), p95=sorted(errors)[int(len(errors) * .95)], max=max(errors), overThreshold=excess))

probes = []
for sample in bad:
    if 'visibleEye' not in sample:
        continue
    eye = sample['visibleEye']
    for fraction in (0, .001, .01, .05, .25, .5, 1):
        point = sample['point'] + (sample['centroid'] - sample['point']) * fraction
        direction = point - eye
        distance = direction.length
        direction.normalize()
        blocked = near.ray(eye, direction, distance - .002)
        hit = near.ray(eye, direction, distance + .002)
        probes.append(dict(cell=sample['cell'], triangle=sample['triangle'], fractionToCentroid=fraction,
                           point=list(point), error=far.tree.find_nearest(point)[3], eye=list(eye), earlierBlocker=blocked, firstHit=hit,
                           targetDistance=distance))

bounds = []
for cell in sorted(TARGETS):
    bad_count, good_count = bad_weight[cell], len(good[cell])
    bounds.append(dict(cell=cell, visibleOrUnresolvedBadPositionOccurrences=bad_count, visibleGoodLower=good_count,
                       badShareUpper=bad_count / (bad_count + good_count) if good_count else 1))
report = dict(
    schema=1,
    scope='Sampled bidirectional exterior P95 bound, not an all-camera guarantee or delivered-pack acceptance. Whole raw occluders; all retained candidate positions set native shared bounds. Artificial cell caps and clear target faces excluded. Actual clear/front-face traversal. Corner and triangle-middle sample normals deduplicated for rays; conservative raw occurrence multiplicities retained in the bound.',
    identities={**CONFIG['identities'], 'usedGeometryAndClearSHA256': FINGERPRINT.hexdigest()},
    parameters=dict(targetCells=sorted(TARGETS), threshold=THRESHOLD, targetSurfaceExclusion=.002, capIdentification=.0003,
                    rayAdvance=.00001, maxSkips=512, cameraRadius=250, cameraAzimuthStep=10,
                    cameraElevations=[-10,-5,0,5,10,20,35,50,70,90], sharedViewpoints=len(EYES)),
    wholeCellNativeP95=CONFIG['wholeCell'], samples=len(selected), overThreshold=len(bad), rays=rays,
    counts=dict(counts), bounds=bounds, goodVisible=good, badVisible=bad_witnesses, unresolvedBadRays=unresolved,
    reverse=reverse, boundaryProbes=probes,
    supportsSampledP95=all(b['visibleGoodLower'] >= 40 and b['badShareUpper'] < .05 for b in bounds) and all(not r['overThreshold'] for r in reverse),
    limitations=['Unused GLTF vertices can change final native shared bounds; final packed-art and visual gates remain required.',
                 'Visible witnesses and boundary probes may exceed0.06m; their recorded errors are retained. This is a sampled P95 bound, not a maximum bound.',
                 'This diagnostic uses complete over-threshold classification and positive good-sample lower bounds rather than an exhaustive all-visible-sample percentile; unresolved bad rays count conservatively.',
                 'Observed model source hashes may postdate frozen raw generation; raw/index hashes identify the measured artifact.'],
    elapsedSeconds=time.time()-STARTED)
Path(CONFIG['out']).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(dict(bounds=bounds, reverse=reverse, supportsSampledP95=report['supportsSampledP95'], seconds=report['elapsedSeconds'])), flush=True)
