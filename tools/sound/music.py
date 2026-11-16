"""Make music tracks in layers with Stable Audio 3 on CUDA, for the music director to fade between by intensity.

    tools/sound/.venv-stable/bin/python tools/sound/music.py <music brief.json> [--track ID] [--layer NAME] [--force]

A track's base layer is made from its prompt, or from another track's chosen layer (`from`, with `from_noise`), so
that tracks share a theme. Its further layers are made from its chosen base as their starting audio (`init_audio`,
with `noise` from 0 to 1 saying how far each may depart), so every layer keeps the base's tempo, bars and key and the
director can cross between them on a bar. Each layer is made `candidates` times (seeds apart) as <layer>@<k>.wav;
music_pick.py measures them and copies the one it keeps to <layer>.wav. A layer whose source is not chosen yet waits
for the next run. Files go to tools/sound/.work/<asset>/music/<track>/ (stereo 32-bit float at the model's rate) with
a .json recipe beside each. Weights are pinned by revision. A run holds the shared render lock (/tmp/snark-render.lock
on Linux) from loading the model to its last layer.
"""

import argparse
import datetime
import fcntl
import hashlib
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / ".work"
CODE_COMMIT = "790793b89ddceea612be9ce42ff6830d18f6fa57"
CODE = WORK / "src" / f"stable-audio-3-{CODE_COMMIT}"
REVISIONS = {
    "stabilityai/stable-audio-3-medium": "d4d3579395a8ac0df4ab13b5b1d7138ce7290f81",
    "stabilityai/stable-audio-3-small-music": "8bdfb53c6b0fbc62113cd571fd37373efe15fa14",
    "stabilityai/stable-audio-3-small-sfx": "05ca3857881c94a2b84026b1111c537d78f5f9f0",
}
LICENCE = {"name": "Stability AI Community License", "terms": "free under US$1M annual revenue, commercial users register with Stability AI; outputs are ours; not for training other foundation models"}
NEGATIVE = "fade out, ending, silence, gaps, dropouts, lo-fi, pop, happy, major key, vocals with lyrics, singing words"


def pin():
    """Every download Stable Audio makes asks for the pinned revision, never `main`."""
    import huggingface_hub
    import stable_audio_3.model_configs as mc

    real = huggingface_hub.hf_hub_download

    def pinned(repo_id, filename, **kw):
        kw.setdefault("revision", REVISIONS.get(repo_id))
        return real(repo_id=repo_id, filename=filename, **kw)

    mc.hf_hub_download = pinned


def music_dir(brief):
    return WORK / brief["asset"] / "music"


def source_of(brief, tid, name):
    """The chosen file a layer is made from, and how far it may depart; (None, None) for a base from its prompt alone."""
    track = brief["tracks"][tid]
    layer = track["layers"][name]
    if name != track["base"]:
        return music_dir(brief) / tid / f"{track['base']}.wav", layer["noise"]
    if "from" in track:
        other, other_layer = track["from"].split("/")
        return music_dir(brief) / other / f"{other_layer}.wav", track["from_noise"]
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("--track", action="append")
    ap.add_argument("--layer", action="append")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    brief = json.loads(Path(a.brief).resolve().read_text())
    sys.path.insert(0, str(CODE))
    import soundfile as sf
    import torch

    pin()
    from stable_audio_3 import StableAudioModel

    jobs = []
    for tid, track in brief["tracks"].items():
        if a.track and tid not in a.track:
            continue
        for name, layer in track["layers"].items():
            if a.layer and name not in a.layer:
                continue
            src, noise = source_of(brief, tid, name)
            if src is not None and not src.exists():
                print(f"{tid}/{name}: waits for {src.parent.name}/{src.stem} to be chosen", flush=True)
                continue
            for k in range(1, int(layer.get("candidates", track.get("candidates", 3))) + 1):
                out = music_dir(brief) / tid / f"{name}@{k}.wav"
                if out.exists() and not a.force:
                    continue
                jobs.append((tid, track, name, layer, k, out, src, noise))
    print(f"{len(jobs)} layers to make", flush=True)
    if not jobs:
        return
    # The model stays on the GPU from the first layer to the last, so the lock is held for the whole run.
    lock = open("/tmp/snark-render.lock", "w") if sys.platform != "darwin" else None
    if lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
    models = {}
    for tid, track, name, layer, k, out, src, noise in jobs:
        which = track.get("model", "medium")
        if which not in models:
            models.clear()
            torch.cuda.empty_cache()
            t = time.time()
            # Halved on the CPU and then moved: loaded straight to the GPU, Medium is held in full precision first
            # and does not fit an 8 GB card.
            m = StableAudioModel.from_pretrained(which, device="cpu", model_half=True)
            m.model.to("cuda")
            m.device = "cuda"
            models[which] = m
            print(f"{which} loaded in {time.time() - t:.0f}s", flush=True)
        model = models[which]
        prompt = f"{track['style']} {layer['prompt']} {track['bpm']} BPM, {track['key']}."
        seed = int(track["seed"]) + 100 * int(layer.get("seed", 0)) + k
        kw = {}
        if src is not None:
            audio, sr = sf.read(str(src), dtype="float32", always_2d=True)
            kw = {"init_audio": (sr, torch.from_numpy(audio.T.copy())), "init_noise_level": float(noise)}
        torch.cuda.reset_peak_memory_stats()
        t = time.time()
        result = model.generate(prompt=prompt, negative_prompt=track.get("negative", NEGATIVE), duration=float(track["seconds"]),
                                steps=int(track.get("steps", 8)), cfg_scale=float(track.get("cfg", 1.0)), seed=seed, **kw)
        secs = time.time() - t
        wav = result[0] if result.dim() == 3 else result
        rate = int(model.model.sample_rate)
        out.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out), wav.float().cpu().numpy().T, rate, subtype="FLOAT")
        repo = f"stabilityai/stable-audio-3-{which}"
        recipe = {"track": tid, "layer": name, "candidate": k, "model": f"Stable Audio 3 {which}", "repo": repo, "revision": REVISIONS.get(repo),
                  "code": {"repo": "github.com/Stability-AI/stable-audio-3", "commit": CODE_COMMIT}, "licence": LICENCE,
                  "prompt": prompt, "negative_prompt": track.get("negative", NEGATIVE), "seconds": track["seconds"], "bpm": track["bpm"],
                  "key": track["key"], "seed": seed, "steps": track.get("steps", 8), "cfg": track.get("cfg", 1.0),
                  "init_from": None if src is None else f"{src.parent.name}/{src.name}", "init_noise_level": noise,
                  "rate": rate, "channels": int(wav.shape[0]), "seconds_to_make": round(secs, 1),
                  "gpu_peak_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2), "torch": torch.__version__,
                  "device": torch.cuda.get_device_name(0), "date": datetime.date.today().isoformat(),
                  "sha256": hashlib.sha256(out.read_bytes()).hexdigest()}
        out.with_suffix(".json").write_text(json.dumps(recipe, indent=2) + "\n")
        print(f"{tid}/{name}@{k}: {track['seconds']} s in {secs:.0f} s", flush=True)


if __name__ == "__main__":
    main()
