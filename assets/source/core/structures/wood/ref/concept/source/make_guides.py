"""Original geometry guides only; final paintings are made by imagegen.
Units: metres. Generates fresh PNGs, never edits a painting.
"""
from pathlib import Path
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / 'guides'
OUT.mkdir(exist_ok=True)
FACES=[]
def box(x0,y0,z0,x1,y1,z1,c):
    p=np.array([[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],
                [x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],float)
    for inds,k in [([0,3,2,1],.6),([0,1,5,4],.88),([1,2,6,5],.72),
                   ([2,3,7,6],.65),([3,0,4,7],.95),([4,5,6,7],1.1)]:
        FACES.append((p[inds],tuple(min(255,int(v*k)) for v in c)))

timber=(107,76,48); boards=(171,133,87); deck=(161,132,97)
for x in [0,3]:
    for y in [-3,0,3]:
        box(x,y,0,x+3,y+3,.335,timber)
        for i in range(12):
            box(x+i*.25+.004,y,.335,x+(i+1)*.25-.004,y+3,.375,deck)

def wall(x,y,rot,kind):
    def b(a,d,z,A,D,Z,c):
        if rot==0: box(x+a,y+d,z+.375,x+A,y+D,Z+.375,c)
        else: box(x-D,y+a,z+.375,x-d,y+A,Z+.375,c)
    b(0,-.1,2.81,3,.1,3,timber)
    for a,A in [(0,.09),(2.91,3)]:b(a,-.09,0,A,.09,2.81,timber)
    if kind=='door':
        for a,A in [(.09,.62),(2.38,2.91)]:b(a,-.075,0,A,.075,2.81,boards)
        for a,A in [(.62,.8),(2.2,2.38)]:b(a,-.09,0,A,.09,2.52,timber)
        b(.8,-.09,2.31,2.2,.09,2.52,timber)
        b(.09,-.075,2.52,2.91,.075,2.81,boards)
    elif kind=='window':
        b(.09,-.075,0,2.91,.075,1.03,boards)
        b(.09,-.075,2.07,2.91,.075,2.81,boards)
        b(.09,-.075,1.03,.74,.075,2.07,boards)
        b(2.26,-.075,1.03,2.91,.075,2.07,boards)
        b(.74,-.1,1.03,2.26,.1,1.2,timber)
        b(.74,-.09,1.9,2.26,.09,2.07,timber)
        b(.74,-.09,1.2,.9,.09,1.9,timber)
        b(2.1,-.09,1.2,2.26,.09,1.9,timber)
    else:
        b(.09,-.075,.18,2.91,.075,2.81,boards)
        b(1.43,-.09,.18,1.57,.09,2.81,timber)
    if kind!='door':b(.09,-.09,0,2.91,.09,.18,timber)

wall(0,0,0,'door');wall(3,0,0,'window')
for y in [0,3]:
    wall(0,y,1,'solid');wall(6,y,1,'solid' if y==0 else 'window')
for x in [0,3]:wall(x,6,0,'solid')
for x in [0,3]:
    for y in [-3,0,3]:
        box(x+.004,y+.004,3.125,x+2.996,y+2.996,3.335,timber)
        for i in range(12):
            box(x+i*.25+.004,y,3.335,x+(i+1)*.25-.004,y+3,3.375,deck)
for x in [1.5,4.5]:
    box(x-.25,-3,.375,x+.25,-2.5,.675,timber)
    box(x-.19,-2.94,.675,x+.19,-2.56,2.995,timber)
    box(x-.25,-3,2.995,x+.25,-2.5,3.375,timber)
for i in range(10):
    box(6,i*.3,.375,9,(i+1)*.3,.375+(i+1)*.3,timber)
    box(6,i*.3,.375+(i+1)*.3-.05,9,(i+1)*.3,.375+(i+1)*.3,deck)
# Left-hinged door leaf opened outward 65 degrees: transformed rectangular box.
prior=len(FACES)
box(0,-.04,0,1.4,.04,2.31,boards)
theta=math.radians(-65)
R=np.array([[math.cos(theta),-math.sin(theta),0],
            [math.sin(theta),math.cos(theta),0],[0,0,1]])
for n in range(prior,len(FACES)):
    p,c=FACES[n];FACES[n]=(p@R.T+np.array([.8,-.13,.375]),c)

def render(name,eye,target,focal=1250):
    W,H=1920,1280
    eye=np.array(eye,float);target=np.array(target,float)
    forward=target-eye;forward/=np.linalg.norm(forward)
    right=np.cross(forward,[0,0,1]);right/=np.linalg.norm(right)
    up=np.cross(right,forward)
    im=Image.new('RGB',(W,H),(207,211,205));d=ImageDraw.Draw(im)
    d.rectangle([0,H*.6,W,H],fill=(161,164,145))
    def project(p):
        q=p-eye;z=q@forward
        return [(W*.5+focal*(v@right)/zz,H*.5-focal*(v@up)/zz) for v,zz in zip(q,z)]
    pixels=np.array(im)
    depth=np.full((H,W),np.inf)
    for pts,c in FACES:
        q=np.array(project(pts)); zz=(pts-eye)@forward
        for ids in [(0,1,2),(0,2,3)]:
            a,b,cc=q[list(ids)];zt=zz[list(ids)]
            lo=np.maximum(np.floor(np.min([a,b,cc],axis=0)).astype(int),0)
            hi=np.minimum(np.ceil(np.max([a,b,cc],axis=0)).astype(int),[W-1,H-1])
            if np.any(hi<lo):continue
            X,Y=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
            denom=(b[1]-cc[1])*(a[0]-cc[0])+(cc[0]-b[0])*(a[1]-cc[1])
            if abs(denom)<1e-10:continue
            u=((b[1]-cc[1])*(X-cc[0])+(cc[0]-b[0])*(Y-cc[1]))/denom
            v=((cc[1]-a[1])*(X-cc[0])+(a[0]-cc[0])*(Y-cc[1]))/denom
            w=1-u-v
            with np.errstate(divide='ignore',invalid='ignore'):
                z=1/(u/zt[0]+v/zt[1]+w/zt[2])
            ds=depth[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
            ps=pixels[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
            mask=(u>=0)&(v>=0)&(w>=0)&(z<ds)
            ds[mask]=z[mask];ps[mask]=c
    im=Image.fromarray(pixels)
    im.save(OUT/(name+'.png'))

render('homestead_front_geometry',(11,-10,2.075),(4,1,1.9),1350)
render('homestead_above_geometry',(14,-13,19),(3.7,1.5,1.5),1500)
render('homestead_field_geometry',(36,-49,2.075),(3,1.5,1.7),1350)

FACES.clear()
for i in range(10):
    box(0,i*.3,0,3,(i+1)*.3,(i+1)*.3,timber)
    box(0,i*.3,(i+1)*.3-.05,3,(i+1)*.3,(i+1)*.3,deck)
render('stairs_geometry',(6,-7,5),(1.5,1.5,1.5),1900)

FACES.clear()
wall(0,0,0,'door')
render('doorframe_geometry',(2.7,-10,2.7),(1.5,0,1.875),3300)

# Explicit plan and elevation specification, independent from the paintings.
im=Image.new('RGB',(1920,1280),(240,237,224));d=ImageDraw.Draw(im)
try:font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',25)
except OSError:font=ImageFont.load_default()
scale=75;ox,oy=240,940
def planrect(x,y,X,Y,c):
    d.rectangle((ox+x*scale,oy-Y*scale,ox+X*scale,oy-y*scale),fill=c,outline='black',width=3)
for x in [0,3]:
    for y in [-3,0,3]:planrect(x,y,x+3,y+3,(207,182,140) if y<0 else (190,166,125))
planrect(6,0,9,3,(156,122,87))
for i in range(10):
    yy=oy-i*.3*scale;d.line((ox+6*scale,yy,ox+9*scale,yy),fill='black',width=2)
for x in [1.5,4.5]:planrect(x-.25,-3,x+.25,-2.5,(96,66,43))
for x,y,rot,kind in [(0,0,0,'DOOR'),(3,0,0,'WINDOW'),(6,3,1,'WINDOW')]:
    d.text((ox+x*scale+10,oy-y*scale-45),kind,fill='black',font=font)
d.text((160,60),'ORIGINAL GRID GUIDE — metres; front is at bottom',fill='black',font=font)
d.text((950,180),'House: 6 x 6; four foundations',fill='black',font=font)
d.text((950,230),'Porch: 6 x 3; two foundations',fill='black',font=font)
d.text((950,280),'Six flat roof tiles: 3 x 3 x 0.25',fill='black',font=font)
d.text((950,330),'Wall / pillar height above deck: 3',fill='black',font=font)
d.text((950,380),'Door: left bay; left hinge; opens out',fill='black',font=font)
d.text((950,430),'Window: right front and right rear',fill='black',font=font)
d.text((950,480),'Stairs: side; 3 wide / run / rise',fill='black',font=font)
d.text((950,530),'Ten steps: 0.3 rise x 0.3 going',fill='black',font=font)
d.text((950,580),'Stair base on earth at deck level',fill='black',font=font)
d.text((950,630),'No seventh foundation; no railings',fill='black',font=font)
im.save(OUT/'layout_plan.png')
