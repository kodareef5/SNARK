"""Raster finish: exact solid background, common alpha-derived masks, contact sheet.
No geometry deformation or independent painting is performed here.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import json, numpy as np
ROOT=Path(__file__).resolve().parents[1]
BG=(214,212,206)
VIEWS=json.loads((ROOT/'checks/cameras.json').read_text())
for name,spec in VIEWS.items():
    path=ROOT/'renders'/f'{name}.png'
    if not path.exists():continue
    im=Image.open(path).convert('RGBA')
    if spec['view']=='side': im=ImageOps.mirror(im)
    alpha=im.getchannel('A');out=Image.new('RGB',im.size,BG);out.paste(im,mask=alpha);out.save(ROOT/f'{name}.png');alpha.save(ROOT/f'{name}_mask.png')
thumbs=[]
for name in VIEWS:
    path=ROOT/f'{name}.png'
    if path.exists():
        im=Image.open(path);im.thumbnail((418,418));thumbs.append((name,im))
sheet=Image.new('RGB',(1254,460*((len(thumbs)+2)//3)),(242,241,237));d=ImageDraw.Draw(sheet)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
for i,(name,im) in enumerate(thumbs):
    x=(i%3)*418;y=(i//3)*460;sheet.paste(im,(x,y+32));d.text((x+15,y+6),name,fill=(38,43,44),font=font)
sheet.save(ROOT/'checks/contact.png')
