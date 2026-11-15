"""Paint original hurt/harvest pigments in the baked bird's millimetre space.

Run from any directory: python3 -B tex/layers/paint.py
Requires Python 3, NumPy, Pillow and SciPy. No Blender, network, generated-image
service, clock or process-dependent random state. Output alpha is TIME, never
coverage. RGB is intrinsic pigment, with no painted specular highlights.
"""
from pathlib import Path
import hashlib
import json
import site
import sys

site.addsitedir(site.getusersitepackages())
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import distance_transform_edt, gaussian_filter

HERE = Path(__file__).resolve().parent
DODO = HERE.parents[1]
PAINT = DODO / "tex/paint"
BAKES = DODO / "ref/bakes"
SIZE = 1024
PIGMENTS = json.loads((HERE / "source/pigments.json").read_text())


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-10)


def mix(a, b, t):
    return np.asarray(a) * (1 - t[..., None]) + np.asarray(b) * t[..., None]


def noise(u, v, pitch, seed):
    """Smooth, fixed non-repeating value noise in millimetres, [-1, 1]."""
    x, y = u / pitch, v / pitch
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = smooth(x - ix), smooth(y - iy)

    def corner(dx, dy):
        # Integer hash, avoiding RNG sequence dependence on mask/mesh size.
        a = (ix.astype(np.int64) + dx) * 374761393
        b = (iy.astype(np.int64) + dy) * 668265263
        h = (a + b + seed * 1442695) & 0xffffffff
        h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
        h ^= h >> 16
        return (h & 0xffffff) / 8388607.5 - 1

    a = corner(0, 0) * (1 - fx) + corner(1, 0) * fx
    b = corner(0, 1) * (1 - fx) + corner(1, 1) * fx
    return a * (1 - fy) + b * fy


def sample_image(path, size=SIZE, nearest=False):
    im = Image.open(path)
    if im.size != (size, size):
        im = im.resize((size, size), Image.Resampling.NEAREST if nearest else Image.Resampling.BOX)
    return np.asarray(im)


def read_geometry():
    meta = json.loads((PAINT / "pieces.json").read_text())
    bake_meta = json.loads((BAKES / "bakes.json").read_text())
    ids = sample_image(PAINT / "pieces.png", nearest=True)[..., 0]
    pos = []
    for k, axis in enumerate("xyz"):
        q = sample_image(PAINT / f"position_{axis}.png", nearest=True).astype(float) / 65535
        lo, hi = meta["position_box"]["min"][k], meta["position_box"]["max"][k]
        pos.append((lo + q * (hi - lo)) * 1000)
    pos = np.stack(pos, -1)
    normal = unit(sample_image(BAKES / "dodo_normal_object.png", nearest=True)[..., :3] / 127.5 - 1)
    raw_flow = sample_image(BAKES / "dodo_feather_direction.png", nearest=True) / 255
    flow = np.stack([raw_flow[..., 0] * 2 - 1, 1 - raw_flow[..., 1] * 2], -1)
    # Decode the UV vector into physical surface tangent; do not confuse image
    # y with world y. One-sided derivatives keep seams out of the direction.
    deriv = []
    for axis in (1, 0):
        plus = np.roll(ids, -1, axis) == ids
        minus = np.roll(ids, 1, axis) == ids
        dp = np.roll(pos, -1, axis) - pos
        dm = pos - np.roll(pos, 1, axis)
        deriv.append(np.where((plus & minus)[..., None], (dp + dm) / 2,
                              np.where(plus[..., None], dp, dm)))
    down = unit(deriv[0] * flow[..., :1] + deriv[1] * flow[..., 1:])
    base = sample_image(DODO / "tex/dodo_base.png").mean(-1) / 255
    height = sample_image(DODO / "tex/dodo_height.png").astype(float) / 65535
    # Existing vane/scale drawing survives in pigment without copying lighting
    # or dye. It anchors the new blood clumps to the accepted feathers.
    grain = np.clip((base - gaussian_filter(base, 6)) * 4 +
                    (height - gaussian_filter(height, 5)) * 1.6, -.5, .5)
    # Broad vane crests and recessed overlaps come from the accepted feather
    # drawing, not a new dapple pattern. Keep this separate from grain because
    # the approved carcass and scale recipes still use their original field.
    feather_relief = np.clip((gaussian_filter(height, .7) -
                              gaussian_filter(height, 18)) / .010, -1.5, 1.5)
    covered = sample_image(BAKES / "dodo_covered.png")[..., 0] / 255
    mm = sample_image(PAINT / "texel_mm.png", nearest=True).astype(float) / 1000 * 2
    regions = sample_image(DODO / "tex/dodo_regions.png", nearest=True)
    return dict(meta=meta, bake_meta=bake_meta, ids=ids, pos=pos, normal=normal,
                down=down, grain=grain, feather_relief=feather_relief,
                height=height, covered=covered, mm=mm,
                regions=regions, names={r["name"]: r["number"] for r in meta["pieces"]})


def mark_frame(g, rec):
    own = np.isin(g["ids"], [g["names"][n] for n in rec["pieces"]])
    candidates = np.argwhere(own)
    p = g["pos"][own]
    anchor = np.array(rec["at"], dtype=float)
    j = np.argmin(np.linalg.norm(p - anchor, axis=-1))
    cy, cx = candidates[j]
    anchor = p[j]
    n = g["normal"][cy, cx]
    v = np.array(rec["axis"], dtype=float)
    v = unit(v - n * np.dot(n, v))
    u = unit(np.cross(v, n))
    # Broad geometry-aware selection, then evaluate only the local patch.
    radius = max(rec["length"], rec["width"]) * .8
    own &= np.linalg.norm(g["pos"] - anchor, axis=-1) < radius
    yy, xx = np.where(own)
    p = g["pos"][yy, xx]
    q = p - anchor
    U, V, Z = (np.sum(q * a, axis=-1) for a in (u, v, n))
    # Reject surfaces folded back behind this local patch.
    facing = np.sum(g["normal"][yy, xx] * n, -1)
    good = (facing > -.1) & (abs(Z) < radius * .85)
    yy, xx, p, U, V = yy[good], xx[good], p[good], U[good], V[good]
    feather = g["down"][cy, cx]
    fu, fv = np.dot(feather, u), np.dot(feather, v)
    if fu * fu + fv * fv < .2:
        fu, fv = 0., 1.
    Uflow, Vflow = U * fv - V * fu, U * fu + V * fv
    # Gravity projected onto this patch, in physical millimetres. The pigment
    # uses it for drainage; the accepted mark footprint/time field is untouched.
    gv = unit(np.array([0., -1., 0.]) - n * np.dot(n, [0., -1., 0.]))
    gu = unit(np.cross(gv, n))
    gravity_u = np.sum((p-anchor)*gu, axis=-1)
    gravity_v = np.sum((p-anchor)*gv, axis=-1)
    return yy, xx, U, V, Uflow, Vflow, p, anchor, gravity_u, gravity_v


def wound_pigment(kind, u, v, r, grain, rec, flow_u, flow_v, gravity_u, gravity_v,
                  feather_relief):
    """Material transitions are spatial: red cut -> skin/down -> clumped vanes."""
    seed = rec["seed"]
    coarse = noise(u, v, 11, seed + 11)
    fine = noise(u, v, 1.7, seed + 12)
    fibres = noise(flow_u, flow_v * .18, 2.4, seed + 13)
    core = rec.get("core", .3)
    if kind == "feather":
        palette = PIGMENTS["wound"]
        fw, fl, offset = PIGMENTS["focus"][rec["id"]]
        width, length = rec["width"]*fw/2, rec["length"]*fl/2
        # Long body cuts have separate edge curves and a short rolled flap.
        # The wing uses a missing-covert gap instead, below.
        cv = v-rec["length"]*offset
        midline = rec["at"][0] == 0
        centre = (0 if midline else rec["width"]*.075) + .12*cv
        centre += 3.4*noise(v,u*.04,9,seed+35) + 1.5*np.sin(v/15+seed)
        cut_taper = np.maximum(1-abs((cv+length*.12)/(length*1.08))**1.3,0)
        roll_taper = np.maximum(1-abs((cv-length*.17)/(length*.76))**1.65,0)
        cut_edge = centre-width*.58*cut_taper + 2.8*noise(v,u*.03,6.5,seed+36)
        roll_edge = centre+width*.96*roll_taper + 2.1*noise(v,u*.03,11,seed+39)
        cut_distance = cut_edge-u
        roll_distance = u-roll_edge
        signed = np.maximum(np.maximum(cut_distance,roll_distance),abs(cv)-length*1.1)
        signed += 1.0*fibres
        opening = 1-smooth((signed+.6)/2.0)
        bank = smooth((u-centre+1)/max(3.,width*.45))
        tear = smooth((noise(v,u*.04,8,seed+37)+.55)/.7)
        rolled_length = smooth((cv/length+.43)/.2)*(1-smooth((cv/length-.56)/.24))
        flesh = smooth((roll_distance+.9)/2.0)*(1-smooth((roll_distance-4.5)/3.0))
        flesh *= bank*rolled_length*(.35+.65*tear)
        skin = smooth((roll_distance-3.8)/2.0)*(1-smooth((roll_distance-6.5)/2.4))
        skin *= bank*tear*rolled_length*.42
        wing = rec["id"] == "wing_tear"
        if wing:
            # An open notch reaches one edge of the accepted blood footprint.
            # A closed oval, even irregular, reads as another mouth on this
            # small rounded wing. Only the positive-u edge meets red matting.
            # This is pigment geometry; the reveal field is untouched.
            gu = u + .24*cv
            gv = cv + 5
            notch = -7 + 5*noise(gv,gu*.02,7,seed+93)
            gap = np.maximum(gu-notch, abs(gv+2)-22)
            signed = gap + fibres*1.5 + noise(flow_u,flow_v*.25,4.5,seed+94)*1.9
            opening = 1-smooth((signed+.4)/1.7)
            flesh = np.zeros_like(r)
            skin = np.zeros_like(r)
        # A narrow dark collar contains the opening. Most of the larger mat
        # is a clear blood red that survives the engine's 10 m reduction.
        distance = np.maximum(signed-6,0)
        col = mix(palette["dense_blood"],palette["feather_blood"],smooth((distance+3)/9))
        col = mix(col,palette["thin_blood"],smooth((r-.77)/.23))
        # Blood sinks into the existing feather overlaps, leaving the vane
        # crests lighter. Broad structure survives 256 px storage; the actual
        # base-map barb drawing and elongated clumps sit within those vanes.
        # Centre the variation inside the mat to retain its distance value.
        mat = (r < 1) & (opening < .1)
        relief = feather_relief.copy()
        if mat.any():
            relief -= relief[mat].mean()
        comb = noise(flow_u, flow_v*.22, 4.8, seed+92)
        col += (relief*(.85+.15*comb))[...,None]*[28.,8.,11.]
        col += grain[...,None]*[150.,45.,54.]
        col += comb[...,None]*[17.,4.,6.]
        col += fibres[...,None]*[7.,2.5,3.5] + fine[...,None]*1.0
        # Two unequal streams pull down the standing breast/flank and off the
        # wing. The smaller longitudinal variation follows the feather comb.
        drain = np.zeros_like(r)
        for side, breadth, run in [(-.16, 4.4, .40),(.20, 2.8, .32)]:
            centreline = side*rec["width"] + 1.4*noise(gravity_v,gravity_u*.1,14,seed+81)
            spread = breadth*(1-.48*smooth(gravity_v/(rec["length"]*.5)))
            line = 1-smooth((abs(gravity_u-centreline)-spread)/2.3)
            line *= smooth((gravity_v+5)/9)*(1-smooth((gravity_v-rec["length"]*run)/10))
            drain = np.maximum(drain,line)
        col = mix(col,palette["dense_blood"],drain*.72)
        fleshcol = mix([103,31,34],palette["flesh"],.24+.76*bank)
        fleshcol += (fine*2+fibres*2)[...,None]
        col = mix(col,fleshcol,flesh)
        col = mix(col,palette["torn_skin"],skin)
        wall = smooth((signed+width*.72)/(width*.72))
        deep = mix(palette["opening"],palette["inner_meat"],wall*(.33+.67*bank))
        deep += (fine*1.2+fibres*1.3)[...,None]
        if wing:
            # A recessed patch with one darker corner, not a dark centreline
            # flanked by matching red ridges. No flesh or skin rim here.
            deep = mix(palette["opening"],palette["inner_meat"],
                       smooth((gu+gv*.3+9)/24)*.58)
            deep += (fine+fibres)[...,None]
        col = mix(col,deep,opening)
        # Frayed blood-soaked vanes intrude on the cut side, breaking its edge
        # without inventing a second flesh bank opposite the rolled flap.
        fray = smooth((cut_distance+2.8+fibres*2.5)/3.5)*opening*(1-bank)
        fray *= smooth((noise(flow_u,flow_v*.12,3.4,seed+67)+.15)/.65)
        if wing:
            # Broken feather ends intrude on one short edge, with uneven ends
            # 4--8 mm long. There is no matching row on the opposite bank.
            ends = smooth((noise(flow_u,flow_v*.10,3.1,seed+97)+.10)/.48)
            fray = opening*smooth((7-abs(gv+20+ends*4))/6)*ends
            fragments = mix([111,67,72],palette["down"],ends*.30)
            fragments += grain[...,None]*[45.,23.,26.]
            col = mix(col,fragments,fray*.88)
        else:
            col = mix(col,palette["feather_blood"],fray*.78)
        # A few lifted down tufts sit at the ragged margin only. They are not
        # sprinkled through flesh or used as a repeating clump texture.
        tuft = noise(flow_u,flow_v*.11,5.2,seed+65)
        down = smooth((r-.76)/.09)*(1-smooth((r-.94)/.06))*smooth((tuft-.33)/.20)
        col = mix(col,palette["down"],down*.82)
    elif kind == "bruise":
        col = mix([88, 60, 64], [151, 92, 85], smooth(r + coarse * .22))
        col += (fine * 4 + grain * 12)[..., None]
    elif kind in ("scratch", "scrape"):
        col = mix([108, 28, 28], [187, 112, 87], smooth((r - .35) / .55))
        col += (fine * 5 + grain * 24)[..., None]
        if kind == "scrape":
            scales = smooth((grain + .035) / .13) * smooth((r - .4) / .35)
            col = mix(col, [191, 159, 112], scales * .60)
    elif kind == "horn":
        col = mix([144, 126, 93], [199, 184, 145], smooth(.4 + coarse * .35 + fine * .13))
        chip = smooth((.10*rec["width"] - abs(u+2+coarse*2)) / 2)
        chip *= smooth((.45-v/rec["length"])/.3)
        col = mix(col, [102, 82, 60], chip * .52)
        col += grain[..., None] * 14
    elif kind == "crack":
        col = mix([60, 47, 33], [168, 149, 108], smooth((r - .30) / .5))
        col += fine[..., None] * 5
    else:
        raise ValueError(kind)
    return np.clip(col, 0, 255)


def corpse_pigment(kind, u, v, r, grain, rec, p, flow_u, flow_v):
    seed = rec["seed"]
    coarse = noise(u, v, 17, seed + 11)
    middle = noise(u, v, 5, seed + 12)
    fine = noise(u, v, 1.5, seed + 13)
    fibres = noise(flow_u, flow_v * .15, 2.1, seed + 15)
    palette=PIGMENTS["carcass"]
    skin=np.broadcast_to(np.array(palette["skin"],float),(len(r),3)).copy()
    skin+=(fine*3.0+middle*2.0)[...,None]
    follicles=smooth((noise(u,v,2.4,seed+23)-.40)/.26)
    skin=mix(skin,palette["skin_pimples"],follicles*.34)
    col=skin.copy()
    if rec["id"] == "wing_pluck":
        # This small plucked margin previously read as another pale ring.
        # Keep the exact arrival map, exposing skin in disconnected fragments.
        fragment=smooth((noise(v,u*.25,13,seed+87)-.04)/.36)
        col=mix([87,53,51],skin,fragment*.78)
    primary=rec["id"] in ("breast_harvest","breast_underside","rib_flank","shank_strip")
    if primary:
        # A dark cut edge with occasional plucked skin; avoid a second pale
        # outline outside the fascia. The skin's own pigment stays pink-grey.
        skin_fragments = smooth((noise(u*.6,v,22,seed+50)-.08)/.48)
        col = mix([99,63,60],skin,skin_fragments*.72)
        signed=(r-.83)*min(rec["width"],rec["length"])/2
        lip=1-smooth((signed-2)/3.4)
        col=mix(col,palette["hide_lip"],lip)
        inside=smooth((-signed-4.5)/4)
        muscle=noise(u,v*.12,3.0,seed+31)
        depth=smooth((.71-r)/.38)
        meat=mix(palette["muscle"],palette["deep_meat"],depth*.75)
        meat+=(muscle*11.0+fine*1.5)[...,None]
        col=mix(col,meat,inside)
        # Fascia survives in separated pieces on selected edges, about 3–6 mm
        # wide. Neither the mask nor the pigment draws a full cream perimeter.
        angle=np.arctan2(v/(rec["length"]/2),u/(rec["width"]/2))
        sector=smooth((np.sin(angle+seed*.37)-.12)/.5)
        breaks=smooth((noise(v,u*.25,15,seed+38)+.02)/.40)
        fat=smooth((-signed-1.2)/1.6)*(1-smooth((-signed-5.2)/2.2))
        fat*=sector*breaks
        col=mix(col,palette["fascia"],fat*.84)
        # Grey-green bloom is confined to late edge fragments; never a base
        # coat for the whole carcass. The engine supplies global dulling.
        bloom=smooth((r-.90)/.06)*smooth((.99-r)/.04)*smooth((coarse-.24)/.3)
        col=mix(col,palette["edge_bloom"],bloom*.46)
    bone = np.zeros_like(r)
    bone_tone = np.zeros_like(r)
    # Anatomical cues are in the bird's frame, independent of UV cuts/patches.
    if rec.get("anatomy") == "ribs":
        x, y, z = p.T
        for k, station in enumerate((-46., -18., 11., 40.)):
            # The ribs curve forward toward the sternum under the wing, not
            # horizontal stripes across the bird. Ends stay partly fleshed.
            bend = station + .0028 * (y - 279) ** 2
            dist = abs(z - bend)
            width = 3.0 + 1.0 * np.cos((y - 213) / 38)
            line = smooth((width + 1.1 - dist) / 2.1)
            ends = smooth((y - (179 + k * 4)) / 16) * smooth(((278 - k * 3) - y) / 19)
            tone=.20+.72*smooth((z-bend+width)/(2*width))
            bone_tone=np.where(line*ends>bone,tone,bone_tone)
            bone = np.maximum(bone, line * ends)
        bone *= smooth((.81 - r) / .17)
    elif rec.get("anatomy") == "keel":
        x, y, z = p.T
        # A short exposed crest of the broad bird keel, not a mammal sternum.
        width = 7 + 8 * smooth((210 - y) / 50)
        bone = smooth((width - x) / 4) * smooth((y - 130) / 15) * smooth((252 - y) / 23)
        bone *= smooth((.89 - r) / .17)
        bone_tone=.24+.66*smooth((width-x)/width)
    elif rec.get("anatomy") == "leg":
        bone = smooth((6.8 - abs(u + 1.0 * np.sin(v / 14))) / 2.3)
        bone *= smooth((36 - abs(v)) / 9) * smooth((.78 - r) / .13)
        bone_tone=.2+.7*smooth((u+6.8)/13.6)
    elif rec.get("anatomy") == "ventral_keel":
        x, y, z = p.T
        # Continue the breast crest along the underside exposed by the lying
        # pose. Flesh-covered ends avoid a floating white stick on the belly.
        width = 9 + 5*smooth((z-45)/90)
        bone = smooth((width-x)/4)*smooth((z-13)/24)*smooth((171-z)/31)
        bone_tone=.24+.66*smooth((width-x)/width)
        # Short ventral ends turn inward from the flank ribs toward the keel.
        # They give the exposed belly structure when the lateral ribs are
        # hidden by the folded wing in the lying pose.
        for station in (27.,58.,89.):
            bend = station + .0028*(x-105)**2
            end = smooth((4.6-abs(z-bend))/2.0)
            end *= smooth((x-18)/17)*smooth((123-x)/22)
            tone=.20+.72*smooth((z-bend+4.6)/9.2)
            bone_tone=np.where(end*.93>bone,tone,bone_tone)
            bone = np.maximum(bone,end*.93)
        bone *= smooth((.82-r)/.18)
    # Geometry and the bone reveal clock above are unchanged. This is local
    # side-to-side material modelling, never a white highlight along a rib.
    bonecol = mix(palette["bone_shadow"], palette["bone"],bone_tone)
    bonecol = mix(bonecol,palette["bone_joint"],smooth((.55-bone)/.55)*.38)
    bonecol += (middle*2.5+fine)[...,None]
    col = mix(col, bonecol, bone)
    return np.clip(col, 0, 255), bone


def paint_marks(g, records, corpse=False, reserved=None):
    rgb = np.zeros((SIZE, SIZE, 3), dtype=float)
    time = np.full((SIZE, SIZE), 4., dtype=float)
    markid = np.zeros((SIZE, SIZE), dtype=np.uint8)
    retention = np.ones((SIZE, SIZE), dtype=bool)
    wound_distance = distance_transform_edt(~reserved)*g["mm"] if corpse else None
    report = []
    for index, rec in enumerate(records, 1):
        yy, xx, u, v, fu, fv, p, anchor, gu, gv = mark_frame(g, rec)
        seed, length, width = rec["seed"], rec["length"], rec["width"]
        # Irregular axes, large broken lobes, then feather-aligned tears. The
        # edge is a continuous time field, not opacity noise or binary splats.
        bend = (np.sin(v / (length * .22) + seed) + .4 * np.sin(v / (length * .09))) * width * .055
        if rec["kind"] == "crack":
            bend += np.sin(v / 3.7) * width * .19
        U = u - bend
        r = np.sqrt((U / (width / 2)) ** 2 + (v / (length / 2)) ** 2)
        large = noise(u, v, min(width, length) * .27, seed)
        edge = noise(fu, fv * .26, max(2., min(width, length) * .075), seed + 1)
        r += .17 * large + .17 * edge * smooth(r / .8)
        if rec["kind"] == "feather":
            # Two broken, feather-flow lobes and a dragged lower end break the
            # mathematical ellipse. This changes the arrival field as well.
            clump = noise(fu, fv*.35, 6.4, seed+31)
            r += .16*clump*smooth(r/.6)
            r += .10*np.sin(v/(length*.15)+seed)*smooth(abs(u)/(width*.35))
        r += .035 * noise(u, v, 2.8, seed + 2)
        r = np.maximum(r, 0)
        t = rec["onset"] + (rec["edge"] - rec["onset"]) * np.minimum(r, 1) ** rec.get("power",1.4)
        if corpse and rec.get("surround"):
            # Expand from the *outside* of a permanent wound. Rebase the
            # smooth radial clock at its first unreserved surface, so stage 1
            # is visible instead of disappearing under the living injury.
            visible = (r < 1) & ~reserved[yy, xx]
            if visible.any():
                start = float(np.percentile(r[visible], 6))
                growth = np.clip((r-start)/(1-start),0,1)
                t = rec["onset"] + (rec["edge"]-rec["onset"])*growth**1.15
        # Shelter delays secondary damage, while the primary placements avoid
        # the covered bake. No blunt hole at the boundary of a folded wing.
        t += g["covered"][yy, xx] * (.11 if corpse else .20) * r
        grain = g["grain"][yy, xx]
        if corpse:
            col, bone = corpse_pigment(rec["kind"], U, v, r, grain, rec, p, fu, fv)
            # Exposed bone arrives progressively during harvest 2/3, even if
            # its neighbouring hide was cut in stage 1.
            t = np.maximum(t, (1.30 + .66 * smooth(abs(v) / (length / 2))) * bone)
        else:
            col = wound_pigment(rec["kind"], U, v, r, grain, rec, fu, fv, gu, gv,
                               g["feather_relief"][yy, xx])
        choose = (r < 1) & (t < time[yy, xx])
        # A scratch is intentionally painted over its surrounding bruise;
        # colour changes only spatially, never as a function of game stage.
        if rec["kind"] in ("scratch", "crack"):
            choose = r < 1
        y, x = yy[choose], xx[choose]
        rgb[y, x] = col[choose]
        time[y, x] = np.minimum(time[y, x], t[choose])
        markid[y, x] = index
        if corpse:
            # Keep the approved source footprints and every retained texel's
            # reveal time. Withdraw the old broad camouflage fields so the
            # engine can show the bird's actual dyed plumage through its grade.
            keep = np.ones_like(r,dtype=bool)
            if rec["id"]=="back_hide":
                keep=(r<.70)&(wound_distance[yy,xx]<13)
            elif rec["id"]=="cap_loss":
                keep=r<.46
            elif rec["id"]=="neck_pluck":
                keep=(r<.87)&(wound_distance[yy,xx]<10)
            elif rec["id"]=="wing_pluck":
                keep=(r<.88)&(wound_distance[yy,xx]<11)&(u>-3+4*noise(v,u*.08,12,seed))
            elif rec["id"]=="hind_rot":
                keep=(wound_distance[yy,xx]<8)&(r>.58)&(noise(u,v,20,seed)>.12)
                col=mix(col,PIGMENTS["carcass"]["edge_bloom"],np.full_like(r,.7))
                rgb[y,x]=col[choose]
            elif rec["id"]=="face_mottling":
                keep=(r<.58)&(wound_distance[yy,xx]<7)
            retention[y,x]=keep[choose]
        report.append(dict(id=rec["id"], anchor_mm=np.round(anchor, 3).tolist(),
                           footprint_mm=[length, width], onset=rec["onset"], edge=rec["edge"],
                           painted_texels=int(choose.sum()),
                           covered_fraction=round(float(g["covered"][y, x].mean()), 4) if len(y) else 0.,
                           median_stored_texel_mm=round(float(np.median(g["mm"][y, x])) * 4, 3) if len(y) else 0.))
    alpha = np.where(time < 3, np.rint(255 * (1 - time / 3)), 0).astype(np.uint8)
    alpha[~retention]=0
    return rgb, alpha, markid, report


def pad_layers(g, hrgb, ha, drgb, da):
    """Nearest same-surface gutter extension, keeping hurt/decay disjoint."""
    own = g["ids"] > 0
    distance, indices = distance_transform_edt(~own, return_indices=True)
    gutter = (~own) & (distance <= 4)
    for value in (hrgb, ha, drgb, da):
        value[gutter] = value[tuple(indices[:, gutter])]
    da[ha > 0] = 0
    hrgb[ha == 0] = 0
    drgb[da == 0] = 0


def save_rgba(path, rgb, alpha):
    arr = np.dstack([np.clip(np.rint(rgb), 0, 255).astype(np.uint8), alpha])
    info = PngImagePlugin.PngInfo()
    info.add(b'gAMA', (45455).to_bytes(4, 'big'))
    info.add(b'sRGB', b'\0')
    Image.fromarray(arr).save(path, pnginfo=info, compress_level=9)


def paint_cards(g):
    """Sparse shared feather stains; no repeated little cuts on every card."""
    size = 256
    base = sample_image(DODO / "tex/dodo_cards_base.png", size)
    hrgb, drgb = (np.zeros((size, size, 3), float) for _ in range(2))
    ha, da = (np.zeros((size, size), np.uint8) for _ in range(2))
    specs = g["bake_meta"]["material dodo_cards"]["rectangles"]
    records = []
    for i, (name, rect) in enumerate(specs.items()):
        x0, y0, x1, y1 = int(rect[0] * size), int((1-rect[3])*size), int(rect[2]*size), int((1-rect[1])*size)
        y, x = np.mgrid[y0:y1, x0:x1]
        u, v = (x-x0+.5)/(x1-x0), (y-y0+.5)/(y1-y0)
        width, height = g["meta"]["cards"][name]["card_mm"]
        um, vm = u * width, v * height
        seed = 801 + i * 39
        clump = noise(um, vm*.24, max(width/25, 1.7), seed)
        coarse = noise(um, vm, max(height*.3, 4), seed+1)
        grain = base[y, x, :3].mean(-1)/255 - .65
        if name in ("body", "trousers", "mane", "hood", "forehead"):
            # Different delays down a hanging fringe; most of each repeated
            # rectangle remains untouched during life. No clean fringe at 3.
            start = {"body":2.0,"trousers":2.03,"mane":2.18,"hood":2.30,"forehead":2.35}[name]
            field = .60 * v + .26 * clump + .14 * coarse
            hit = field > .47
            ht = start + .65 * (1 - smooth((field-.47)/.34))
            dt = 1.3 + 1.43*(1-smooth((v+.25*coarse+.13*clump)/1.1))
        else:
            # Blood caught toward finger roots; tail gets a small side smear.
            field = (v*.72 if name == "finger" else .4*v + .35*u) + .22*clump
            hit = field > (.46 if name == "finger" else .67)
            ht = (1.8 if name == "finger" else 2.2) + .52*(1-smooth((field-.46)/.35))
            dt = .8 + 1.93 * (1-smooth((v+.25*clump)/1.15))
        alpha = np.where(hit, np.rint(255*(1-np.clip(ht,0,2.77)/3)), 0).astype(np.uint8)
        decay = np.rint(255*(1-np.clip(dt,0,2.77)/3)).astype(np.uint8)
        # Crop to an expanded accepted cutout, preserving antialiased edges.
        valid = gaussian_filter((base[y,x,3]>32).astype(float),.8) > .04
        alpha[~valid] = 0
        decay[~valid | (alpha>0)] = 0
        col = mix([87,34,29], [128,53,39], smooth(.5+coarse*.4)) + (grain*28+clump*7)[...,None]
        # Keep shared staining, but remove the all-over brown decay coat.
        # Sparse ash-grey frayed ends leave the original dye/bands visible.
        dc = mix([85,78,79], [148,139,132], smooth(.5+coarse*.3)) + (grain*25+clump*4)[...,None]
        terminal=(v>.64+.14*clump) if name not in ("tail","finger") else (v<.20+.12*clump)
        decay[~terminal]=0
        hrgb[y,x], drgb[y,x], ha[y,x], da[y,x] = col, dc, alpha, decay
        records.append(dict(rectangle=name, card_mm=[width,height], hurt_start=float(ht[hit].min()) if hit.any() else None,
                            note="Shared diffuse clumping, not individually located wounds"))
    hrgb[ha==0] = 0
    drgb[da==0] = 0
    save_rgba(DODO/"tex/dodo_cards_hurt.png", hrgb, ha)
    save_rgba(DODO/"tex/dodo_cards_decay.png", drgb, da)
    return records


def main():
    (HERE / "checks").mkdir(exist_ok=True)
    records = json.loads((HERE / "source/marks.json").read_text())
    g = read_geometry()
    hrgb, ha, hi, hurt = paint_marks(g, records["hurt"])
    drgb, da, di, decay = paint_marks(g, records["decay"], True, ha>0)
    # The lying view exposes the underside below the original breast patch.
    # Continue that cut without shifting or retiming any existing pigment.
    extra_rgb, extra_a, _, extra_report = paint_marks(
        g, [PIGMENTS["belly_continuation"]], True, ha>0)
    extend = (da == 0) & (ha == 0) & (extra_a > 0)
    drgb[extend], da[extend] = extra_rgb[extend], extra_a[extend]
    extra_report[0]["added_texels_after_reservation"] = int(extend.sum())
    decay += extra_report
    erased = int(np.sum((ha > 0) & (da > 0)))
    da[ha > 0] = 0
    pad_layers(g, hrgb, ha, drgb, da)
    save_rgba(DODO / "tex/dodo_hurt.png", hrgb, ha)
    save_rgba(DODO / "tex/dodo_decay.png", drgb, da)
    cards = paint_cards(g)
    inputs = [PAINT / x for x in ("pieces.json", "pieces.png", "position_x.png", "position_y.png", "position_z.png", "texel_mm.png")]
    inputs += [BAKES / x for x in ("bakes.json", "dodo_normal_object.png", "dodo_feather_direction.png", "dodo_covered.png")]
    inputs += [DODO / "tex" / x for x in ("dodo_base.png", "dodo_regions.png", "dodo_height.png", "dodo_cards_base.png")]
    inputs += [HERE / "source/marks.json", HERE / "source/pigments.json", Path(__file__)]
    hashes = {str(p.relative_to(DODO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
    outputs = {name:hashlib.sha256((DODO/"tex"/name).read_bytes()).hexdigest() for name in
               ("dodo_hurt.png","dodo_decay.png","dodo_cards_hurt.png","dodo_cards_decay.png")}
    coverage = {}
    own = g["ids"] > 0
    # Weight by surface area, avoiding oversampling the face relative to body.
    area = g["mm"] ** 2 * own
    for name, a in (("hurt",ha),("decay",da)):
        onset = 3*(1-a.astype(float)/255)
        coverage[name] = [round(float((smooth((s-onset)/.25)*(a>0)*area).sum()/area.sum())*100, 3) for s in (1,2,3)]
    manifest = dict(inputs=hashes, outputs=outputs, hurt=hurt, decay=decay, cards=cards,
                    overlap_texels=int(((ha>0)&(da>0)).sum()), decay_texels_reserved_for_hurt=erased,
                    opaque_surface_coverage_percent=coverage, alpha="255*(1-onset/3); 0 is absent",
                    sources="Original mathematical brushwork and hand-directed millimetre placements; no generated imagery.")
    (HERE / "checks/manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
    for name, a in (("hurt",ha),("decay",da)):
        Image.fromarray(a).save(HERE / "checks" / f"{name}_arrival.png")
    assert manifest["overlap_texels"] == 0
    print(json.dumps(dict(outputs=outputs,coverage=coverage,overlap=manifest["overlap_texels"]),indent=2))


if __name__ == "__main__":
    main()
