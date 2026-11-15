"""Unretouched game-render boards for the face/neck transition."""
import site
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import argparse,json,hashlib
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parent
QA=ROOT/'checks'
FONT='/System/Library/Fonts/Helvetica.ttc'

def fit(out,im,box):
    im=im.convert('RGB');im.thumbnail((box[2]-box[0],box[3]-box[1]),Image.Resampling.LANCZOS)
    out.paste(im,(box[0]+(box[2]-box[0]-im.width)//2,box[1]+(box[3]-box[1]-im.height)//2))

def main():
    args=argparse.ArgumentParser();args.add_argument('--look',default='round5_final')
    args.add_argument('--before',default='collar_final');a=args.parse_args()
    final=QA/a.look
    rows=[('head_side_default','Side / default'),('head_front_left_default','Front-left / default'),
          ('head_side_loud','Side / loud dye'),('bird_front_left_default','Whole bird / default'),
          ('bird_front_left_loud','Whole bird / loud dye')]
    im=Image.new('RGB',(1440,550*len(rows)),(29,31,31));d=ImageDraw.Draw(im);font=ImageFont.truetype(FONT,21)
    for row,(name,label) in enumerate(rows):
        y=row*550
        for col,(folder,title) in enumerate([(QA/a.before,'Round 4'),(final,'Round 5 / matched value and tips')]):
            x=col*720;d.text((x+12,y+10),title+' / '+label,fill='white',font=font)
            fit(im,Image.open(folder/f'{name}.png'),(x+5,y+42,x+715,y+545))
    im.save(QA/'margin_before_after.png')
    im=Image.new('RGB',(1440,1100),(29,31,31));d=ImageDraw.Draw(im)
    for row,(ref,name,label) in enumerate([('head_side','head_side_default','side'),('head_front','head_front_left_default','front-left')]):
        y=row*550;d.text((12,y+12),'Concept',font=font,fill='white');d.text((732,y+12),'Game / '+label,font=font,fill='white')
        fit(im,Image.open(ROOT.parents[2]/'ref/concept'/f'{ref}.png'),(8,y+45,712,y+545))
        fit(im,Image.open(final/f'{name}.png'),(728,y+45,1432,y+545))
    im.save(QA/'concept_comparison.png')
    hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'layers').iterdir() if p.is_file()}
    record=dict(command='zsh tex/paint/look.sh '+str(final),face_layers_sha256=hashes,
        render_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(final.glob('*.png'))})
    (QA/'margin_render_receipt.json').write_text(json.dumps(record,indent=2)+'\n')

if __name__=='__main__':main()
