"""Sample the striped Grab3D Rex around its full circumference in anatomical coordinates."""
import hashlib
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree

from anatomy import DONOR_Z, SOURCE_Y, SOURCE_DEPTH, body_chart, leg_chart

def read(path):
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != '8447182d7e767b990eedf63c1f87a5ae52d9168cb5e6f69737d6c8aab1377651':
        raise ValueError('Expected the full Grab3D t-rex.glb')
    stop = 20 + int.from_bytes(raw[12:16], 'little')
    g = json.loads(raw[20:stop])
    buf = memoryview(raw)[stop+8:]
    prim = g['meshes'][0]['primitives'][0]
    def array(i, width):
        a = g['accessors'][i]
        b = g['bufferViews'][a['bufferView']]
        dtype = np.dtype({5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']])
        return np.ndarray((a['count'],width), dtype, buf, b.get('byteOffset',0)+a.get('byteOffset',0),
                          strides=(b.get('byteStride',width*dtype.itemsize),dtype.itemsize))
    def image(slot):
        im = g['images'][g['textures'][slot['index']]['source']]
        b = g['bufferViews'][im['bufferView']]
        off = b.get('byteOffset',0)
        return np.asarray(Image.open(io.BytesIO(buf[off:off+b['byteLength']])).convert('RGB'))
    mat = g['materials'][prim['material']]['pbrMetallicRoughness']
    return (array(prim['attributes']['POSITION'],3), array(prim['attributes']['TEXCOORD_0'],2),
            array(prim['indices'],1).reshape(-1,3),image(mat['baseColorTexture']),image(mat['metallicRoughnessTexture']))

class Chart:
    """Unroll the donor triangles, preserving individual donor UV charts across their seams."""
    def __init__(self, p, uv, tri, images, leg=False):
        self.lo, self.hi = (0,3) if leg else (-6,6)
        s, phi = (leg_chart if leg else body_chart)(p, True)
        centres = p[tri].mean(1)
        x,y,z = centres.T
        if leg:
            valid = (x>.20)&(y<3.01)&(z>-1)&(z<1.8)
        else:
            belly = np.interp(z, DONOR_Z, SOURCE_Y) - np.interp(z,DONOR_Z,SOURCE_DEPTH)
            valid = y > belly-.07
        tri = tri[valid]
        angles = phi[tri]
        # Unwrap each triangle locally, then duplicate only the ones crossing the seam.
        angles = angles[:, :1] + (angles-angles[:, :1]+np.pi)%(2*np.pi)-np.pi
        points = np.stack((s[tri],angles),axis=2)
        low, high = angles.min(1)<-np.pi+.08, angles.max(1)>np.pi-.08
        points = np.concatenate((points, points[low]+[0,2*np.pi],points[high]-[0,2*np.pi]))
        tri = np.concatenate((tri,tri[low],tri[high]))
        tree = cKDTree(points.mean(1))
        w,h = (1024,768) if leg else (3072,1280)
        self.pixels = np.empty((h,w,4),np.uint8)
        for row in range(0,h,32):
            yy,xx = np.mgrid[row:min(row+32,h),:w]
            q = np.stack((self.lo + (xx+.5)/w*(self.hi-self.lo), (yy+.5)/h*(2*np.pi)-np.pi),-1).reshape(-1,2)
            _,near = tree.query(q,k=4,workers=4)
            a,b,c = points[near].transpose(2,0,1,3)
            ba,ca,qa = b-a,c-a,q[:,None,:]-a
            def cross(v,t): return v[...,0]*t[...,1]-v[...,1]*t[...,0]
            det = cross(ba,ca)
            det = np.where(abs(det)<1e-12,1e-12,det)
            u,v = cross(qa,ca)/det,cross(ba,qa)/det
            weights = np.stack((1-u-v,u,v),-1)
            best = np.maximum(-weights,0).sum(-1).argmin(1)
            i = np.arange(len(q))
            wt = np.maximum(0,weights[i,best])
            tex = (uv[tri[near[i,best]]]*(wt/wt.sum(1)[:,None])[:,:,None]).sum(1)%1
            for k,(im,ch) in enumerate(images):
                coord = [tex[:,1]*im.shape[0]-.5,tex[:,0]*im.shape[1]-.5]
                self.pixels[row:row+yy.shape[0],:,k] = map_coordinates(im[:,:,ch],coord,order=1,mode='nearest').reshape(yy.shape)

    def sample(self,s,phi):
        h,w = self.pixels.shape[:2]
        coord = [((phi+np.pi)/(2*np.pi)*h-.5)%h, np.clip((s-self.lo)/(self.hi-self.lo)*w-.5,0,w-1)]
        return np.stack([map_coordinates(self.pixels[:,:,k],coord,order=1,mode='nearest') for k in range(4)],-1)

class Sculpt:
    def __init__(self,path):
        p,uv,tri,base,mro = read(path)
        images = [(base,0),(base,1),(base,2),(mro,1)]
        self.body = Chart(p,uv,tri,images)
        self.leg = Chart(p,uv,tri,images,leg=True)

    def paint(self,points,fields):
        shape = points.shape[:-1]
        p = points.reshape(-1,3)
        x,y,z = p.T
        body = self.body.sample(*body_chart(p,False)).astype(float)
        # The planted hindleg supplies both legs. Its foot and ankle follow their
        # own centreline independently of the posed donor's trailing foot.
        leg = self.leg.sample(*leg_chart(p,False))
        def smooth(a,b,t):
            u = np.clip((t-a)/(b-a),0,1)
            return u*u*(3-2*u)
        mix = (1-smooth(1.80,2.96,y))*smooth(-2.1,-1.25,z)*(1-smooth(.50,1.13,z))
        pix = (body+(leg-body)*mix[:,None]).reshape((*shape,4))
        native,height,rough,ao,weights,wound,macro = fields
        rgb = pix[:,:,:3]
        luma = .299*rgb[:,:,0]+.587*rgb[:,:,1]+.114*rgb[:,:,2]
        # Keep the amber flank and cool the umber dorsal bars. Native relief
        # supplies pore-scale contrast, especially around the live lids and lips.
        base = (.69*rgb+.31*luma[:,:,None])*[.97,1.02,1.04]+[22,23,23]
        base *= (.82+.20*native/155)
        # The scan has a closed jaw and exposed teeth. Paint the mobile dentary
        # from its own scales so the scan's teeth never travel on its outside.
        lip = np.interp(z,[3.3,3.55,4.0,4.24,4.5,4.73,5.08],[3.48,3.46,3.34,3.31,3.34,3.40,3.44])
        chin = (smooth(3.37,3.77,z)*(1-smooth(lip-.012,lip+.025,y))).reshape(shape)
        bone = native*[1.02,.85,.65] + [12,12,13]
        base += (bone-base)*chin[:,:,None]
        # Deep nasal tissue keeps its own occlusion when the donor snout is wider.
        cavity = (1-smooth(48,122,native[:,:,0]))*smooth(4.42,4.56,z).reshape(shape)
        base *= (1-.8*cavity[:,:,None])
        return base,height,.59*rough+.41*np.clip(pix[:,:,3]/255,.49,.94),ao,weights*.48,wound,macro
