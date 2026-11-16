"""Pick the takes to accept from a brief's measured candidates, by rule, for accept.py.

    tools/sound/.venv/bin/python tools/sound/pick.py <brief.json> [--out picks.json] [--prefix moss-pt]

Needs review.py's measures (tools/sound/.work/<asset>/measures.json). For each slot:
- a slot that loops (`loop: true`) gets one long stretch of its best file, which accept.py cuts to loop seamlessly;
- a slot that keeps whole (`whole: true`) gets the start of its best file as it is;
- any other slot gets its best events: within the length its kind allows, no quieter than 30 dB under full scale nor
  15 dB under its file's loudest, from
  files that are not clipped and have no noisy floor (impacts and steps also none with a steady tone under them), one
  from each file first, loudest first, then a second from each (and a third where a slot keeps six or more). `keep` in the slot says how many (default by kind).
A slot nothing fits takes its loudest events up to 8 s long (or its prompt's length), a steady tone allowed, and
softer ones from a clean file. The picks are measured, not heard: the owner listens before anything merges.
"""

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import generate  # noqa: E402

KEEP = {"voice": 4, "impact": 4, "step": 6}
LENGTH = {"voice": (0.25, 3.0), "impact": (0.04, 3.0), "step": (0.08, 0.8)}
LOOP_LEAD = 1.5
RELAXED = 8.0
# Seconds a bed loops over: long enough that its return is not heard, short enough to keep small.
LOOP_MAX = 12.0
LOOP_TAIL = 1.75


LINE_LEAD, LINE_TAIL = 0.06, 0.2  # around a spoken line, kept with its first sound and its last


def spoken_span(wav, drop_opening=False, frame=0.02, floor_db=40.0, gap=0.35, keep_db=12.0):
    """Where a spoken line is in its take. The voice model often opens with a short quiet sound and a second or more of
    near silence before the line, or trails one after it. The take is split into sounds (20 ms frames within
    `floor_db` of its loudest, joined across pauses shorter than `gap`); the loudest sound is kept, with any other whose
    own peak is within `keep_db` of it, and the span runs from the first kept to the last. With `drop_opening`, a short
first sound a second or more before the next goes too: it is the model's opening mumble as often as a first word said
alone, so transcribe.py hears that cut before it is used. None if the take cannot be read."""
    import numpy as np
    import soundfile as sf

    try:
        x, rate = sf.read(str(wav), dtype="float32", always_2d=True)
    except Exception:
        return None
    x = x.mean(axis=1)
    h = max(1, int(rate * frame))
    n = len(x) // h
    if n == 0:
        return None
    db = 10 * np.log10(np.mean(x[: n * h].reshape(n, h) ** 2, axis=1) + 1e-12)
    top = db.max()
    on = np.flatnonzero(db > top - floor_db)
    sounds = []  # [first frame, last frame, peak dB]
    for i in on:
        if sounds and (i - sounds[-1][1]) * frame <= gap:
            sounds[-1][1] = i
            sounds[-1][2] = max(sounds[-1][2], db[i])
        else:
            sounds.append([i, i, db[i]])
    kept = [snd for snd in sounds if snd[2] >= top - keep_db]
    while drop_opening and len(kept) > 1 and (kept[0][1] - kept[0][0] + 1) * frame < 0.4 and (kept[1][0] - kept[0][1]) * frame >= 1.0:
        kept.pop(0)
    return kept[0][0] * frame - LINE_LEAD, (kept[-1][1] + 1) * frame + LINE_TAIL
WORDS_FLOOR = 0.6  # a spoken take whose letters match its line less than this (transcribe.py) says something else


def pick_slot(slot, spec, cands, heard=None, brief=None):
    kind = spec.get("kind", "voice")
    if not cands:
        return [], "no candidates"
    if spec.get("trim"):
        # A spoken line, or anything else wanted whole: each clean file from its first sound to its last, quietest
        # floor first, as many as `keep` (default every one: a library keeps its versions).
        ok = [(t, m) for t, m in cands.items() if not m.get("clipped") and m["events"] and max(e["peak_db"] for e in m["events"]) > -40]
        wrong = 0
        if spec.get("words") and heard is not None:
            # Lines with words to check keep only the takes heard saying them; a take not yet heard is kept.
            n = len(ok)
            ok = [(t, m) for t, m in ok if heard.get(t, {}).get("match", 1.0) >= spec.get("words_floor", WORDS_FLOOR)]
            wrong = n - len(ok)
        ok.sort(key=lambda kv: -kv[1].get("snr_db", 0))
        ok = ok[: spec.get("keep", len(ok))]
        out = []
        for t, m in ok:
            # Where transcribe.py heard the line said whole; else by loudness, the opening sound kept.
            span = (heard or {}).get(t, {}).get("span") or (spoken_span(generate.work_dir(brief) / "takes" / slot / f"{t}.wav") if brief else None)
            if span is None:
                span = (min(e["start"] for e in m["events"]) - 0.03, max(e["end"] for e in m["events"]) + 0.08)
            out.append({"take": t, "start": round(max(0.0, span[0]), 3), "end": round(min(m["seconds"], span[1]), 3)})
        return out, f"trimmed {len(out)} of {len(cands)}" + (f", {wrong} saying other words" if wrong else "")
    if spec.get("loop") or spec.get("whole"):
        best = max(cands.items(), key=lambda kv: (kv[1].get("snr_db", 0), -len(kv[1].get("faults", []))))
        take, m = best
        dur = m["seconds"]
        if spec.get("loop"):
            start = LOOP_LEAD if dur > 8 else 0.5
            end = min(dur - LOOP_TAIL, start + LOOP_MAX)
            return [{"take": take, "start": start, "end": round(end, 3)}], f"loop {take} {start}-{end:.1f} s"
        return [{"take": take, "start": 0.2, "end": round(min(dur, 9.0) - 0.1, 3)}], f"whole {take}"
    lo, hi = LENGTH.get(kind, LENGTH["voice"])
    longest = max((p.get("seconds", 8) for p in spec["prompts"]), default=8)
    if longest >= 10:
        # A prompt for one long event (a tree falling, a building coming down) may fill its file.
        hi = max(hi, float(longest))
    events = []
    for take, m in cands.items():
        faults = " ".join(m.get("faults", []))
        if m.get("clipped") or "noisy floor" in faults or (kind in ("impact", "step") and "steady tone" in faults):
            continue
        loudest = max((e["peak_db"] for e in m["events"]), default=-99)
        for i, e in enumerate(m["events"]):
            # A quiet fragment beside the file's real events would be levelled up to their loudness.
            if lo <= e["seconds"] <= hi and e["peak_db"] > -30 and e["peak_db"] >= loudest - 15:
                events.append((e["peak_db"], take, i, e))
    events.sort(key=lambda c: -c[0])
    n = spec.get("keep", KEEP.get(kind, 4))
    chosen, used = [], {}
    # A sound heard in a crowd wants many takes: a third from each file before the picks run out.
    for rnd in (1, 2, 3) if n >= 6 else (1, 2):
        for c in events:
            if len(chosen) >= n:
                break
            if used.get(c[1], 0) == rnd - 1 and c not in chosen:
                chosen.append(c)
                used[c[1]] = used.get(c[1], 0) + 1
    if not chosen:
        # Nothing fit the rules: the loudest events of any length up to RELAXED seconds, a steady tone allowed (a deep
        # thud reads as one), from files with no noisy floor. A roar or a fit of panting is one long event.
        loose = []
        for take, m in cands.items():
            if m.get("clipped") or "noisy floor" in " ".join(m.get("faults", [])):
                continue
            loudest = max((e["peak_db"] for e in m["events"]), default=-99)
            # A soft sound recorded clean (a bow's creak) is levelled up by the build without bringing noise with it.
            floor = -42 if m.get("snr_db", 0) >= 45 else -30
            loose += [(e["peak_db"], take, i, e) for i, e in enumerate(m["events"]) if 0.04 <= e["seconds"] <= max(RELAXED, hi) and e["peak_db"] > floor and e["peak_db"] >= loudest - 15]
        loose.sort(key=lambda c: -c[0])
        for c in loose:
            if len(chosen) >= min(n, 2):
                break
            if c[1] not in {x[1] for x in chosen}:
                chosen.append(c)
    why = "; ".join(f"{t} #{i} {e['start']:.2f}-{e['end']:.2f} {e['peak_db']} dB" for _, t, i, e in chosen) or "nothing fit"
    return [{"take": t, "event": i} for _, t, i, _ in chosen], why


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("--out")
    ap.add_argument("--prefix", default="moss-pt", help="only candidates whose name starts so")
    a = ap.parse_args()
    brief = generate.load_brief(a.brief)
    meas = json.loads((generate.work_dir(brief) / "measures.json").read_text())
    heard_file = generate.work_dir(brief) / "heard.json"
    heard = json.loads(heard_file.read_text()) if heard_file.exists() else None
    picks = {}
    for slot, spec in brief["slots"].items():
        cands = {t: m for t, m in meas.get(slot, {}).items() if t.startswith(a.prefix)}
        chosen, why = pick_slot(slot, spec, cands, None if heard is None else heard.get(slot, {}), brief)
        if chosen:
            picks[slot] = chosen
        print(f"{slot}: {why}")
    out = Path(a.out) if a.out else generate.work_dir(brief) / "picks.json"
    out.write_text(json.dumps(picks, indent=1) + "\n")
    print(f"{sum(len(v) for v in picks.values())} picks in {len(picks)} slots -> {out}")


if __name__ == "__main__":
    main()
