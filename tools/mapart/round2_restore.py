"""Rebuild ignored geometry contexts without rewriting historical prompts."""
import argparse
import numpy as np
from PIL import Image,ImageDraw
from common import ROOT


def contexts():
 for z in [2,3]:
  ref=ROOT/f'references/z{z}';im=Image.open(ref/'whole.png').convert('RGB')
  padded=Image.fromarray(np.pad(np.asarray(im),((64,64),(64,64),(0,0)),mode='edge'))
  for y in range(2**z):
   for x in range(2**z):padded.crop((x*1024,y*1024,x*1024+1152,y*1024+1152)).save(ref/f'{x}_{y}.context.png')
 print('restored geometry contexts',flush=True)


def review():
 dest=ROOT/'checks';dest.mkdir(exist_ok=True)
 out=Image.new('RGB',(2048,2048))
 for z in range(4):
  n=2**z;whole=Image.new('RGB',(n*1024,n*1024))
  for y in range(n):
   for x in range(n):whole.paste(Image.open(ROOT/f'tiles/z{z}/{x}_{y}.png'),(x*1024,y*1024))
  whole.resize((1024,1024),Image.Resampling.LANCZOS).save(dest/f'overview_z{z}.png')
  out.paste(whole.resize((1024,1024),Image.Resampling.LANCZOS),((z%2)*1024,(z//2)*1024))
 out.save(dest/'round2-four-zooms.jpg',quality=94)
 for z in [2,3]:
  n=2**z;sheet=Image.new('RGB',(n*256,n*280),'#ebe3cb');d=ImageDraw.Draw(sheet)
  for y in range(n):
   for x in range(n):
    im=Image.open(ROOT/f'tiles/z{z}/{x}_{y}.png').resize((256,256),Image.Resampling.LANCZOS)
    sheet.paste(im,(x*256,y*280+24));d.text((x*256+8,y*280+5),f'z{z} {x},{y}',fill='#544d39')
  sheet.save(dest/f'round2-contact-z{z}.jpg',quality=94)
 print('restored review sheets',flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--review',action='store_true');a=p.parse_args()
 review() if a.review else contexts()
