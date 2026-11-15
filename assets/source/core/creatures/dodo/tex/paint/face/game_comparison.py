"""Review boards from the game's saved renders; no synthetic shading."""
from pathlib import Path
import site
site.addsitedir(site.getusersitepackages())
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parent
QA=ROOT/'checks'
DODO=ROOT.parents[2]

def font(size):
    return ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',size)

def fit(board,path,box):
    im=Image.open(path).convert('RGB');im.thumbnail((box[2]-box[0],box[3]-box[1]),Image.Resampling.LANCZOS)
    board.paste(im,(box[0]+(box[2]-box[0]-im.width)//2,box[1]+(box[3]-box[1]-im.height)//2))

def main():
    board=Image.new('RGB',(1480,1210),(29,31,31));d=ImageDraw.Draw(board)
    for row,(reference,shot,label) in enumerate([('head_side','head_side','side'),('head_front','head_front_left','front-left')]):
        y=row*600
        d.text((12,y+12),'Concept / '+reference.replace('head_',''),font=font(21),fill='white')
        d.text((752,y+12),'Game renderer / '+label,font=font(21),fill='white')
        fit(board,DODO/'ref/concept'/f'{reference}.png',(8,y+48,732,y+595))
        fit(board,QA/'game_final'/f'{shot}_default.png',(748,y+48,1472,y+595))
    board.save(QA/'concept_comparison.png')
    # Identical camera, framing and output pixels before and after this pass.
    board=Image.new('RGB',(1480,1290),(29,31,31));d=ImageDraw.Draw(board)
    for row,shot in enumerate(['head_side','head_front_left']):
        y=row*640
        for col,(folder,label) in enumerate([('game_before','Before'),('game_final','Weighted rolls')]):
            x=col*740
            d.text((x+12,y+12),label+' / '+shot.replace('head_',''),font=font(21),fill='white')
            fit(board,QA/folder/f'{shot}_default.png',(x+8,y+48,x+732,y+595))
    board.save(QA/'game_before_after.png')
    # Crops remain at equal magnification, with no warp or paint-over.
    board=Image.new('RGB',(1200,900),(29,31,31));d=ImageDraw.Draw(board)
    for col,(folder,label) in enumerate([('game_before','Before'),('game_final','Weighted rolls')]):
        x=col*600;im=Image.open(QA/folder/'head_side_default.png')
        d.text((x+12,12),label+' / game side, 3x crop',font=font(21),fill='white')
        eye=im.crop((690,365,875,515)).resize((555,450),Image.Resampling.LANCZOS)
        mouth=im.crop((620,510,745,635)).resize((375,375),Image.Resampling.LANCZOS)
        board.paste(eye,(x+20,52));board.paste(mouth,(x+90,515))
    board.save(QA/'game_fold_closeups.png')

if __name__=='__main__':main()
