#!/usr/bin/env python3
"""Read all seven colours from final RGB keys, arithmetic mean of 13×13 sRGB pixels.
Horizontal coordinates wrap across the panorama seam. No medians or source/target
colour substitutions. Reads are independent of the build and supplied measure.py.
"""
import site
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import json,csv
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
def main():
 meta=json.loads((ROOT/'base/points.json').read_text());patch=meta['patch'];r=patch//2
 out={'about':'Arithmetic mean sRGB of the final RGB panorama pixels, 13 by 13 square centered at each supplied point; horizontal wrap.', 'patch':patch,'colourSpace':'8-bit sRGB D65','projection':meta['projection'],'keys':{}}
 rows=[]
 for k in meta['keys']:
  im=Image.open(ROOT/k['file']);assert im.mode=='RGB' and im.size==(2048,1024)
  a=np.asarray(im,dtype=np.float64);cols={}
  for n,p in k['points'].items():
   xs=np.arange(p['x']-r,p['x']+r+1)%a.shape[1]
   square=a[max(0,p['y']-r):min(a.shape[0],p['y']+r+1)][:,xs]
   c=square.mean(axis=(0,1));cols[n]=[round(float(v),3) for v in c]
   rows.append([k['name'],n,p['x'],p['y'],*cols[n]])
  out['keys'][k['name']]=cols
 (ROOT/'points.json').write_text(json.dumps(out,indent=2)+'\n')
 with (ROOT/'reports'/'key-points.csv').open('w') as f:
  w=csv.writer(f);w.writerow(['key','point','x','y','R','G','B']);w.writerows(rows)
 print('Read 56 point colours from eight RGB panoramas.')
if __name__=='__main__':main()
