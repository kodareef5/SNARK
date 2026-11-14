"""Warm registration caches while original paintings arrive; no final exports."""
import argparse,time
import numpy as np
from PIL import Image
from common import ROOT
from finish import cached_register

def main(z,watch):
    ref=ROOT/'references'/f'z{z}';n=2**z;done=set()
    truth=np.pad(np.asarray(Image.open(ref/'surface_water.png'))>0,64,mode='edge')
    while True:
        for y in range(n):
            for x in range(n):
                if (x,y) in done:continue
                path=ROOT/'paintings'/f'z{z}'/f'{x}_{y}.raw.png'
                if not path.exists():continue
                try:
                    with Image.open(path) as im:im.verify()
                except (OSError,SyntaxError):continue # copy may still be arriving
                target=truth[y*1024:y*1024+1152,x*1024:x*1024+1152]
                cached_register(path,ref/f'{x}_{y}.context.png',target,1152)
                done.add((x,y));print('registered',z,x,y,len(done),flush=True)
        if len(done)==n*n or not watch:break
        time.sleep(5)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('zoom',type=int);p.add_argument('--watch',action='store_true');a=p.parse_args();main(a.zoom,a.watch)
