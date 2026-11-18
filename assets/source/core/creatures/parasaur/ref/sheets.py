"""Lay out the native review frames. Requires Pillow and DejaVu Sans."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import math
HERE=Path(__file__).resolve().parent
VIEWS=HERE.parents[5]/'var'/'parasaur'/'views'
PAPER='#f1f0e9'
INK='#223a35'
MUTED='#53605a'
FONTS=Path('/usr/share/fonts/truetype/dejavu')
def font(size,bold=False):
    name='DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    try:return ImageFont.truetype(str(FONTS/name),size)
    except OSError:return ImageFont.load_default(size=size)
def label(draw,x,y,s,size=17,bold=False,color=INK):
    draw.text((x,y),s,font=font(size,bold),fill=color)
def panel(canvas,name,x,y,w,h):
    im=Image.open(VIEWS/(name+'.png')).convert('RGB')
    canvas.paste(im.resize((w,h),Image.Resampling.LANCZOS),(x,y))
def header(canvas,title,sub):
    draw=ImageDraw.Draw(canvas)
    label(draw,24,18,title,27,True)
    label(draw,24,57,sub,15,False,MUTED)
    return draw

col,row=334,208
sheet=Image.new('RGB',(4*col+5*14,2*row+198),PAPER)
d=header(sheet,'Parasaurolophus • native silhouette comparison','Each pack uses its first idle frame. Camera, light and four RGB swatches match across both bare animals.')
columns=[('previous','clay','Earlier mesh · clay'),('new','clay','Original sculpt · clay'),
         ('previous','paint','Earlier mesh · color'),('new','paint','Original sculpt · color')]
for i,(version,style,title) in enumerate(columns):
    x=14+(col+14)*i
    label(d,x,92,title,16,True)
    for j,shot in enumerate(['profile','quarter']):
        y=124+j*(row+20)
        panel(sheet,version+'-'+style+'-'+shot,x,y,col,row)
label(d,15,sheet.height-30,'Top   Profile       Bottom   Front three-quarter',15,False,MUTED)
sheet.save(HERE/'native-comparison.jpg',quality=92,subsampling=0)

col,row=488,304
sheet=Image.new('RGB',(2*col+48,2*row+202),PAPER)
d=header(sheet,'Parasaurolophus • field detail','The same native rig carries the jaw, both sections of the cranial crest and the fitted riding gear.')
shots=[('new-paint-crest','Crest, eye and bill'),('new-paint-tack','Saddle tree, handgrips and stirrups'),
       ('new-paint-hoof','Forefoot at rest'),('new-paint-approach','Approach mesh · 4,500 triangles')]
for i,(name,title) in enumerate(shots):
    x=16+(col+16)*(i%2);y=91+(row+49)*(i//2)
    label(d,x,y,title,16,True)
    panel(sheet,name,x,y+27,col,row)
sheet.save(HERE/'native-detail.jpg',quality=92,subsampling=0)

labels=['Walk · 2.60 m/s','Run · 6.24 m/s','Swim · 3 m per stroke']
clips=['walk','run','swim']
frames=[[Image.open(f).convert('RGB').resize((320,190),Image.Resampling.LANCZOS)
         for f in sorted(VIEWS.glob('motion-'+clip+'-*.png'),key=lambda f:int(f.stem.split('-')[-1]))] for clip in clips]
sheet=Image.new('RGB',(992,264),PAPER);d=ImageDraw.Draw(sheet)
label(d,10,8,'Parasaur locomotion',21,True)
for i,name in enumerate(labels):label(d,8+328*i,44,name,15,True)
duration=math.lcm(*(len(seq) for seq in frames))
animation=[]
for tick in range(0,duration,2):
    f=sheet.copy()
    for i,seq in enumerate(frames):f.paste(seq[tick%len(seq)],(8+328*i,68))
    animation.append(f)
animation[0].save(HERE/'native-motion.webp',save_all=True,append_images=animation[1:],loop=0,
                  duration=[67 if k%3!=2 else 66 for k in range(len(animation))],quality=77,method=3)
