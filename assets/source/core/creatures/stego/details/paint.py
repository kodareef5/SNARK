"""Original small dry scute flake, one 128px native details cell.

No photographs or library pixels: the chipped outline, layered keratin and
fine fractures are authored here. The region card takes Stego hide region 1.
"""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFilter

out=Path(__file__).resolve().parent;size=512
outline=[(.15,.34),(.27,.18),(.43,.21),(.52,.11),(.73,.21),(.86,.42),(.79,.55),(.84,.69),(.66,.84),(.42,.87),(.31,.74),(.14,.67),(.20,.50)]
mask=Image.new('L',(size,size));draw=ImageDraw.Draw(mask)
draw.polygon([(int(x*size),int(y*size))for x,y in outline],fill=255)
y,x=np.mgrid[0:size,0:size]/size
alpha=np.asarray(mask,dtype=np.float32)/255
eroded=np.asarray(mask.filter(ImageFilter.MinFilter(15)),dtype=np.float32)/255
edge=alpha-eroded
growth=np.sin(np.sqrt((x-.52)**2+(y-.30)**2)*82+.7*np.sin(x*23))
shade=np.clip(.53+.11*(.5-x)+.09*(.5-y)+.035*growth+.15*edge,0,1)
base=np.dstack([shade,shade,shade,alpha]);im=Image.fromarray((base*255).astype(np.uint8),'RGBA')
fractures=ImageDraw.Draw(im)
for points in [[(.22,.34),(.37,.39),(.43,.48)],[(.74,.25),(.64,.38),(.66,.48)],[(.69,.79),(.58,.65),(.60,.56)]]:
 fractures.line([(int(a*size),int(b*size))for a,b in points],fill=(92,92,92,220),width=2)
im.resize((128,128),Image.Resampling.LANCZOS).save(out/'scute.png')
Image.new('RGB',(128,128),(0,255,0)).save(out/'scute_regions.png')
