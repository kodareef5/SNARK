"""Composite the eight laptop files and write their ingest rows."""
import csv
import math
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[4]
WORK = ROOT / "var/ads2/work/laptops"
OUT = ROOT / "var/ads2/out"
FONTS = Path("/usr/share/fonts/opentype/urw-base35")
FAMILIES = {
    "mono": "NimbusMonoPS-Regular", "mb": "NimbusMonoPS-Bold",
    "sans": "NimbusSans-Regular", "bold": "NimbusSans-Bold",
    "narrow": "NimbusSansNarrow-Bold", "serif": "P052-Roman",
    "italic": "P052-Italic", "book": "URWBookman-Demi",
    "gothic": "URWGothic-Demi",
}
NAMES = {
    "parcel-weather": "Parcel Weather",
    "brinewire-exchange": "Brinewire Shore Exchange",
    "dodo-standby": "Dodo on Standby",
    "lastplank-ledger": "The Lastplank Night Ledger",
    "collar-ferry": "The Collar Took the Ferry",
    "keepsake-queue": "The Keepsake Queue",
    "mammoth-appeal": "The Mammoth Appeal",
    "rex-key-finder": "The Rex Key Finder",
}

@lru_cache(maxsize=None)
def font(kind, size):
    return ImageFont.truetype(FONTS / (FAMILIES[kind] + ".otf"), size)


class Screen:
    def __init__(self, color):
        self.image = Image.new("RGB", (1280, 800), color)
        self.d = ImageDraw.Draw(self.image)

    def text(self, x, y, words, size, color, face="sans", *, width=None):
        f = font(face, size)
        if width is not None and f.getlength(words) > width:
            raise ValueError(f"{words!r} exceeds {width} pixels")
        self.d.text((x, y), words, fill=color, font=f, anchor="lt")

    def line(self, *points, color, weight=1):
        self.d.line(points, fill=color, width=weight)

    def rect(self, box, fill=None, edge=None, weight=1):
        self.d.rectangle(box, fill=fill, outline=edge, width=weight)

    def photo(self, slug, box, circular=False):
        x,y,r,b = box
        with Image.open(WORK / "art" / (slug + ".png")) as src:
            crop = ImageOps.fit(src.convert("RGB"), (r-x,b-y), Image.Resampling.LANCZOS)
        mask = None
        if circular:
            mask = Image.new("L", crop.size, 0)
            ImageDraw.Draw(mask).ellipse((0, 0, r-x-1, b-y-1), fill=255)
        self.image.paste(crop, (x,y), mask)

    def dot(self, x, y, radius, color, edge=None, weight=1):
        self.d.ellipse((x-radius,y-radius,x+radius,y+radius), fill=color, outline=edge, width=weight)


def weather():
    c = Screen("#123038")
    ink, green, tan, soft = "#fcf1cb", "#b8df9e", "#e6bb77", "#a9c8c1"
    c.rect((0,0,1280,71), "#d9e7cf")
    for i in range(3):
        c.line((40,25+i*8),(63-i*5,25+i*8), color="#275048", weight=3)
    c.text(82,22,"MUNICIPAL RAIN WORKS",28,"#1a3e43","narrow")
    c.text(855,24,"ADMINISTRATOR   /   MIAMI 04",23,"#1a3e43","mb")
    c.text(43,103,"Parcel weather",76,ink,"serif")
    c.text(46,211,"MANUAL OVERRIDE",22,green,"mb")
    c.line((44,247),(618,247),color="#69867a",weight=2)
    rows=[("Operator","The server owner"),("Rainfall","4.0 inches per hour"),("Coverage","One roof"),("Target","Rival tribe hall")]
    for i,(label,value) in enumerate(rows):
        y=273+73*i
        c.text(46,y,label,24,soft)
        c.text(255,y-2,value,31,ink,"bold",width=365)
        c.line((44,y+45),(616,y+45),color="#476268")
    c.rect((45,583,616,686),"#24444a")
    c.text(63,600,"CHANGE HISTORY",18,tan,"mb")
    c.text(63,638,"Appeal moved to the flood queue.",28,ink,"sans",width=538)
    c.photo("parcel-weather",(653,107,1235,636))
    c.rect((653,636,1234,687),"#d9e7cf")
    c.dot(673,661,6,"#a45236")
    c.text(692,651,"PARCEL CAMERA   /   LIVE",22,"#183737","mb")
    c.text(1112,653,"CAM 02",19,"#183737","mono")
    c.line((43,727),(1235,727),color=green,weight=2)
    c.text(44,752,"[F1]  FORECAST",20,soft,"mb")
    c.text(335,752,"[F2]  MOVE CLOUD",20,soft,"mb")
    c.text(996,752,"OVERRIDE ACTIVE",21,green,"mb")
    return c


def cable():
    navy, bone, aqua = "#082f36", "#f2e7c8", "#8dd4c5"
    c=Screen(navy)
    c.text(49,38,"BRINEWIRE",48,bone,"gothic")
    c.text(343,54,"SHORE EXCHANGE",22,aqua,"mb")
    c.text(1008,52,"REPAIR DESK  /  6",20,aqua,"mb")
    c.line((49,109),(1231,109),color=aqua,weight=2)
    c.d.ellipse((18,150,588,720), outline="#527c78",width=2)
    c.photo("brinewire-exchange",(40,172,566,698),circular=True)
    for i in range(36):
        a=i*math.pi/18
        x,y=303+274*math.cos(a),435+274*math.sin(a)
        xx,yy=303+282*math.cos(a),435+282*math.sin(a)
        c.line((x,y),(xx,yy),color=aqua,weight=2)
    c.text(622,166,"TRANSMISSION FAULT    BW / 018",23,aqua,"mb")
    c.text(618,229,"Server",86,bone,"book")
    c.text(618,325,"unreachable.",80,bone,"book",width=609)
    c.text(622,450,"The repair crew found both ends.",33,bone,"sans",width=610)
    c.text(622,500,"They are circling the boat.",33,bone,"sans",width=610)
    c.line((623,590),(1228,590),color="#4a736f")
    c.text(624,620,"CARRIER",20,aqua,"mb")
    c.text(806,610,"Megalodon",33,bone,"italic")
    c.line((49,730),(1231,730),color=aqua,weight=2)
    c.text(49,752,"[R]  REDIAL",22,bone,"mb")
    c.text(809,754,"NEXT ATTEMPT WHEN CABLE SURFACES",19,aqua,"mono")
    return c


def seat():
    c=Screen("#b94431")
    body, ink, brick = "#f6e9c4", "#272d38", "#a23b32"
    c.text(42,31,"BIRDSEAT   /   SERVER SEATING EXCHANGE",25,"#ffecce","mb")
    c.text(1037,32,"CLAIM  0947",23,"#ffecce","mb")
    c.rect((40,97,1240,698),body)
    for y in range(108,694,26):
        c.dot(40,y,6,"#b94431")
        c.dot(1240,y,6,"#b94431")
    for y in range(105,690,14):
        c.line((743,y),(743,y+7),color="#a79582",weight=2)
    c.text(71,135,"EJECTION RECEIPT",24,brick,"mb")
    c.text(67,211,"You were",85,ink,"book")
    c.text(65,303,"kicked.",119,ink,"book")
    c.line((73,450),(708,450),color=ink,weight=3)
    c.text(73,480,"Your seat went to a dodo.",36,ink,"serif",width=630)
    c.text(73,558,"PRIORITY CLASS",21,brick,"mb")
    c.text(73,596,"Owner’s favorite tame",32,ink,"italic")
    c.photo("dodo-standby",(775,133,1207,568))
    c.line((775,586),(1207,586),color=ink,weight=2)
    c.text(775,609,"PASSENGER",21,brick,"mb")
    c.text(775,642,"Mrs. Biscuit   /   Seat 01",27,ink,"bold",width=432)
    c.text(43,744,"[RETURN]  REJOIN THE QUEUE",23,"#fff0d5","mb")
    c.text(934,745,"STANDBY POSITION  02",22,"#fff0d5","mb")
    return c


def ledger():
    paper, ink, vermilion = "#f0e7cd", "#242c28", "#983e31"
    c=Screen(paper)
    c.rect((0,0,1280,52),ink)
    c.text(37,15,"LASTPLANK COOPERATIVE    /    TRIBE RECORDS",23,paper,"mb")
    c.text(1073,15,"PAGE  18",23,paper,"mb")
    c.text(39,84,"Night ledger",77,ink,"serif")
    c.text(927,108,"MIAMI  /  EAST YARD",23,vermilion,"mb")
    c.line((37,185),(1242,185),color=ink,weight=4)
    c.line((37,194),(1242,194),color=ink)
    c.text(43,233,"TIME",20,vermilion,"mb")
    c.text(166,233,"AUTOMATIC ENTRY",20,vermilion,"mb")
    entries=[("02:10","East gate installed."),("02:12","East gate locked."),("02:14","Rex removed east gate."),("02:15","Lock reports secure.")]
    for i,(time,words) in enumerate(entries):
        y=305+i*90
        c.line((42,y-18),(636,y-18),color="#b9b19b")
        c.text(43,y,time,28,ink,"mb")
        c.text(165,y,words,31,ink,"serif",width=470)
    c.photo("lastplank-ledger",(683,237,1239,589))
    c.text(685,612,"Exhibit A.  The lock held.",30,ink,"italic",width=548)
    c.line((39,695),(1241,695),color=ink,weight=3)
    c.text(42,729,"[←]  PREVIOUS SHIFT",22,ink,"mb")
    c.text(837,729,"ENTRIES WITNESSED   04 / 04",22,vermilion,"mb")
    return c


def route():
    dark, paper, rust = "#1e4141", "#f3e8c9", "#a64227"
    c=Screen(paper)
    c.photo("collar-ferry",(0,0,795,800))
    c.rect((795,0,1279,799),dark)
    pts=[(248,114),(211,176),(224,252),(336,351),(426,429),(502,498),(596,555)]
    for (x,y),(xx,yy) in zip(pts,pts[1:]):
        c.line((x,y),(xx,yy),color=paper,weight=9)
        c.line((x,y),(xx,yy),color=rust,weight=4)
    for x,y in [pts[0],pts[-1]]:
        c.dot(x,y,15,paper,rust,4)
        c.dot(x,y,5,rust)
    c.dot(596,555,35,None,rust,2)
    c.rect((45,117,206,170),paper,dark,2)
    c.text(58,132,"NORTH SLIP",23,dark,"mb")
    c.rect((426,605,722,656),paper,dark,2)
    c.text(440,619,"SOUTHBOUND FERRY",23,dark,"mb")
    c.rect((26,27,266,75),dark)
    c.text(39,40,"BAY SURVEY  17B",23,paper,"mb")
    c.rect((44,717,268,772),paper,dark,2)
    c.line((60,739),(150,739),color=dark,weight=4)
    c.line((60,733),(60,746),color=dark,weight=2)
    c.line((150,733),(150,746),color=dark,weight=2)
    c.text(166,731,"1 MI",22,dark,"mb")
    c.text(829,46,"SWITCHGRASS FIELD RADIO",23,"#b8ceab","narrow")
    c.line((829,96),(1243,96),color="#94b3a2")
    c.text(829,131,"Collar fix",60,paper,"serif")
    c.text(831,221,"CLOVER  /  RAPTOR",25,"#cfdca5","mb")
    for i,(a,b) in enumerate([("Last fix","Ferry deck"),("Speed","18 knots"),("Raptor sighted","No")]):
        y=288+i*92
        c.text(832,y,a.upper(),18,"#bdd1c2","mb")
        c.text(831,y+28,b,32,paper,"bold")
    c.rect((815,585,1257,697),"#365958")
    c.text(832,604,"PURCHASE RECORDED",19,"#cfdca5","mb")
    c.text(831,644,"One adult collar fare.",29,paper,"italic",width=411)
    c.text(833,750,"[F]  REQUEST ANOTHER FIX",20,paper,"mb")
    return c


def keepsake():
    blush, burgundy, cream = "#edd6bd", "#552d35", "#fff0d2"
    c=Screen(blush)
    c.photo("keepsake-queue",(662,0,1280,800))
    c.rect((0,0,660,799),blush)
    c.rect((24,23,635,776),None,burgundy,2)
    c.text(53,49,"TINLIGHT   /   WORLD ARCHIVE",22,burgundy,"mb")
    c.line((54,94),(604,94),color=burgundy,weight=2)
    c.text(50,137,"Keepsake",74,burgundy,"book")
    c.text(48,223,"queue",84,burgundy,"italic")
    c.text(54,365,"SCHEDULED WORLD WIPE IN",23,burgundy,"mb")
    c.rect((52,413,605,517),burgundy)
    c.text(77,429,"00:09:41",74,cream,"mb")
    c.text(54,558,"Saved: one photograph.",33,burgundy,"bold",width=550)
    c.text(54,609,"All 42 foundations are in it.",30,burgundy,"serif",width=548)
    c.line((54,695),(604,695),color=burgundy,weight=2)
    c.text(55,724,"[P]  PRINT KEEPSAKE",22,burgundy,"mb")
    return c


def appeal():
    cream, black, blue, red = "#ece7d9", "#1d292d", "#203952", "#973e37"
    c=Screen(blue)
    c.rect((32,27,1245,773),cream)
    c.text(65,56,"MUNICIPAL SERVER COURT",23,blue,"mb")
    c.text(953,56,"PETITION  19 / B",22,blue,"mb")
    c.line((64,101),(1212,101),color=blue,weight=3)
    c.text(62,137,"Petition to unban",70,blue,"serif",width=1000)
    c.text(65,241,"APPLICANT",18,red,"mb")
    c.text(235,232,"Mallow, woolly mammoth",30,black,"bold",width=506)
    c.line((65,283),(741,283),color="#aaa79a")
    c.text(65,315,"CHARGE",18,red,"mb")
    c.text(235,308,"Flooding tribe chat",30,black,"bold",width=506)
    c.line((65,360),(741,360),color="#aaa79a")
    c.text(65,398,"APPLICANT’S STATEMENT",20,red,"mb")
    c.text(63,449,"“I stepped on it.”",47,blue,"italic",width=675)
    c.line((65,542),(741,542),color="#aaa79a")
    c.text(65,573,"WITNESS",18,red,"mb")
    c.text(236,563,"Keyboard unavailable.",29,black,"bold")
    c.photo("mammoth-appeal",(782,232,1209,599))
    c.text(784,620,"EXHIBIT 01  /  KEY DEPRESSION",20,blue,"mb")
    c.rect((65,688,1210,741),blue)
    c.text(80,704,"[A]  ATTACH EVIDENCE",20,cream,"mb")
    c.text(761,704,"STATUS   AWAITING SMALLER WITNESS",19,cream,"mb",width=434)
    return c


def key():
    navy, light, orange, muted = "#10242e", "#daeee5", "#ffae64", "#a8c8c6"
    c=Screen(navy)
    c.text(38,35,"NEEDLE & ECHO",34,light,"gothic")
    c.text(799,44,"POSITION COMPARATOR   /   DESYNC",22,muted,"mb")
    c.line((38,90),(1242,90),color="#597a7b",weight=2)
    c.text(40,126,"Where is the spare key?",56,light,"serif",width=1190)
    c.photo("rex-key-finder",(37,227,779,653))
    c.rect((37,227,779,653),None,"#54757c",2)
    for i in range(1,29):
        x=37+int(i*742/29)
        c.line((x,642 if i%5==0 else 647),(x,652),color=muted,weight=1)
    c.text(41,675,"SERVER FLUOROSCOPE  /  FEED 03",19,muted,"mb")
    c.text(811,251,"CLIENT REPORT",21,muted,"mb")
    c.text(810,294,"In your pocket.",38,light,"serif",width=427)
    c.line((812,370),(1241,370),color="#54757c")
    c.text(811,406,"SERVER REPORT",21,orange,"mb")
    c.text(810,449,"In this rex.",40,light,"serif",width=427)
    c.line((812,527),(1241,527),color="#54757c")
    c.text(811,557,"RECONCILIATION",21,muted,"mb")
    c.text(811,602,"Wait for it to pass.",31,light,"italic",width=423)
    c.rect((0,736,1279,799),"#d1ded3")
    c.text(41,759,"[R]  RESCAN POCKET",21,navy,"mb")
    c.text(938,759,"SERVER HAS FINAL SAY",21,navy,"mb")
    return c


SCREENS = dict(zip(NAMES, (weather, cable, seat, ledger, route, keepsake, appeal, key)))


def render():
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, draw in SCREENS.items():
        image = draw().image
        path = OUT / f"{slug}.jpg"
        for quality in (93,90,87,84):
            image.save(path, format="JPEG", quality=quality, subsampling=0, optimize=True)
            if path.stat().st_size < 400000:
                break
        with Image.open(path) as final:
            assert final.size == (1280,800) and final.format == "JPEG"
        assert path.stat().st_size < 400000, path
    fields = "file,name,title,kind,types,channels,rights,licence,by,year,poster,audio,flashes".split(",")
    with (WORK/"rows.csv").open("w", newline="") as file:
        rows = csv.writer(file)
        rows.writerow(fields)
        for slug, title in NAMES.items():
            rows.writerow([f"{slug}.jpg",slug,title,"image","laptop","Laptop screens",
                "Made for SNARK, 2026","Made for the game and given to it under CC0 1.0.",
                "SNARK",2026,"","no","no"])


if __name__ == "__main__":
    render()
