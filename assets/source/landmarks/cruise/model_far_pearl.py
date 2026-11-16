"""The Pearl's distant closed shell; near candidates remain in model_parts.

A single indexed annulus removes the hidden longitudinal caps of separate
sectors. The two axial openings remain real holes, with a closed rim at each.
Coordinates are ship-local engine metres, as model_cells.distant_shell expects.
"""
import math


def pearl(mesh, layout, level):
    """Append the continuous shell for authored candidate 4 or 5 only."""
    if level not in (4, 5):
        raise ValueError("The distant Pearl helper is only for candidates 4 and 5")
    origin = next(i['at'] for i in layout['instances'] if i['id'] == 'pearl_shell_0')
    radius = layout['pearl']['diameter'] / 2
    end = 5.6
    # Both distant candidates use the same useful surface. The normal census
    # collapses a duplicate candidate when the rest of its cell also matches.
    # Equal angular spacing controls curvature error along the portal axis.
    angle = math.asin(end / radius)
    zs = [radius * math.sin(-angle + j * angle / 3) for j in range(7)]
    sides = 16
    vertices = []
    faces = []
    layer = sides * len(zs)
    for inner in (False, True):
        for z in zs:
            r = math.sqrt(radius * radius - z * z)
            if inner:
                # Circumscribe the inner polygon so its coarse chords do not
                # narrow the authored circular opening. Sixteen facets keep
                # this surface strictly inside the outer shell at every ring.
                r = (r - .20) / math.cos(math.pi / sides)
            for i in range(sides):
                angle = i * math.tau / sides
                # Balance the coarse outer chords around the fine sphere,
                # while its four cardinal extrema keep the exact 15 m span.
                vr = r + (.08 if not inner and i % 4 else 0)
                vertices.append((origin[0] + vr * math.cos(angle),
                                 origin[1] + vr * math.sin(angle), origin[2] + z))
    for inner in (False, True):
        offset = layer if inner else 0
        for j in range(len(zs) - 1):
            for i in range(sides):
                a = offset + j * sides + i
                b = offset + j * sides + (i + 1) % sides
                c = b + sides
                d = a + sides
                faces.append((d, c, b, a) if inner else (a, b, c, d))
    for j in (0, len(zs) - 1):
        for i in range(sides):
            a = j * sides + i
            b = j * sides + (i + 1) % sides
            # Only the annular rim is capped, never the opening itself.
            faces.append((a, a + layer, b + layer, b) if j == 0 else
                         (a, b, b + layer, a + layer))
    mesh.indexed(vertices, faces, 'ivory')
