"""Draw requested hood dyes with the game's unchanged renderer and camera setup.

Run look.sh first to compose the latest delivery into the built look tree.
Uses look.ts in memory, so there is no extra TS asset in the game repository.
"""
from pathlib import Path
import hashlib,json,re,subprocess,shutil
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent
LOOK=ROOT.parent/'look.ts'
TREE=Path('/private/tmp/dodo-hood-round7/tree')
OUT=ROOT/'checks/look_round7_dyes'


def board():
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',20)
    sheet=Image.new('RGB',(1800,1960),(27,30,33));draw=ImageDraw.Draw(sheet)
    dyes=[('concept_umber','#3B302A'),('warm_umber','#6A4532'),('near_white','#F3F1EA')]
    shots=['head_side','nape','hood_edge','bird_back_right']
    for row,shot in enumerate(shots):
        for col,(dye,value) in enumerate(dyes):
            im=Image.open(OUT/f'{shot}_{dye}.png').convert('RGB').resize((600,450),Image.Resampling.LANCZOS)
            x,y=col*600,row*490
            draw.text((x+10,y+8),shot.replace('_',' ')+' / '+value,font=font,fill='white')
            sheet.paste(im,(x,y+34))
    sheet.save(ROOT/'checks/round7_game_dyes.jpg',quality=97)


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    # Freeze the current model with our composed maps, outside asset discovery.
    bird=TREE/'core/creatures/dodo';bird.mkdir(parents=True,exist_ok=True)
    for name in ['dodo.snpk','asset.ts']:
        shutil.copy2(Path('/private/tmp/dodo-look/tree/core/creatures/dodo')/name,bird/name)
    shutil.copytree(ROOT/'checks/composed',bird/'tex',dirs_exist_ok=True)
    code=LOOK.read_text()
    code=re.sub(r'from "(\.[^"]+)"',lambda m:'from '+json.dumps(str((LOOK.parent/m.group(1)).resolve())),code)
    code=code.replace('const out = arg("out");','const out = '+json.dumps(str(OUT))+';')
    code=code.replace('arg("source")',json.dumps(str(TREE)))
    start=code.index('const DYES:');end=code.index('// Point looked at',start)
    code=code[:start]+'''const dye = (value: string, slot: number) => {
  // Unused debug palette slots, changed in memory only for exact dye testing.
  pack.palette.set([parseInt(value.slice(0,2),16),parseInt(value.slice(2,4),16),parseInt(value.slice(4,6),16),255],slot*4);
  const colors = Array.from(DODO_DYES); colors[4] = slot; return colors;
};
const DYES = { concept_umber: dye("3B302A",3), warm_umber: dye("6A4532",4), near_white: dye("F3F1EA",5) };
'''+code[end:]
    code=code.replace('Object.entries(SHOTS)', 'Object.entries(SHOTS).filter(([name]) => ["head_side","nape","bird_back_right","hood_edge"].includes(name))')
    code=code.replace('    if (dyes !== "default" && !name.startsWith("bird") && name !== "head_side") continue;','')
    # Small-size strips remain part of this colour review.
    subprocess.run(['bun','--eval',code],cwd=LOOK.parents[7],check=True)
    pack=TREE/'core/creatures/dodo/dodo.snpk';tex=pack.parent/'tex'
    record=dict(pack_sha256=hashlib.sha256(pack.read_bytes()).hexdigest(),
        dyes={'concept_umber':'#3B302A','warm_umber':'#6A4532','near_white':'#F3F1EA'},
        texture_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in tex.glob('*.png')},
        layer_sha256=json.loads((ROOT/'layers/hashes.json').read_text()))
    (OUT/'inputs.json').write_text(json.dumps(record,indent=2)+'\n')
    board()

if __name__=='__main__':main()
