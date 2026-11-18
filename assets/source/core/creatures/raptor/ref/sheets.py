"""Lay out native captures and keep their camera and material receipt beside them."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent
SRC=HERE.parents[5]/"var/raptor/review"
PAPER="#f4f2ed"
INK="#343733"
MUTE="#5f655f"
def font(size,bold=False):
    path="/usr/share/fonts/truetype/dejavu/DejaVuSans"+("-Bold" if bold else "")+".ttf"
    return ImageFont.truetype(path,size)
def build(file,title,sub,rows):
    width=1456; outer=28; gap=16; y=88
    height=y+sum(h+62 for h,c in rows)+12
    im=Image.new("RGB",(width,height),PAPER); d=ImageDraw.Draw(im)
    d.text((outer,18),title,fill=INK,font=font(31,True))
    d.text((outer,57),sub,fill=MUTE,font=font(17))
    for h,cells in rows:
        count=len(cells); cellw=(width-2*outer-(count-1)*gap)//count
        for i,(name,label) in enumerate(cells):
            pic=Image.open(SRC/(name+".png")).convert("RGB")
            if name.startswith("distance-"):
                # Preserve a 1:1 pixel sample of the distant camera.
                pic=pic.crop((265,225,635,325))
            # All cells in a row use the same native camera aspect and fit.
            pic.thumbnail((cellw,h),Image.Resampling.LANCZOS)
            x=outer+i*(cellw+gap)
            d.rectangle((x,y,x+cellw-1,y+h-1),fill=pic.getpixel((0,0)))
            im.paste(pic,(x+(cellw-pic.width)//2,y+(h-pic.height)//2))
            d.text((x,y+h+9),label,font=font(17),fill=INK)
        y+=h+62
    im.save(HERE/file)
if __name__=="__main__":
    receipt=json.loads((SRC/"receipt.json").read_text())
    assert receipt["textureFormat"]=="bc", "Capture production BC mips before making the sheets"
    build("native-review.png","Raptor · shape and materials","Native packed mesh under the game’s noon light. The two upper panels share one camera and idle frame.",[
        (364,[("quarter","5,100-triangle body, painted"),("clay","Same body, neutral clay")]),
        (266,[("profile","Full-resolution profile"),("face","Orbit, nasal opening and closed mouth"),("tail","Layered rectrices and coverts")]),
        (266,[("wing","Folded primaries and manual digits"),("claw","Raised second toe beside the planted digits"),("saddle","Equipped field saddle")]),
        (100,[("distance-profile","Distant profile, native pixels"),("distance-quarter","Distant three-quarter, native pixels")]),
    ])
    build("native-motion.png","Raptor · movement","The run frames use the same camera at 5,100 triangles. A full stride covers 3.33 m in twelve ticks.",[
        (210,[("run-0","Run · tick 0"),("run-3","Run · tick 3"),("run-6","Run · tick 6"),("run-9","Run · tick 9")]),
        (266,[("bite-0","Bite · start"),("bite-5","Bite · jaw open"),("bite-11","Bite · impact")]),
        (302,[("swim","Swimming · opposed hindfoot strokes"),("rest","Torpor · flank on the ground")]),
    ])
    (HERE/"receipt.json").write_text(json.dumps(receipt,indent=2)+"\n")
