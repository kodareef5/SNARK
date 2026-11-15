"""Make a labelled review contact sheet from the current transparent renders.
Usage: python3 inspect_round.py checks/review.png
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parent
BG=(214,212,206)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
sheet=Image.new('RGB',(3*627,6*667),BG);d=ImageDraw.Draw(sheet)
for col,station in enumerate(['mortar','smithy','bin']):
    views=['front','side','top','back','hero']+(['hero_lit'] if station=='bin' else [])
    for row,view in enumerate(views):
        im=Image.open(ROOT/'renders'/f'{station}_{view}_rgba.png').convert('RGBA').resize((627,627),Image.Resampling.LANCZOS)
        x=col*627;y=row*667
        d.text((x+20,y+8),station+' / '+view,font=font,fill=(40,43,44));sheet.paste(im,(x,y+40),im)
sheet.save(ROOT/(sys.argv[1] if len(sys.argv)>1 else 'checks/current_review.png'))
