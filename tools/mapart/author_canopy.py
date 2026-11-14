"""Freeze the finest painted vegetation as authored world data for every zoom."""
import json,hashlib
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from rasterio.warp import reproject,Resampling
from common import *

def main():
    for y in range(8):
        for x in range(8):
            if not (ROOT/'paintings/z3'/f'{x}_{y}.raw.png').exists():
                raise ValueError('Every zoom-3 original is required before freezing canopy')
    source=ROOT/'paintings/z3/registered.png'
    raw=np.asarray(Image.open(source),dtype=np.int16)
    if raw.shape!=(8192,8192,3):raise ValueError('Expected complete finest-scale registered painting')
    crown=((raw[...,1]-raw[...,0]>-5)&(raw[...,1]-raw[...,2]>30))|((raw[...,1]-raw[...,0]>-18)&(raw[...,1]-raw[...,2]>48)&(raw[...,1]<170))
    crown=nd.binary_closing(crown,iterations=1)
    del raw
    for name in ['surface_water','roads','buildings']:
        crown&=np.asarray(Image.open(ROOT/'references/z3'/f'{name}.png'))==0
    crown&=np.asarray(Image.open(ROOT/'references/z3/biome.png'))!=6
    fine=crown.astype(np.uint8)
    save(fine,ROOT/'base/painted_canopy_fine.png')
    base=np.zeros((N,N),np.uint8)
    reproject(fine,base,src_transform=transform(8192),dst_transform=GRID,
              src_crs=CRS,dst_crs=CRS,resampling=Resampling.nearest)
    ix=np.minimum((np.arange(N,dtype=np.float64)*8192/(N-1)).astype(int),8191)
    base[0]=fine[0,ix];base[-1]=fine[-1,ix]
    base[:,0]=fine[ix,0];base[:,-1]=fine[ix,-1]
    save(base,ROOT/'base/painted_canopy.png')
    (ROOT/'base/painted_canopy.json').write_text(json.dumps({
        'origin':'Authored vegetation from registered original painting; not a survey of present-day trees.',
        'source':'paintings/z3/registered.png','source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'fine_grid':'8192 pixel areas across map bounds; transform in map.json conventions',
        'base_grid':'4065 vertex samples, 2 m spacing, endpoints included',
        'values':{'0':'no added crown','1':'authored crown'},'fine_count':int(fine.sum()),
        'base_count':int(base.sum())},indent=2))
    print('Frozen authored canopy',int(fine.sum()),'fine pixels',int(base.sum()),'base samples')

if __name__=='__main__':main()
