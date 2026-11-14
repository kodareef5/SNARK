"""Native bathymetric painting contexts. Run before commissioning new originals.

Writes a new round3 queue; never overwrites the earlier historical prompts.
Uses the frozen generation-time parent, not a later colour-balanced export.
"""
import argparse, json
import numpy as np
from PIL import Image, ImageDraw
from common import ROOT
from round3_bathy import pigment

def district_contexts():
    """Recreate the four exact z1 reference pairs without changing prompts."""
    n=2048;g=64;r=ROOT/'references/round3/z1';r.mkdir(parents=True,exist_ok=True)
    base=np.array(Image.open(ROOT/'paintings/z1/retained-paint.png'))
    w=np.array(Image.open(ROOT/'references/z1/surface_water.png'))>0
    base[w]=np.uint8(pigment(n)[w])
    parent=np.array(Image.open(ROOT/'reports/round3/z0-registered-study.png').resize((n,n),Image.Resampling.LANCZOS))
    ims=[Image.fromarray(np.pad(a,((g,g),(g,g),(0,0)),mode='edge')) for a in [base,parent]]
    for y in range(2):
        for x in range(2):
            box=(x*1024,y*1024,x*1024+1152,y*1024+1152)
            for im,kind in zip(ims,['guide','parent']):im.crop(box).save(r/f'{x}_{y}.{kind}.png')
    print('Four z1 reference pairs restored; accepted prompts unchanged.')

def main():
    z=2;n=4096;g=64
    r=ROOT/'references/round3/z2';r.mkdir(parents=True,exist_ok=True)
    p=ROOT/'paintings/z1/water-parent.png'
    if not p.exists():p.write_bytes((ROOT/'paintings/z1/final-master.png').read_bytes())
    base=np.array(Image.open(ROOT/'paintings/z2/retained-paint.png'))
    w=np.array(Image.open(ROOT/'references/z2/surface_water.png'))>0
    base[w]=np.uint8(pigment(n)[w])
    parent=np.array(Image.open(p).resize((n,n),Image.Resampling.LANCZOS))
    ims=[Image.fromarray(np.pad(a,((g,g),(g,g),(0,0)),mode='edge')) for a in [base,parent]]
    sheet=Image.new('RGB',(4*384,4*408),(236,226,199));d=ImageDraw.Draw(sheet)
    queue=[]
    for y in range(4):
        for x in range(4):
            box=(x*1024,y*1024,x*1024+1152,y*1024+1152)
            for im,kind in zip(ims,['guide','parent']):im.crop(box).save(r/f'{x}_{y}.{kind}.png')
            sheet.paste(ims[0].crop(box).resize((384,384)),(x*384,y*408+24));d.text((x*384+8,y*408+5),f'z2 {x},{y}',fill=(55,62,49))
            # Northwest is almost all accepted land; keep its original. The
            # tiny water slivers can use that retained original's pigment.
            if (x,y)==(0,0) or not w[y*1024:(y+1)*1024,x*1024:(x+1)*1024].any():continue
            prompt=f'''Use case: precise-object-edit, illustration-story. Paint the WATER ONLY in this native close neighborhood tile of our original drowned-Miami atlas. Image 1 is the target: accepted detailed land, exact coastline/roads/buildings, and NOAA bathymetric water-color guide. Image 2 is the new parent painting of exactly this region; use it for pigment and broad hydrographic interpretation. Image 3 is our original style sheet. This is zoom 2, tile {x},{y}, with a 64-pixel overlap on all sides. Render the entire square, no cropping. If stretched outer-edge pixels appear, extend the painting naturally across them.
Keep ALL land, buildings, roads, islands and coast in EXACTLY the same places as image1. The detailed top-down ruined rooms and courtyards of image1 must remain; do not replace them with enlarged parent landmark pictures. Paint native-scale watercolor into the water region, following the REAL channel and shoal positions shown by image1. Slate-blue deeper dredged cuts and turning areas, soft mineral teal navigable water, transparent jade/olive shoals and flats. Irregular lobed wash edges, pooled pigment and visible rag tooth; occasional tapered fine current strokes that follow the bank or channel, sparse short wave marks. Rich observed watercolor, never flat teal, never contour-map rainbow bands. Image2 is a parent palette reference, not pixels to enlarge. Compose fresh close-scale strokes. Calm enough for colored game markers to read. No compositing glow or uniform pale shore outline; a quay can drop directly into deep water. No arbitrary new shallows where image1 is deep. Do not add vessels, islands, reefs or wrecks. No decorative open-ocean foam in the bay. No letters, writing, numerals, grid, compass, border, margin, page edge, legend, label or watermark. Full-bleed north-up map section with no empty rim.'''
            (ROOT/f'paintings/z2/{x}_{y}.round3.prompt.txt').write_text(prompt+'\n')
            queue.append(dict(x=x,y=y,prompt=prompt,references=[str(r/f'{x}_{y}.guide.png'),str(r/f'{x}_{y}.parent.png'),str(ROOT/'style/style-sheet.png')],output=str(ROOT/f'paintings/z2/{x}_{y}.raw.png')))
    (ROOT/'paintings/z2/round3-queue.json').write_text(json.dumps(queue,indent=2))
    sheet.save(ROOT/'reports/round3/z2-depth-contexts.jpg',quality=93)
    print(len(queue),'native water paintings queued',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('zoom',type=int,nargs='?',default=2,choices=[1,2]);a=p.parse_args()
    district_contexts() if a.zoom==1 else main()
