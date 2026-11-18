"""Measure cross-sections of the donor for the connected, weighted game skin."""
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter
from anatomy import DONOR_Z, SOURCE_X, SOURCE_Y, SOURCE_WIDTH, SOURCE_DEPTH, body_chart
from sculpt import read


def measure(source):
    p = read(source)[0]
    x,y,z = p.T
    dz,phi = body_chart(p,True)
    cx,cy,w,h = [np.interp(z,DONOR_Z,a) for a in (SOURCE_X,SOURCE_Y,SOURCE_WIDTH,SOURCE_DEPTH)]
    radius = np.hypot((x-cx)/w,(y-cy)/h)
    ring, column = np.floor((phi+np.pi)*64/(2*np.pi)).astype(int)%64, np.clip(((dz+6)*40).astype(int),0,479)
    grid = np.full((64,480),np.nan)
    valid = (y>cy-h-.015)&(radius>.50)&(radius<1.64)
    # Median samples reject the small forearms and the opposite edge of a fold.
    keys = ring[valid]*480+column[valid]
    order = np.argsort(keys)
    values = radius[valid][order]
    keys,starts,counts = np.unique(keys[order],return_index=True,return_counts=True)
    for key, start, count in zip(keys,starts,counts):
        grid.flat[key] = np.median(values[start:start+count])
    grid = np.tile(grid,(3,1))
    indices = distance_transform_edt(~np.isfinite(grid), return_distances=False,return_indices=True)
    return gaussian_filter(grid[tuple(indices)],(.85,1.0))[64:128].astype('float32')


if __name__ == '__main__':
    np.round(measure(sys.argv[1])*128).astype('uint8').tofile(Path(__file__).with_name('sections.u8'))
