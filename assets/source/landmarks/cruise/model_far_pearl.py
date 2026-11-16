"""The Pearl's distant closed shell; near candidates remain in model_parts.

A single indexed annulus removes the hidden longitudinal caps of separate
sectors. The two axial openings remain real holes, with a closed rim at each.
Coordinates are ship-local engine metres, as model_cells.distant_shell expects.
"""
import math


def pearl(mesh, layout, level):
    """Append a continuous closed shell for authored candidates 3 through 5."""
    if level not in (3, 4, 5):
        raise ValueError("The distant Pearl helper is only for candidates 3 through 5")
    origin = next(i['at'] for i in layout['instances'] if i['id'] == 'pearl_shell_0')
    radius = layout['pearl']['diameter'] / 2
    end = 5.6
    # Both distant candidates use the same useful surface. The normal census
    # collapses a duplicate candidate when the rest of its cell also matches.
    # Equal angular spacing controls curvature error along the portal axis.
    angle = math.asin(end / radius)
    zs = ([-5.6,-4.95,-4.3,-3.65,-3,-2.25,-1.5,-.75,0,.75,1.5,2.25,3,3.65,4.3,4.95,5.6]
          if level == 3 else [radius * math.sin(-angle + j * 2 * angle / 5) for j in range(6)])
    sides = 28 if level == 3 else 16
    vertices = []
    faces = []
    layer = sides * len(zs)
    for inner in (False, True):
        for j, z in enumerate(zs):
            # A short central belt replaces the equator ring. Its cardinal
            # vertices retain the exact diameter without another strip.
            central = level >= 4 and j in (2, 3)
            r = radius if central else math.sqrt(radius * radius - z * z)
            if inner and level == 3:
                r -= .20
                if j in (0, len(zs)-1):
                    r /= math.cos(math.pi / sides)
            elif inner:
                # Circumscribe the inner polygon so its coarse chords do not
                # narrow the authored circular opening. Sixteen facets keep
                # this surface strictly inside the outer shell at every ring.
                r = r - .20 if central else (r - .20) / math.cos(math.pi / sides)
            for i in range(sides):
                angle = i * math.tau / sides
                # Balance the coarse outer chords around the fine sphere,
                # while its four cardinal extrema keep the exact 15 m span.
                if level == 3:
                    vr = r
                else:
                    vr = r + ((.02 if central else .10) if not inner and i % 4 else 0)
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
