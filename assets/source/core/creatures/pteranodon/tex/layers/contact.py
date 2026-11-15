"""Label the game-rendered review sheets, preserving native distance pixels."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent
LABELS=['Unhurt','Hurt 1','Hurt 2','Hurt 3 / fresh','Decay 1','Decay 2','Decay 3']
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
def font(n):
    try:return ImageFont.truetype(FONT,n)
    except OSError:return ImageFont.load_default()

def close():
    names=['inner_wing','head','carcass']
    width=2164
    out=Image.new('RGB',(width,3*352+60),(34,38,43));d=ImageDraw.Draw(out)
    d.text((12,10),'PTERANODON  /  INJURY AND HARVEST     Game renderer, layers stored at 256',font=font(23),fill='white')
    for row,name in enumerate(names):
        y=60+row*352
        for i,label in enumerate(LABELS):d.text((16+308*i,y),label,font=font(18),fill='white')
        im=Image.open(HERE/f'look/close/stages_{name}_design.png').convert('RGB')
        out.paste(im,(0,y+27))
    out.save(HERE/'REVIEW.jpg',quality=94)

def distance():
    width=2024;out=Image.new('RGB',(width,690),(34,38,43));d=ImageDraw.Draw(out)
    d.text((12,10),'20 m BELOW / native 270-pixel span / design, loud, dark dyes',font=font(24),fill='white')
    for row,dye in enumerate(['design','loud','dark']):
        y=50+row*212
        for i,label in enumerate(LABELS):d.text((16+288*i,y),label,font=font(18),fill='white')
        im=Image.open(HERE/f'look/20m/stages_below_{dye}.png').convert('RGB')
        out.paste(im.crop((0,50,width,220)),(0,y+30))
    out.save(HERE/'DISTANCE_20M.png')
    width=2145;out=Image.new('RGB',(width,1220),(34,38,43));d=ImageDraw.Draw(out)
    d.text((12,10),'60 m BELOW / native 90-pixel span above each 3x nearest-pixel enlargement',font=font(24),fill='white')
    for row,dye in enumerate(['design','loud','dark']):
        y=50+row*385
        im=Image.open(HERE/f'look/60m/stages_below_{dye}.png').convert('RGB')
        out.paste(im,(12,y));d.text((750,y+20),dye,font=font(24),fill='white')
        for i,label in enumerate(LABELS):d.text((30+303*i,y+115),label,font=font(20),fill='white')
        crop=im.crop((0,23,715,96)).resize((2145,219),Image.Resampling.NEAREST)
        out.paste(crop,(0,y+147))
    out.save(HERE/'DISTANCE_60M.png')

if __name__=='__main__':
    close();distance()
