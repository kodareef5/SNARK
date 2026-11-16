"""Supported accommodation fronts and tier closures, in the shared ship metre frame.

The photographed ship has enclosed, stepped accommodation rather than exposed slab
edges. These original facade modules retain the authored floors, public routes and
open neighborhoods. Unadvertised cabin fronts use opaque dark panels; public
glazing keeps real clear near apertures and a separate blue far-proxy kind.
"""
import math


def finish(D, p, world, place, box, ys):
    decks = {d['id']: d for d in D['decks']}
    labels = [d['id'] for d in D['decks']]
    placed = []

    def put(name, proto, at, deck, section, yaw=0):
        placed.append(place('enclosure_' + name, proto, at, deck, section, yaw))

    def height(label):
        return ys[labels[labels.index(label) + 1]] - ys[label] - .24

    def pane_group(length, h, clear):
        """One pale frame and one dark/clear pane draw; both have bounded real shapes."""
        n = max(1, math.ceil(length / 3.2))
        cuts = [-length / 2 + length * i / n for i in range(n + 1)]
        sill, head, jamb = (.65, h - .40, .10) if clear else (.32, h - .24, .10)
        frames = [box([-.10, 0, cuts[0]], [.10, sill, cuts[-1]]),
                  box([-.10, head, cuts[0]], [.10, h, cuts[-1]])]
        for i, z in enumerate(cuts):
            lo = z if i == 0 else z - jamb / 2
            hi = z if i == n else z + jamb / 2
            frames.append(box([-.10, sill, lo], [.10, head, hi]))
        panes = [box([-.025, sill, cuts[0] + jamb / 2],
                     [.025, head, cuts[-1] - jamb / 2])]
        if clear:
            # No translucent material claim: native near geometry is four thin
            # aperture-edge cues; the solid pane remains the glass collision.
            z0, z1 = cuts[0] + jamb / 2, cuts[-1] - jamb / 2
            e = .012
            panes += [box([-.018, sill, z0], [.018, sill + e, z1]),
                      box([-.018, head - e, z0], [.018, head, z1]),
                      box([-.018, sill + e, z0], [.018, head - e, z0 + e]),
                      box([-.018, sill + e, z1 - e], [.018, head - e, z1])]
        return frames, panes

    def glazing(name, a, b, deck, section, clear=True, tall=None):
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz)
        if length < .30:
            return
        # Keep every group below both native ±16 m and radial route bounds.
        count = max(1, math.ceil(length / 25.6))
        yaw = math.degrees(math.atan2(dx, dz))
        for i in range(count):
            frames, panes = pane_group(length / count, tall or height(deck), clear)
            if tall:
                # Real curtain-wall transoms, not fictitious intermediate slabs.
                # Their deeper section avoids coplanar faces at column crossings.
                for label in ('6', '7', '8'):
                    y = ys[label] - ys[deck]
                    frames.append(box([-.14, y - .05, -length / count / 2],
                                      [.14, y + .05, length / count / 2]))
            frame = p('tier_window_frame', 'facade', frames,
                      art={'kind': 'solids', 'finish': 'enamel'}, color=232)
            art = {'kind': 'window_wall', 'glassBoxes': [0]} if clear else {'kind': 'solids', 'finish': 'navy'}
            pane = p('tier_clear_pane' if clear else 'tier_cabin_pane', 'facade', panes,
                     art=art, color=85 if clear else 29,
                     look={'boxes': [panes[0]]} if clear else None)
            at = [a[0] + dx * (i + .5) / count, ys[deck], a[1] + dz * (i + .5) / count]
            put(name + '_frame_' + str(i), frame, at, deck, section, yaw)
            put(name + '_pane_' + str(i), pane, at, deck, section, yaw)

    def route_openings(a, b, deck):
        """Subtract full declared walking bands, including sloping stair approaches."""
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz)
        ux, uz = dx / length, dz / length
        gaps = []
        low, high = ys[deck] - 2.6, ys[deck] + height(deck)
        for r in D['routes']:
            radius = r['clearWidth'] / 2 + .18
            for q, s in zip(r['anchors'], r['anchors'][1:]):
                # Clip the path to the wall-height interval and its normal band.
                n0 = (q[0] - a[0]) * uz - (q[2] - a[1]) * ux
                n1 = (s[0] - a[0]) * uz - (s[2] - a[1]) * ux
                lo, hi = 0., 1.
                for v0, v1, lower, upper in [(q[1], s[1], low, high), (n0, n1, -radius, radius)]:
                    if abs(v1 - v0) < 1e-9:
                        if v0 < lower or v0 > upper:
                            hi = -1
                            break
                    else:
                        aa, bb = sorted(((lower - v0) / (v1 - v0), (upper - v0) / (v1 - v0)))
                        lo, hi = max(lo, aa), min(hi, bb)
                if lo > hi:
                    continue
                t0 = (q[0] - a[0]) * ux + (q[2] - a[1]) * uz
                t1 = (s[0] - a[0]) * ux + (s[2] - a[1]) * uz
                aa, bb = sorted((t0 + (t1 - t0) * lo, t0 + (t1 - t0) * hi))
                gaps.append((max(0., aa - radius), min(length, bb + radius)))
        runs = [(0., length)]
        for lo, hi in gaps:
            if hi <= lo:
                continue
            runs = [(aa, bb) for start, end in runs for aa, bb in
                    [(start, min(end, lo)), (max(start, hi), end)] if bb - aa > .30]
        return [([a[0] + ux * lo, a[1] + uz * lo], [a[0] + ux * hi, a[1] + uz * hi]) for lo, hi in runs]

    def wall(name, a, b, deck, section):
        for i, (start, end) in enumerate(route_openings(a, b, deck)):
            glazing(name + '_' + str(i), start, end, deck, section)

    def widths(poly, z):
        xs = []
        for a, b in zip(poly, poly[1:] + poly[:1]):
            if abs(a[1] - b[1]) < 1e-8:
                if abs(z - a[1]) < 1e-7:
                    xs.extend((a[0], b[0]))
            elif min(a[1], b[1]) - 1e-7 <= z <= max(a[1], b[1]) + 1e-7:
                xs.append(a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]))
        return min(xs), max(xs)

    def contains(poly, x, z):
        inside = False
        for a, b in zip(poly, poly[1:] + poly[:1]):
            dx, dz = b[0] - a[0], b[1] - a[1]
            t = max(0., min(1., ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))) if dx or dz else 0.
            if math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < 1e-7:
                return True
            if (a[1] > z) != (b[1] > z) and x < a[0] + dx * (z - a[1]) / dz:
                inside = not inside
        return inside

    def supported(deck, x, z):
        d = decks[deck]
        return any(contains(poly, x, z) for poly in d['outlines']) and not any(contains(v['polygon'], x, z) for v in d['voids'])

    # Forward/aft walls sit under the *intersection* of the two floor outlines.
    # Unsupported fore terraces remain open, including the fitness approach.
    for deck in ['5', '6', '7', '8', '9', '10', '11', '12', '14']:
        lower = decks[deck]['outlines'][0]
        upper = decks[labels[labels.index(deck) + 1]]['outlines'][0]
        fore = min(max(q[1] for q in lower), max(q[1] for q in upper)) - .18
        aft = max(min(q[1] for q in lower), min(q[1] for q in upper)) + .18
        def sides(z):
            la, ra = widths(lower, z)
            lb, rb = widths(upper, z)
            return max(la, lb) + .18, min(ra, rb) - .18
        for tag, start, end in [('forward', 110.4, fore), ('aft', aft, -155.2)]:
            if end <= start:
                continue
            cuts = sorted(set([start, end] + [q[1] for poly in (lower, upper) for q in poly if start < q[1] < end]))
            for side in (0, 1):
                for i, (za, zb) in enumerate(zip(cuts, cuts[1:])):
                    wall(f'{deck}_{tag}_side_{side}_{i}', [sides(za)[side], za], [sides(zb)[side], zb], deck, 'tier-enclosure')
            z = end if tag == 'forward' else start
            left, right = sides(z)
            wall(f'{deck}_{tag}_end', [left, z], [right, z], deck, 'tier-enclosure')

    def bank(deck, name, edge, front, rear, start, end):
        h = height(deck)
        protected = [r['bounds'] for r in D['rooms'] if r['deck'] == deck]
        # A basin in the floor above has its own lower waterproof slab; a full
        # accommodation rear wall must not rise through that independent basin.
        upper = decks[labels[labels.index(deck) + 1]]
        protected += [{'min': [min(q[0] for q in v['polygon']), 0, min(q[1] for q in v['polygon'])],
                       'max': [max(q[0] for q in v['polygon']), 0, max(q[1] for q in v['polygon'])]}
                      for v in upper['voids'] if v['kind'] == 'basin']
        # Split at protected room edges, so the deck14 pool-under room retains
        # its complete occupied footprint rather than only its center route.
        for side in (-1, 1):
            splits = [start, end]
            for bounds in protected:
                if min(side * front, side * rear) < bounds['max'][0] and max(side * front, side * rear) > bounds['min'][0]:
                    splits += [max(start, min(end, bounds['min'][2] - .12)),
                               max(start, min(end, bounds['max'][2] + .12))]
            splits = sorted(set(splits))
            for si, (za, zb) in enumerate(zip(splits, splits[1:])):
                count = max(1, math.ceil((zb - za) / 25.6))
                for j in range(count):
                    a, b = za + (zb - za) * j / count, za + (zb - za) * (j + 1) / count
                    length = b - a
                    if length < .30:
                        continue
                    frames, panes = pane_group(length, h, False)
                    # Full-height real rear/end walls make the bank a shallow
                    # enclosure; they are omitted where an existing room owns it.
                    room = any(q['min'][0] <= side * front <= q['max'][0] or
                               (min(side * front, side * rear) < q['max'][0] and max(side * front, side * rear) > q['min'][0])
                               for q in protected if q['min'][2] < (a + b) / 2 < q['max'][2])
                    depth = rear - front
                    balcony = front - edge - .12
                    if not room:
                        frames += [box([depth - .14, 0, -length / 2], [depth, h, length / 2]),
                                   box([-balcony, 0, -length / 2], [depth - .14, h, -length / 2 + .10]),
                                   box([-balcony, 0, length / 2 - .10], [depth - .14, h, length / 2])]
                    # Two shallow balcony privacy fins per long grouped bank.
                    # They stay behind the existing rim guard and outside paths.
                    for z in (-length / 6, length / 6):
                        frames.append(box([-balcony, 0, z - .04], [-.10, min(h, 1.70), z + .04]))
                    assert len(frames) <= 16
                    frame = p('canyon_cabin_frame', 'facade', frames,
                              art={'kind': 'solids', 'finish': 'enamel', 'walkableRoom': False}, color=232)
                    pane = p('canyon_cabin_panels', 'facade', panes,
                             art={'kind': 'solids', 'finish': 'navy', 'walkableRoom': False}, color=29)
                    # Local +X points into the bank on both sides; rotating the
                    # whole group also mirrors its longitudinal end conditions.
                    at = [side * front, ys[deck], (a + b) / 2]
                    yaw = 0 if side > 0 else 180
                    ident = f'{name}_{deck}_{side}_{si}_{j}'
                    put(ident + '_frame', frame, at, deck, 'inward-accommodation', yaw)
                    put(ident + '_pane', pane, at, deck, 'inward-accommodation', yaw)

    for deck in ['9', '10', '11', '12', '14']:
        bank(deck, 'park', 8.6, 10.6, 13.4, -66., 57.5)
    for deck in ['8', '9', '10', '11', '12', '14']:
        bank(deck, 'surfside', 11., 13., 17., -174., -86.)

    # Reuse the actual unadvertised outer cells, not a guessed interval that
    # could cover a playable cabin. The glass-colored inset closes their front
    # apertures while leaving all existing cabin/back/side walls untouched.
    outer = {}
    for inst in D['instances']:
        if inst['id'].startswith('facade_') and inst['section'] == 'accommodation-facade':
            side = 1 if inst['at'][0] > 0 else -1
            upper = labels[labels.index(inst['deck']) + 1]
            if not all(supported(deck, inst['at'][0] + side * x, inst['at'][2] + z)
                       for deck in (inst['deck'], upper) for x in (3.96, 4.) for z in (-1.34, 0, 1.34)):
                continue
            key = (inst['deck'], inst['yaw'], inst['at'][0])
            outer.setdefault(key, []).append(inst['at'][2])
    for (deck, yaw, x), stations in outer.items():
        groups = []
        for z in sorted(stations):
            if not groups or len(groups[-1]) == 8 or abs(z - groups[-1][-1] - 3.2) > .01:
                groups.append([])
            groups[-1].append(z)
        for i, group in enumerate(groups):
            center = (group[0] + group[-1]) / 2
            # A group uses the same local +X exterior face as the source bank.
            # Negative-side yaw mirrors Z, which is immaterial to these evenly
            # spaced, symmetric windows.
            panes = [box([3.96, .60, z - center - 1.34], [4.00, 2.60, z - center + 1.34]) for z in group]
            q = p('outer_cabin_panels', 'facade', panes,
                  art={'kind': 'solids', 'finish': 'navy', 'walkableRoom': False}, color=29)
            put(f'outer_panels_{deck}_{yaw}_{i}', q, [x, ys[deck], center], deck, 'accommodation-facade', yaw)

    # Port Pearl panorama spans a genuine multi-storey void. Art removes the
    # former deck7/8 facade/balcony cells and deck5/6 glazing in this exact span.
    # The solid deck5 and deck9 edges anchor it; no intermediate walking slab
    # is added. Z−22.4 retains the whole 2.8 m boarding aperture at Z−24.
    glazing('pearl_panorama', [28.72, -22.4], [28.72, 7.], '5', 'pearl-panorama',
            tall=ys['9'] - .24 - ys['5'])

    # Two supported forward upper tiers, under the actual Grove floor. The
    # open sports, launch, pool and Grove terraces are deliberately left open.
    for deck in ['16', '17']:
        loop = [[-24.8, 60.5], [24.8, 60.5], [24.8, 76.8], [-24.8, 76.8]]
        for i, (a, b) in enumerate(zip(loop, loop[1:] + loop[:1])):
            if i == 0:
                wall(f'upper_{deck}_{i}_left', a, [-2.6, 60.5], deck, 'upper-accommodation')
                wall(f'upper_{deck}_{i}_right', [2.6, 60.5], b, deck, 'upper-accommodation')
            else:
                wall(f'upper_{deck}_{i}', a, b, deck, 'upper-accommodation')

    D['enclosures'] = {'instances': placed,
        'interpretation': 'Original supported tier and inward accommodation facades informed by archived ship photographs.',
        'glazing': 'Public near apertures remain clear; separate blue pane kinds preserve far window rhythm.',
        'routes': 'Existing declared width/headroom bands and occupied room footprints retained; no route edits.'}
