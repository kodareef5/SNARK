"""Four different drawn wreck stories, at the four frozen world hulls.

Far symbols exaggerate size (as round two did), never position or direction.
Close symbols use the source length/beam. All internal salvage detail is fiction.
"""
import math
from PIL import Image, ImageDraw
from common import vectors, SIZE

def wrecks(im,z):
    mpp=SIZE/im.width;s=4
    for g,p in vectors('future_changes'):
        if p['kind']!='submerged_wreck':continue
        length=max(p['length_m']/mpp,17 if z==0 else 22 if z==1 else 0)
        width=max(p['width_m']/mpp,5.5 if z==0 else 7 if z==1 else 0)
        side=math.ceil(length+width+12);sheet=Image.new('RGBA',(side*s,side*s));d=ImageDraw.Draw(sheet)
        angle=-math.radians(p['angle_degrees'])
        def q(u,v):
            x=u*length;y=v*width
            return ((side/2+x*math.cos(angle)-y*math.sin(angle))*s,(side/2+x*math.sin(angle)+y*math.cos(angle))*s)
        ink=(67,91,80,210);pale=(199,195,151,230);rust=(142,108,69,210);wash=(91,126,113,170)
        k=p['id']
        hull=[(-.49,0),(-.36,-.43),(.28,-.46),(.5,0),(.28,.44),(-.36,.43)]
        if k==1:hull=[(-.48,-.38),(.35,-.38),(.48,-.18),(.48,.32),(-.48,.38)]
        d.polygon([q(*a) for a in hull],fill=wash)
        d.line([q(*a) for a in hull[:4]],fill=ink,width=2)
        d.line([q(*a) for a in hull[4:]+[hull[0]]],fill=ink,width=2)
        if k==0:
            # Broken cargo spine; the two halves no longer share a straight keel.
            for i,u in enumerate([-.30,-.18,-.05,.13,.26]):
                d.line([q(u,-.32),q(u+.025,.29 if i!=2 else -.02)],fill=pale,width=2)
            d.line([q(-.35,0),q(-.09,0)],fill=rust,width=3)
            d.line([q(.06,.09),q(.32,.09)],fill=rust,width=3)
        elif k==1:
            # Low barge, two empty square holds and one folded wall.
            for u in [-.22,.12]:
                d.line([q(u-.1,-.23),q(u+.1,-.23),q(u+.1,.20),q(u-.1,.20),q(u-.1,-.23)],fill=pale,width=2)
            d.line([q(-.38,.34),q(-.16,.08)],fill=rust,width=3)
        elif k==2:
            # Little working hull, offset broken cabin and bare stern.
            d.line([q(-.15,-.25),q(.10,-.25),q(.1,.21),q(-.15,.21),q(-.15,-.25)],fill=pale,width=2)
            d.line([q(.12,0),q(.35,-.22)],fill=rust,width=3)
            d.line([q(-.35,-.25),q(-.35,.25)],fill=pale,width=2)
        else:
            # Narrow rib cage with a missing side and a fallen mast.
            for u in [-.25,-.06,.13,.29]:d.line([q(u,-.33),q(u,.32)],fill=pale,width=2)
            d.line([q(-.1,-.38),q(.32,.14)],fill=rust,width=3)
        sheet=sheet.resize((side,side),Image.Resampling.LANCZOS)
        cx=(p['center'][0]+4064)/mpp;cy=(4064-p['center'][1])/mpp
        im.paste(sheet,(round(cx-side/2),round(cy-side/2)),sheet)
    return im
