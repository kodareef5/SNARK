"""Letter, cut, encode and inspect six silent commercials from their image plates."""

import argparse
import csv
import json
import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[4]
WORK = ROOT / "var/ads2/work/tv"
OUT = ROOT / "var/ads2/out"
ART = WORK / "art"
SIZE = (854, 480)
FPS = 24
S = 2
URW = Path("/usr/share/fonts/opentype/urw-base35")
FONTS = {
    "serif": "C059-Roman", "bold": "C059-Bold", "italic": "C059-Italic",
    "book": "URWBookman-Demi", "booki": "URWBookman-DemiItalic",
    "geo": "URWGothic-Demi", "cond": "NimbusSansNarrow-Bold",
    "sans": "NimbusSans-Regular", "sansb": "NimbusSans-Bold",
    "mono": "NimbusMonoPS-Regular", "monob": "NimbusMonoPS-Bold",
    "script": "Z003-MediumItalic", "roman": "NimbusRoman-Regular",
}


@lru_cache(None)
def font(face, size):
    return ImageFont.truetype(str(URW / (FONTS[face] + ".otf")), round(size * S))


def pixels(points):
    return tuple(round(p * S) for p in points)


def rect(canvas, box, color):
    ImageDraw.Draw(canvas).rectangle(pixels(box), fill=color)


def line(canvas, points, color, width=1):
    ImageDraw.Draw(canvas).line(pixels(points), fill=color, width=max(1, round(width * S)))


def polygon(canvas, points, color):
    ImageDraw.Draw(canvas).polygon([pixels(point) for point in points], fill=color)


def label(canvas, point, message, face, size, color, anchor="lt"):
    ImageDraw.Draw(canvas).text(pixels(point), message, font=font(face, size),
                                fill=color, anchor=anchor, stroke_width=0)


def tracked(canvas, point, message, face, size, color, spacing, align="left"):
    draw = ImageDraw.Draw(canvas)
    f = font(face, size)
    advances = [draw.textlength(letter, font=f) + spacing * S for letter in message]
    x, y = pixels(point)
    length = sum(advances) - spacing * S
    if align == "center":
        x -= length / 2
    if align == "right":
        x -= length
    for letter, advance in zip(message, advances):
        draw.text((x, y), letter, fill=color, font=f, anchor="lt")
        x += advance


def fade_panel(canvas, x1, x2, color, a1, a2):
    panel = Image.new("RGBA", canvas.size)
    draw = ImageDraw.Draw(panel)
    for x in range(round(x1 * S), round(x2 * S)):
        progress = (x / S - x1) / (x2 - x1)
        alpha = round(a1 + (a2 - a1) * progress)
        draw.line((x, 0, x, canvas.height), fill=(*color, alpha))
    canvas.alpha_composite(panel)


def lozenge(canvas, cx, cy, radius, color):
    polygon(canvas, [(cx, cy-radius), (cx+radius, cy),
                     (cx, cy+radius), (cx-radius, cy)], color)


@dataclass(frozen=True)
class Shot:
    art: int
    frames: int
    window: tuple = (0, 0, 854, 480)
    matte: str = "#ffffff"
    focus: tuple = (.5, .5)
    zoom: tuple = (1., 1.055)
    pan: tuple = (.5, .5)
    dissolve: int = 1
    transition: str = "fade"


# Windows are x, y, width and height. Durations and incoming transitions use frames.
CUTS = {
    "plume-ledger": [
        Shot(1, 84, (22, 16, 810, 366), "#ebe2c9", focus=(.50,.52)),
        Shot(4, 86, (22, 16, 810, 366), "#ebe2c9", focus=(.50,.52),
             zoom=(1.055,1.), dissolve=8),
        Shot(2, 84, (0, 0, 854, 392), "#2a1e1a", focus=(.54,.55)),
        Shot(1, 120, (438, 45, 382, 300), "#eae1c8", focus=(.60,.56),
             zoom=(1.04,1.), dissolve=7)],
    "second-bell": [
        Shot(1, 82, focus=(.70,.46), pan=(.70,.45)),
        Shot(2, 84, (0, 106, 854, 374), "#163e30", focus=(.56,.72),
             zoom=(1.08,1.01), pan=(.6,.66), dissolve=4),
        Shot(3, 83, zoom=(1.09,1.), pan=(.51,.52)),
        Shot(2, 126, (383, 50, 471, 380), "#173b2e", focus=(.63,.75),
             zoom=(1.02,1.08), dissolve=8)],
    "strata-supper-club": [
        Shot(1, 79, (0, 0, 854, 394), "#34152e", focus=(.49,.37),
             zoom=(1.09,1.), pan=(.51,.34)),
        Shot(2, 80, (0, 0, 854, 406), "#35152f", focus=(.53,.48),
             pan=(.55,.45), dissolve=8, transition="smoothdown"),
        Shot(3, 84, zoom=(1.,1.075), pan=(.82,.52), dissolve=6),
        Shot(2, 128, (454, 22, 378, 436), "#32182f", focus=(.74,.46),
             zoom=(1.05,1.), dissolve=9)],
    "tickaway-motor-tours": [
        Shot(1, 65, (12, 12, 830, 384), "#fff0cc", focus=(.5,.59)),
        Shot(2, 66, zoom=(1.01,1.07), pan=(.42,.4), dissolve=5, transition="wipeleft"),
        Shot(1, 61, (12, 12, 830, 384), "#fff0cc", focus=(.5,.59)),
        Shot(3, 82, (0, 0, 854, 370), "#114a4d", focus=(.53,.56),
             zoom=(1.,1.07), dissolve=4),
        Shot(1, 118, (0, 0, 854, 201), "#fff0cc", focus=(.52,.65),
             zoom=(1.04,1.), dissolve=5, transition="smoothup")],
    "fussbudget-feed": [
        Shot(1, 82, (0, 0, 854, 376), "#fff1c7", focus=(.52,.48)),
        Shot(2, 79, zoom=(1.,1.06), pan=(.61,.52), dissolve=8),
        Shot(4, 83, (0, 0, 854, 385), "#fff1c7", focus=(.54,.52), zoom=(1.065,1.)),
        Shot(2, 120, (0, 0, 410, 480), "#fce9b2", focus=(.48,.68),
             pan=(.55,.71), dissolve=6, transition="wiperight")],
    "velvet-rope-appeals": [
        Shot(1, 76, zoom=(1.,1.075), pan=(.77,.53)),
        Shot(2, 76, (0, 83, 854, 397), "#151519", focus=(.5,.47), zoom=(1.055,1.)),
        Shot(3, 83, (0, 0, 854, 389), "#151519", focus=(.49,.52),
             zoom=(1.,1.075), dissolve=6),
        Shot(1, 130, (501, 0, 353, 480), "#eee9d9", focus=(.74,.55),
             zoom=(1.05,1.01), dissolve=6)],
}
CATALOGUE = {
    "plume-ledger": ("Plume Ledger Estate Portraits", 12),
    "second-bell": ("Second Bell Recall Whistle", 9),
    "strata-supper-club": ("Strata Supper Club", 2),
    "tickaway-motor-tours": ("Tickaway Motor Tours", 9),
    "fussbudget-feed": ("Fussbudget Imprint Assortment", 8),
    "velvet-rope-appeals": ("Velvet Rope Appeals", 12),
}
COLUMNS = "file,name,title,kind,types,channels,rights,licence,by,year,poster,audio,flashes".split(",")


def plume_ledger(c, i):
    ink, paper, moss = "#352e26", "#f1e7cc", "#566448"
    if i in (0, 1):
        line(c, (22, 389, 832, 389), moss)
        label(c, (32, 402), ["Your base at sign-off.", "Your base at sign-in."][i], "italic", 42, ink)
        tracked(c, (818, 405), "PLUME LEDGER", "sansb", 15, ink, 2.1, "right")
        label(c, (818, 434), ["Estate portrait  •  Monday", "Estate portrait  •  Tuesday"][i],
              "serif", 18, moss, "rt")
    elif i == 2:
        line(c, (28, 401, 826, 401), "#957e5a")
        label(c, (427, 414), "Have it photographed while it stands.", "italic", 37, paper, "mt")
    else:
        for box in [(433,40,825,350),(440,47,818,343)]:
            ImageDraw.Draw(c).rectangle(pixels(box), outline=moss, width=2)
        tracked(c, (40, 56), "ESTATE PORTRAITURE", "sansb", 14, moss, 2.7)
        label(c, (35, 106), "Plume", "italic", 87, ink)
        label(c, (47, 187), "Ledger", "bold", 75, ink)
        line(c, (40, 292, 385, 292), moss)
        label(c, (40, 310), "Your base, on paper.", "serif", 32, ink)
        label(c, (633, 365), "From the family collection", "italic", 22, moss, "mt")
        rect(c, (0, 414, 854, 480), "#3b4537")
        label(c, (427, 438), "Original negatives kept off-server.", "serif", 23, paper, "mt")


def second_bell(c, i):
    cream, saffron, green = "#feedc5", "#efb852", "#163e30"
    if i == 0:
        fade_panel(c, 0, 505, (13,37,29), 239, 0)
        tracked(c, (37, 57), "SECOND BELL", "cond", 24, saffron, 3.3)
        line(c, (37, 96, 225, 96), saffron, 2)
        label(c, (33, 194), "Call your", "booki", 53, cream)
        label(c, (33, 258), "raptor.", "booki", 65, cream)
    elif i == 1:
        tracked(c, (33, 22), "BRASS RECALL WHISTLE", "cond", 15, saffron, 2.5)
        label(c, (32, 49), "One clear note.", "booki", 43, cream)
        line(c, (0, 102, 854, 102), saffron, 3)
    elif i == 2:
        rect(c, (0, 398, 854, 480), green)
        line(c, (0, 400, 854, 400), saffron, 2)
        label(c, (427, 417), "Apparently they all heard it.", "booki", 36, cream, "mt")
    else:
        line(c, (27, 30, 826, 30), saffron, 1)
        line(c, (27, 446, 826, 446), saffron, 1)
        tracked(c, (34, 58), "FIELD EQUIPMENT", "cond", 16, saffron, 2.4)
        label(c, (29, 112), "Second", "booki", 65, cream)
        label(c, (36, 183), "Bell", "booki", 76, cream)
        label(c, (35, 288), "The recall whistle.", "serif", 30, cream)
        label(c, (35, 365), "Does not distinguish", "sans", 21, saffron)
        label(c, (35, 392), "ownership.", "sans", 21, saffron)


def strata_supper_club(c, i):
    pink, gold, plum = "#ffe4ce", "#e4b36d", "#34152e"
    if i in (0, 1):
        y = [394,406][i]
        line(c, (32, y+8, 822, y+8), gold)
        label(c, (427, y+20), ["Fall through the sidewalk?", "Dinner is one floor down."][i],
              "italic", [42,37][i], pink, "mt")
    elif i == 2:
        fade_panel(c, 0, 570, (49,14,43), 250, 0)
        tracked(c, (38, 132), "FROM OUR DESSERT CART", "sansb", 14, gold, 2)
        label(c, (35, 177), "The Inverted", "italic", 48, pink)
        label(c, (36, 234), "Parfait", "italic", 68, pink)
        line(c, (38, 318, 306, 318), gold)
    else:
        for x in [13, 20, 436, 443]:
            line(c, (x, 22, x, 458), gold)
        for y in [26, 33, 447, 454]:
            line(c, (26, y, 430, y), gold)
        lozenge(c, 227, 75, 7, gold)
        label(c, (226, 100), "Strata", "script", 91, pink, "mt")
        tracked(c, (228, 205), "SUPPER CLUB", "geo", 23, gold, 4, "center")
        line(c, (106, 250, 349, 250), gold)
        label(c, (228, 273), "Fall-ins welcome.", "italic", 40, pink, "mt")
        label(c, (227, 355), "We seat by last known", "serif", 21, pink, "mt")
        label(c, (227, 386), "coordinates.", "serif", 21, pink, "mt")


def tickaway_motor_tours(c, i):
    teal, red, honey = "#134c4b", "#9d3d32", "#fff1cb"
    if i in (0, 2):
        line(c, (14, 401, 840, 401), teal, 2)
        label(c, (29, 413), ["See Miami!", "See Miami again!"][i == 2], "booki", 44, red)
        tracked(c, (824, 426), "TICKAWAY MOTOR TOURS", "cond", 17, teal, 2.1, "right")
    elif i == 1:
        rect(c, (24, 371, 449, 449), honey)
        label(c, (43, 389), "“And on your left…”", "italic", 38, teal)
    elif i == 3:
        label(c, (427, 388), "Thirty miles. One parking meter.", "booki", 42, honey, "mt")
        tracked(c, (427, 447), "THE RUBBER-BAND EXCURSION", "cond", 15, "#f8bb83", 3, "center")
    else:
        rect(c, (0, 197, 854, 209), teal)
        line(c, (0, 213, 854, 213), red, 2)
        label(c, (38, 242), "Tickaway", "booki", 70, red)
        tracked(c, (42, 334), "MOTOR TOURS", "geo", 21, teal, 4.7)
        line(c, (487, 243, 487, 412), teal)
        tracked(c, (524, 251), "RETURN FARE", "cond", 20, teal, 2)
        label(c, (523, 299), "Always included.", "italic", 32, teal)
        label(c, (523, 358), "Meter charges extra.", "sans", 21, red)
        line(c, (31, 436, 823, 436), teal, 2)
        line(c, (31, 443, 823, 443), teal)


def fussbudget_feed(c, i):
    blue, red, cream = "#143e62", "#a02b23", "#fff1c7"
    if i in (0, 2):
        y = 376 if i == 0 else 385
        rect(c, (0, y, 854, y+7), red)
        label(c, (427, y+24), ["Baby wants kibble.", "Now baby wants a walk."][i == 2],
              "book", 47 if i == 0 else 43, blue, "mt")
    elif i == 1:
        rect(c, (0, 13, 294, 89), cream)
        polygon(c, [(294,13),(325,13),(307,51),(325,89),(294,89)], cream)
        label(c, (20, 29), "48 flavors!", "booki", 45, red)
    else:
        rect(c, (409, 0, 422, 480), red)
        line(c, (428, 0, 428, 480), red, 2)
        tracked(c, (458, 46), "THE IMPRINT ASSORTMENT", "cond", 15, blue, 2.1)
        label(c, (449, 100), "Fussbudget", "booki", 56, red)
        label(c, (456, 176), "Feed", "book", 64, blue)
        line(c, (458, 268, 819, 268), red, 2)
        label(c, (458, 295), "For very particular", "italic", 30, blue)
        label(c, (458, 336), "young tames.", "italic", 30, blue)
        label(c, (458, 417), "Leash sold separately.", "sansb", 21, red)


def velvet_rope_appeals(c, i):
    white, black, stamp = "#f2eee2", "#1b1a1c", "#8b292b"
    if i == 0:
        fade_panel(c, 0, 490, (12,13,15), 220, 0)
        tracked(c, (35, 70), "VELVET ROPE APPEALS", "mono", 17, white, 2.3)
        label(c, (34, 198), "Unfairly", "roman", 72, white)
        label(c, (34, 276), "kicked?", "roman", 75, white)
    elif i == 1:
        label(c, (36, 25), "Ring once for an appeal.", "mono", 37, white)
        line(c, (32, 72, 822, 72), "#aaa69c")
    elif i == 2:
        label(c, (427, 412), "Your chair is waiting.", "roman", 43, white, "mt")
    else:
        tracked(c, (36, 35), "VELVET ROPE APPEALS", "monob", 17, black, 2)
        line(c, (35, 70, 467, 70), black, 3)
        line(c, (35, 77, 467, 77), black)
        label(c, (35, 123), "Log in", "roman", 78, black)
        label(c, (35, 207), "to appeal.", "roman", 74, black)
        line(c, (35, 318, 467, 318), black)
        tracked(c, (36, 339), "ADMISSION RULE", "monob", 14, stamp, 2.2)
        label(c, (36, 381), "Active bans prevent entry.", "mono", 24, black)


ART_DIRECTION = {
    "plume-ledger": plume_ledger, "second-bell": second_bell,
    "strata-supper-club": strata_supper_club, "tickaway-motor-tours": tickaway_motor_tours,
    "fussbudget-feed": fussbudget_feed, "velvet-rope-appeals": velvet_rope_appeals,
}


def prepare(name, index, shot, dest):
    x, y, w, h = shot.window
    plate = Image.open(ART / f"{name}-{shot.art}.png").convert("RGB")
    plate = ImageOps.fit(plate, (w*3,h*3), method=Image.Resampling.LANCZOS, centering=shot.focus)
    plate.save(dest / f"plate-{index}.jpg", quality=95, subsampling=0)
    overlay = Image.new("RGBA", (SIZE[0]*S, SIZE[1]*S), shot.matte)
    rect(overlay, (x, y, x+w-1/S, y+h-1/S), (0,0,0,0))
    ART_DIRECTION[name](overlay, index)
    overlay.resize(SIZE, Image.Resampling.LANCZOS).save(dest/f"type-{index}.png")


def run_ffmpeg(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-filter_complex_threads", "1",
                    *args], check=True)


def shoot(name, index, shot, dest):
    prepare(name, index, shot, dest)
    x, y, w, h = shot.window
    start, end = shot.zoom
    ease = f"(.5-.5*cos(PI*on/{shot.frames-1}))"
    z = f"{start}+({end}-{start})*{ease}"
    zoompan = (f"zoompan=z='{z}':x='(iw-iw/zoom)*{shot.pan[0]}'"
               f":y='(ih-ih/zoom)*{shot.pan[1]}':d={shot.frames}:s={w}x{h}:fps={FPS}")
    chain = (f"[0:v]{zoompan},setsar=1[plate];color=c=black:s=854x480:r=24[paper];"
             f"[paper][plate]overlay={x}:{y}:shortest=1[scene];"
             f"[scene][1:v]overlay=0:0,format=yuv444p[out]")
    run_ffmpeg(["-i", str(dest/f"plate-{index}.jpg"), "-i", str(dest/f"type-{index}.png"),
                "-filter_complex", chain, "-map", "[out]", "-frames:v", str(shot.frames),
                "-an", "-threads", "2", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0",
                str(dest/f"shot-{index}.mkv")])


def join(name, shots, dest):
    inputs = []
    for index in range(len(shots)):
        inputs += ["-i", str(dest/f"shot-{index}.mkv")]
    chain = [f"[{i}:v]settb=1/{FPS},setpts=N[v{i}]" for i in range(len(shots))]
    total = shots[0].frames
    prev = "v0"
    for i, shot in enumerate(shots[1:], 1):
        overlap = shot.dissolve
        offset = (total-overlap)/FPS
        chain.append(f"[{prev}][v{i}]xfade=transition={shot.transition}:"
                     f"duration={overlap/FPS:.8f}:offset={offset:.8f}[cut{i}]")
        prev = f"cut{i}"
        total += shot.frames-overlap
    chain.append(f"[{prev}]scale=in_range=full:out_range=limited:"
                 "in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p,"
                 "setparams=range=limited:color_primaries=bt709:color_trc=bt709:"
                 "colorspace=bt709,setsar=1[out]")
    run_ffmpeg([*inputs, "-filter_complex", ";".join(chain), "-map", "[out]",
                "-c:v", "libx264", "-threads", "2", "-preset", "medium", "-profile:v", "high",
                "-r", str(FPS), "-b:v", "740k", "-maxrate", "1050k", "-bufsize", "1350k",
                "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
                "-color_range", "tv", "-an", "-movflags", "+faststart", str(OUT / (name+".mp4"))])
    return total


def verify(name, frames):
    film = OUT / (name+".mp4")
    info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams",
                    "-show_format", "-of", "json", str(film)]))
    stream, = info["streams"]
    assert (stream["codec_name"], stream["pix_fmt"]) == ("h264", "yuv420p")
    assert (stream["width"], stream["height"], stream["r_frame_rate"]) == (854,480,"24/1")
    assert int(stream["nb_frames"]) == frames, (stream["nb_frames"], frames)
    assert 12 <= float(info["format"]["duration"]) <= 20
    assert int(info["format"]["bit_rate"]) <= 1500000
    data = film.read_bytes()
    assert 0 < data.index(b"moov") < data.index(b"mdat")
    return info


def contact(name, dest):
    shots = CUTS[name]
    starts, duration = [0], shots[0].frames
    for shot in shots[1:]:
        starts.append(duration - shot.dissolve)
        duration += shot.frames - shot.dissolve
    sheet = Image.new("RGB", (854, ((len(shots)+1)//2)*265), "#302e2a")
    for i, (start, shot) in enumerate(zip(starts, shots)):
        sec = (start+shot.frames/2)/FPS
        f = dest/f"sample-{i}.png"
        run_ffmpeg(["-ss", f"{sec:.6f}", "-i", str(OUT/(name+".mp4")),
                    "-frames:v","1","-threads","1", str(f)])
        x, y = i%2*427, i//2*265
        sheet.paste(Image.open(f).resize((427,240), Image.Resampling.LANCZOS), (x,y))
        ImageDraw.Draw(sheet).text((x+8,y+244), f"{sec:04.1f} s", fill="white")
    sheet.save(dest/"review.jpg", quality=94)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("campaign", nargs="*", choices=list(CUTS))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--proof", action="store_true", help="render static shot proofs only")
    mode.add_argument("--check", action="store_true", help="verify existing films and refresh samples")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for name in args.campaign or CUTS:
        dest = WORK/name
        dest.mkdir(parents=True, exist_ok=True)
        if args.check:
            shots = CUTS[name]
            frames = sum(shot.frames for shot in shots) - sum(shot.dissolve for shot in shots[1:])
            verify(name, frames)
            contact(name, dest)
            continue
        for i, shot in enumerate(CUTS[name]):
            if args.proof:
                prepare(name, i, shot, dest)
                x,y,w,h = shot.window
                proof = Image.new("RGBA", SIZE, shot.matte)
                plate = Image.open(dest/f"plate-{i}.jpg").resize((w,h), Image.Resampling.LANCZOS)
                proof.paste(plate, (x,y))
                proof.alpha_composite(Image.open(dest/f"type-{i}.png"))
                proof.convert("RGB").save(dest/f"proof-{i}.jpg", quality=93)
            else:
                shoot(name, i, shot, dest)
        if not args.proof:
            frames = join(name, CUTS[name], dest)
            info = verify(name, frames)
            (dest/"probe.json").write_text(json.dumps(info, indent=2)+"\n")
            contact(name, dest)
            print(f"{name}  {frames/FPS:.2f} s  {int(info['format']['bit_rate'])//1000} kbit/s",flush=True)
    if args.proof:
        return
    if all((OUT/(name+".mp4")).is_file() for name in CUTS):
        with (WORK/"rows.csv").open("w", newline="") as out:
            writer = csv.writer(out)
            writer.writerow(COLUMNS)
            for name, (title, poster) in CATALOGUE.items():
                writer.writerow([name+".mp4", name, title, "clip", "tv", "TV spots",
                                 "Made for SNARK, 2026", "Made for the game and given to it under CC0 1.0.",
                                 "SNARK", 2026, poster, "no", "no"])


if __name__ == "__main__":
    main()
