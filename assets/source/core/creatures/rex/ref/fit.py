"""Fit the weighted hide to the donor barrel, tail and hindlimb mass in rest space."""
from pathlib import Path

import numpy as np
from anatomy import GAME_Z, GAME_Y, GAME_WIDTH, GAME_DEPTH, GAME_LEG_Z, LEG_Y, body_chart


def fit(points):
    x,y,z = points.T
    def ease(a,b,v):
        t = np.clip((v-a)/(b-a),0,1)
        return t*t*(3-2*t)
    def bell(v,w):
        return np.exp(-(v/w)**2)
    cy,w,h = [np.interp(z,GAME_Z,a) for a in (GAME_Y,GAME_WIDTH,GAME_DEPTH)]
    s,phi = body_chart(points,False)
    grid = np.fromfile(Path(__file__).with_name('sections.u8'),dtype=np.uint8).reshape(64,480)/128.
    row = ((phi+np.pi)*64/(2*np.pi)-.5)%64
    col = np.clip((s+6)*40-.5,0,478.999)
    i,j = row.astype(int),col.astype(int)
    def ring(k):
        return grid[k,j]*(1-(col-j)) + grid[k,j+1]*(col-j)
    radius = ring(i)*(1-(row-i)) + ring((i+1)%64)*(row-i)
    # Scale the radial change by physical distance before blending. The seat,
    # ankles, oral cavity and the animated eye margins have their own clearances.
    native = np.hypot(x/w,(y-cy)/h)
    blend = ease(-7.10,-6.55,z)*(1-ease(2.68,3.15,z))*ease(-1.23,-.76,(y-cy)/h)
    seat = bell((z-.48),.90)*ease(.35,.77,(y-cy)/h)
    blend *= (1-seat)*(.66-.14*ease(-2,-.6,z))
    delta = np.clip(radius-native,-.16,.28)*blend
    out = points.copy()
    out[:,0] += delta*w*np.cos(phi)
    out[:,1] += delta*h*np.sin(phi)
    # Widen the rib basket and neck below the tack. Carry the mass into the
    # back of the dentary without moving the occlusal edges or the nostrils.
    out[:,0] += x*(.15*bell(z-.48,1.55)*bell(y-2.84,.75)
                    +.14*bell(z-2.22,.75)*bell(y-3.35,.70)
                    +.15*bell(z-3.18,.48)*bell(y-3.10,.25))
    out[:,1] -= .12*bell(z-.82,1.03)*bell(y-2.06,.50)
    # Both calves and the metatarsal shafts have volume around their own
    # centreline. Keep the sole planted, and fade the change into the hip.
    cz = np.interp(y,LEG_Y,GAME_LEG_Z)
    cx = np.interp(y,LEG_Y,[.65,.64,.64,.64,.68,.72,.75,.73])
    weight = ease(.09,.35,y)*(1-ease(1.88,2.67,y))*bell(z-cz,.88)
    out[:,0] += (x-np.sign(x)*cx)*.39*weight
    out[:,2] += (z-cz)*.46*weight
    return out
