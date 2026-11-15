"""Measures of one take: its events, loudness, onset, pitch, harmonicity, spectrum and faults.

Kinds change only the event rules: "voice" merges syllables into one call, "impact" and
"step" keep each hit separate.
"""

import numpy as np
import soundfile as sf

VERSION = 6
GAP = {"voice": 0.15, "impact": 0.06, "step": 0.05}
PAD = {"voice": (0.03, 0.08), "impact": (0.01, 0.06), "step": (0.008, 0.05)}


def load(path):
    x, sr = sf.read(str(path), dtype="float64", always_2d=True)
    return x, sr


def envelope(mono, sr, win=0.02, hop=0.005):
    w, h = max(1, int(win * sr)), max(1, int(hop * sr))
    if len(mono) < w:
        mono = np.pad(mono, (0, w - len(mono)))
    n = 1 + (len(mono) - w) // h
    idx = np.arange(w)[None, :] + h * np.arange(n)[:, None]
    rms = np.sqrt(np.mean(mono[idx] ** 2, axis=1) + 1e-20)
    return 20 * np.log10(rms + 1e-12), h / sr, w / sr


def find_events(env, hop, kind):
    peak = env.max()
    floor = np.percentile(env, 5)
    thr = max(peak - 35.0, floor + 8.0)
    act = env > thr
    runs, i = [], 0
    while i < len(act):
        if act[i]:
            j = i
            while j < len(act) and act[j]:
                j += 1
            runs.append([i, j])
            i = j
        else:
            i += 1
    gap = int(GAP[kind] / hop)
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    events = []
    for a, b in merged:
        p = env[a:b].max()
        if b - a < 3:
            continue
        events.append({"a": a, "b": b, "peak_db": float(p)})
    return events, float(peak), float(floor), float(thr)


def find_steps(env, hop, min_gap=0.3, prominence=10.0):
    """Footfalls: prominent envelope peaks at least min_gap apart, each bounded by the valleys either side."""
    from scipy.signal import find_peaks

    peak = env.max()
    floor = np.percentile(env, 5)
    tops, _ = find_peaks(env, prominence=prominence, distance=max(1, int(min_gap / hop)), height=peak - 25)
    events = []
    for n, top in enumerate(tops):
        lo = tops[n - 1] if n else max(0, top - int(0.3 / hop))
        hi = tops[n + 1] if n + 1 < len(tops) else min(len(env), top + int(0.6 / hop))
        a = lo + int(np.argmin(env[lo:top])) if top > lo else top
        b = top + int(np.argmin(env[top:hi])) if hi > top else top
        quiet = max(env[top] - 35, floor + 3)
        a = max(a, top - int(0.15 / hop))
        while a < top and env[a] < quiet:
            a += 1
        while b > top + 3 and env[b] < quiet:
            b -= 1
        events.append({"a": a, "b": max(b, top + 3), "peak_db": float(env[top])})
    return events, float(peak), float(floor), float(peak - 25)


def yin(frame, sr, fmin=70.0, fmax=2000.0):
    n = len(frame)
    tmax = min(int(sr / fmin), n // 2)
    tmin = max(2, int(sr / fmax))
    f = np.fft.rfft(frame, 2 * n)
    acf = np.fft.irfft(f * np.conj(f))[:tmax + 1]
    cs = np.concatenate([[0.0], np.cumsum(frame ** 2)])
    e0 = cs[n - np.arange(tmax + 1)]
    et = cs[n] - cs[np.arange(tmax + 1)]
    d = e0 + et - 2 * acf
    d[0] = 0
    cmnd = np.ones_like(d)
    cm = np.cumsum(d[1:]) / np.arange(1, tmax + 1)
    cmnd[1:] = d[1:] / np.maximum(cm, 1e-12)
    seg = cmnd[tmin:tmax]
    if len(seg) < 3:
        return None, 1.0, 0.0
    below = np.where(seg < 0.15)[0]
    if len(below):
        k = below[0]
        while k + 1 < len(seg) and seg[k + 1] < seg[k]:
            k += 1
    else:
        k = int(np.argmin(seg))
    ti = k + tmin
    t = float(ti)
    if 1 <= ti < tmax:
        a, b, c = cmnd[ti - 1], cmnd[ti], cmnd[ti + 1]
        den = a - 2 * b + c
        t += 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
    r = acf[ti] / max(np.sqrt(e0[ti] * et[ti]), 1e-12)
    return sr / t, float(cmnd[ti]), float(np.clip(r, 0, 0.9999))


def pitch_track(mono, sr, a, b):
    win, hop = int(0.04 * sr), int(0.01 * sr)
    seg = mono[a:b]
    out = []
    lvl = np.sqrt(np.mean(seg ** 2) + 1e-20)
    for s in range(0, max(1, len(seg) - win), hop):
        fr = seg[s:s + win]
        if len(fr) < win or np.sqrt(np.mean(fr ** 2)) < lvl * 0.25:
            continue
        fr = fr - fr.mean()
        f0, ap, r = yin(fr, sr)
        out.append((s / sr, f0, ap, r))
    return out


def spectrum_stats(mono, sr, a, b):
    seg = mono[a:b]
    n = 2048
    if len(seg) < n:
        seg = np.pad(seg, (0, n - len(seg)))
    hop = 512
    frames = 1 + (len(seg) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    S = np.abs(np.fft.rfft(seg[idx] * np.hanning(n), axis=1)) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    e = S.sum(axis=1)
    keep = e > e.max() * 1e-3
    S, e = S[keep], e[keep]
    tot = S.sum(axis=0)
    cen = float((tot * f).sum() / tot.sum())
    cum = np.cumsum(tot) / tot.sum()
    roll = float(f[np.searchsorted(cum, 0.85)])
    band = lambda lo, hi: float(tot[(f >= lo) & (f < hi)].sum() / tot.sum())
    flat = float(np.mean(np.exp(np.mean(np.log(S[:, 1:] + 1e-20), axis=1)) / (np.mean(S[:, 1:], axis=1) + 1e-20)))
    # steady tone: longest run where the strongest bin stays put and stands far above the rest
    pk = np.argmax(S[:, 2:], axis=1) + 2
    prom = 10 * np.log10(S[np.arange(len(S)), pk] / (np.median(S, axis=1) + 1e-20))
    run = best = 0
    for i in range(1, len(pk)):
        run = run + 1 if abs(int(pk[i]) - int(pk[i - 1])) <= 1 and prom[i] > 30 else 0
        best = max(best, run)
    return {
        "centroid_hz": round(cen), "rolloff85_hz": round(roll), "flatness": round(flat, 3),
        "bands": {"lt300": round(band(0, 300), 3), "300_2k": round(band(300, 2000), 3),
                  "2k_6k": round(band(2000, 6000), 3), "gt6k": round(band(6000, sr / 2), 3)},
        "steady_tone_ms": round(best * hop / sr * 1000),
    }


def attack_ms(mono, sr, a, b):
    env, hop, _ = envelope(mono[a:b], sr, win=0.005, hop=0.001)
    pk = int(np.argmax(env))
    lo = env[pk] - 30
    i = pk
    while i > 0 and env[i] > lo:
        i -= 1
    j = i
    while j < pk and env[j] < env[pk] - 3:
        j += 1
    return round((j - i) * hop * 1000, 1), round(pk * hop, 3)


def decay_ms(env, hop, a, b, peak_i, floor):
    stop = max(env[peak_i] - 30, floor + 3)
    k = peak_i
    while k < len(env) - 1 and env[k] > stop:
        k += 1
    return round((k - peak_i) * hop * 1000)


def measure(path, kind):
    x, sr = load(path)
    mono = x.mean(axis=1)
    dur = len(mono) / sr
    if kind == "step":
        env, hop, win = envelope(mono, sr)
        events, peak, floor, thr = find_steps(env, hop)
    else:
        env, hop, win = envelope(mono, sr)
        events, peak, floor, thr = find_events(env, hop, kind)
    full = 32767 / 32768
    m = {
        "rate": sr, "channels": x.shape[1], "seconds": round(dur, 3),
        "peak_dbfs": round(20 * np.log10(np.abs(x).max() + 1e-12), 2),
        "clipped": int((np.abs(x) >= full * 0.9999).sum()),
        "dc": round(float(mono.mean()), 5),
        "floor_db": round(floor, 1), "env_peak_db": round(peak, 1),
        "snr_db": round(peak - floor, 1),
        "silent": bool(peak < -60),
    }
    pre, post = PAD[kind]
    evs = []
    for k, e in enumerate(events):
        a_s, b_s = e["a"] * hop, e["b"] * hop + win
        start = max(0.0, a_s - pre)
        end = min(dur, b_s + post)
        if k > 0:
            start = max(start, (events[k - 1]["b"] * hop + win + a_s) / 2)
        if k + 1 < len(events):
            end = min(end, (b_s + events[k + 1]["a"] * hop) / 2)
        sa, sb = int(start * sr), int(end * sr)
        seg = mono[sa:sb]
        pk_i = e["a"] + int(np.argmax(env[e["a"]:e["b"]]))
        ev = {
            "start": round(start, 3), "end": round(end, 3), "seconds": round(end - start, 3),
            "peak_db": round(e["peak_db"], 1),
            "rms_dbfs": round(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12), 1),
            "attack_ms": attack_ms(mono, sr, sa, sb)[0],
            "decay_ms": decay_ms(env, hop, e["a"], e["b"], pk_i, floor),
        }
        ev.update(spectrum_stats(mono, sr, sa, sb))
        if kind == "voice":
            tr = pitch_track(mono, sr, sa, sb)
            voiced = [t for t in tr if t[2] < 0.25 and t[1]]
            ev["voiced"] = round(len(voiced) / max(1, len(tr)), 2)
            if voiced:
                f0 = np.array([t[1] for t in voiced])
                r = np.array([t[3] for t in voiced])
                ev["f0_hz"] = round(float(np.median(f0)))
                ev["f0_range"] = [round(float(np.percentile(f0, 5))), round(float(np.percentile(f0, 95)))]
                ev["hnr_db"] = round(float(np.median(10 * np.log10(r / (1 - r)))), 1)
            run = best = 0
            for p, q in zip(tr, tr[1:]):
                ok = p[2] < 0.25 and q[2] < 0.25 and p[1] and q[1] and abs(q[1] / p[1] - 1) < 0.003
                run = run + 1 if ok else 0
                best = max(best, run)
            ev["flat_pitch_ms"] = best * 10
            ev["track"] = [[round(t[0], 2), round(t[1] or 0), round(t[2], 2)] for t in tr]
        evs.append(ev)
    major = [e for e in evs if e["peak_db"] > peak - 12]
    m["events"] = evs
    m["major_events"] = len(major)
    faults = []
    if m["silent"]:
        faults.append("silent")
    if m["clipped"] > 0:
        faults.append(f"clipped {m['clipped']}")
    if abs(m["dc"]) > 0.01:
        faults.append("dc offset")
    if m["snr_db"] < 30:
        faults.append(f"noisy floor ({m['snr_db']} dB)")
    for e in evs:
        if kind == "voice" and e.get("flat_pitch_ms", 0) >= 300:
            faults.append(f"flat pitch {e['flat_pitch_ms']} ms")
            break
        if kind != "voice" and e["steady_tone_ms"] >= 300:
            faults.append(f"steady tone {e['steady_tone_ms']} ms")
            break
    if kind == "voice" and len(major) > 1:
        faults.append(f"{len(major)} calls")
    if evs and kind in ("impact", "step") and max(e["decay_ms"] for e in evs) > 400:
        faults.append("long tail")
    m["faults"] = faults
    return m
