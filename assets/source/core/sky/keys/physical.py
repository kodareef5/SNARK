# A physical sky for each mood key, in the base renders' projection, to paint over and to measure a key against.
# Scattering by air (Rayleigh) and haze (Mie) with ozone absorption, and light scattered more than once as Hillaire
# (2020) approximates it, for a viewer at the sea's level. It is not L1's table: it gives the keys a sky whose light
# could be real to start from, and says how far a key's points lie from physics.
#
#   python3 -I physical.py                    reads base/points.json and base/<key>.png, writes underlay/
#   python3 -I physical.py --keys noon,dusk
#
# Exposure follows the engine's rule: at each hour a grey card of sRGB 128 lying face up in the open shows what low
# poly shows today. The dome is scaled so the noon sky 30 degrees up, away from the sun, is as bright as sRGB
# (150, 190, 230); the sun's and the sky's light on surfaces each get a scale, so that at noon the card shows 123
# and a wall out of the sun 70 (D155). Writes underlay/<key>.png, the base with this sky where the base shows sky,
# and underlay/points.json, the colours at the keys' points.
import argparse
import json
import math
import os
import site

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

RG = 6_360_000.0
RT = 6_460_000.0
EYE = 10.0
RAYLEIGH = np.array([5.802, 13.558, 33.1]) * 1e-6
RAYLEIGH_H = 8000.0
MIE_SCATTER = 3.996e-6
MIE_EXTINCT = 4.40e-6
MIE_H = 1200.0
MIE_G = 0.8
OZONE = np.array([0.650, 1.881, 0.085]) * 1e-6
# Light scattered more than once, per height and sun angle: made in main() from the transmittance table.
MULTIPLE = None
# The moon's light against the sun's, a little redder.
MOON = np.array([1.0, 0.94, 0.84]) * 2.5e-6
TILT = math.atan(0.43)
WIDTH, HEIGHT, MIDDLE = 2048, 1024, 345.0

KEYS = [("dawn", 2, False), ("morning", 15, False), ("noon", None, False), ("afternoon", 35, True),
        ("golden", 8, True), ("sunset", 0, True), ("dusk", -8, True), ("night", None, False)]


def hour_of_sun(height, evening):
    t = math.degrees(math.asin(math.sin(math.radians(height)) / math.cos(TILT)))
    travel = round((180 - t if evening else t) / 0.05) * 0.05
    return 6 + travel / 15


def sun_direction(hour):
    t = math.radians((((hour - 6) * 15) % 360 + 360) % 360)
    return np.array([-math.cos(t), math.sin(t) * math.cos(TILT), math.sin(t) * math.sin(TILT)])


def low_poly_card(hour):
    """What low poly shows today for a grey 128 card face up in the open, and one in shade (client/core/render/scene.ts)."""
    up = math.sin((hour - 6) / 12 * math.pi)
    around = math.cos((hour - 6) / 12 * math.pi)
    dusk = min(1.0, max(0.0, (up + 0.1) / 0.4))
    light = 0.3 + 0.7 * dusk * dusk * (3 - 2 * dusk)
    sx, sy = (around * 0.6, up) if up > 0.15 else (0.3, 0.8)
    sl = math.sqrt(sx * sx + sy * sy + 0.43 * 0.43)
    return 128 * light * (0.55 + 0.45 * max(0.0, sy / sl)), 128 * light * 0.55


def dot(a, b):
    return a[..., 0] * b[0] + a[..., 1] * b[1] + a[..., 2] * b[2]


def density(h):
    h = np.maximum(h, 0)
    oz = np.maximum(0, 1 - np.abs(h - 25_000) / 15_000)
    return np.exp(-h / RAYLEIGH_H), np.exp(-h / MIE_H), oz


def extinction(h):
    r, m, o = density(h)
    return RAYLEIGH * r[..., None] + MIE_EXTINCT * m[..., None] + OZONE * o[..., None]


def transmittance_table(nh=64, nm=256):
    """Transmittance from a height toward the top of the air along a ray with cosine mu from straight up."""
    hs = np.linspace(0, RT - RG, nh)
    mus = np.linspace(-1, 1, nm)
    H, MU = np.meshgrid(hs, mus, indexing="ij")
    r = RG + H
    # Distance to the top of the air, and whether the ground is hit first.
    disc = r * r * (MU * MU - 1) + RT * RT
    dist = -r * MU + np.sqrt(np.maximum(disc, 0))
    ground = (MU < 0) & (r * r * (MU * MU - 1) + RG * RG >= 0)
    n = 48
    s = (np.arange(n) + 0.5) / n
    tau = np.zeros(H.shape + (3,))
    for k in range(n):
        t = dist * s[k]
        hh = np.sqrt(r * r + t * t + 2 * r * t * MU) - RG
        tau += extinction(hh) * (dist / n)[..., None]
    tr = np.exp(-tau)
    tr[ground] = 0
    return hs, mus, tr


def multi_table(trans, nh=32, nm=32, ndir=64, steps=20, albedo=0.1):
    """Light scattered more than once, as Hillaire (2020) makes it: per height and sun angle, the second order of
    light from every direction, summed as a geometric series of higher orders. Light from the sun of unit strength."""
    hs = np.linspace(0, RT - RG, nh)
    mus = np.linspace(-1, 1, nm)
    i = np.arange(ndir) + 0.5
    z = 1 - 2 * i / ndir
    phi = math.pi * (1 + 5 ** 0.5) * i
    dirs = np.stack([np.sqrt(1 - z * z) * np.cos(phi), z, np.sqrt(1 - z * z) * np.sin(phi)], -1)
    H, MU = np.meshgrid(hs, mus, indexing="ij")
    r0 = (RG + H)[..., None]
    sun = np.stack([np.sqrt(1 - MU * MU), MU, np.zeros_like(MU)], -1)
    dy = dirs[:, 1][None, None]
    disc = r0 * r0 * (dy * dy - 1) + RT * RT
    dist = -r0 * dy + np.sqrt(np.maximum(disc, 0))
    gdisc = r0 * r0 * (dy * dy - 1) + RG * RG
    hit = (dy < 0) & (gdisc >= 0)
    dist = np.where(hit, -r0 * dy - np.sqrt(np.maximum(gdisc, 0)), dist)
    lum = np.zeros(H.shape + (ndir, 3))
    fms = np.zeros_like(lum)
    tau = np.zeros_like(lum)
    dt = (dist / steps)[..., None]
    for k in range(steps):
        t = dist * (k + 0.5) / steps
        px = dirs[:, 0][None, None] * t
        py = r0 + dy * t
        pz = dirs[:, 2][None, None] * t
        r = np.sqrt(px * px + py * py + pz * pz)
        h = r - RG
        rd, md, od = density(h)
        scat = RAYLEIGH * rd[..., None] + MIE_SCATTER * md[..., None]
        ext = RAYLEIGH * rd[..., None] + MIE_EXTINCT * md[..., None] + OZONE * od[..., None]
        tv = np.exp(-(tau + ext * dt * 0.5))
        mu_s = (px * sun[..., 0:1] + py * sun[..., 1:2] + pz * sun[..., 2:3]) / r
        ts = lookup(trans, h, mu_s)
        lum += tv * scat * ts / (4 * math.pi) * dt
        fms += tv * scat * dt
        tau += ext * dt
    # Light off the ground where a direction meets it.
    gmu = np.clip(MU, 0, 1)[..., None, None]
    ground = np.exp(-tau) * lookup(trans, np.zeros_like(MU), MU)[:, :, None, :] * gmu * albedo / math.pi
    lum += np.where(hit[..., None], ground, 0)
    l2 = lum.mean(2)
    f = fms.mean(2)
    return hs, mus, l2 / (1 - f)


def lookup(table, h, mu):
    hs, mus, tr = table
    fh = np.clip(h / hs[-1] * (len(hs) - 1), 0, len(hs) - 1.001)
    fm = np.clip((mu + 1) / 2 * (len(mus) - 1), 0, len(mus) - 1.001)
    h0, m0 = fh.astype(int), fm.astype(int)
    a, b = (fh - h0)[..., None], (fm - m0)[..., None]
    return (tr[h0, m0] * (1 - a) * (1 - b) + tr[h0 + 1, m0] * a * (1 - b) + tr[h0, m0 + 1] * (1 - a) * b + tr[h0 + 1, m0 + 1] * a * b)


def sky(dirs, light, table, n=40):
    """Radiance along unit view rays dirs (..., 3) for a light of unit strength from direction light."""
    r0 = RG + EYE
    mu = dirs[..., 1]
    disc = r0 * r0 * (mu * mu - 1) + RT * RT
    dist = -r0 * mu + np.sqrt(np.maximum(disc, 0))
    gdisc = r0 * r0 * (mu * mu - 1) + RG * RG
    hit = (mu < 0) & (gdisc >= 0)
    dist = np.where(hit, -r0 * mu - np.sqrt(np.maximum(gdisc, 0)), dist)
    cos = np.clip(dot(dirs, light), -1, 1)
    pr = 3 / (16 * math.pi) * (1 + cos * cos)
    g = MIE_G
    pm = 3 / (8 * math.pi) * (1 - g * g) * (1 + cos * cos) / ((2 + g * g) * np.power(1 + g * g - 2 * g * cos, 1.5))
    out = np.zeros(dirs.shape[:-1] + (3,))
    tau = np.zeros_like(out)
    # Steps closer together near the viewer, where the air is thickest.
    edges = (np.arange(n + 1) / n) ** 2
    for k in range(n):
        t0, t1 = dist * edges[k], dist * edges[k + 1]
        t = 0.5 * (t0 + t1)
        dt = (t1 - t0)[..., None]
        p = np.stack([dirs[..., 0] * t, r0 + dirs[..., 1] * t, dirs[..., 2] * t], -1)
        r = np.linalg.norm(p, axis=-1)
        h = r - RG
        rd, md, od = density(h)
        ext = RAYLEIGH * rd[..., None] + MIE_EXTINCT * md[..., None] + OZONE * od[..., None]
        tv = np.exp(-(tau + ext * dt * 0.5))
        mu_s = dot(p, light) / r
        ts = lookup(table, h, mu_s)
        scatter_r = RAYLEIGH * rd[..., None]
        scatter_m = MIE_SCATTER * md[..., None]
        single = ts * (scatter_r * pr[..., None] + scatter_m * pm[..., None])
        # Light scattered more than once reaches even the shadowed air of twilight; it falls off as the sun sinks
        # under the sample's own horizon.
        multi = lookup(MULTIPLE, h, mu_s) * (scatter_r + scatter_m)
        out += tv * (single + multi) * dt
        tau += ext * dt
    return out


def directions(width, height):
    j, i = np.mgrid[0:height, 0:width].astype(np.float64)
    heading = np.radians(MIDDLE + ((i + 0.5) / width - 0.5) * 360)
    elev = np.radians(90 - (j + 0.5) / height * 180)
    return np.stack([-np.sin(heading) * np.cos(elev), np.sin(elev), np.cos(heading) * np.cos(elev)], -1)


def irradiance(light, strength, table, normal, ground=0.12):
    """Light falling on a surface facing normal: the light itself through the air, the sky, and the ground's bounce."""
    d = directions(128, 64)
    lum = sky(d, light, table) * strength
    w = np.cos(np.radians(90 - (np.arange(64) + 0.5) / 64 * 180))[:, None] * (2 * math.pi / 128) * (math.pi / 64)
    cos = np.clip(dot(d, normal), 0, None)
    up = d[..., 1] > 0
    e_sky = (lum * (cos * w * up)[..., None]).sum((0, 1))
    sun_ground = lookup(table, np.array(EYE), np.array(light[1])) * strength
    e_sun = sun_ground * max(0.0, float(dot(light, normal)))
    # The ground below the horizon, lit as a grey of the given albedo by the sun and the sky above it.
    e_flat = sun_ground * max(0.0, float(light[1])) + (lum * (np.clip(d[..., 1], 0, None) * w * up)[..., None]).sum((0, 1))
    e_ground = ground / math.pi * e_flat * (cos * w * ~up).sum()
    return e_sun, e_sky + e_ground


def surface_light(e, scales):
    """Light on a surface with the sun's and the sky's parts each on its own scale, as the engine calibrates them."""
    return e[0] * scales[0] + e[1] * scales[1]


def srgb_to_linear(c):
    c = np.asarray(c, np.float64) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def tone(x):
    x = np.maximum(x, 0)
    start = 0.8
    peak = x.max(-1, keepdims=True)
    d = 1 - start
    new_peak = 1 - d * d / (peak + d - start)
    scaled = np.where(peak > start, x * new_peak / np.maximum(peak, 1e-9), x)
    g = 1 - 1 / (0.15 * (peak - new_peak) + 1)
    x = np.clip(np.where(peak > start, scaled * (1 - g) + new_peak * g, x), 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055) * 255


def luminance(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def point_dir(p):
    h, e = math.radians(p["heading"]), math.radians(p["elevation"])
    return np.array([-math.sin(h) * math.cos(e), math.sin(e), math.cos(h) * math.cos(e)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.path.join(HERE, "base"))
    ap.add_argument("--out", default=os.path.join(HERE, "underlay"))
    ap.add_argument("--keys", default="")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    meta = None
    pj = os.path.join(args.base, "points.json")
    if os.path.exists(pj):
        meta = {k["name"]: k for k in json.load(open(pj))["keys"]}
    global MULTIPLE
    table = transmittance_table()
    MULTIPLE = multi_table(table)
    grey = srgb_to_linear(128)

    def setting(name, height, evening):
        hour = meta[name]["hour"] if meta else (12.0 if name == "noon" else 0.0 if name == "night" else hour_of_sun(height, evening))
        sun = sun_direction(hour)
        moon = name == "night"
        return hour, (-sun if moon else sun), (MOON if moon else np.ones(3))

    # The two scales, from noon.
    hour, light, strength = setting("noon", None, False)
    high = point_dir(meta["noon"]["points"]["high"]) if meta else None
    if high is None:
        flat = np.array([-light[0], 0, -light[2]])
        flat /= np.linalg.norm(flat)
        high = flat * math.cos(math.radians(30)) + np.array([0, math.sin(math.radians(30)), 0])
    dome = luminance(srgb_to_linear([150, 190, 230])) / luminance(sky(high[None], light, table)[0])
    # D155 at noon: a grey 128 card face up in the open shows 123, a wall out of the sun 70.
    up_noon = irradiance(light, strength, table, np.array([0, 1.0, 0]))
    away = np.array([-light[0], 0, -light[2]])
    wall_noon = irradiance(light, strength, table, away / np.linalg.norm(away))
    k_sky = srgb_to_linear(70) / (grey * luminance(wall_noon[1]) / math.pi)
    k_sun = (srgb_to_linear(low_poly_card(12.0)[0]) / (grey / math.pi) - luminance(up_noon[1]) * k_sky) / luminance(up_noon[0])
    scales = (k_sun, k_sky)

    wanted = [k for k in args.keys.split(",") if k] or [k[0] for k in KEYS]
    report = {"about": "The physical sky at each key's points, exposed as the engine exposes it, in sRGB. Grey cards are grey 128.", "keys": {}}
    full = directions(512, 256)
    for name, height, evening in KEYS:
        if name not in wanted:
            continue
        hour, light, strength = setting(name, height, evening)
        card_up, card_shade = low_poly_card(hour)
        e_up = surface_light(irradiance(light, strength, table, np.array([0, 1.0, 0])), scales)
        exposure = srgb_to_linear(card_up) / (grey * luminance(e_up) / math.pi)
        lum = sky(full, light, table) * strength * dome * exposure
        small = tone(lum)
        img = np.asarray(Image.fromarray(small.astype(np.uint8)).resize((WIDTH, HEIGHT), Image.BICUBIC)).astype(np.float64)
        base_path = os.path.join(args.base, f"{name}.png")
        if os.path.exists(base_path):
            base = np.asarray(Image.open(base_path).convert("RGB")).astype(np.float64)
            flat_sky = base[2:8, :].reshape(-1, 3).mean(0)
            dist = np.abs(base - flat_sky).max(-1)
            w = np.clip(1 - dist / 24, 0, 1)[..., None]
            img = img * w + base * (1 - w)
        Image.fromarray(np.clip(img + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(args.out, f"{name}.png"))
        entry = {"hour": round(hour, 4), "lightHeight": round(math.degrees(math.asin(light[1])), 2), "exposure": round(float(exposure), 4)}
        pts = meta[name]["points"] if meta else {}
        for pname in ("zenith", "high", "toward", "away"):
            if pname in pts:
                v = sky(point_dir(pts[pname])[None], light, table)[0] * strength * dome * exposure
                entry[pname] = [round(float(c)) for c in tone(v)]
        flat = np.array([light[0], 0, light[2]])
        flat /= max(np.linalg.norm(flat), 1e-9)
        for pname, normal in (("lit", flat), ("shaded", -flat), ("up", np.array([0, 1.0, 0]))):
            e = surface_light(irradiance(light, strength, table, normal), scales)
            entry[pname] = [round(float(c)) for c in tone(grey * e / math.pi * exposure)]
        entry["lowPolyUp"] = round(card_up, 1)
        report["keys"][name] = entry
        print(name, json.dumps(entry))
    with open(os.path.join(args.out, "points.json"), "w") as f:
        json.dump(report, f, indent=2)


if __name__ == "__main__":
    main()
