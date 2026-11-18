"""Flat originals for the open sport cat."""
from PIL import Image, ImageDraw, ImageFont


def wordmark():
    strokes = {
        "W": [[(0,0),(4,37),(13,18),(16,37),(27,0)]],
        "I": [[(8,0),(8,37)]],
        "N": [[(0,37),(0,0),(20,37),(20,0)]],
        "G": [[(20,4),(16,0),(6,0),(0,7),(0,30),(6,37),(19,37),(19,22),(11,22)]],
        "S": [[(20,1),(5,1),(0,7),(0,14),(6,18),(15,19),(20,23),(20,31),(14,37),(0,37)]],
        "P": [[(0,37),(0,1),(14,1),(20,7),(20,14),(14,20),(2,20)]],
        "A": [[(0,37),(10,0),(23,37)],[(5,25),(18,25)]],
    }
    master=Image.new("L",(1190,235))
    pen=ImageDraw.Draw(master)
    start=3
    for char in "WINGSPAN":
        for stroke in strokes[char]:
            pts=[(int(5*(start+x+(37-y)*.24)),int(14+5*y)) for x,y in stroke]
            pen.line(pts,fill=255,width=18,joint="curve")
        start+= {"I":14,"W":34}.get(char,29)
    return master.crop(master.getbbox())


def wing():
    art=Image.new("L",(1500,260))
    draw=ImageDraw.Draw(art)
    # A cranked leading edge, a clipped wingtip and three separate trailing vanes.
    draw.polygon([(0,251),(399,200),(728,80),(1094,39),(1498,3),(1431,32),
                  (989,88),(786,116),(474,221)],fill=255)
    draw.polygon([(500,229),(809,136),(1034,101),(964,131),(797,163),(638,222)],fill=255)
    draw.polygon([(730,205),(865,157),(966,142),(898,175),(798,204)],fill=255)
    return art


def sport_chart(font_path):
    w,h=924,216
    im=Image.new("RGB",(w,h),"#114b5e")
    p=ImageDraw.Draw(im)
    def title(x,y,t,size,color,anchor="lt"):
        p.text((x,y),t,font=ImageFont.truetype(str(font_path),size),fill=color,anchor=anchor)
    shore=[(-2,-3),(268,-3),(231,21),(192,28),(164,51),(147,74),(109,91),(93,115),(57,130),(29,165),(-2,173)]
    for shift,color in [(89,"#317b81"),(48,"#72aaaa"),(18,"#a4c0aa"),(0,"#d4c49d")]:
        p.polygon([(a+shift if a>0 else a,b) for a,b in shore],fill=color)
    for x,y in [(140,16),(94,51),(43,94)]:
        p.line([(x,y),(x+19,y+13),(x+32,y+10)],fill="#f5dfb3",width=4)
    for x,y,t in [(90,147,"2.4"),(186,94,"3.6"),(367,119,"5.7"),(438,56,"6.2")]:
        title(x,y,t,18,"#c4e2d6")
    pts=[(119,222),(177,156),(239,112),(302,56),(403,31),(469,19)]
    p.line(pts,fill="#092d39",width=15,joint="curve")
    p.line(pts,fill="#ffce6b",width=8,joint="curve")
    for x,y in pts[1:-1]:
        p.ellipse((x-6,y-6,x+6,y+6),fill="#173745",outline="#ffd377",width=3)
    # Keep the active leg, vessel and next waypoint above the wheel rim.
    p.polygon([(323,47),(294,77),(295,61),(282,54)],fill="#fffbe6",outline="#123943",width=3)
    p.ellipse((395,23,411,39),fill="#173745",outline="#ffda80",width=4)
    for x,y,c in [(230,135,"#ed7d56"),(247,175,"#76d7aa")]:
        p.polygon([(x,y-8),(x-6,y+4),(x+6,y+4)],fill=c,outline="#173c40",width=2)
    p.rectangle((0,0,146,31),fill="#112f39")
    title(9,4,"CUT  /  WPT 02",22,"#f1eedb")
    p.line((12,178,12,186,80,186,80,178),fill="#bdddd0",width=3)
    title(12,191,"0.1 NM",15,"#ccebd9")
    title(482,11,"N",23,"#f1eedb")
    p.polygon([(490,39),(484,60),(490,55),(496,60)],fill="#e8e6cc")
    p.rectangle((514,0,w,h),fill="#13282e")
    p.rectangle((516,5,520,h-6),fill="#eaa26b")
    for x,tag,num in [(536,"PORT","2460"),(730,"STBD","2440")]:
        title(x,7,tag,25,"#edb478")
        title(x,37,num,65,"#fff2d9")
        for j in range(13):
            fill="#7ecab4" if j<8 else "#39494c"
            p.rectangle((x+j*12,118,x+8+j*12,130),fill=fill)
    p.line((541,149,906,149),fill="#4c6667",width=2)
    title(538,166,"TWIN DRIVE",25,"#e8d7bb")
    title(897,166,"RPM",25,"#9cbdb3","rt")
    return im
