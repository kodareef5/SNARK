"""Render the six SNARK roadside loops from their generated print plates."""

import argparse
import csv
import math
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[4]
WORK = ROOT / 'var/ads2/work/loops'
OUT = ROOT / 'var/ads2/out'
W, H = 854, 280
FPS = 24
S = 3
TAU = math.tau
FONTS = Path('/usr/share/fonts/opentype/urw-base35')
RESAMPLE = Image.Resampling.LANCZOS
DATA = {
    'backstep-parcel': ('Backstep Parcel Express', 7, 2),
    'slipfax-portraits': ('Slipfax Portraits', 8, 4),
    'dozehaven-motor-court': ('Dozehaven Motor Court', 9, 5),
    'lid-and-louver': ('Lid & Louver', 9, 1),
    'underlot-lift': ('Underlot Lift Co.', 8, 4),
    'plumbfin-bait': ('Plumbfin Bait Works', 8, 3),
}


def smooth(v):
    v = max(0, min(1, v))
    return v * v * (3 - 2 * v)


def keyframes(t, points):
    for (a, v), (b, w) in zip(points, points[1:]):
        if t <= b:
            return v + (w - v) * smooth((t - a) / (b - a))
    return points[-1][1]


def smooth_window(t, begin, attack, release, end):
    return smooth((t - begin) / (attack - begin)) * (1 - smooth((t - release) / (end - release)))


@lru_cache(maxsize=96)
def font(face, size):
    return ImageFont.truetype(str(FONTS / (face + '.otf')), round(size * S))


class Ink:
    def __init__(self):
        self.layer = Image.new('RGBA', (W * S, H * S))
        self.pen = ImageDraw.Draw(self.layer)

    def text(self, xy, value, face, size, color, anchor='lt', stroke=0, outline=None):
        self.pen.text(tuple(round(n * S) for n in xy), value, font=font(face, size),
                      fill=color, anchor=anchor, stroke_width=round(stroke * S),
                      stroke_fill=outline)

    def tracked(self, xy, value, face, size, tracking, color, center=False):
        f = font(face, size)
        widths = [f.getlength(c) for c in value]
        x, y = xy[0] * S, xy[1] * S
        if center:
            x -= (sum(widths) + tracking * S * (len(value) - 1)) / 2
        for c, width in zip(value, widths):
            self.pen.text((round(x), round(y)), c, font=f, anchor='ls', fill=color)
            x += width + tracking * S

    def line(self, coords, fill, width=1):
        self.pen.line([(round(x * S), round(y * S)) for x, y in coords], fill, max(1, round(S * width)))

    def poly(self, coords, fill):
        self.pen.polygon([(round(x * S), round(y * S)) for x, y in coords], fill=fill)

    def arc(self, rect, start, end, fill, width=1):
        self.pen.arc(tuple(round(n * S) for n in rect), start, end, fill, max(1, round(width * S)))

    def finish(self):
        return self.layer.resize((W, H), RESAMPLE)


def compose(im, ink):
    return Image.alpha_composite(im.convert('RGBA'), ink).convert('RGB')


def print_ink(name):
    p = Ink()
    if name == 'backstep-parcel':
        red, navy = '#a62418', '#123d4b'
        for y, length in ((28, 16), (32, 24), (36, 32)):
            p.line([(31, y), (31 + length, y)], navy, 2)
        p.tracked((72, 38), 'BACKSTEP', 'NimbusSansNarrow-BoldOblique', 18, 2, navy)
        p.tracked((33, 59), 'PARCEL EXPRESS', 'NimbusSans-Bold', 10, 2.7, navy)
        p.text((26, 79), 'Same block.', 'NimbusSansNarrow-BoldOblique', 57, navy)
        p.text((26, 130), 'Twice as fast.', 'NimbusSansNarrow-BoldOblique', 57, red)
        p.text((31, 215), 'Rubber-banding counts toward our mileage.', 'URWBookman-LightItalic', 13.4, navy)
    elif name == 'slipfax-portraits':
        cream, gold = '#fff4d9', '#e6b989'
        p.tracked((552, 42), 'SLIPFAX PORTRAITS', 'C059-Bold', 18, 2.6, gold, True)
        p.line([(365, 37), (422, 37)], gold, .7)
        p.line([(681, 37), (737, 37)], gold, .7)
        p.text((552, 65), 'Hold still.', 'NimbusRoman-Regular', 66, cream, 'mt')
        p.text((552, 128), 'Both of you.', 'NimbusRoman-Italic', 68, cream, 'mt')
        p.text((552, 232), 'Our desync package includes both server positions.', 'C059-Roman', 15, cream, 'mt')
    elif name == 'dozehaven-motor-court':
        pale, coral = '#fff1d5', '#ffb69c'
        p.text((24, 13), 'Dozehaven', 'Z003-MediumItalic', 48, '#fcb798', stroke=.45, outline='#fcb798')
        p.tracked((34, 65), 'MOTOR COURT', 'NimbusSans-Bold', 10.5, 4.4, '#a3e6da')
        p.text((26, 96), 'Sleep through', 'URWBookman-Demi', 40, pale)
        p.text((26, 140), 'the raid.', 'URWBookman-Demi', 58, coral)
        p.text((29, 225), 'Wake-up calls go to the new owners.', 'NimbusSans-Regular', 16, pale)
    elif name == 'lid-and-louver':
        dark, red = '#213f43', '#9d301c'
        p.text((711, 25), 'Lid & Louver', 'P052-BoldItalic', 27, dark, 'mt')
        p.tracked((711, 61), 'VENETIAN BLINDS', 'NimbusSans-Bold', 9, 2.2, dark, True)
        p.text((710, 92), 'Get some', 'URWBookman-Demi', 42, dark, 'mt')
        p.text((710, 141), 'shut-eye.', 'URWBookman-DemiItalic', 48, red, 'mt')
        p.line([(643, 207), (781, 207)], red, .9)
        p.text((711, 221), 'Covers all three Tide Eyes.', 'P052-Roman', 16.5, dark, 'mt')
    elif name == 'underlot-lift':
        ivory, gold = '#fff1cd', '#f5c37b'
        p.tracked((184, 27), 'UNDERLOT LIFT CO.', 'URWGothic-Demi', 14, 3.4, gold, True)
        p.text((183, 144), 'Going below?', 'NimbusRoman-Italic', 52, ivory, 'mt')
        p.text((184, 222), 'Ground floor subject to terrain loading.', 'C059-Roman', 15.2, ivory, 'mt')
        for offset in (0, 3):
            p.line([(127 + 7*offset, 202 + offset), (241 - 7*offset, 202 + offset)], gold, .8)
    else:
        pale, gold = '#fff5d3', '#ffc469'
        p.tracked((636, 44), 'PLUMBFIN', 'NimbusSansNarrow-Bold', 27, 5.3, pale, True)
        p.tracked((636, 65), 'BAIT WORKS', 'NimbusSans-Bold', 10, 3.3, gold, True)
        p.text((635, 83), 'Bite', 'C059-BdIta', 65, gold, 'mt')
        p.text((634, 145), 'guaranteed.', 'C059-BdIta', 56, pale, 'mt')
        p.text((636, 234), 'Airdrops double as deep-sea chum.', 'NimbusSans-Regular', 16, pale, 'mt')
    return p.finish()


class Backstep:
    def __init__(self, base):
        self.paper = base.copy()
        clean = base.crop((0, 0, 212, 247))
        for x in range(0, W, 212):
            tile = clean if (x // 212) % 2 == 0 else ImageOps.mirror(clean)
            self.paper.paste(tile, (x, 0))
        # Feather the natural paper around the animal and retain the original running silhouette.
        arr = np.array(base, dtype=float)
        distance = np.maximum(0, (arr[:, :, 1] - 215) * -.75) + np.maximum(0, (arr[:, :, 2] - 145) * -.35)
        alpha = np.clip((distance - 7) / 18, 0, 1)
        alpha[:4] = np.maximum(alpha[:4], np.where(arr[:4, :, 1] < 175, 1, 0))
        alpha[245:, :] = 0
        alpha[:, :223] = 0
        self.animal = base.convert('RGBA')
        self.animal.putalpha(Image.fromarray((alpha * 255).astype('uint8')))
        self.animal = self.animal.resize((round(W * .89), round(H * .89)), RESAMPLE)
        self.ghost = Image.new('RGBA', self.animal.size, '#b66522')
        self.alpha = self.animal.getchannel('A')

    def __call__(self, t):
        dx = keyframes(t, [(0,-9), (.30,14), (.40,-34), (.59,-10), (.78,14), (.88,-30), (1,-9)])
        dy = 2.3 * math.sin(TAU * t * 3)
        x, y = round(82 + dx), round(16 + dy)
        opacity = smooth_window(t, .27, .32, .43, .52) + smooth_window(t, .75, .80, .89, .99)
        out = self.paper.copy()
        if opacity > .005:
            out.paste(self.ghost, (x+25, y+1), self.alpha.point(lambda a: round(a * opacity * .28)))
        out.paste(self.animal, (x,y), self.animal)
        return out


class Slipfax:
    def __init__(self, base):
        self.base = base
        arr = np.array(base, dtype=float)
        x = np.arange(W)[None, :]
        lum = arr[:, :, 0] * .36 + arr[:, :, 1] * .47 + arr[:, :, 2] * .17
        mask = np.clip((lum - 36) / 56, 0, 1) * np.clip((322 - x) / 55, 0, 1)
        mask *= np.clip(x / 52, 0, 1)
        self.alpha = Image.fromarray((mask * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(.5))
        self.double = ImageOps.colorize(ImageOps.grayscale(base), '#171e20', '#eee8c4')

    def __call__(self, t):
        shift = smooth_window(t, .08, .38, .57, .88)
        out = self.base.copy()
        if shift:
            mask = self.alpha.point(lambda a: round(a * .74 * shift))
            out.paste(self.double, (round(104 * shift), round(-5 * shift)), mask)
        return out


class Dozehaven:
    def __init__(self, base):
        self.base = base
        self.lit = []
        for points in [[(553,190),(591,183),(591,222),(553,225)],
                       [(728,52),(768,37),(768,92),(725,99)]]:
            m = Image.new('L', base.size)
            ImageDraw.Draw(m).polygon(points, fill=255)
            self.lit.append(np.array(m.filter(ImageFilter.GaussianBlur(1.2))) / 255)
        self.neon = []
        for on in (False, True):
            p = Ink()
            p.line([(443,77),(443,88)], '#6f8984', 2)
            p.line([(518,77),(518,99)], '#6f8984', 2)
            p.poly([(432,58),(529,58),(529,80),(432,80)], '#101d31')
            p.line([(432,58),(529,58),(529,80),(432,80),(432,58)], '#4c9c9b', 1.2)
            p.tracked((439,74), 'NO', 'NimbusSansNarrow-Bold', 13, .8, '#ff967a' if on else '#643f47')
            p.tracked((460,74), 'VACANCY', 'NimbusSansNarrow-Bold', 13, .6, '#dcffff')
            self.neon.append(p.finish())

    def __call__(self, t):
        downstairs = smooth_window(t, .12, .25, .72, .85)
        upstairs = smooth_window(t, .28, .40, .61, .73)
        value = 1 - self.lit[0]*downstairs*.78 - self.lit[1]*upstairs*.75
        im = Image.fromarray((np.array(self.base) * value[:, :, None]).astype('uint8'))
        light = smooth_window(t, .27, .37, .63, .75)
        return compose(im, Image.blend(self.neon[0], self.neon[1], light))


class Blinds:
    def __init__(self, base):
        self.base = base
        self.masks = []
        for x0,x1 in [(44,204), (211,402), (406,572)]:
            mask = Image.new('L', base.size)
            p = ImageDraw.Draw(mask)
            p.rectangle((x0,10,x1,218), fill=255)
            p.polygon([(0,89),(56,106),(65,115),(74,117),(76,109),(86,103),(99,100),
                       (108,102),(113,112),(116,119),(109,124),(111,132),(122,145),
                       (128,161),(130,186),(147,218),(0,218)], fill=0)
            self.masks.append(mask)
        texture = np.array(base.crop((604,0,788,170)).resize((W,H)), dtype=float)
        grain = (texture.mean(axis=2) - texture.mean()) * .46
        y = np.arange(H)[:,None] % 17
        value = np.where(y < 1, 18, np.where(y > 13, -12 - (y - 14) * 5, 7 - y*.85))
        rgb = np.array([211,170,104])[None,None,:] + (grain+value)[:,:,None]
        self.slat = Image.fromarray(np.clip(rgb,0,255).astype('uint8'))

    def __call__(self, t):
        out = self.base.copy()
        for i, (left,right) in enumerate([(44,204),(211,402),(406,572)]):
            shift = smooth_window(t, .10+i*.055, .40+i*.055, .59+i*.045, .82+i*.055)
            height = round(133 * shift)
            if not height:
                continue
            slats = self.slat.crop((left,0,right+1,height))
            cords = ImageDraw.Draw(slats, 'RGBA')
            for x in (17, right - left - 17):
                cords.line([(x,0),(x,height)], (249,225,170,110))
                cords.line([(x+1,0),(x+1,height)], (110,80,44,90))
            cords.line([(0,height-1),(right-left,height-1)], (106,75,43,200))
            mask = self.masks[i].crop((left,10,right+1,10+height))
            out.paste(slats, (left,10), mask)
            shade = out.crop((left,10+height,right+1,13+height)).point(lambda a: round(a*.82))
            out.paste(shade, (left,10+height), self.masks[i].crop((left,10+height,right+1,13+height)))
        return out


class Underlot:
    def __init__(self, base):
        self.base = base
        self.xgrid = np.arange(W)[None,:]
        p = Ink()
        cx, cy, r = 184, 125, 77
        for rad, col, width in [(r,'#bf8d4c',3.4),(r-3,'#ffe7a5',.8),(r-8,'#c19758',.8)]:
            p.arc((cx-rad,cy-rad,cx+rad,cy+rad),195,345,col,width)
        p.line([(106,120),(262,120)], '#deb576', 1)
        for value,angle in zip(('G','−1','−2','−3','−4'),(204,237,270,303,336)):
            a = math.radians(angle)
            u,v = math.cos(a),math.sin(a)
            x,y = cx+u*55,cy+v*55
            p.text((x,y),value,'NimbusSansNarrow-Bold',14,'#f6dba4','mm')
            p.line([(cx+u*63,cy+v*63),(cx+u*68,cy+v*68)], '#f0cc87', 1.5)
        self.dial = p.finish()

    def __call__(self, t):
        travel = keyframes(t, [(0,0),(.12,0),(.45,.77),(.55,1),(.68,1),(.94,0),(1,0)])
        x = self.xgrid
        focus = np.exp(-((x - (300 + 580*travel))/33)**2)
        bronze = ((x > 367) & (x < 465)) | ((x > 785) & (x < 854))
        factor = 1 + .17 * focus * bronze
        out = Image.fromarray(np.clip(np.asarray(self.base)*factor[:,:,None],0,255).astype('uint8'))
        out = compose(out, self.dial)
        a = math.radians(204 + 132 * travel)
        u,v = math.cos(a), math.sin(a)
        cx,cy = 184,125
        needle = Ink()
        needle.poly([(cx+u*42,cy+v*42),(cx-v*3-u*4,cy+u*3-v*4),
                     (cx+v*3-u*4,cy-u*3-v*4)], '#f9c365')
        for radius,color in [(5,'#663d22'),(3.7,'#d8a04c'),(2,'#f3d39c')]:
            needle.pen.ellipse(tuple(round(n*S) for n in (cx-radius,cy-radius,cx+radius,cy+radius)),fill=color)
        return compose(out,needle.finish())


class Plumbfin:
    def __init__(self, base):
        self.base = base
        self.boxes = []
        for y0 in range(0,H,14):
            for x0 in range(0,W,22):
                x1,y1 = min(x0+22,W),min(y0+14,H)
                self.boxes.append((x0,y0,x1,y1))
        self.vertices = {}
        for x0,y0,x1,y1 in self.boxes:
            for x,y in ((x0,y0),(x0,y1),(x1,y1),(x1,y0)):
                # The crate and its line travel together, with the hook fixed at the boat.
                weight = math.exp(-((x-397)/58)**2-((y-164)/102)**2) * min(1,max(0,(y-26)/65))
                self.vertices[(x,y)] = (weight, min(1,(y+3)/35), (x*.022+y*.037))

    def __call__(self,t):
        a = TAU*t
        pts = {}
        for (x,y),(weight,deep,phase) in self.vertices.items():
            dx = -9.5*weight*math.sin(a) + 1.35*deep*math.sin(a + phase)
            dy = -8*weight*math.sin(a*2+.25) + .85*deep*math.cos(a + phase*.7)
            if x in (0,W): dx = 0
            if y in (0,H): dy = 0
            pts[(x,y)] = (x+dx,y+dy)
        mesh = []
        for x0,y0,x1,y1 in self.boxes:
            quad = pts[(x0,y0)] + pts[(x0,y1)] + pts[(x1,y1)] + pts[(x1,y0)]
            mesh.append(((x0,y0,x1,y1),quad))
        return self.base.transform(self.base.size,Image.Transform.MESH,mesh,Image.Resampling.BICUBIC)


REELS = dict(zip(DATA,(Backstep, Slipfax, Dozehaven, Blinds, Underlot, Plumbfin)))


def render(name, proof):
    base = ImageOps.fit(Image.open(WORK/(name+'.png')).convert('RGB'), (W,H), RESAMPLE)
    background = REELS[name](base)
    ink = print_ink(name)
    title,seconds,poster = DATA[name]
    if proof:
        panels = Image.new('RGB', (W,H*3))
        for i, t in enumerate([0,.48,.76]):
            panels.paste(compose(background(t),ink),(0,H*i))
        panels.save(WORK/(name+'-layout.jpg'),quality=94)
        return
    target = OUT/(name+'.mp4')
    quality = {'plumbfin-bait': '18', 'slipfax-portraits': '17'}.get(name, '15')
    buffer = {'plumbfin-bait': '580k', 'slipfax-portraits': '650k'}.get(name, '900k')
    ceiling = '800k' if name == 'plumbfin-bait' else '1000k'
    args = ['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}',
            '-framerate',str(FPS),'-i','-','-an','-c:v','libx264','-pix_fmt','yuv420p',
            '-threads','2','-preset','slow','-crf',quality,'-maxrate',ceiling,'-bufsize',buffer,
            '-g',str(FPS*2),'-x264-params','vbv-init=1','-movflags','+faststart',str(target)]
    with subprocess.Popen(args,stdin=subprocess.PIPE) as ff:
        count = seconds*FPS
        for frame in range(count):
            ff.stdin.write(compose(background(frame/count),ink).tobytes())
        ff.stdin.close()
        if ff.wait():
            raise RuntimeError('FFmpeg failed to encode '+title)


def write_rows():
    with (WORK/'rows.csv').open('w',newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow('file,name,title,kind,types,channels,rights,licence,by,year,poster,audio,flashes'.split(','))
        for name,(title,_,poster) in DATA.items():
            writer.writerow([name+'.mp4',name,title,'clip','billboard','Billboard ads','Made for SNARK, 2026',
                             'Made for the game and given to it under CC0 1.0.','SNARK',2026,poster,'no','no'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--proof',action='store_true',help='write three layout samples per reel')
    parser.add_argument('names',nargs='*')
    args = parser.parse_args()
    for reel in args.names or DATA:
        if reel not in DATA:
            parser.error('unknown reel '+reel)
        render(reel,args.proof)
    if not args.proof:
        write_rows()
