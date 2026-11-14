"""Original geometry scaffold, not an edit of generated artwork."""
from pathlib import Path
from PIL import Image, ImageDraw
import math

OUT = Path('guides')
OUT.mkdir(exist_ok=True)
im = Image.new('RGB', (1600, 1200), '#e9e0d0')
d = ImageDraw.Draw(im)
scale = 220
az = math.radians(24)
el = math.radians(24)
def project(p):
    x,y,z = p
    return (300 + scale*(math.cos(az)*x+math.sin(az)*y),
            1060 + scale*(math.sin(az)*math.sin(el)*x-math.cos(az)*math.sin(el)*y-math.cos(el)*z))
def face(points, fill):
    q = [project(p) for p in points]
    d.polygon(q, fill=fill)
    d.line(q+[q[0]], fill='#584f42', width=3)
# The visible east side is a single, fully filled stepped masonry mass.
profile = [(3,0,0),(3,3,0),(3,3,3)]
for i in range(9,-1,-1):
    profile.extend([(3,.3*i,.3*(i+1)),(3,.3*i,.3*i)])
face(profile, '#9d9585')
# Exactly ten risers and ten treads; no extra cap or landing.
for i in range(9,-1,-1):
    y=.3*i
    lo=.3*i
    hi=.3*(i+1)
    face([(0,y,hi),(3,y,hi),(3,y+.3,hi),(0,y+.3,hi)], '#d4cbb8')
    face([(0,y,lo),(3,y,lo),(3,y,hi),(0,y,hi)], '#b7ab94')
im.save(OUT/'stairs_geometry.png')
