# Lights the two cloud layers as the sky's shader would and draws them over the dome, so a layer is judged lit and
# not raw. Each layer is an RGB picture: red is cover (0 to 1, how much of the sky it hides), green is thickness
# (0 to 1, how little sun gets through), both linear, with no light painted in. Blue is unused.
#
#   python3 -I light.py                      the accepted low.png and high.png, at noon, sunset and under the moon
#   python3 -I light.py --low a.png --high b.png --out dir --hours noon,sunset,moon
#
# The sky behind the clouds is drawn through the mood keys' points (../keys/points.json) when they are there.
# Writes, for each hour, <hour>.jpg: the whole dome seen from below (zenith in the middle, a ring at 10 degrees up),
# and three views of 102 degrees across, as a player sees them: toward the sun, away from it, straight up. Also
# tiled.jpg: each layer's cover tiled 3 by 3, and seams.txt: D166's seam measure for each layer and channel.
#
# The model is a proposal for L3, written to be cheap in a shader: one fetch a layer plus one from a coarse mip for
# the slope of thickness. Nothing here is physical beyond its shape; the numbers are set by eye.
import argparse
import json
import math
import os
import site

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
EARTH = 6_371_000.0

# Where each layer sits and how dark its thickest cloud gets. Spans are the plan's; heights and depths are ours.
LAYERS = {
    "low": {"height": 1500.0, "span": 8000.0, "tau": 9.0, "step": 120.0, "coarse": 3.0},
    "high": {"height": 8000.0, "span": 32000.0, "tau": 1.6, "step": 240.0, "coarse": 3.0},
}
# The plan gives the high layer 16 km a tile, but a view 102 degrees across straight up at 8 km sees 20 km of it, so
# a band shows twice at once. At 32 km it does not, and a texel is still 16 m, finer than the fibres.
# L3's starting haze: rho0 per metre at sea level, falling by e every H metres up.
HAZE_RHO = 2.5e-4
HAZE_H = 400.0


def dot(d, s):
    return d[..., 0] * s[0] + d[..., 1] * s[1] + d[..., 2] * s[2]


def deg(a):
    return a * math.pi / 180.0


def sun_dir(elev, azim=0.0):
    e, a = deg(elev), deg(azim)
    return np.array([math.cos(e) * math.sin(a), math.sin(e), math.cos(e) * math.cos(a)])


# Each hour: the light's direction and colour (linear, as the table would give it), the sky's colours for the
# background, and an exposure. These stand in when the mood keys are missing; with them, keys_hours() below takes
# the sky from the keys' points.
HOURS = {
    "noon": {
        "sun": sun_dir(66, 0), "light": [1.0, 0.95, 0.88], "zenith": [0.09, 0.22, 0.62], "horizon": [0.55, 0.68, 0.85],
        "glow": [0.9, 0.85, 0.75], "ambient": [0.30, 0.40, 0.55], "exposure": 1.0,
    },
    "sunset": {
        "sun": sun_dir(1, 0), "light": [1.0, 0.42, 0.12], "zenith": [0.06, 0.10, 0.30], "horizon": [0.95, 0.45, 0.20],
        "glow": [1.4, 0.55, 0.15], "ambient": [0.18, 0.16, 0.26], "exposure": 1.1, "away": [0.32, 0.26, 0.40],
    },
    "moon": {
        "sun": sun_dir(40, 0), "light": [0.040, 0.050, 0.070], "zenith": [0.004, 0.009, 0.026],
        "horizon": [0.012, 0.022, 0.045], "glow": [0.02, 0.025, 0.035], "ambient": [0.008, 0.013, 0.026],
        "exposure": 9.0,
    },
}


def to_light(srgb):
    """A key's sRGB colour back to the light before the tone curve: sRGB undone, then the shoulder over 0.8 undone."""
    c = np.asarray(srgb, np.float64) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    peak = c.max()
    if peak > 0.8:
        p = min(peak, 0.995)
        c = c * ((0.04 / (1 - p) - 0.2 + 0.8) / p)
    return c


def keys_hours(path):
    """The three hours the clouds are judged at, with the sky from the mood keys' points: noon, sunset and the night
    key's moon. The light on the clouds is set by eye to sit with each key: white-gold at noon, the low sun's orange at
    sunset, and at night the moon's light as the night key's flat card shows it."""
    keys = json.load(open(path))["keys"]
    out = {}
    lum = lambda c: float(c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722)
    # How bright the sky stands against a flat card in the open, at noon: the night key lifts its sky against its
    # card for readability, and the moon's light on the clouds is lifted with it, so moonlit cloud stays silver.
    noon_ratio = lum(to_light(keys["noon"]["high"])) / lum(to_light(keys["noon"]["up"]))
    for name, key, elev, light in (("noon", "noon", 66.7, [1.0, 0.95, 0.86]), ("sunset", "sunset", 1.0, [1.0, 0.40, 0.16]),
                                    ("moon", "night", 66.7, None)):
        k = keys[key]
        sky = {n: to_light(k[n]) for n in ("zenith", "high", "toward", "away")}
        if light is None:
            ratio = lum(sky["high"]) / lum(to_light(k["up"])) / noon_ratio
            light = (to_light(k["up"]) / to_light([128, 128, 128]) * ratio).tolist()
        out[name] = {
            "sun": sun_dir(elev, 0), "light": light, "ambient": (0.6 * (sky["high"] + sky["zenith"]) / 2).tolist(),
            "glow": (np.array(light) * 0.25).tolist(), "exposure": 1.0, **{n: v.tolist() for n, v in sky.items()},
        }
    return out


def load_layer(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0
    return a[:, :, 0], a[:, :, 1]


def pyramid(cover, thick):
    """Box mips of cover and thickness, as the engine makes them."""
    levels = []
    a = np.stack([cover, thick], -1)
    while True:
        levels.append(a)
        n = a.shape[0]
        if n == 1:
            break
        a = a.reshape(n // 2, 2, n // 2, 2, 2).mean((1, 3))
    return levels


def bilinear(img, u, v):
    n = img.shape[0]
    x = u * n - 0.5
    y = v * n - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    x0 %= n
    y0 %= n
    x1 = (x0 + 1) % n
    y1 = (y0 + 1) % n
    a = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    b = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return a * (1 - fy) + b * fy


def trilinear(levels, u, v, lod):
    lod = np.clip(lod, 0, len(levels) - 1)
    out = np.zeros(u.shape + (levels[0].shape[-1],), np.float32)
    lo = np.floor(lod).astype(np.int64)
    f = (lod - lo)[..., None]
    for k in range(len(levels)):
        m0 = lo == k
        m1 = (lo + 1 == k) & (f[..., 0] > 0)
        if m0.any():
            out[m0] += bilinear(levels[k], u[m0], v[m0]) * (1 - f[m0])
        if m1.any():
            out[m1] += bilinear(levels[k], u[m1], v[m1]) * f[m1]
    return out


def shell_hit(d, h):
    """Distance along unit rays d from a viewer at the ground to a shell h above it, on a round earth."""
    r = EARTH
    b = r * d[..., 1]
    return -b + np.sqrt(b * b + 2 * r * h + h * h)


def hg(c, g):
    return (1 - g * g) / np.power(1 + g * g - 2 * g * c, 1.5)


def sky(d, hour):
    s = hour["sun"]
    if "high" in hour:
        # Through the keys' points: the horizon from away to toward the light by heading, 30 degrees up from the
        # high point (warmer on the light's side), the zenith overhead.
        flat = math.hypot(s[0], s[2])
        h = np.sqrt(d[..., 0] ** 2 + d[..., 2] ** 2) + 1e-6
        side = (d[..., 0] * s[0] + d[..., 2] * s[2]) / (h * max(flat, 1e-6)) if flat > 1e-3 else np.zeros(d.shape[:-1])
        w = (((side + 1) / 2) ** 2)[..., None]
        z, hi, tw, aw = (np.array(hour[n]) for n in ("zenith", "high", "toward", "away"))
        horizon = aw + (tw - aw) * w
        mid = hi + ((hi + tw) / 2 - hi) * w ** 1.5
        e = np.arcsin(np.clip(d[..., 1], 0, 1))
        low = np.power(np.clip(np.sin(e) / 0.5, 0, 1), 0.7)[..., None]
        top = np.clip((e - deg(30)) / deg(60), 0, 1)[..., None]
        col = np.where(e[..., None] < deg(30), horizon + (mid - horizon) * low, mid + (z - mid) * top)
    else:
        e = np.clip(d[..., 1], 0, 1)
        up = 1 - np.exp(-e * 3.2)
        z = np.array(hour["zenith"])
        hz = np.array(hour["horizon"])
        toward = np.clip((dot(d, s) + 1) * 0.5, 0, 1)[..., None]
        if "away" in hour:
            hz = np.array(hour["away"]) + (hz - np.array(hour["away"])) * toward ** 2
        col = hz * (1 - up[..., None]) + z * up[..., None]
    c = np.clip(dot(d, s), -1, 1)[..., None]
    col = col + np.array(hour["glow"]) * (0.25 * np.power(np.clip(c, 0, 1), 6) + 0.8 * np.power(np.clip(c, 0, 1), 200))
    return col


def layer_colour(d, hour, levels, spec, lod_scale):
    """The colour and cover of one layer along rays d. lod_scale is how many texels of mip 0 a pixel spans per metre."""
    t = shell_hit(d, spec["height"])
    p = d * t[..., None]
    u = p[..., 0] / spec["span"]
    v = p[..., 2] / spec["span"]
    # The footprint of a pixel on the layer, from the change of u and v to the next pixel across and down.
    du = np.maximum(np.abs(np.gradient(u, axis=1)), np.abs(np.gradient(u, axis=0)))
    dv = np.maximum(np.abs(np.gradient(v, axis=1)), np.abs(np.gradient(v, axis=0)))
    n = levels[0].shape[0]
    lod = np.log2(np.maximum(np.maximum(du, dv) * n, 1e-6))
    s = trilinear(levels, u % 1.0, v % 1.0, lod)
    cover, thick = s[..., 0], s[..., 1]

    sun = hour["sun"]
    light = np.array(hour["light"])
    amb = np.array(hour["ambient"])
    tau = thick * spec["tau"]
    cos = np.clip(dot(d, sun), -1, 1)
    # The side of a cloud facing the sun is brighter, the other darker: thickness read twice from a coarse mip, here
    # and a step toward the sun, which in a shader is two more fetches. This is the only light direction there is,
    # and it comes from the sun, not from the picture.
    sh = np.array([sun[0], sun[2]])
    flat = math.hypot(sh[0], sh[1])
    relief = np.zeros_like(thick)
    if flat > 1e-3:
        step = spec["step"] / spec["span"]
        coarse = np.maximum(lod, spec["coarse"])
        here = trilinear(levels, u % 1.0, v % 1.0, coarse)[..., 1]
        there = trilinear(levels, (u + sh[0] / flat * step) % 1.0, (v + sh[1] / flat * step) % 1.0, coarse)[..., 1]
        relief = np.clip((here - there) * 3.5 * flat, -0.7, 0.7)
    # By day sunlight reaches the base through the cloud, so thick cores are grey. With the sun low it strikes the
    # base and sides from under the layer, so a sunset cloud glows at its thinner parts and the relief carries its
    # shape, while a thick core stays in its own shade.
    # Looking toward a low sun a player sees the clouds' shaded sides with a bright rim; looking away, their lit sides.
    low = math.exp(-max(sun[1], 0.0) * 9.0)
    through = 1.0 / (1.0 + 0.32 * tau)
    facing = 0.5
    if flat > 1e-3:
        vh = np.sqrt(d[..., 0] ** 2 + d[..., 2] ** 2) + 1e-6
        facing = 0.5 - 0.5 * (d[..., 0] * sh[0] + d[..., 2] * sh[1]) / (vh * flat)
    # Seen low over the horizon a cloud shows its sunlit sides more than its base, so the base's grey fades out.
    below = np.power(np.clip(d[..., 1] / math.sin(deg(25)), 0, 1), 0.7)
    through = through * below + 0.9 * (1 - below)
    direct = (1 - low) * through + low * (0.6 * np.exp(-0.1 * tau) + 0.15) * (0.4 + 0.6 * facing)
    # The bright rim toward the sun: forward scattering, strongest where the cloud is thin.
    rim = (0.65 * hg(cos, 0.7) + 0.35) * np.exp(-tau * 0.9) * (1 - np.exp(-tau * 3.0 - 0.15))
    col = light * ((0.95 * direct * (1 + relief))[..., None] + (0.55 + 0.6 * low) * rim[..., None]) + amb * (0.9 - 0.35 * thick)[..., None]
    # The layer melts into the haze of the sky in that direction, by L3's haze: density rho0 * exp(-y / H) along the
    # ray from the viewer at sea level up to the layer, in closed form. It thins out under a few degrees.
    haze = 1 - np.exp(-HAZE_RHO * HAZE_H * (1 - math.exp(-spec["height"] / HAZE_H)) / np.maximum(d[..., 1], 1e-3))
    col = col * (1 - haze[..., None]) + sky(d, hour) * haze[..., None]
    alpha = cover * np.clip(d[..., 1] / math.sin(deg(1.5)), 0, 1)
    return col, alpha


def tone(x, exposure):
    x = np.maximum(x * exposure, 0)
    start = 0.8
    peak = x.max(-1, keepdims=True)
    d = 1 - start
    new_peak = 1 - d * d / (peak + d - start)
    scaled = np.where(peak > start, x * new_peak / np.maximum(peak, 1e-6), x)
    g = 1 - 1 / (0.15 * (peak - new_peak) + 1)
    x = np.where(peak > start, scaled * (1 - g) + new_peak * g, x)
    x = np.clip(x, 0, 1)
    s = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return (s * 255 + 0.5).astype(np.uint8)


def render(d, hour, stacks):
    above = d[..., 1] > 0
    col = sky(d, hour)
    for name in ("high", "low"):
        if name not in stacks:
            continue
        c, a = layer_colour(d, hour, stacks[name], LAYERS[name], 1.0)
        a = (a * above)[..., None]
        col = col * (1 - a) + c * a
    ground = np.array(hour["ambient"]) * 0.35
    col = np.where(above[..., None], col, ground)
    return tone(col, hour["exposure"])


def dome_rays(size):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    x = (x + 0.5) / size * 2 - 1
    y = (y + 0.5) / size * 2 - 1
    r = np.sqrt(x * x + y * y)
    elev = (1 - np.minimum(r, 1)) * math.pi / 2
    az = np.arctan2(x, -y)
    d = np.stack([np.cos(elev) * np.sin(az), np.sin(elev), np.cos(elev) * np.cos(az)], -1)
    return d, r


def view_rays(w, h, yaw, pitch, hfov=102.0):
    f = 1 / math.tan(deg(hfov) / 2)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    x = ((x + 0.5) / w * 2 - 1)
    y = (1 - (y + 0.5) / h * 2) * h / w
    cam = np.stack([x, y, np.full_like(x, f)], -1)
    cam /= np.linalg.norm(cam, axis=-1, keepdims=True)
    p, a = deg(pitch), deg(yaw)
    # Pitch about x, then yaw about y.
    cy, sy = math.cos(p), math.sin(p)
    rx = np.stack([cam[..., 0], cam[..., 1] * cy + cam[..., 2] * sy, -cam[..., 1] * sy + cam[..., 2] * cy], -1)
    ca, sa = math.cos(a), math.sin(a)
    return np.stack([rx[..., 0] * ca + rx[..., 2] * sa, rx[..., 1], -rx[..., 0] * sa + rx[..., 2] * ca], -1)


def seam(a):
    """D166's measure: the jump across the wrap edge against the mean jump inside, across and down."""
    a = a.astype(np.float64)
    inner_x = np.abs(np.diff(a, axis=1)).sum()
    inner_y = np.abs(np.diff(a, axis=0)).sum()
    edge_x = np.abs(a[:, 0] - a[:, -1]).sum()
    edge_y = np.abs(a[0] - a[-1]).sum()
    w, h = a.shape[1], a.shape[0]
    return edge_x * (w - 1) / max(inner_x, 1e-9), edge_y * (h - 1) / max(inner_y, 1e-9)


def label(img, text):
    from PIL import ImageDraw

    im = Image.fromarray(img)
    ImageDraw.Draw(im).text((10, 8), text, fill=(255, 255, 255))
    return np.asarray(im)


def sheet(hour_name, hour, stacks, size):
    d, r = dome_rays(size)
    dome = render(d, hour, stacks)
    ring = np.abs(r - (1 - 10 / 90)) < 1.2 / size
    dome[ring] = (dome[ring] * 0.5 + 128).astype(np.uint8)
    dome[r > 1] = 20
    w, h = size * 16 // 9, size
    sun_yaw = math.degrees(math.atan2(hour["sun"][0], hour["sun"][2]))
    toward = render(view_rays(w, h, sun_yaw, 14), hour, stacks)
    away = render(view_rays(w, h, sun_yaw + 180, 14), hour, stacks)
    up = render(view_rays(w, h, sun_yaw, 90), hour, stacks)
    top = np.concatenate([label(dome, f"{hour_name}: the dome, ring at 10 degrees"), label(toward, "toward the sun, 102 degrees")], 1)
    bottom = np.concatenate([label(np.full((h, size, 3), 20, np.uint8), ""), label(away, "away from the sun")], 1)
    view = np.concatenate([top, bottom], 0)
    upw = np.zeros((h, view.shape[1], 3), np.uint8)
    upw[:, size:size + w] = label(up, "straight up")
    return np.concatenate([view, upw], 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--low", default=os.path.join(HERE, "low.png"))
    ap.add_argument("--high", default=os.path.join(HERE, "high.png"))
    ap.add_argument("--out", default=os.path.join(HERE, "lit"))
    ap.add_argument("--hours", default="noon,sunset,moon")
    ap.add_argument("--size", type=int, default=720)
    ap.add_argument("--keys", default=os.path.join(HERE, "..", "keys", "points.json"), help="the mood keys' points")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    hours = keys_hours(args.keys) if os.path.exists(args.keys) else HOURS
    stacks = {}
    lines = []
    tiles = []
    for name, path in (("low", args.low), ("high", args.high)):
        if not path or not os.path.exists(path):
            continue
        cover, thick = load_layer(path)
        stacks[name] = pyramid(cover, thick)
        sc, st = seam(cover), seam(thick)
        lines.append(f"{name}: cover {sc[0]:.2f} across {sc[1]:.2f} down; thickness {st[0]:.2f} across {st[1]:.2f} down; "
                     f"mean cover {cover.mean():.3f}, mean thickness {thick.mean():.3f}, cover over 0.5 on {(cover > 0.5).mean():.1%}")
        small = np.asarray(Image.fromarray((cover * 255).astype(np.uint8)).resize((512, 512), Image.BOX))
        tiles.append(np.tile(small, (3, 3)))
    with open(os.path.join(args.out, "seams.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    if tiles:
        Image.fromarray(np.concatenate(tiles, 1)).save(os.path.join(args.out, "tiled.jpg"), quality=88)
    for name in args.hours.split(","):
        img = sheet(name, hours[name], stacks, args.size)
        Image.fromarray(img).save(os.path.join(args.out, f"{name}.jpg"), quality=90)
        print("wrote", os.path.join(args.out, f"{name}.jpg"))


if __name__ == "__main__":
    main()
