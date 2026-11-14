from pathlib import Path
import json
import numpy as np
from affine import Affine
from PIL import Image
from rasterio.features import rasterize
from shapely.geometry import shape

ROOT=Path(__file__).resolve().parents[2]/'assets/source/maps/miami'
CFG=json.loads((ROOT/'map.json').read_text())
CRS=CFG['crs_wkt']
B=CFG['bounds']
SIZE=CFG['size_m']
N=CFG['grid_samples']
GRID=Affine(2,0,B[0]-1,0,-2,B[3]+1)

def transform(n):return Affine(SIZE/n,0,B[0],0,-SIZE/n,B[3])
def save(a,path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    Image.fromarray(a).save(path)
def vectors(name):
    data=json.loads((ROOT/'base'/f'{name}.geojson').read_text())
    return [(shape(f['geometry']),f['properties']) for f in data['features']]
def burn(items,n,tx=None):
    return rasterize(items,out_shape=(n,n),transform=tx or transform(n),fill=0,dtype='uint8')
