"""Make candidate takes from a sound brief.

    tools/sound/.venv/bin/python tools/sound/generate.py <brief.json> [--slot S] [--model M] [--prompt ID] [--force]

Each prompt entry in the brief makes `takes` files per model, seeds `seed`, `seed+1`, ...
Takes land in tools/sound/.work/<asset>/takes/<slot>/<model>-<seed>.wav with a .json recipe
beside each. Existing takes are kept unless --force. Every model run holds the shared render
lock (lockf on /tmp/snark-render.lock), a few takes at a time.
"""

import argparse
import datetime
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import models  # noqa: E402

LOCK = ["lockf", "-t", "7200", "/tmp/snark-render.lock"]
TIME = ["/usr/bin/time", "-l"]
CHUNK = {"stable": 40, "moss": 4}


def load_brief(path):
    path = Path(path).resolve()
    brief = json.loads(path.read_text())
    brief["_dir"] = path.parent
    return brief


def work_dir(brief):
    return models.WORK / brief["asset"]


def take_path(brief, slot, model, seed):
    return work_dir(brief) / "takes" / slot / f"{model}-{seed:04d}.wav"


def jobs_for(brief, slots=None, model_filter=None, prompt_ids=None):
    jobs = []
    seen = set()
    for slot, spec in brief["slots"].items():
        if slots and slot not in slots:
            continue
        for p in spec["prompts"]:
            if prompt_ids and p["id"] not in prompt_ids:
                continue
            for model in p.get("models", list(models.MODELS)):
                if model_filter and model != model_filter:
                    continue
                settings = dict(models.MODELS[model]["defaults"])
                settings.update(p.get("settings", {}).get(model, {}))
                for k in range(p.get("takes_" + model, p["takes"])):
                    seed = p["seed"] + k
                    key = (slot, model, seed)
                    if key in seen:
                        raise SystemExit(f"seed {seed} used twice for {slot}/{model}")
                    seen.add(key)
                    text = p.get("text_" + model, p["text"])
                    jobs.append({
                        "slot": slot,
                        "model": model,
                        "prompt_id": p["id"],
                        "prompt": text,
                        "negative": p.get("negative_" + model, p.get("negative", "")),
                        "seconds": p.get("seconds_" + model, p["seconds"]),
                        "seed": seed,
                        "settings": settings,
                        "out": str(take_path(brief, slot, model, seed)),
                    })
    return jobs


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def moss_notes(settings):
    out = {"pipeline": "tools/sound/generate.py run_moss: the moss_sfx_mlx components in three stages (text encoder, "
                       "DiT, VAE), one resident at a time; same maths as MossSoundEffectPipeline, with the VAE decode "
                       "cut to seconds + decode_margin (null = the full 30 s, as upstream)"}
    if settings.get("dit", "bf16") == "int4":
        d = models.MODELS["moss"]["dit_int4"]
        out["dit_weights"] = {"repo": d["repo"], "revision": d["revision"], "file": d["file"],
                              "quantisation": f"{d['bits']}-bit, group {d['group_size']}, transformer-block Linear layers"}
    return out


def recipe(job, extra):
    m = models.MODELS[job["model"]]
    r = {
        "model": job["model"],
        "model_name": m["name"],
        "repo": m["repo"],
        "revision": m["revision"],
        "code": m["code"],
        "licence": m["licence"]["name"],
        "licence_link": m["licence"]["link"],
        "slot": job["slot"],
        "prompt_id": job["prompt_id"],
        "prompt": job["prompt"],
        "negative_prompt": job["negative"],
        "seed": job["seed"],
        "seconds": job["seconds"],
        "settings": job["settings"],
        "date": datetime.date.today().isoformat(),
        "file": Path(job["out"]).name,
    }
    if "upstream" in m:
        r["upstream"] = m["upstream"]
    if job["model"] == "moss":
        r.update(moss_notes(job["settings"]))
    r.update(extra)
    r["sha256"] = sha256(job["out"])
    return r


def run_stable(jobs):
    root = models.link_stable_weights()
    py = sys.executable
    for job in jobs:
        s = job["settings"]
        out = Path(job["out"])
        out.parent.mkdir(parents=True, exist_ok=True)
        cmd = [py, str(root / "scripts" / "sa3_mlx.py"),
               "--prompt", job["prompt"], "--dit", s["dit"], "--decoder", s["decoder"],
               "--seconds", str(job["seconds"]), "--steps", str(s["steps"]), "--seed", str(job["seed"]),
               "--cfg", str(s["cfg"]), "--apg", str(s["apg"]), "--dit-dtype", s["dit_dtype"],
               "--out", str(out)]
        if job["negative"]:
            cmd += ["--negative-prompt", job["negative"]]
        t = time.time()
        res = subprocess.run(TIME + cmd, capture_output=True, text=True, cwd=root)
        wall = time.time() - t
        log = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", res.stdout + res.stderr)
        if res.returncode != 0 or not out.exists():
            print(log[-3000:], file=sys.stderr)
            raise SystemExit(f"stable failed on {out.name}")
        peak = re.search(r"peak RAM\s+([0-9.]+ [GMK]B)", log)
        extra = {"writer": "sa3_mlx.py save_wav: 16-bit PCM, stereo, 44.1 kHz, clipped to [-1, 1]",
                 "prompt_sent": job["prompt"], "wall_seconds": round(wall, 2),
                 "peak_memory": peak.group(1) if peak else None, "process": rusage(res.stderr)}
        out.with_suffix(".json").write_text(json.dumps(recipe(job, extra), indent=2) + "\n")
        print(f"stable {job['slot']} {out.name} {wall:.1f}s", flush=True)


def free():
    import gc

    import mlx.core as mx
    gc.collect()
    mx.clear_cache()


def run_moss(jobs):
    """The moss_sfx_mlx pipeline in three stages, one model resident at a time.

    Same maths as MossSoundEffectPipeline: prompt + " duration: N.Ns", noise seeded with
    mx.random.seed(seed) over the full max_seconds latent, CFG in fp32, Euler flow-match
    steps, VAE decode in fp32. Only the decode is cut to the asked seconds plus a margin
    (the decoder is convolutional) unless decode_margin is null.
    """
    import mlx.core as mx
    import mlx.nn as nn
    import numpy as np
    import soundfile as sf
    from mlx.utils import tree_unflatten
    from moss_sfx_mlx.config import DACConfig, WanAudioModelConfig
    from moss_sfx_mlx.model.dac_vae import DAC
    from moss_sfx_mlx.model.qwen3_text_encoder import Qwen3TextEncoder
    from moss_sfx_mlx.model.wan_audio_dit import WanAudioModel
    from moss_sfx_mlx.prompter import WanPrompter
    from moss_sfx_mlx.scheduler import FlowMatchScheduler

    mx.set_cache_limit(256 * 1024 ** 2)
    root = models.weights_dir("moss")
    dtype = mx.bfloat16
    rate, hop = 48000, 960
    stage = {}

    def mark(name, t0):
        stage[name] = {"seconds": round(time.time() - t0, 1), "peak_gb": round(mx.get_peak_memory() / 1e9, 2)}
        mx.reset_peak_memory()
        print(f"moss {name} {stage[name]}", flush=True)

    def sent(job):
        return f"{job['prompt'].strip()} duration: {round(float(job['seconds']), 1):.1f}s"

    t0 = time.time()
    enc = Qwen3TextEncoder(root / "text_encoder", dtype=dtype)
    prompter = WanPrompter(tokenizer_path=str(root / "tokenizer"))
    prompter.fetch_models(enc)
    ctx = {}
    for job in jobs:
        for text in (sent(job), job["negative"]):
            if text not in ctx:
                ctx[text] = prompter.encode_prompt(text).astype(dtype)
                mx.eval(ctx[text])
    del enc, prompter
    free()
    mark("text", t0)

    latents = {}
    for kind in sorted({j["settings"].get("dit", "bf16") for j in jobs}):
        t0 = time.time()
        c = WanAudioModelConfig()
        dit = WanAudioModel(dim=c.dim, in_dim=c.in_dim, ffn_dim=c.ffn_dim, out_dim=c.out_dim, text_dim=c.text_dim,
                            freq_dim=c.freq_dim, eps=c.eps, patch_size=c.patch_size, num_heads=c.num_heads,
                            num_layers=c.num_layers, has_image_input=c.has_image_input, vae_type=c.vae_type)
        if kind == "int4":
            q = models.MODELS["moss"]["dit_int4"]
            nn.quantize(dit, group_size=q["group_size"], bits=q["bits"],
                        class_predicate=lambda path, m: isinstance(m, nn.Linear) and path.startswith("blocks."))
            w = mx.load(str(models.moss_int4_dit()))
            dit.update(tree_unflatten(list(w.items())))
        else:
            w = mx.load(str(root / "mlx" / "dit.safetensors"))
            dit.update(tree_unflatten([(k, v.astype(dtype)) for k, v in w.items()]))
        del w
        mx.eval(dit.parameters())
        for job in [j for j in jobs if j["settings"].get("dit", "bf16") == kind]:
            s = job["settings"]
            t1 = time.time()
            sched = FlowMatchScheduler(shift=5.0, sigma_min=0.0, extra_one_step=True)
            sched.set_timesteps(s["steps"], shift=s["sigma_shift"])
            posi, nega = ctx[sent(job)], ctx[job["negative"]]
            mx.random.seed(int(job["seed"]))
            x = mx.random.normal((1, 128, rate * s["max_seconds"] // hop)).astype(dtype)
            for i in range(len(sched.timesteps)):
                ts = sched.timesteps[i].reshape(1)
                v = dit(x, ts, posi)
                if s["cfg"] != 1.0:
                    vn = dit(x, ts, nega)
                    v = vn.astype(mx.float32) + s["cfg"] * (v.astype(mx.float32) - vn.astype(mx.float32))
                x = sched.step(v, sched.timesteps[i], x.astype(mx.float32)).astype(dtype)
                mx.eval(x)
            latents[job["out"]] = x
            job["_sample_seconds"] = round(time.time() - t1, 1)
            print(f"moss sampled {Path(job['out']).name} {job['_sample_seconds']}s", flush=True)
        del dit
        free()
        mark(f"dit-{kind}", t0)

    t0 = time.time()
    v = DACConfig()
    vae = DAC(encoder_dim=v.encoder_dim, encoder_rates=v.encoder_rates, latent_dim=v.latent_dim,
              decoder_dim=v.decoder_dim, decoder_rates=v.decoder_rates, sample_rate=v.sample_rate,
              continuous=v.continuous)
    vw = mx.load(str(root / "mlx" / "vae.safetensors"))
    vae.update(tree_unflatten([(k, v.astype(mx.float32)) for k, v in vw.items()]))
    del vw
    for job in jobs:
        s = job["settings"]
        out = Path(job["out"])
        out.parent.mkdir(parents=True, exist_ok=True)
        seconds = round(float(job["seconds"]), 1)
        z = latents.pop(job["out"]).astype(mx.float32)
        margin = s.get("decode_margin")
        if margin is not None:
            z = z[:, :, : int(np.ceil((seconds + margin) * rate / hop))]
        audio = vae.decode(z)
        mx.eval(audio)
        wav = np.array(audio[0, :, : int(rate * seconds)].astype(mx.float32)).T
        del audio, z
        free()
        sf.write(str(out), wav, rate, subtype="FLOAT")
        extra = {"writer": "soundfile, 32-bit float, mono, 48 kHz, the pipeline's output unchanged",
                 "prompt_sent": sent(job), "sample_seconds": job["_sample_seconds"]}
        out.with_suffix(".json").write_text(json.dumps(recipe(job, extra), indent=2) + "\n")
        print(f"moss {job['slot']} {out.name}", flush=True)
    del vae
    free()
    mark("vae", t0)
    return stage


def rusage(text):
    """The peaks /usr/bin/time -l printed: resident set and physical footprint (Metal buffers included)."""
    out = {}
    for key, name in (("max_rss_gb", "maximum resident set size"), ("peak_footprint_gb", "peak memory footprint")):
        m = re.search(r"(\d+)\s+" + name, text)
        if m:
            out[key] = round(int(m.group(1)) / 1e9, 2)
    return out


def worker(jobfile):
    jobs = json.loads(Path(jobfile).read_text())
    by = {"stable": run_stable, "moss": run_moss}
    stages = by[jobs[0]["model"]](jobs)
    if stages:
        Path(jobfile).with_suffix(".stages").write_text(json.dumps(stages))


def run_jobs(jobs):
    """Run jobs in chunks, each chunk one worker process holding the render lock, measured by time -l."""
    for model in models.MODELS:
        mine = [j for j in jobs if j["model"] == model]
        for i in range(0, len(mine), CHUNK[model]):
            chunk = mine[i:i + CHUNK[model]]
            with tempfile.NamedTemporaryFile("w", suffix=".json", dir=models.WORK, delete=False) as f:
                json.dump(chunk, f)
            jobfile = Path(f.name)
            try:
                t = time.time()
                res = subprocess.run(LOCK + TIME + [sys.executable, str(Path(__file__).resolve()), "--worker", f.name],
                                     stderr=subprocess.PIPE, text=True)
                peaks = rusage(res.stderr)
                if res.returncode != 0:
                    print(res.stderr[-3000:], file=sys.stderr)
                    raise SystemExit(f"{model} worker failed")
                stages = json.loads(jobfile.with_suffix(".stages").read_text()) if jobfile.with_suffix(".stages").exists() else None
                print(f"{model} worker: {len(chunk)} takes in {time.time() - t:.0f}s, {peaks}", flush=True)
                for job in chunk:
                    side = Path(job["out"]).with_suffix(".json")
                    if side.exists() and stages is not None:
                        r = json.loads(side.read_text())
                        r["worker"] = {"takes": len(chunk), "process": peaks, "stages": stages}
                        side.write_text(json.dumps(r, indent=2) + "\n")
            finally:
                jobfile.unlink(missing_ok=True)
                jobfile.with_suffix(".stages").unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief", nargs="?")
    ap.add_argument("--slot", action="append")
    ap.add_argument("--model", choices=list(models.MODELS))
    ap.add_argument("--prompt", action="append")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--worker")
    a = ap.parse_args()
    if a.worker:
        return worker(a.worker)
    brief = load_brief(a.brief)
    jobs = jobs_for(brief, a.slot, a.model, a.prompt)
    if not a.force:
        jobs = [j for j in jobs if not Path(j["out"]).exists()]
    print(f"{len(jobs)} takes to make", flush=True)
    models.WORK.mkdir(parents=True, exist_ok=True)
    run_jobs(jobs)


if __name__ == "__main__":
    main()
