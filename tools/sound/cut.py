"""An accepted take is stored as the part of the model's output the game plays, plus a margin.

Stored as mono 24-bit PCM at the source's rate: the mean of the channels, the same mono the build
makes (tools/pack/sound.ts). From 16-bit PCM that is exact, so the build reads bit for bit what it
read from the whole file; from float it is within 2^-24 of full scale. The recipe keeps the source
file's sha256 and the cut in frames, so a remade source can be cut and compared.
"""

from pathlib import Path

import numpy as np
import soundfile as sf

MARGIN = 0.05
FULL = 1 << 23


def cut_frames(info, start, end, margin=MARGIN):
    """Frames [a, b) holding start..end seconds of the source with the margin, inside the file."""
    a = max(0, int(np.floor((start - margin) * info.samplerate)))
    b = min(info.frames, int(np.ceil((end + margin) * info.samplerate)))
    return a, b


def mono24(src, a, b):
    """Frames a..b of src as mono 24-bit integers, and the rate."""
    x, rate = sf.read(str(src), start=a, stop=b, dtype="float64", always_2d=True)
    m = x.mean(axis=1)
    return np.clip(np.round(m * FULL), -FULL, FULL - 1).astype(np.int32), rate


def write24(dst, q, rate):
    # soundfile scales floats by 2^23 - 1; int32 holding the 24-bit value in its top bits is stored as is
    sf.write(str(dst), (q << 8).astype(np.int32), rate, subtype="PCM_24", format="WAV")


def read24(path):
    x, rate = sf.read(str(path), dtype="int32", always_2d=True)
    return x[:, 0] >> 8, rate


def write_cut(src, dst, start, end):
    """Write the cut of src around start..end seconds to dst; return the recipe's "cut" and the new bounds."""
    info = sf.info(str(src))
    a, b = cut_frames(info, start, end)
    q, rate = mono24(src, a, b)
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    write24(dst, q, rate)
    cut = {"source_file": Path(src).name, "source_frames": info.frames, "source_channels": info.channels,
           "source_subtype": info.subtype, "frames": [a, b], "rate": rate, "stored_as": "mono PCM_24",
           "margin_seconds": MARGIN}
    return cut, round(start - a / rate, 3), round(end - a / rate, 3)


def write_loop(src, dst, start, end, xfade=0.75):
    """Cut start..end seconds of src to loop seamlessly: the stretch after `end` is crossfaded into its head, equal power."""
    info = sf.info(str(src))
    a = max(0, int(round(start * info.samplerate)))
    n = int(round(xfade * info.samplerate))
    b = min(info.frames - n, int(round(end * info.samplerate)))
    if b - a < 4 * n:
        raise SystemExit(f"{src}: {start}-{end} s is too short to loop with a {xfade} s crossfade")
    x, rate = sf.read(str(src), start=a, stop=b + n, dtype="float64", always_2d=True)
    m = x.mean(axis=1)
    body = m[: b - a].copy()
    t = (np.arange(n) + 0.5) / n
    body[:n] = body[:n] * np.sin(t * np.pi / 2) + m[b - a:] * np.cos(t * np.pi / 2)
    q = np.clip(np.round(body * FULL), -FULL, FULL - 1).astype(np.int32)
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    write24(dst, q, rate)
    cut = {"source_file": Path(src).name, "source_frames": info.frames, "source_channels": info.channels,
           "source_subtype": info.subtype, "frames": [a, b], "rate": rate, "stored_as": "mono PCM_24",
           "loop_crossfade_frames": n}
    return cut, 0.0, round((b - a) / rate, 3)


def same_cut(made_source, kept, cut):
    """Whether a remade source, cut as the recipe says, holds the kept file's samples; and how far apart."""
    a, b = cut["frames"]
    if "loop_crossfade_frames" in cut:
        tmp = Path(made_source).with_suffix(".loop.wav")
        write_loop(made_source, tmp, a / cut["rate"], b / cut["rate"], cut["loop_crossfade_frames"] / cut["rate"])
        y, _ = read24(tmp)
        tmp.unlink(missing_ok=True)
    else:
        y, _ = mono24(made_source, a, b)
    k, _ = read24(kept)
    if y.shape != k.shape:
        return False, {"same_shape": False}
    d = int(np.abs(y.astype(np.int64) - k).max())
    corr = float(np.corrcoef(y, k)[0, 1]) if y.std() > 0 and k.std() > 0 else 0.0
    return d == 0, {"same_shape": True, "max_abs": d / FULL, "corr": round(corr, 6)}
