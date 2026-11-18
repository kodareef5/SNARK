"""Compose matched form-review.ts native renders without changing their relative scale."""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont

before, after, output = map(Path, sys.argv[1:4])
rows = [
    ('game-quarter', 'Daylight, Level 0'),
    ('game-lod2', 'Daylight, Level 2'),
    ('clay-profile', 'Clay profile'),
    ('clay-quarter', 'Clay three-quarter'),
    ('face', 'Head and neck'),
    ('shell', 'Rear shell'),
]
fonts='/usr/share/fonts/truetype/dejavu/'
normal=ImageFont.truetype(fonts+'DejaVuSans.ttf',16)
bold=ImageFont.truetype(fonts+'DejaVuSans-Bold.ttf',25)
canvas=Image.new('RGB',(1104,1512),'#f1f0e9')
draw=ImageDraw.Draw(canvas)
draw.text((20,10),'Carbonemys sculpt comparison',font=bold,fill='#263b35')
draw.text((20,49),'Previous model',font=normal,fill='#33483e')
draw.text((568,49),'Revised model',font=normal,fill='#33483e')
for row,(name,title) in enumerate(rows):
    pics=[Image.open(folder/(name+'.png')).convert('RGB') for folder in (before,after)]
    bgs=[pic.getpixel((0,0)) for pic in pics]
    bounds=[ImageChops.difference(pic,Image.new('RGB',pic.size,bg)).getbbox() for pic,bg in zip(pics,bgs)]
    x0=min(box[0] for box in bounds);x1=max(box[2] for box in bounds)
    y0=min(box[1] for box in bounds);y1=max(box[3] for box in bounds)
    # Identical crop and camera. The two gameplay rows keep the original pixel size.
    low=0 if row in (0,1) else 5
    box=(max(0,x0-low),max(0,y0-low),min(600,x1+low),min(420,y1+low))
    if name=='face': box=(116,130,411,278)
    scale=min(1.4 if name=='face' else 1,518/(box[2]-box[0]),204/(box[3]-box[1]))
    target=(round((box[2]-box[0])*scale),round((box[3]-box[1])*scale))
    for col,(pic,bg) in enumerate(zip(pics,bgs)):
        xx=20+col*548;yy=75+row*238
        draw.rectangle((xx,yy,xx+517,yy+204),fill=bg)
        frame=pic.crop(box).resize(target,Image.Resampling.LANCZOS)
        canvas.paste(frame,(xx+(518-target[0])//2,yy+(205-target[1])//2))
        if col==0:draw.text((xx,yy+208),title,font=normal,fill='#33483e')
canvas.save(output,optimize=True)
