"""Make music tracks in layers with Stable Audio 3 on CUDA, for the music director to fade between by intensity.

    tools/sound/.venv-stable/bin/python tools/sound/music.py <music brief.json> [--track ID] [--layer NAME] [--force]

A track has a base layer made from its prompt alone, and further layers made from the base as their starting audio
(`init_audio`, with `noise` from 0 to 1 saying how far each may depart), so every layer keeps the base's tempo, bars
and key and the director can cross between them on a bar. Layers land in tools/sound/.work/<asset>/music/<track>/<layer>.wav
(stereo, 32-bit float at the model's rate) with a .json recipe beside each. Weights are pinned by revision. One
generation at a time holds the shared render lock (/tmp/snark-render.lock on Linux).
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


def full_revisions():
    """The pinned revisions as the cache holds them: the snapshot whose name starts with each short hash."""
    from huggingface_hub import scan_cache_dir

    out = {}
    for repo in scan_cache_dir().repos:
        want = REVISIONS.get(repo.repo_id)
        if not want:
            continue
        for rev in repo.revisions:
            if rev.commit_hash == want:
                out[repo.repo_id] = rev.commit_hash
    return out


def pin():
    """Every download Stable Audio makes asks for the pinned revision, never `main`."""
    import huggingface_hub
    import stable_audio_3.model_configs as mc

    revs = full_revisions()
    real = huggingface_hub.hf_hub_download

    def pinned(repo_id, filename, **kw):
        kw.setdefault("revision", revs.get(repo_id))
        return real(repo_id=repo_id, filename=filename, **kw)

    mc.hf_hub_download = pinned
    return revs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("--track", action="append")
    ap.add_argument("--layer", action="append")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    brief_path = Path(a.brief).resolve()
    brief = json.loads(brief_path.read_text())
    sys.path.insert(0, str(CODE))
    import soundfile as sf
    import torch

    revs = pin()
    from stable_audio_3 import StableAudioModel

    out_root = WORK / brief["asset"] / "music"
    # The model stays on the GPU from the first layer to the last, so the lock is held for the whole run.
    lock = open("/tmp/snark-render.lock", "w") if sys.platform != "darwin" else None
    if lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
    model = None
    for tid, track in brief["tracks"].items():
        if a.track and tid not in a.track:
            continue
        for name, layer in track["layers"].items():
            if a.layer and name not in a.layer:
                continue
            out = out_root / tid / f"{name}.wav"
            if out.exists() and not a.force:
                continue
            base = out_root / tid / f"{track['base']}.wav"
            if name != track["base"] and not base.exists():
                raise SystemExit(f"{tid}/{name} varies {track['base']}, which is not made yet")
            if model is None:
                t = time.time()
                # Halved on the CPU and then moved: loaded straight to the GPU, Medium is held in full precision
                # first and does not fit an 8 GB card.
                model = StableAudioModel.from_pretrained(track.get("model", "medium"), device="cpu", model_half=True)
                model.model.to("cuda")
                model.device = "cuda"
                print(f"model loaded in {time.time() - t:.0f}s", flush=True)
            prompt = f"{track['style']} {layer['prompt']} {track['bpm']} BPM, {track['key']}."
            kw = {}
            if name != track["base"]:
                audio, sr = sf.read(str(base), dtype="float32", always_2d=True)
                kw = {"init_audio": (sr, torch.from_numpy(audio.T.copy())), "init_noise_level": float(layer["noise"])}
            torch.cuda.reset_peak_memory_stats()
            t = time.time()
            result = model.generate(prompt=prompt, negative_prompt=track.get("negative"), duration=float(track["seconds"]), steps=int(track.get("steps", 8)), cfg_scale=float(track.get("cfg", 1.0)), seed=int(track["seed"]) + int(layer.get("seed", 0)), **kw)
            secs = time.time() - t
            wav = result[0] if result.dim() == 3 else result
            rate = int(model.model.sample_rate)
            out.parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(out), wav.float().cpu().numpy().T, rate, subtype="FLOAT")
            model_name = track.get("model", "medium")
            repo = f"stabilityai/stable-audio-3-{model_name}"
            recipe = {"track": tid, "layer": name, "model": f"Stable Audio 3 {model_name}", "repo": repo, "revision": revs.get(repo),
                      "code": {"repo": "github.com/Stability-AI/stable-audio-3", "commit": CODE_COMMIT}, "licence": LICENCE,
                      "prompt": prompt, "negative_prompt": track.get("negative"), "seconds": track["seconds"], "bpm": track["bpm"], "key": track["key"],
                      "seed": int(track["seed"]) + int(layer.get("seed", 0)), "steps": track.get("steps", 8), "cfg": track.get("cfg", 1.0),
                      "init_from": None if name == track["base"] else f"{track['base']}.wav", "init_noise_level": None if name == track["base"] else layer["noise"],
                      "rate": rate, "channels": int(wav.shape[0]), "seconds_to_make": round(secs, 1),
                      "gpu_peak_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2), "torch": torch.__version__,
                      "device": torch.cuda.get_device_name(0), "date": datetime.date.today().isoformat(),
                      "sha256": hashlib.sha256(out.read_bytes()).hexdigest()}
            out.with_suffix(".json").write_text(json.dumps(recipe, indent=2) + "\n")
            print(f"{tid}/{name}: {track['seconds']} s in {secs:.0f} s, GPU peak {recipe['gpu_peak_gb']} GB", flush=True)


if __name__ == "__main__":
    main()
