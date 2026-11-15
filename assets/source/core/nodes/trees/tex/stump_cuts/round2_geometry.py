"""Round-two native-source relief and reflectance fields, in millimetres.

Six complete facets replace the old partial supports over a shallow bowl.
Native ring bands and their offsets are shared by pigment and shallow relief.
No source-wide luminance-to-height conversion or baked source illumination.
"""
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter as gf, map_coordinates, median_filter
from scipy.interpolate import PchipInterpolator


def smoothstep(a, b, v):
    t = np.clip((v-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def trace(points, width, shape, curved=False):
    p = np.asarray(points, dtype=float)
    if curved:
        t = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
        p = PchipInterpolator(t, p, axis=0)(np.linspace(0, t[-1], max(20, int(t[-1]*2))))
    im = Image.new('L', (shape[1], shape[0]))
    ImageDraw.Draw(im).line([tuple(v) for v in p], fill=255, width=width, joint='curve')
    return np.asarray(im, dtype=np.float32)/255


def native_fields(a, cfg, old, original_structure, name):
    yy, xx = np.mgrid[:a.shape[0], :a.shape[1]].astype(np.float32)
    spokes = cfg['spokes']
    angle = np.unwrap([np.arctan2(p[0][1]-626.5, p[0][0]-626.5) for p in spokes])
    angle = np.r_[angle, angle[0]+2*np.pi]
    weights = []
    # Full coverage: every face runs all the way from bark to the hinge.
    for i, path in enumerate(spokes):
        arc = np.linspace(angle[i], angle[i+1], 48)
        rim = np.c_[626.5+1500*np.cos(arc), 626.5+1500*np.sin(arc)]
        polygon = [*path[::-1], *rim.tolist(), *spokes[(i+1) % len(spokes)]]
        im = Image.new('L', (a.shape[1], a.shape[0]))
        ImageDraw.Draw(im).polygon([tuple(p) for p in polygon], fill=255)
        mask = np.asarray(im, dtype=np.float32)/255
        # Subpixel broken edge, never a broad Gaussian shoulder.
        mask = map_coordinates(mask, [yy+1.1*np.sin(xx*.23)+.65*np.sin(yy*.47),
                                      xx+.8*np.sin(yy*.29)+.5*np.sin(xx*.53)], order=1, mode='nearest')
        weights.append(gf(mask, .65))
    weights = np.stack(weights)
    weights /= np.maximum(weights.sum(axis=0), 1e-6)
    facet_id = weights.argmax(axis=0).astype(np.float32)+1
    h = np.zeros_like(xx); tone = np.zeros_like(xx); rough = np.zeros_like(xx)
    centres = [19.0, 25.0, 18.5, 24.0, 18.0, 26.0]
    rises = [7.0, 4.0, 7.0, 5.0, 7.0, 3.0]
    tones = [1.021, .968, 1.012, .981, 1.031, .960]
    roughs = [.785, .865, .805, .850, .780, .875]
    for i, w in enumerate(weights):
        hub = np.asarray(spokes[i][-1], dtype=float)
        direction = np.array([np.cos((angle[i]+angle[i+1])/2), np.sin((angle[i]+angle[i+1])/2)])
        tx, ty = xx-hub[0], yy-hub[1]
        t = (tx*direction[0]+ty*direction[1])/580
        lateral = (-tx*direction[1]+ty*direction[0])/580
        plane = centres[i]+rises[i]*t+(.8 if i % 2 else -1.2)*lateral
        h += w*plane; tone += w*tones[i]; rough += w*roughs[i]

    lum = np.sum(a*np.array([.2126, .7152, .0722], dtype=np.float32), axis=-1)
    fine = lum-gf(lum, 2)
    band = gf(lum, .55)-gf(lum, 4.2)
    # Fine painted growth bands, including their facet discontinuities. A
    # clipped band-pass removes broad lighting; ring relief stays sub-mm.
    rings = np.clip(band/15, -1, 1)
    rings *= 1-smoothstep(.05, .5, old['ridge_fine'])
    rings *= 1-old['concrete']
    ring_height = rings*cfg['ring_relief_mm']
    h += ring_height + np.clip(fine, -20, 20)*(.008 if name == 'mangrove' else .013)
    heart = np.zeros_like(xx)
    if name == 'oak':
        # Trace a dark growth band in a narrow annulus of the new painting.
        # A radial prior keeps it a rounded, eccentric core; source ring pixels
        # determine the little deviations instead of a hand-cut polygon.
        angles = np.linspace(-np.pi, np.pi, 2048, endpoint=False)
        radii = np.arange(359, 410, .5)
        target = 384+6*np.sin(3*angles+.4)+3*np.sin(7*angles)
        sample = map_coordinates(band, [613+np.sin(angles[:,None])*radii,
                                        591+np.cos(angles[:,None])*radii], order=1)
        cost = sample+.13*(radii[None,:]-target[:,None])**2
        edge = radii[np.argmin(cost, axis=1)]
        edge = gf(median_filter(edge, size=13, mode='wrap'), 3, mode='wrap')
        radius = np.hypot(xx-591, yy-613)
        theta = np.arctan2(yy-613, xx-591)
        boundary = np.interp(theta, angles, edge, period=2*np.pi)
        heart = 1-smoothstep(boundary-3, boundary+3, radius)

    cracks = np.zeros_like(xx)
    for i, points in enumerate(cfg.get('checks', [])):
        path = trace(points, 2 if i < 4 else 1, xx.shape)
        cracks = np.maximum(cracks, gf(path, .65))
    cracks *= 1-smoothstep(.08, .4, old['ridge_fine'])
    h -= cracks*1.7

    seams = np.zeros_like(xx)
    for points in original_structure.get('seams', []):
        seam = gf(trace(points, 8, xx.shape, curved=True), 1.8)
        seams = np.maximum(seams, seam)
    seams *= 1-smoothstep(.12, .6, old['ridge_fine'])
    h -= seams*2.2

    protect = smoothstep(.15, .55, old['ridge_fine'])
    # The original hinge and concrete are restored after registration, so
    # their approved shapes do not inherit the edited plate's new UV warp.
    return dict(height=h, facet_id=facet_id, facet_tone=tone, facet_rough=rough,
                rings=rings, ring_height=ring_height, fine=fine, heart=heart,
                cracks=cracks, seams=seams, preserve_hinge=protect)


def chipped_rim(theta, radius, nominal_rim, pitch, cfg, outer_radius):
    """Bark breaks alter material coverage, never the outer mesh footprint."""
    chip_profile = np.zeros_like(theta)
    lift_profile = np.zeros_like(theta)
    for i, degrees in enumerate(cfg['chip_angles_degrees']):
        a = np.deg2rad(degrees)
        delta = np.angle(np.exp(1j*(theta-a)))
        # The smaller mangrove has a much wider bark band in texels. Scale
        # impact width with it so missing bark reads as a bite, not a peg.
        width = max(np.deg2rad(3.0 + (i % 3)*.85),
                    float(nominal_rim.mean())/pitch/outer_radius*(1.12+.14*(i%3)))
        # Unequal angular shoulders make fractured V-shaped bites.
        side_width = width*np.where(delta < 0, .8, 1.25)
        bite = np.clip((1-abs(delta)/side_width)/.40, 0, 1)
        bite *= .91+.045*np.sin(theta*213+i)+.02*np.sin(theta*371-i)
        bite *= [1.0,.87,.94,.80,.98,.89][i % 6]
        chip_profile = np.maximum(chip_profile, bite)
        lift_delta = np.angle(np.exp(1j*(theta-a-width*1.45)))
        lift_profile = np.maximum(lift_profile, np.clip(1-abs(lift_delta)/(width*.7), 0, 1))
    effective_rim = nominal_rim*(1-chip_profile)
    wood_radius = outer_radius-effective_rim/pitch
    wood = smoothstep(wood_radius+.7, wood_radius-.7, radius)
    annulus = smoothstep(outer_radius-nominal_rim/pitch-2, outer_radius-nominal_rim/pitch+2, radius)
    chip = chip_profile*annulus*wood
    lift = lift_profile*annulus*smoothstep(outer_radius, outer_radius-2, radius)*(1-wood)
    return wood, chip, lift, effective_rim
