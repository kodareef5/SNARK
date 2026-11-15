"""Measure every candidate take of a brief and draw contact sheets of their spectrograms.

    tools/sound/.venv/bin/python tools/sound/review.py <brief.json> [--slot S] [--accepted-only] [--out DIR]

Writes tools/sound/.work/<asset>/measures.json, and one sheet per slot into the brief's
review folder. Takes listed in the asset's sounds.json are framed green with their bounds.
"""

import argparse
import io
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import generate  # noqa: E402
import measure  # noqa: E402


def mel_filters(sr, n_fft, n_mels=96, fmin=40.0, fmax=16000.0):
    fmax = min(fmax, sr / 2)
    mel = lambda f: 2595 * np.log10(1 + f / 700)
    hz = lambda m: 700 * (10 ** (m / 2595) - 1)
    pts = hz(np.linspace(mel(fmin), mel(fmax), n_mels + 2))
    f = np.fft.rfftfreq(n_fft, 1 / sr)
    fb = np.zeros((n_mels, len(f)))
    for i in range(n_mels):
        lo, c, hi = pts[i], pts[i + 1], pts[i + 2]
        fb[i] = np.clip(np.minimum((f - lo) / (c - lo), (hi - f) / (hi - c)), 0, None)
    return fb, pts[1:-1]


def melspec(mono, sr):
    n, hop = 1024, 256
    if len(mono) < n:
        mono = np.pad(mono, (0, n - len(mono)))
    frames = 1 + (len(mono) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    S = np.abs(np.fft.rfft(mono[idx] * np.hanning(n), axis=1)) ** 2
    fb, centres = mel_filters(sr, n)
    M = 10 * np.log10(S @ fb.T + 1e-12)
    return M.T, hop / sr, centres


def accepted_map(brief):
    p = brief["_dir"] / "sounds.json"
    if not p.exists():
        return {}
    out = {}
    for slot, spec in json.loads(p.read_text())["sounds"].items():
        for t in spec["takes"]:
            out.setdefault((slot, Path(t["file"]).stem), []).append((t["start"], t["end"]))
    return out


def slot_kind(brief, slot):
    return brief["slots"][slot].get("kind", "voice")


def candidates(brief, slot):
    d = generate.work_dir(brief) / "takes" / slot
    return sorted(d.glob("*.wav")) if d.exists() else []


def summary(m, kind):
    evs = m["events"]
    if not evs:
        return "silent"
    e = max(evs, key=lambda e: e["peak_db"])
    s = f"{e['seconds']:.2f}s  rms {e['rms_dbfs']:.0f}  atk {e['attack_ms']:.0f}ms  cen {e['centroid_hz']}"
    if kind == "voice" and e.get("f0_hz"):
        s += f"\nf0 {e['f0_hz']} ({e['f0_range'][0]}-{e['f0_range'][1]})  hnr {e.get('hnr_db', 0):.0f}  v {e['voiced']:.2f}"
    else:
        s += f"\nflat {e['flatness']:.2f}  dec {e['decay_ms']}ms  n {len(evs)}"
    return s


def sheet(brief, slot, takes, meas, acc, out, accepted_only=False):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image

    if accepted_only:
        takes = [t for t in takes if (slot, t.stem) in acc]
    if not takes:
        return
    kind = slot_kind(brief, slot)
    cols = 4
    rows = (len(takes) + cols - 1) // cols
    fig = plt.figure(figsize=(cols * 3.3, rows * 2.25), dpi=68)
    fig.suptitle(f"{brief['asset']}  {slot}  ({len(takes)} takes; green = accepted)", fontsize=10, x=0.01, ha="left")
    for i, t in enumerate(takes):
        x, sr = measure.load(t)
        mono = x.mean(axis=1)
        M, hop, centres = melspec(mono, sr)
        ax = fig.add_subplot(rows, cols, i + 1)
        top = M.max()
        ax.imshow(M, origin="lower", aspect="auto", cmap="magma", vmin=top - 80, vmax=top,
                  extent=[0, M.shape[1] * hop, 0, M.shape[0]])
        ticks = [100, 300, 1000, 3000, 10000]
        ax.set_yticks([np.searchsorted(centres, f) for f in ticks if f < centres[-1]])
        ax.set_yticklabels([("%dk" % (f // 1000)) if f >= 1000 else str(f) for f in ticks if f < centres[-1]], fontsize=6)
        ax.tick_params(axis="x", labelsize=6)
        env = 20 * np.log10(np.abs(mono[::max(1, len(mono) // 2000)]) + 1e-6)
        tt = np.linspace(0, len(mono) / sr, len(env))
        ax.plot(tt, (np.clip(env, -60, 0) + 60) / 60 * M.shape[0] * 0.3, color="white", lw=0.4, alpha=0.6)
        m = meas.get(t.stem)
        rec = json.loads(t.with_suffix(".json").read_text()) if t.with_suffix(".json").exists() else {}
        label = f"{t.stem}  {rec.get('prompt_id', '')}"
        ax.set_title(label, fontsize=7, loc="left", pad=2)
        if m:
            for e in m["events"]:
                ax.axvspan(e["start"], e["end"], ymin=0.97, ymax=1.0, color="cyan", alpha=0.8)
            ax.text(0.01, 0.97, summary(m, kind), transform=ax.transAxes, fontsize=5.5, va="top",
                    color="white", family="monospace")
            if m["faults"]:
                ax.text(0.99, 0.03, ", ".join(m["faults"]), transform=ax.transAxes, fontsize=5.5,
                        ha="right", va="bottom", color="#ff6060")
        bounds = acc.get((slot, t.stem))
        if bounds:
            for s, e in bounds:
                ax.axvline(s, color="#40ff40", lw=1.2)
                ax.axvline(e, color="#40ff40", lw=1.2, ls="--")
            for sp in ax.spines.values():
                sp.set_edgecolor("#20d020")
                sp.set_linewidth(3)
    fig.tight_layout(rect=[0, 0, 1, 0.98], pad=0.4)
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    img = Image.open(buf).convert("RGB").quantize(colors=48, method=Image.Quantize.MEDIANCUT)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)


def voices(brief, allm, acc, out):
    """Every voiced take on two maps, so calm and frightened can be seen to sit apart."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    slots = [s for s in brief["slots"] if slot_kind(brief, s) == "voice"]
    colours = ["#2a9d8f", "#e63946", "#f4a261", "#457b9d", "#8d5fd3"]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.6), dpi=80)
    for c, slot in zip(colours, slots):
        for stem, m in allm.get(slot, {}).items():
            if not m["events"]:
                continue
            bounds = acc.get((slot, stem))
            if bounds:
                s0, e0 = bounds[0]
                e = min(m["events"], key=lambda e: abs(e["start"] - s0) + abs(e["end"] - e0))
            else:
                e = max(m["events"], key=lambda e: e["peak_db"])
            mk = "o" if stem.startswith("stable") else "s"
            kw = dict(color=c, s=46 if bounds else 16, marker=mk, alpha=1.0 if bounds else 0.35,
                      edgecolors="black" if bounds else "none", linewidths=0.8)
            a1.scatter(e["centroid_hz"], e.get("f0_hz") or 50, **kw)
            a2.scatter(e["attack_ms"], e["peak_db"] - m["floor_db"], **kw)
        a1.scatter([], [], color=c, label=slot)
    a1.scatter([], [], color="grey", marker="o", label="stable")
    a1.scatter([], [], color="grey", marker="s", label="moss")
    a1.set_xscale("log"); a1.set_yscale("log")
    a1.set_xlabel("spectral centroid, Hz"); a1.set_ylabel("median pitch, Hz (50 = unvoiced)")
    a2.set_xscale("log")
    a2.set_xlabel("attack, ms"); a2.set_ylabel("peak above noise floor, dB")
    a1.legend(fontsize=7)
    fig.suptitle(f"{brief['asset']} voices: big outlined = accepted, faint = rejected", fontsize=9)
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


def detail(brief, slot, stems, out):
    """A close look at a few takes: waveform, linear spectrogram to 8 kHz, pitch track."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    kind = slot_kind(brief, slot)
    fig, axes = plt.subplots(len(stems), 1, figsize=(12, 3.2 * len(stems)), dpi=80, squeeze=False)
    for ax, stem in zip(axes[:, 0], stems):
        t = generate.work_dir(brief) / "takes" / slot / f"{stem}.wav"
        x, sr = measure.load(t)
        mono = x.mean(axis=1)
        n, hop = 2048, 128
        frames = 1 + (len(mono) - n) // hop
        idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
        S = 10 * np.log10(np.abs(np.fft.rfft(mono[idx] * np.hanning(n), axis=1)) ** 2 + 1e-12).T
        fmax = 4000 if kind == "voice" else 12000
        kmax = int(fmax / (sr / n))
        top = S.max()
        ax.imshow(S[:kmax], origin="lower", aspect="auto", cmap="magma", vmin=top - 90, vmax=top,
                  extent=[0, frames * hop / sr, 0, fmax])
        tt = np.arange(len(mono)) / sr
        ax.plot(tt[::20], fmax * (0.85 + mono[::20] / (np.abs(mono).max() + 1e-9) * 0.13), color="cyan", lw=0.3)
        m = measure.measure(t, kind)
        for k, e in enumerate(m["events"]):
            ax.axvspan(e["start"], e["end"], ymin=0.0, ymax=0.04, color="cyan" if k % 2 else "white", alpha=0.9)
            ax.text(e["start"], fmax * 0.05, str(k), color="white", fontsize=7)
        if kind == "voice":
            for e in m["events"]:
                tr = [p for p in e.get("track", []) if p[2] < 0.25 and p[1]]
                if tr:
                    ax.plot([e["start"] + p[0] for p in tr], [p[1] for p in tr], "o", ms=1.5, color="#40ff40")
        ax.set_title(f"{slot} {stem}", fontsize=9, loc="left")
        ax.set_ylabel("Hz")
    fig.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out)
    plt.close(fig)
    print(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("--slot", action="append")
    ap.add_argument("--no-sheets", action="store_true")
    ap.add_argument("--detail", nargs="+", help="slot then take names: close-up into the work folder")
    ap.add_argument("--out", help="folder for the sheets instead of the brief's review folder, which holds the "
                                  "committed sheets of every candidate; a machine without them should write elsewhere")
    a = ap.parse_args()
    brief = generate.load_brief(a.brief)
    if a.detail:
        slot, stems = a.detail[0], a.detail[1:]
        name = slot.replace("/", "-") + "_" + "_".join(stems)
        return detail(brief, slot, stems, generate.work_dir(brief) / "detail" / f"{name[:80]}.png")
    mpath = generate.work_dir(brief) / "measures.json"
    allm = json.loads(mpath.read_text()) if mpath.exists() else {}
    acc = accepted_map(brief)
    review = Path(a.out).resolve() if a.out else (brief["_dir"] / brief["review"]).resolve()
    review.mkdir(parents=True, exist_ok=True)
    for slot in brief["slots"]:
        if a.slot and slot not in a.slot:
            continue
        kind = slot_kind(brief, slot)
        takes = candidates(brief, slot)
        meas = allm.setdefault(slot, {})
        for t in takes:
            key = t.stem
            stamp = t.stat().st_mtime
            if key not in meas or meas[key].get("_mtime") != stamp or meas[key].get("_v") != measure.VERSION:
                meas[key] = measure.measure(t, kind)
                meas[key]["_mtime"] = stamp
                meas[key]["_v"] = measure.VERSION
        for k in [k for k in meas if not (generate.work_dir(brief) / "takes" / slot / f"{k}.wav").exists()]:
            del meas[k]
        mpath.write_text(json.dumps(allm, indent=1))
        if not a.no_sheets:
            sheet(brief, slot, takes, meas, acc, review / f"{slot.replace('/', '-')}.png")
        print(f"{slot}: {len(takes)} takes measured", flush=True)
    if not a.no_sheets:
        voices(brief, allm, acc, review / "voices.png")


if __name__ == "__main__":
    main()
