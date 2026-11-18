"""Axial and hindlimb landmarks in game and Grab3D model metres."""
import numpy as np

# Corresponding tail, hip, shoulder, occiput, orbit, naris and nose stations.
GAME_Z = [-7.11, -6.1, -4.5, -3.1, -1.8, -.8, .45, 1.65, 2.4, 2.85, 3.45, 4.68, 5.15]
DONOR_Z = [-5.99, -5.15, -3.65, -2.25, -.83, .55, 1.6, 2.70, 3.12, 3.6, 4.84, 5.70, 5.99]
# Section centres and radii allow the upturned neck and curled tail to register
# without pinning belly scales to a single row of a side photograph.
GAME_Y = [1.75, 1.76, 2.10, 2.55, 2.96, 3.05, 2.86, 3.10, 3.43, 3.60, 3.74, 3.62, 3.68]
GAME_DEPTH = [.03,.13,.28,.49,.72,.96,1, .95,.84,.88,.84,.51,.18]
GAME_WIDTH = [.02,.10,.24,.43,.65,.88,.84,.65,.55,.51,.65,.40,.14]
SOURCE_Y = [2.57,2.88,2.94,2.97,3.1,3.13,3.32,3.6,3.99,4.26,4.31,4.20,4.12]
SOURCE_DEPTH = [.04,.15,.34,.56,.87,1.32,1.27,.96,.91,.96,.70,.51,.16]
SOURCE_WIDTH = [.04,.14,.30,.46,.54,1.08,.98,.82,.71,.59,.56,.34,.12]
SOURCE_X = [1.44,1.29,.87,.26,-.04,.01,0,.01,.02,.03,.055,.044,.04]
LEG_Y = [0,.25,.7,1,1.5,2,2.5,3]
GAME_LEG_Z = [-.18,-.48,-.73,-.84,-.48,.02,-.24,-.64]
SOURCE_LEG_Z = [0,-.12,-.38,-.31,.1,.66,.68,.56]
SOURCE_LEG_X = [1.08,1.08,.80,.79,.86,.82,.75,.69]

def angle(x, y, width, depth):
    return np.arctan2(y / depth, x / width)

def body_chart(p, donor):
    x, y, z = p.T
    stations, ys, widths, depths = (DONOR_Z,SOURCE_Y,SOURCE_WIDTH,SOURCE_DEPTH) if donor else (GAME_Z,GAME_Y,GAME_WIDTH,GAME_DEPTH)
    if donor:
        x = x - np.interp(z, stations, SOURCE_X)
    phi = angle(x, y - np.interp(z, stations, ys), np.interp(z, stations, widths), np.interp(z, stations, depths))
    return z if donor else np.interp(z, stations, DONOR_Z), phi

def leg_chart(p, donor):
    x,y,z = p.T
    if donor:
        cx = np.interp(y, LEG_Y, SOURCE_LEG_X)
        cz = np.interp(y, LEG_Y, SOURCE_LEG_Z)
    else:
        cx = np.interp(y, LEG_Y, [.65,.64,.64,.64,.68,.72,.75,.73])
        cz = np.interp(y, LEG_Y, GAME_LEG_Z)
    return y, angle(abs(x)-cx, z-cz, .35, .50)
