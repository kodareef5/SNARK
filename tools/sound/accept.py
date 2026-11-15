"""Turn picked candidates into an asset's accepted takes, sounds.json and recipes.json.

    tools/sound/.venv/bin/python tools/sound/accept.py <brief.json> <picks.json>

picks.json: {"call": [{"take": "stable-0007"}, {"take": "moss-0031", "event": 1},
                      {"take": "moss-0040", "start": 0.10, "end": 1.30}], ...}
Without start/end a pick takes the bounds review.py measured for its event (default: the loudest).
Takes are copied byte for byte; files under takes/ that no pick names are removed.
"""

import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import generate  # noqa: E402


def main():
    brief = generate.load_brief(sys.argv[1])
    picks = json.loads(Path(sys.argv[2]).read_text())
    meas = json.loads((generate.work_dir(brief) / "measures.json").read_text())
    home = brief["_dir"]
    sounds, recipes, keep = {}, {}, set()
    for slot, spec in brief["slots"].items():
        if slot not in picks:
            continue
        entries = []
        for p in picks[slot]:
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
            rel = f"takes/{slot}/{p['take']}.wav"
            dst = home / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            if not dst.exists() or generate.sha256(dst) != rec["sha256"]:
                shutil.copyfile(src, dst)
            keep.add(dst.resolve())
            recipes[rel] = rec
            entries.append({"file": rel, "from": rec["model"], "start": round(start, 3), "end": round(end, 3)})
        sounds[slot] = {"range": spec["range"], "level": spec["level"], "vary": spec["vary"], "takes": entries}
    for f in (home / "takes").rglob("*.wav"):
        if f.resolve() not in keep:
            f.unlink()
    for d in sorted((home / "takes").rglob("*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    lines = ['{', '  "sounds": {']
    for n, (slot, s) in enumerate(sounds.items()):
        lines.append(f'    "{slot}": {{')
        lines.append(f'      "range": {s["range"]}, "level": {s["level"]}, "vary": {s["vary"]},')
        lines.append('      "takes": [')
        takes = [f'        {json.dumps(t)}' for t in s["takes"]]
        lines.append(",\n".join(takes))
        lines.append('      ]')
        lines.append('    }' + ("," if n + 1 < len(sounds) else ""))
    lines += ['  }', '}']
    text = "\n".join(lines) + "\n"
    assert json.loads(text) == {"sounds": sounds}
    (home / "sounds.json").write_text(text)
    (home / "recipes.json").write_text(json.dumps({"takes": recipes}, indent=2) + "\n")
    n = sum(len(s["takes"]) for s in sounds.values())
    print(f"{n} takes accepted in {len(sounds)} slots")


if __name__ == "__main__":
    main()
