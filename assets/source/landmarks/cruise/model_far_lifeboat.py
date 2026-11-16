"""Distant lifeboats retain the photographed hull and canopy, in engine metres."""
from model_exterior import _outline, _shell, _side_panel, _side_x, _door

CORNER_FIT = .72


def _far_outline(y, half_x, half_z, steps, front_drop=0):
    """Fit the rounded corners while retaining every cardinal width/length."""
    rx = min(.74, half_x * .46) * CORNER_FIT
    front = min(1.42, half_z * .35) * CORNER_FIT
    rear = min(.78, half_z * .35) * CORNER_FIT
    points = [(half_x, half_z-front), (half_x-rx, half_z),
              (-half_x+rx, half_z), (-half_x, half_z-front),
              (-half_x, -half_z+rear), (-half_x+rx, -half_z),
              (half_x-rx, -half_z), (half_x, -half_z+rear)]
    return [(x, y-front_drop*max(0, (z-4.8)/max(.01, half_z-4.8)), z) for x, z in points]


def lifeboat(mesh, level):
    steps = 5 if level == 2 else 3 if level == 3 else 2
    outline = _outline if level < 4 else _far_outline
    if level < 4:
        stations = [(-2.02, 1.12, 5.85), (-1.72, 1.82, 6.85),
                    (-1.14, 2.48, 7.25), (-.60, 2.65, 7.42),
                    (-.51, 2.70, 7.48), (-.44, 2.70, 7.48),
                    (-.37, 2.64, 7.42), (.45, 2.60, 7.32)]
        bands = ['enamel'] * 7
        bands[4] = 'rubber'
    else:
        # Retain the three lower chine stations and the real upper shoulder.
        # The seven-centimetre rubbing band merges at its middle station.
        stations = [(-2.02, 1.12, 5.85), (-1.72, 1.82, 6.85),
                    (-1.14, 2.48, 7.25), (-.475, 2.70, 7.48),
                    (.45, 2.60, 7.32)]
        bands = ['enamel'] * 4
    _shell(mesh, [outline(y, x, z, steps) for y, x, z in stations], bands)
    canopy = [(.46, 2.60, 7.31, 0), (1.30, 2.54, 7.20, 0),
              (1.75, 2.38, 6.98, .20), (2.00, 2.06, 6.76, .45)]
    if level >= 4:
        canopy = [canopy[0], canopy[2], canopy[3]]
    _shell(mesh, [outline(y, x, z, steps, dip) for y, x, z, dip in canopy], ['yellow'] * (len(canopy)-1), 'yellow')
    for side in (-1, 1):
        for z in (-4.80, -3.48, 2.55, 3.87):
            if level == 2:
                _door(mesh, side, z)
            elif level < 4:
                _side_panel(mesh, side, z - .22, z + .22, .12, 1.23, 'navy', stand=.045, depth=.010)
            else:
                # The ten-millimetre light panel keeps both visible sides at
                # its midplane; its outline and dark appearance remain.
                mesh.indexed([(side * (_side_x(y) + .050), y, zz)
                              for y, zz in ((.12, z-.22), (.12, z+.22), (1.23, z+.22), (1.23, z-.22))],
                             [(0, 1, 2, 3), (3, 2, 1, 0)], 'navy')
    # The helm is a visible part of the roof silhouette, including its pale cap.
    saved = mesh.level
    if level == 2:
        mesh.level = 1
    mesh.box([-.80, 1.72, 5.67], [.80, 2.035, 6.58], 'navy', .09)
    mesh.level = saved
    if level < 4:
        mesh.box([-.84, 2.043, 5.63], [.84, 2.082, 6.62], 'enamel')
    else:
        # The 39 mm pale cap keeps its measured top plane and both visible
        # sides; the collapsed underside moves by only 39 mm at this stage.
        mesh.indexed([[-.84,2.082,5.63],[.84,2.082,5.63],[.84,2.082,6.62],[-.84,2.082,6.62]],
                     [(0,1,2,3),(3,2,1,0)], 'enamel')
