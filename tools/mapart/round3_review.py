"""Keep review evidence beside the report. Labels are never baked into tiles."""
import json
import numpy as np
from PIL import Image, ImageDraw
from common import ROOT

R=ROOT/'reports/round3';PAPER=(237,225,198);INK=(64,66,51)

def main():
    old=Image.open(R/'round2-overview.png');new=Image.open(ROOT/'tiles/z0/0_0.png')
    pair=Image.new('RGB',(2048,1064),PAPER);d=ImageDraw.Draw(pair)
    d.text((16,12),'ROUND TWO - previous accepted overview',fill=INK)
    d.text((1040,12),'ROUND THREE - observed bay, individual landmarks',fill=INK)
    pair.paste(old,(0,40));pair.paste(new,(1024,40));pair.save(R/'whole-map-comparison.jpg',quality=96)
    zooms=Image.new('RGB',(1536,1600),PAPER);d=ImageDraw.Draw(zooms)
    for z in range(4):
        im=Image.open(ROOT/f'paintings/z{z}/final-master.png')
        x=(z%2)*768;y=(z//2)*800
        d.text((x+10,y+8),f'z{z} - independent native drawing',fill=INK)
        zooms.paste(im.resize((768,768),Image.Resampling.LANCZOS),(x,y+32))
        cell=512 if z==1 else 320 if z==2 else 192
        if z:
            side=2**z;sheet=Image.new('RGB',(side*cell,side*(cell+24)),PAPER);sd=ImageDraw.Draw(sheet)
            for row in range(side):
                for col in range(side):
                    tile=Image.open(ROOT/f'tiles/z{z}/{col}_{row}.png')
                    sheet.paste(tile.resize((cell,cell),Image.Resampling.LANCZOS),(col*cell,row*(cell+24)+24))
                    sd.text((col*cell+8,row*(cell+24)+6),f'z{z} {col},{row}',fill=INK)
            sheet.save(R/f'all-tiles-z{z}.jpg',quality=95)
    zooms.save(R/'four-zooms.jpg',quality=95)
    boxes=[('Banyan arcade',(35,150,225,310)),('Drowned unequal towers',(77,336,258,535)),
           ('Reed-filled bowl',(144,509,270,607)),('Stepped Deco gallery',(835,412,990,539)),
           ('Mangrove tanks',(628,857,794,988)),('Port sheds and cranes',(312,476,668,671))]
    sheet=Image.new('RGB',(1080,640),PAPER);d=ImageDraw.Draw(sheet)
    for i,(label,box) in enumerate(boxes):
        x=(i%3)*360;y=(i//3)*320;crop=new.crop(box);crop.thumbnail((344,280),Image.Resampling.LANCZOS)
        # Native crops enlarged only for inspection; final tile is unchanged.
        scale=min(344/crop.width,280/crop.height);crop=crop.resize((round(crop.width*scale),round(crop.height*scale)),Image.Resampling.LANCZOS)
        sheet.paste(crop,(x+(360-crop.width)//2,y+30));d.text((x+12,y+10),label,fill=INK)
    sheet.save(R/'landmark-pictures.jpg',quality=96)
    shore=Image.new('RGB',(1152,656),PAPER);d=ImageDraw.Draw(shore)
    for row,z in enumerate([0,1]):
        scale=2**z;box=tuple(round(q*scale) for q in [224,165,292,310])
        for col,name in enumerate(['retained-paint.png','final-master.png']):
            im=Image.open(ROOT/f'paintings/z{z}/{name}').crop(box)
            im=im.resize((136*2,290),Image.Resampling.LANCZOS)
            x=col*576+20;y=row*328
            shore.paste(im,(x,y+30));d.text((x,y+9),f'z{z}: '+('round two' if col==0 else 'round three'),fill=INK)
            # Second quay stretch, at the same magnification.
            b=tuple(round(q*scale) for q in [230,277,298,422]);im=Image.open(ROOT/f'paintings/z{z}/{name}').crop(b).resize((272,290),Image.Resampling.LANCZOS)
            shore.paste(im,(x+280,y+30))
    shore.save(R/'mainland-quays.jpg',quality=96)
    # Overlay study is explicitly a mock: no engine visual style is assumed.
    mock=new.convert('RGBA');overlay=Image.new('RGBA',mock.size);d=ImageDraw.Draw(overlay)
    for x,y,c in [(466,196,(209,91,64)),(571,763,(150,90,186)),(839,869,(233,170,47)),(99,674,(75,110,205))]:
        d.rectangle((x-20,y-20,x+20,y+20),fill=(*c,80),outline=(*c,200),width=2)
        d.ellipse((x-7,y-7,x+7,y+7),fill=(33,45,48,255),outline=(250,242,214,255),width=2)
        d.ellipse((x-3,y-3,x+3,y+3),fill=(*c,255))
    mock=Image.alpha_composite(mock,overlay).convert('RGB');mock.save(R/'marker-overlay-study.png')
    # Unscaled close crops: prove what survived beneath the revised broad wash.
    detail=Image.new('RGB',(1024,1096),PAPER);d=ImageDraw.Draw(detail)
    boxes=[('Zoom 3 water',(3200,6208,3712,6720)),
           ('Zoom 3 rooms',(1248,3312,1760,3824))]
    for row,(label,box) in enumerate(boxes):
        for col,name in enumerate(['retained-paint.png','final-master.png']):
            x=col*512;y=row*548
            detail.paste(Image.open(ROOT/f'paintings/z3/{name}').crop(box),(x,y+36))
            d.text((x+12,y+12),label+' - '+('round two' if col==0 else 'round three'),fill=INK)
    detail.save(R/'retained-close-detail.jpg',quality=97)
    if (R/'measurements.json').exists():
        joins=json.loads((R/'measurements.json').read_text())['joins']
        worst=sorted(joins,key=lambda q:-q['ratio_immediate'])[:8]
        sheet=Image.new('RGB',(4*288,2*320),PAPER);d=ImageDraw.Draw(sheet)
        for i,q in enumerate(worst):
            z=q['z'];im=Image.open(ROOT/f'paintings/z{z}/final-master.png');a=np.array(im)
            c=q['coordinate'];start=q['segment']*1024
            v=a if q['axis']=='vertical' else a.transpose(1,0,2)
            jumps=np.abs(v[start:start+1024,c].astype('int16')-v[start:start+1024,c-1]).mean(1)
            strongest=int(np.argmax(np.convolve(jumps,np.ones(64)/64,mode='same')))
            pos=max(128,min(len(a)-128,start+strongest))
            box=(c-128,pos-128,c+128,pos+128) if q['axis']=='vertical' else (pos-128,c-128,pos+128,c+128)
            x=(i%4)*288;y=(i//4)*320;sheet.paste(im.crop(box),(x+16,y+48))
            d.text((x+10,y+8),f'z{z} {q["axis"]} {c}, seg {q["segment"]}',fill=INK)
            d.text((x+10,y+25),f'immediate ratio {q["ratio_immediate"]:.3f}',fill=INK)
        sheet.save(R/'worst-joins.jpg',quality=96)
    print('Review evidence saved under reports/round3/.',flush=True)

if __name__=='__main__':main()
