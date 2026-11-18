"""The enamel, brightwork and lettering of the three sister ships."""
from math import cos, sin, pi
from PIL import Image, ImageDraw

# Cove, bright inlay, dark and light lettering, emblem position and size in metres.
PAINT = {
    "solstice": ((19,73,75),(244,141,67),(23,59,63),(255,236,190),.69,1.65,.27),
    "meridian": ((27,41,71),(163,183,201),(25,35,61),(224,235,234),.70,2.28,.42),
    "sovereign": ((28,61,62),(208,178,111),(26,57,57),(245,228,177),.70,3.12,.66)
}


def emblem(yacht):
    a=Image.new("RGBA",(1440,440))
    d=ImageDraw.Draw(a)
    dark,gold,_,pale=PAINT[yacht][:4]
    if yacht=="solstice":
        # A low sun and two mock suns, interrupted by three strips of sea.
        d.polygon([(10,283),(781,223),(1376,227),(1424,240),(772,255)],fill=dark)
        d.polygon([(139,325),(748,265),(1232,263),(1171,283),(748,292)],fill=gold)
        d.polygon([(378,345),(790,301),(1098,298),(1049,313)],fill=dark)
        d.pieslice((808,33,1116,372),180,360,fill=dark)
        d.pieslice((828,54,1097,348),180,360,fill=gold)
        d.arc((857,85,1070,318),180,292,fill=pale,width=13)
        for x in (705,1218):
            d.polygon([(x,116),(x+21,171),(x+76,188),(x+22,202),(x,218),(x-16,201),(x-67,186),(x-16,172)],fill=gold)
    elif yacht=="meridian":
        # A wading heron tucked into a crescent; its reflection runs aft.
        d.ellipse((781,20,1158,337),fill=gold)
        d.ellipse((748,8,1100,283),fill=(0,0,0,0))
        d.polygon([(22,352),(789,288),(912,292),(735,322)],fill=dark)
        d.polygon([(177,376),(873,325),(790,352)],fill=gold)
        d.polygon([(521,301),(815,189),(957,169),(1000,128),(973,88),(1005,59),
                   (1070,42),(1111,58),(1329,74),(1100,88),(1043,84),(1024,99),
                   (1055,138),(1050,171),(1018,211),(896,259),(692,296)],fill=dark)
        d.polygon([(575,291),(864,201),(955,190),(913,217),(772,257)],fill=(102,141,162))
        d.line([(913,245),(882,316),(921,349)],fill=dark,width=10)
        d.line([(940,235),(923,307),(964,329)],fill=dark,width=9)
        d.polygon([(1063,62),(1096,62),(1076,69)],fill=pale)
    else:
        # A fluted shell, its scalloped rim raised over a pair of chased runners.
        d.polygon([(12,343),(812,253),(1363,176),(1418,183),(863,294)],fill=dark)
        d.polygon([(85,360),(914,277),(1398,200),(1313,232),(906,303)],fill=gold)
        root=(959,332)
        rim=[]
        for j in range(10):
            angle=(-160+j*14.7)*pi/180
            rim.append((root[0]+351*cos(angle),root[1]+292*sin(angle)))
        d.polygon([root]+rim,fill=dark)
        for j,(a1,b1) in enumerate(zip(rim,rim[1:])):
            m=((a1[0]+b1[0])/2,(a1[1]+b1[1])/2-14)
            d.polygon([root,a1,m,b1],fill=gold if j%2==0 else (164,131,76))
            d.line([root,a1,m,b1],fill=pale,width=5)
        d.ellipse((938,307,981,351),fill=pale,outline=dark,width=5)
    return a


def lettering(yacht, text, kind, word):
    ink,trim,dark,pale=PAINT[yacht][:4]
    name=kind not in ("registration",)
    secondary=kind in ("board","transom")
    w,h=(1400,246) if secondary else (1350,178)
    im=Image.new("RGBA",(w,h))
    d=ImageDraw.Draw(im)
    colours=(dark,pale) if name else (pale,dark)
    if kind=="registration":
        word(d,(w/2,148),text,151,9,colours[0],6)
        word(d,(w/2,148),text,151,9,colours[1],1)
        return im
    size={"solstice":146,"meridian":128,"sovereign":141}[yacht]
    tracking={"solstice":23,"meridian":12,"sovereign":57}[yacht]
    baseline=145 if secondary else 146
    word(d,(w/2,baseline),text,size,tracking,colours[0],7)
    word(d,(w/2,baseline),text,size,tracking,colours[1],1)
    if yacht=="solstice":
        im=im.transform(im.size,Image.Transform.AFFINE,(1,.21,-23,0,1,0),Image.Resampling.BICUBIC)
        d=ImageDraw.Draw(im)
    if secondary:
        word(d,(w/2,223),"MIAMI, FL",70,15,dark,5)
        word(d,(w/2,223),"MIAMI, FL",70,15,pale,1)
        for sign in (-1,1):
            x=w/2+sign*245
            if yacht=="sovereign":
                for y,span in ((191,205),(202,158),(214,108)):
                    d.line((x,y,x+sign*span,y),fill=trim,width=4)
            elif yacht=="meridian":
                d.polygon([(x,194),(x+sign*228,181),(x+sign*54,204)],fill=trim)
            else:
                for k in (0,52,104):
                    d.line((x+sign*k,201,x+sign*(k+33),201),fill=trim,width=8)
    return im
