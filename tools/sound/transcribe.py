"""What each spoken take says: Whisper (large-v3-turbo, MIT, pinned) on the CPU, so it never waits on the GPU, writes
<work>/heard.json, {slot: {take: {"heard": text, "match": 0..1}}}. `match` compares the words of the line asked for with
the words heard, each by its letters with runs of one letter counted once ("Aaaah" is "ah"): twice the words in common
over the words in both. pick.py drops a take whose match is under its floor in a slot marked
`"words": true`; laughs, screams and gibberish are not marked, as their words cannot be checked. Words are compared
whole, so "Morning!" heard as "Warning! Ahh!" is 0, not the near match its letters make. It also finds where the line is: the voice model often
opens with a short mumble and a pause before the line, so of the cuts pick.spoken_span offers, the tightest that is
still heard saying what the whole take says is the take's "span", and pick.py cuts there.

    tools/sound/.venv/bin/python -W ignore tools/sound/transcribe.py <brief.json> [--prefix voice-pt] [--cuda]

On the CPU by default (about 15 s a take, as each take may be heard up to three times); --cuda is far quicker, and
takes the render lock (/tmp/snark-render.lock) as every GPU job does, so run it under `flock` as generate.py runs its
workers.
"""

import argparse
import json
import os
import re
import time
from difflib import SequenceMatcher
from pathlib import Path

import generate  # noqa: E402
import pick  # noqa: E402

WHISPER = {"repo": "openai/whisper-large-v3-turbo", "revision": "41f01f3fe87f28c78e2fbf8b568835947dd65ed9", "licence": "MIT"}


def words(text):
    return [w for w in (re.sub(r"(.)\1+", r"\1", re.sub(r"[^a-z]", "", t)) for t in text.lower().split()) if w]


def match(want, heard):
    a, b = words(want), words(heard)
    if not a or not b:
        return 0.0
    return round(SequenceMatcher(None, a, b, autojunk=False).ratio(), 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("--prefix", default="voice-pt")
    ap.add_argument("--cuda", action="store_true")
    a = ap.parse_args()
    if not a.cuda:
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
    brief = json.loads(Path(a.brief).read_text())
    work = generate.work_dir(brief)
    out = work / "heard.json"
    heard = json.loads(out.read_text()) if out.exists() else {}
    for takes in heard.values():  # what was heard is kept; its match is scored again, as the measure may have changed
        for h in takes.values():
            h["match"] = match(h["want"], h["heard"])

    import librosa
    import numpy as np
    import soundfile as sf
    import torch
    from huggingface_hub import snapshot_download
    from transformers import pipeline

    torch.set_num_threads(max(4, (os.cpu_count() or 8) // 2))
    path = snapshot_download(WHISPER["repo"], revision=WHISPER["revision"])
    asr = pipeline("automatic-speech-recognition", model=path, device="cuda" if a.cuda else "cpu",
                   torch_dtype=torch.float16 if a.cuda else torch.float32)
    t0, n = time.time(), 0

    def hear(x):
        return asr({"raw": np.ascontiguousarray(x), "sampling_rate": 16000}, generate_kwargs={"language": "en", "task": "transcribe"})["text"].strip()

    for slot, spec in brief["slots"].items():
        texts = {f"{a.prefix}-{p['seed'] + i}": p.get("text", "") for p in spec["prompts"] for i in range(p.get(f"takes_{a.prefix}", p.get("takes", 1)))}
        for wav in sorted((work / "takes" / slot).glob(f"{a.prefix}-*.wav")):
            take = wav.stem
            if "span" in heard.get(slot, {}).get(take, {}):
                continue
            x, rate = sf.read(str(wav), dtype="float32", always_2d=True)
            x = x.mean(axis=1)
            if rate != 16000:
                x = librosa.resample(x, orig_sr=rate, target_sr=16000)
            want = texts.get(take, "")
            text = hear(x)
            h = {"want": want, "heard": text, "match": match(want, text)}
            # The tightest cut still heard saying what the whole take says: the opening sound dropped, then kept, else
            # the whole take. Lines without words to check (laughs, screams, gibberish) keep the opening sound, and a
            # take saying the wrong words (dropped by pick.py) is not cut at all.
            whole = round(len(x) / 16000, 3)
            h["span"] = [0.0, whole]
            if not spec.get("words"):
                c = pick.spoken_span(wav)
                if c:
                    h["span"] = [round(max(0.0, c[0]), 3), round(min(whole, c[1]), 3)]
            elif h["match"] >= pick.WORDS_FLOOR:
                tried = []
                for c in (pick.spoken_span(wav, drop_opening=True), pick.spoken_span(wav)):
                    if not c:
                        continue
                    c = [round(max(0.0, c[0]), 3), round(min(whole, c[1]), 3)]
                    if c in tried:
                        continue
                    tried.append(c)
                    said = hear(x[int(c[0] * 16000):int(c[1] * 16000)])
                    if match(want, said) >= h["match"] - 0.01:
                        h["span"], h["span_heard"] = c, said
                        break
            heard.setdefault(slot, {})[take] = h
            n += 1
        out.write_text(json.dumps(heard, indent=1) + "\n")  # each slot as it is heard, so a stop loses little
    out.write_text(json.dumps(heard, indent=1) + "\n")
    print(f"{n} takes heard in {time.time() - t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
