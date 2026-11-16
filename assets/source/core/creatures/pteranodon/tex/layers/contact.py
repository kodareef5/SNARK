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
    names=['inner_wing','under_wing','head','carcass']
    width=2164
    out=Image.new('RGB',(width,len(names)*352+60),(34,38,43));d=ImageDraw.Draw(out)
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

def all_stages():
    """Full-size labelled sheets for visual audit, all 210 stage/view/dye cells."""
    groups = {'flight':['three_quarter','side','above','below'],
              'detail':['inner_wing','under_wing','head','rider'],
              'carcass':['carcass','feet']}
    for folder in ['close','storage512']:
        storage=256 if folder=='close' else 512
        for dye in ['design','loud','dark']:
            for group,names in groups.items():
                out=Image.new('RGB',(2164,55+len(names)*344),(34,38,43))
                d=ImageDraw.Draw(out)
                d.text((12,7),f'{dye.upper()} / {group} / stored at {storage}',font=font(22),fill='white')
                for i,label in enumerate(LABELS):d.text((16+308*i,33),label,font=font(16),fill='white')
                for row,name in enumerate(names):
                    y=55+row*344
                    d.text((12,y),name.replace('_',' '),font=font(18),fill='white')
                    out.paste(Image.open(HERE/f'look/{folder}/stages_{name}_{dye}.png').convert('RGB'),(0,y+24))
                out.save(HERE/f'look/{folder}/audit_{group}_{dye}.jpg',quality=95)

def storage():
    names=['inner_wing','under_wing','rider']
    out=Image.new('RGB',(1200,76+len(names)*334),(34,38,43));d=ImageDraw.Draw(out)
    d.text((12,8),'256 / 512 stored pixels — same 1024 paint, game renderer',font=font(24),fill='white')
    for col,label in enumerate(['Hurt 3 at 256','Hurt 3 at 512','Decay 3 at 256','Decay 3 at 512']):
        d.text((col*300+10,44),label,font=font(21),fill='white')
    for row,name in enumerate(names):
        y=76+row*334
        for col,(stage,folder) in enumerate([(3,'close'),(3,'storage512'),(6,'close'),(6,'storage512')]):
            im=Image.open(HERE/f'look/{folder}/stages_{name}_design.png').convert('RGB')
            x=8+stage*308
            out.paste(im.crop((x,8,x+300,308)),(col*300,y+26))
        d.text((12,y),name.replace('_',' '),font=font(19),fill='white')
    out.save(HERE/'STORAGE_256_512.jpg',quality=95)


def marks():
    names=['tear_upper','tear_under','puncture_upper','puncture_under','leather_upper']
    for dye in ['design','loud','dark']:
        out=Image.new('RGB',(2164,55+len(names)*344),(34,38,43));d=ImageDraw.Draw(out)
        d.text((12,7),f'{dye.upper()} / ROUND 3 MARK DETAILS / stored at 256',font=font(22),fill='white')
        for i,label in enumerate(LABELS):d.text((16+308*i,33),label,font=font(16),fill='white')
        for row,name in enumerate(names):
            y=55+row*344
            d.text((12,y),name.replace('_',' '),font=font(18),fill='white')
            out.paste(Image.open(HERE/f'look/marks/stages_{name}_{dye}.png').convert('RGB'),(0,y+24))
        out.save(HERE/f'look/marks/audit_marks_{dye}.jpg',quality=95)
        names_late=['long_rip_upper','long_rip_under','outer_puncture_under']
        out=Image.new('RGB',(2164,55+len(names_late)*344),(34,38,43));d=ImageDraw.Draw(out)
        d.text((12,7),f'{dye.upper()} / SECOND RIP AND OUTER PUNCTURE / stored at 256',font=font(22),fill='white')
        for i,label in enumerate(LABELS):d.text((16+308*i,33),label,font=font(16),fill='white')
        for row,name in enumerate(names_late):
            y=55+row*344
            d.text((12,y),name.replace('_',' '),font=font(18),fill='white')
            out.paste(Image.open(HERE/f'look/marks/stages_{name}_{dye}.png').convert('RGB'),(0,y+24))
        out.save(HERE/f'look/marks/audit_added_{dye}.jpg',quality=95)

if __name__=='__main__':
    close();distance();all_stages();storage();marks()
