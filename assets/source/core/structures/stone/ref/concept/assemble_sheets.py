"""Assemble labelled concept sheets; raw image-tool outputs stay untouched."""
from pathlib import Path
import hashlib
import json
import shutil
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
PAPER = '#ede7dc'
INK = '#302d28'
MUTED = '#665e51'
ACCENT = '#8b5c37'
FONT = next(p for p in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf') if Path(p).exists())
BOLD = next(p for p in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf') if Path(p).exists())
def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)

def sheet(raw, target, title, subtitle, columns):
    art = Image.open(ROOT/'source'/raw).convert('RGB')
    w,h = art.size
    header, footer = 112, 152
    out = Image.new('RGB', (w,h+header+footer), PAPER)
    out.paste(art, (0,header))
    d = ImageDraw.Draw(out)
    d.text((32,23), title, fill=INK, font=font(30,True))
    d.text((32,66), subtitle, fill=MUTED, font=font(19))
    d.line((32,99,w-32,99), fill=ACCENT,width=3)
    colw = w/len(columns)
    for i,(name,dim,note) in enumerate(columns):
        x=int(colw*i+30)
        y=h+header+19
        d.text((x,y), name, fill=INK, font=font(23,True))
        d.text((x,y+35), dim, fill=INK, font=font(21))
        d.text((x,y+70), note, fill=MUTED, font=font(17))
    out.save(ROOT/target)
    return out

walls=sheet('03_pieces_walls.png','pieces_walls.png',
    'STONE / 01   WALLS & OPENINGS',
    'Squared rock-faced limestone / pale chamfered jambs / checked oak / black iron',[
    ('WALL','3 x 3 m / 0.20 m core','Face relief: a few centimetres beyond the core.'),
    ('DOORFRAME + CLOSED DOOR','Opening 1.4 x 2.3 m','Three iron straps; uneven-width oak planks.'),
    ('WINDOWFRAME','Opening 1.2 x 0.7 m / sill 1.2 m','Through-wall oak lintel and heavy oak sill.')])
slabs=sheet('04_pieces_slabs.png','pieces_slabs.png',
    'STONE / 02   FOUNDATION & FLAT ROOF',
    'Three views / one foundation and the two faces of one ceiling module',[
    ('FOUNDATION','3 x 3 x 0.375 m','Big perimeter blocks; broad worn flagstones.'),
    ('CEILING / TOP','3 x 3 x 0.25 m','Flat flagstone roof; no parapet or raised rim.'),
    ('CEILING / UNDERSIDE','Same 0.25 m total depth','Flush oak grid with recessed stone infill.')])
stairs=sheet('06_pieces_stairs.png','pieces_stairs.png',
    'STONE / 03   TEN-STEP STAIR',
    'Corrected against the dimensioned geometry scaffold / P06',[
    ('STAIRS','3 m wide x 3 m rise x 3 m run',
     '10 x (0.30 m rise + 0.30 m tread). Each step is one full-width stone.')])
joinery=sheet('10_pieces_pillar_door.png','pieces_pillar_door.png',
    'STONE / 04   PILLAR & DOOR BACK',
    'Matching limestone and oak / near-frontal views for proportion and joinery',[
    ('PILLAR','0.5 x 0.5 x 3 m','Stacked rough blocks; no capital or pedestal.'),
    ('DOOR / BACK','Fits 1.4 x 2.3 m opening','Three oak ledges; two diagonal braces.')])

# Contact sheet: the individual sheets above retain every original art pixel.
W=2000
margin=32
gap=24
def scaled(im, width):
    return im.resize((width, round(im.height*width/im.width)), Image.Resampling.LANCZOS)
a=scaled(walls,W-2*margin)
b=scaled(slabs,W-2*margin)
cw=(W-2*margin-gap)//2
c=scaled(stairs,cw)
e=scaled(joinery,cw)
overview=Image.new('RGB',(W,margin*2+a.height+b.height+max(c.height,e.height)+gap*2),PAPER)
y=margin
overview.paste(a,(margin,y)); y+=a.height+gap
overview.paste(b,(margin,y)); y+=b.height+gap
overview.paste(c,(margin,y)); overview.paste(e,(margin+cw+gap,y))
overview.save(ROOT/'pieces.png')

for raw,target in [
    ('07_house_front_final.png','house_front.png'),
    ('08_house_far.png','house_far.png'),
    ('09_inside.png','inside.png')]:
    shutil.copy2(ROOT/'source'/raw,ROOT/target)

manifest=[]
for p in sorted((ROOT/'source').glob('*.png')):
    with Image.open(p) as im:
        manifest.append({'file':str(p.relative_to(ROOT)),
            'prompt':'P'+p.name[:2], 'width':im.width,'height':im.height,
            'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(ROOT/'source_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Saved seven individual deliverables, pieces.png, and source_manifest.json.')
