"""Scale-legible wreck symbols at saved world positions, not enlarged world hulls."""
import math
from PIL import Image, ImageDraw
from common import B, SIZE, vectors


def wreck_symbols(im, z):
    if z > 1:
        return im
    scale = 4
    layer = Image.new('RGBA', (im.width*scale, im.height*scale))
    d = ImageDraw.Draw(layer)
    mpp = SIZE/im.width
    for _, p in vectors('future_changes'):
        if p['kind'] != 'submerged_wreck':
            continue
        cx = (p['center'][0]-B[0])/mpp
        cy = (B[3]-p['center'][1])/mpp
        angle = -math.radians(p['angle_degrees'])
        length = max(p['length_m']/mpp, 14 if z == 0 else 18)
        width = max(p['width_m']/mpp, 4.5 if z == 0 else 5.5)
        def point(u, v):
            x = u*length; y = v*width
            return ((cx+x*math.cos(angle)-y*math.sin(angle))*scale,
                    (cy+x*math.sin(angle)+y*math.cos(angle))*scale)
        hull = [(-.5,0),(-.35,-.44),(.22,-.5),(.5,0),(.22,.5),(-.35,.44)]
        d.polygon([point(*q) for q in hull], fill=(100,125,108,225))
        # One torn gunwale, rusted stem and pale exposed frames.
        d.line([point(*q) for q in hull[:4]], fill=(74,76,53,242), width=3)
        d.line([point(*q) for q in hull[4:]+[hull[0]]], fill=(82,84,60,220), width=2)
        for i, u in enumerate([-.29,-.13,.05,.23]):
            d.line([point(u,-.34),point(u,.31 if i!=2 else .1)],
                   fill=(205,197,153,238), width=2)
        d.line([point(.18,0),point(.46,0)], fill=(137,104,62,245), width=3)
    layer = layer.resize(im.size, Image.Resampling.LANCZOS)
    return Image.alpha_composite(im.convert('RGBA'),layer).convert('RGB')
