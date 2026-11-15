"""Project mangrove source extraction, adapted from mangrove_leaves/build_material.py."""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
SRC=Path(__file__).resolve().parent/"source"
MATURE=np.array([75.,98.,55.])
def u8(a):return np.clip(np.rint(a),0,255).astype(np.uint8)
def save(path,a,srgb=False):Image.fromarray(a).save(path)

def largest(mask):
    labels, n = ndi.label(mask)
    if not n: raise ValueError('No source leaf')
    counts = np.bincount(labels.ravel()); counts[0] = 0
    return labels == counts.argmax()

def library():
    """Keep generated contours and pigment/venation, remove broad source light."""
    im = np.array(Image.open(SRC / 'leaves_generated.png').convert('RGBA'))
    h, w = im.shape[:2]
    lib = []
    previews = np.zeros((3*320, 4*160, 4), np.uint8)
    for k in range(12):
        row, col = divmod(k, 4)
        sub = im[round(row*h/3):round((row+1)*h/3), round(col*w/4):round((col+1)*w/4)]
        mask = largest(ndi.binary_opening(sub[..., 3] > 225, iterations=2))
        mask = ndi.binary_fill_holes(mask)
        widths = mask.sum(1)
        rows = np.where(widths > widths.max()*.10)[0]
        y0, y1 = rows[0], rows[-1]
        ys = np.arange(y0, y1+1)
        left = np.array([np.where(mask[y])[0][0] for y in ys], float)
        right = np.array([np.where(mask[y])[0][-1] for y in ys], float)
        mid = ndi.gaussian_filter1d((left+right)*.5, 8)
        lum = sub[..., :3].astype(float) @ np.array([.2126, .7152, .0722])
        vein = []
        for y, m, l, r in zip(ys, mid, left, right):
            radius = max(2, (r-l)*.12)
            a, b = max(0, int(m-radius)), min(sub.shape[1], int(m+radius)+1)
            vein.append(a+np.argmax(ndi.gaussian_filter1d(lum[y, a:b], 1)))
        mid = ndi.gaussian_filter1d(vein, 9)
        t = np.linspace(0, 1, 320)
        sy = y1-t*(y1-y0)
        le = np.interp(sy, ys, ndi.gaussian_filter1d(left, 1.7))
        ri = np.interp(sy, ys, ndi.gaussian_filter1d(right, 1.7))
        ce = np.clip(np.interp(sy, ys, mid), le+.5, ri-.5)
        u = np.linspace(-1, 1, 160)[None]
        sx = ce[:, None] + np.where(u < 0, u*(ce-le)[:, None], u*(ri-ce)[:, None])*.97
        sy2 = np.broadcast_to(sy[:, None], sx.shape)
        tissue = np.stack([ndi.map_coordinates(sub[..., c].astype(float), [sy2, sx], order=1) for c in range(3)], -1)
        luminance = tissue @ np.array([.2126, .7152, .0722])
        low = ndi.gaussian_filter(luminance, (18, 12))
        micro = np.clip((luminance-low)/np.maximum(low, 20), -.17, .17)
        width = (ri-le)/(ri-le).max()
        width *= np.minimum(t/.018, 1)*np.minimum((1-t)/.02, 1)
        curve = (ce-(le+ri)*.5)/(ri-le).max()
        lib.append(dict(width=width, curve=curve, micro=micro))
        target = MATURE if k in [0,1,2,3,4,5,8,9] else np.array([107,120,73]) if k<8 else np.array([150,160,72]) if k==10 else np.array([132,87,47])
        previews[row*320:(row+1)*320, col*160:(col+1)*160, :3] = u8(target*(1+micro[::-1, :, None]))
        previews[row*320:(row+1)*320, col*160:(col+1)*160, 3] = 255
    save(SRC / 'rectified_tissue.png', previews, True)
    return lib

