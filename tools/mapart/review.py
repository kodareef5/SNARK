"""Contact sheets outside the tile directory; no labels added to game artwork."""
import argparse
from PIL import Image,ImageDraw
from common import ROOT

def main(z,kind,row=None):
    count=2**z;thumb=384
    rows=[row] if row is not None else list(range(count))
    sheet=Image.new('RGB',(count*thumb,len(rows)*(thumb+24)),(239,232,210))
    draw=ImageDraw.Draw(sheet)
    for j,y in enumerate(rows):
        for x in range(count):
            if kind=='reference':p=ROOT/'references'/f'z{z}'/f'{x}_{y}.context.png'
            elif kind=='raw':p=ROOT/'paintings'/f'z{z}'/f'{x}_{y}.raw.png'
            else:p=ROOT/'tiles'/f'z{z}'/f'{x}_{y}.png'
            if not p.exists():continue
            im=Image.open(p).convert('RGB');im.thumbnail((thumb,thumb),Image.Resampling.LANCZOS)
            sheet.paste(im,(x*thumb,j*(thumb+24)+24))
            draw.text((x*thumb+5,j*(thumb+24)+5),f'z{z} {x}_{y} {kind}',fill=(60,55,44))
    name=f'{kind}_z{z}'+('' if row is None else f'_row{row}')+'.jpg'
    dest=ROOT/'checks'/name;sheet.save(dest,quality=94);print(dest)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('zoom',type=int);p.add_argument('kind',choices=['reference','raw','final']);p.add_argument('--row',type=int)
    a=p.parse_args();main(a.zoom,a.kind,a.row)
