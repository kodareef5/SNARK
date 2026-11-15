"""Turn picked candidates into an asset's accepted takes, sounds.json and recipes.json.

    tools/sound/.venv/bin/python tools/sound/accept.py <brief.json> <picks.json> [--replace]
    tools/sound/.venv/bin/python tools/sound/accept.py <brief.json> --compact

picks.json: {"call": [{"take": "stable-0007"}, {"take": "moss-0031", "event": 1},
                      {"take": "moss-0040", "start": 0.10, "end": 1.30}], ...}
Without start/end a pick takes the bounds review.py measured for its event (default: the loudest).
Each pick is stored as its cut (cut.py): takes/<slot>/<take>-<start ms>.wav. Picks are added to the
takes already accepted; --replace starts the picked slots afresh. --compact cuts every accepted
take still stored whole. Files under takes/ that no take names are removed.
"""

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cut  # noqa: E402
import generate  # noqa: E402


def write_sounds(home, sounds):
    lines = ['{', '  "sounds": {']
    for n, (slot, s) in enumerate(sounds.items()):
        lines.append(f'    "{slot}": {{')
        lines.append(f'      "range": {s["range"]}, "level": {s["level"]}, "vary": {s["vary"]},')
        lines.append('      "takes": [')
        lines.append(",\n".join(f'        {json.dumps(t)}' for t in s["takes"]))
        lines.append('      ]')
        lines.append('    }' + ("," if n + 1 < len(sounds) else ""))
    lines += ['  }', '}']
    text = "\n".join(lines) + "\n"
    assert json.loads(text) == {"sounds": sounds}
    (home / "sounds.json").write_text(text)


def store(home, slot, src, rec, start, end):
    """Cut src into the asset; return its sounds.json entry and its recipe."""
    rel = f"takes/{slot}/{Path(rec['file']).stem}-{int(round(start * 1000)):05d}.wav"
    c, s, e = cut.write_cut(src, home / rel, start, end)
    r = dict(rec)
    r["source_sha256"] = rec.get("source_sha256", rec["sha256"])
    r["cut"] = c
    r["sha256"] = generate.sha256(home / rel)
    return rel, {"file": rel, "from": rec["model"], "start": s, "end": e}, r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("picks", nargs="?")
    ap.add_argument("--replace", action="store_true")
    ap.add_argument("--compact", action="store_true")
    a = ap.parse_args()
    brief = generate.load_brief(a.brief)
    home = brief["_dir"]
    old_sounds = json.loads((home / "sounds.json").read_text())["sounds"] if (home / "sounds.json").exists() else {}
    recipes = json.loads((home / "recipes.json").read_text())["takes"] if (home / "recipes.json").exists() else {}
    picks = json.loads(Path(a.picks).read_text()) if a.picks else {}
    meas = {}
    if picks:
        meas = json.loads((generate.work_dir(brief) / "measures.json").read_text())

    sounds, keep_recipes = {}, {}
    for slot, spec in brief["slots"].items():
        entries = [] if (a.replace and slot in picks) else list(old_sounds.get(slot, {}).get("takes", []))
        if a.compact:
            done = []
            for t in entries:
                r = recipes[t["file"]]
                if "cut" in r:
                    done.append(t)
                    continue
                rel, entry, rr = store(home, slot, home / t["file"], r, t["start"], t["end"])
                keep_recipes[rel] = rr
                done.append(entry)
            entries = done
        for p in picks.get(slot, []):
            src = generate.work_dir(brief) / "takes" / slot / f"{p['take']}.wav"
            rec = json.loads(src.with_suffix(".json").read_text())
            if generate.sha256(src) != rec["sha256"]:
                raise SystemExit(f"{src} does not match its recipe")
            if "start" in p:
                start, end = p["start"], p["end"]
            else:
                evs = meas[slot][p["take"]]["events"]
                e = evs[p["event"]] if "event" in p else max(evs, key=lambda e: e["peak_db"])
                start, end = e["start"], e["end"]
            rel, entry, rr = store(home, slot, src, rec, start, end)
            if any(t["file"] == rel for t in entries):
                raise SystemExit(f"{rel} is accepted already")
            keep_recipes[rel] = rr
            entries.append(entry)
        if entries:
            sounds[slot] = {"range": spec["range"], "level": spec["level"], "vary": spec["vary"], "takes": entries}
            for t in entries:
                keep_recipes.setdefault(t["file"], recipes.get(t["file"]))

    named = {(home / t["file"]).resolve() for s in sounds.values() for t in s["takes"]}
    for f in (home / "takes").rglob("*.wav"):
        if f.resolve() not in named:
            f.unlink()
    for d in sorted((home / "takes").rglob("*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    write_sounds(home, sounds)
    out = {rel: keep_recipes[rel] for s in sounds.values() for rel in dict.fromkeys(t["file"] for t in s["takes"])}
    (home / "recipes.json").write_text(json.dumps({"takes": out}, indent=2) + "\n")
    n = sum(len(s["takes"]) for s in sounds.values())
    print(f"{n} takes accepted in {len(sounds)} slots")


if __name__ == "__main__":
    main()
