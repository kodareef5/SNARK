"""Make candidate takes from a sound brief.

    tools/sound/.venv/bin/python tools/sound/generate.py <brief.json>... [--slot S] [--model M] [--prompt ID] [--force]

Each prompt entry in the brief makes `takes` files per model, seeds `seed`, `seed+1`, ...
Takes land in tools/sound/.work/<asset>/takes/<slot>/<model>-<seed>.wav (<model>-pt-<seed>.wav from
the torch backend) with a .json recipe beside each. Existing takes are kept unless --force. Every
model run on Linux holds the shared render lock (/tmp/snark-render.lock, flock); a Mac runs without one, a
few takes at a time, and on Linux waits until the machine has the memory free that the model needs.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import models  # noqa: E402

MAC = sys.platform == "darwin"
# The Mac runs one job at a time without a lock now; Linux shares its GPU with other jobs and keeps the render lock.
LOCK = [] if MAC else ["flock", "-w", "7200", "/tmp/snark-render.lock"]
TIME = ["/usr/bin/time", "-l" if MAC else "-v"]
CHUNK = {("stable", "mlx"): 40, ("moss", "mlx"): 4, ("moss", "torch"): 32, ("voice", "torch"): 120}


def load_brief(path):
    path = Path(path).resolve()
    brief = json.loads(path.read_text())
    brief["_dir"] = path.parent
    return brief


def work_dir(brief):
    return models.WORK / brief["asset"]


def take_stem(model, back, seed):
    return f"{model}-{seed:04d}" if back == "mlx" else f"{model}-pt-{seed:04d}"


def take_path(brief, slot, model, seed, back="mlx"):
    return work_dir(brief) / "takes" / slot / f"{take_stem(model, back, seed)}.wav"


def jobs_for(brief, slots=None, model_filter=None, prompt_ids=None, back="mlx"):
    """A brief's settings and take counts for a model are under its name for MLX and <model>-pt for torch."""
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
                settings = dict(models.spec(model, back)["defaults"])
                settings.update(p.get("settings", {}).get(model if back == "mlx" else model + "-pt", {}))
                count = p.get("takes_" + model, p["takes"])
                if back != "mlx":
                    count = p.get(f"takes_{model}-pt", count)
                for k in range(count):
                    seed = p["seed"] + k
                    key = (slot, model, seed)
                    if key in seen:
                        raise SystemExit(f"seed {seed} used twice for {slot}/{model}")
                    seen.add(key)
                    text = p.get("text_" + model, p["text"])
                    jobs.append({
                        "slot": slot,
                        "model": model,
                        "backend": back,
                        "prompt_id": p["id"],
                        "prompt": text,
                        "negative": p.get("negative_" + model, p.get("negative", "")),
                        **({"instruction": p["instruction"]} if "instruction" in p else {}),
                        "seconds": p.get("seconds_" + model, p["seconds"]),
                        "seed": seed,
                        "settings": settings,
                        "out": str(take_path(brief, slot, model, seed, back)),
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
    back = job.get("backend", "mlx")
    m = models.spec(job["model"], back)
    r = {
        "model": job["model"],
        **({} if back == "mlx" else {"backend": back}),
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
    if job["model"] == "moss" and back == "mlx":
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


def run_moss_torch(jobs):
    """Upstream MOSS-SoundEffect v2.0 in three stages: text encoder, DiT, VAE, one resident at a time.

    Same code and maths as MossSoundEffectPipeline.__call__: bf16 autocast throughout, prompt +
    " duration: N.Ns", noise from a CPU generator over the full 30 s latent, upstream's compiled
    model_fn_wan_video with CFG in fp32 and its FlowMatchScheduler, the full latent decoded under
    fp32 autocast and cut to the asked seconds. Staging, not offload: the process peaks at 7.2 GB
    of memory (17 GB holding every model) and nothing crosses the bus per take. On an RTX 4070
    Laptop (8 GB): GPU peak 5.8 GB, a take in 32 s after a first that compiles (about 100 s).
    The compiled DiT's sums vary a little between processes (max sample difference about 0.02).
    """
    import gc
    import json as _json

    import torch
    import soundfile as sf
    from safetensors.torch import load_file

    sys.path.insert(0, str(models.fetch_moss_code()))
    from moss_soundeffect_v2.diffsynth.models.dac_vae import DAC
    from moss_soundeffect_v2.diffsynth.models.qwen3_text_encoder import Qwen3TextEncoder
    from moss_soundeffect_v2.diffsynth.models.wan_audio_dit import WanAudioModel
    from moss_soundeffect_v2.diffsynth.pipelines.wan_audio import _convert_hf_dit_state_dict, model_fn_wan_video
    from moss_soundeffect_v2.diffsynth.prompters.wan_prompter import WanPrompter
    from moss_soundeffect_v2.diffsynth.schedulers.flow_match import FlowMatchScheduler

    root = models.weights_dir("moss", "torch")
    index = _json.loads((root / "model_index.json").read_text())
    sched_cfg = _json.loads((root / "scheduler" / "scheduler_config.json").read_text())
    dit_cfg = _json.loads((root / "transformer" / "config.json").read_text())
    rate, cuda, bf16 = int(index["sample_rate"]), "cuda", torch.bfloat16
    stage = {}

    def free():
        gc.collect()
        torch.cuda.empty_cache()

    def mark(name, t0):
        stage[name] = {"seconds": round(time.time() - t0, 1),
                       "gpu_peak_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2)}
        torch.cuda.reset_peak_memory_stats()
        print(f"moss-pt {name} {stage[name]}", flush=True)

    def sent(job):
        return f"{job['prompt'].strip()} duration: {round(float(job['seconds']), 1):.1f}s"

    runtime = {"torch": torch.__version__, "cuda": torch.version.cuda, "device": torch.cuda.get_device_name(0),
               "compiled": os.environ.get("TORCHDYNAMO_DISABLE") != "1"}
    with torch.no_grad(), torch.autocast("cuda", dtype=bf16):
        t0 = time.time()
        enc = Qwen3TextEncoder(str(root / "text_encoder"), torch_dtype=bf16).to(cuda)
        prompter = WanPrompter(tokenizer_path=str(root / "tokenizer"))
        prompter.fetch_models(enc)
        ctx = {}
        for job in jobs:
            for key in ((sent(job), True), (job["negative"], False)):
                if key not in ctx:
                    ctx[key] = prompter.encode_prompt(key[0], positive=key[1], device=cuda).cpu()
        del enc, prompter
        free()
        mark("text", t0)

        t0 = time.time()
        sd = _convert_hf_dit_state_dict(load_file(str(root / "transformer" / "diffusion_pytorch_model.safetensors")))
        with torch.device(cuda):
            dit = WanAudioModel(in_dim=dit_cfg["in_dim"], out_dim=dit_cfg["out_dim"], text_dim=dit_cfg["text_dim"],
                                freq_dim=dit_cfg["freq_dim"], eps=dit_cfg["eps"], patch_size=tuple(dit_cfg["patch_size"]),
                                has_image_input=dit_cfg["has_image_input"], dim=dit_cfg["dim"],
                                ffn_dim=dit_cfg["ffn_dim"], num_heads=dit_cfg["num_heads"],
                                num_layers=dit_cfg["num_layers"], vae_type=dit_cfg.get("vae_type", "dac"))
        res = dit.load_state_dict(sd)
        if res.missing_keys or res.unexpected_keys:
            raise SystemExit(f"DiT weights: missing {res.missing_keys[:3]}, unexpected {res.unexpected_keys[:3]}")
        del sd
        dit.eval()
        free()
        latents = {}
        for job in jobs:
            s = job["settings"]
            t1 = time.time()
            sched = FlowMatchScheduler(shift=sched_cfg.get("shift", 5.0), sigma_min=0.0, extra_one_step=True)
            sched.set_timesteps(s["steps"], denoising_strength=1.0, shift=s["sigma_shift"])
            hop = 960
            frames = (rate * int(s["max_seconds"])) // hop
            gen = torch.Generator("cpu").manual_seed(int(job["seed"]))
            x = torch.randn((1, dit_cfg["in_dim"], frames), generator=gen, device="cpu", dtype=torch.float32)
            x = x.to(dtype=bf16, device=cuda)
            posi, nega = ctx[(sent(job), True)].to(cuda), ctx[(job["negative"], False)].to(cuda)
            for i, ts in enumerate(sched.timesteps):
                ts = ts.unsqueeze(0).to(device=cuda)
                torch.compiler.cudagraph_mark_step_begin()
                v = model_fn_wan_video(dit=dit, latents=x, timestep=ts, context=posi)
                if s["cfg"] != 1.0:
                    v = v.clone()
                    vn = model_fn_wan_video(dit=dit, latents=x, timestep=ts, context=nega)
                    v = vn.float() + s["cfg"] * (v.float() - vn.float())
                x = sched.step(v, sched.timesteps[i], x)
            latents[job["out"]] = x.clone().cpu()
            job["_sample_seconds"] = round(time.time() - t1, 1)
            print(f"moss-pt sampled {Path(job['out']).name} {job['_sample_seconds']}s", flush=True)
        del dit, x, v
        torch.compiler.reset()
        free()
        mark("dit", t0)

        t0 = time.time()
        vae = DAC.load(str(root / "vae" / "vae_128d_48k.pth")).to(cuda)
        if vae.hop_length != hop:
            raise SystemExit(f"VAE hop {vae.hop_length}, sampling assumed {hop}")
        for job in jobs:
            out = Path(job["out"])
            out.parent.mkdir(parents=True, exist_ok=True)
            seconds = round(float(job["seconds"]), 1)
            with torch.autocast("cuda", dtype=torch.float32):
                audio = vae.decode(latents.pop(job["out"]).to(cuda))
            wav = audio[0, :, : int(rate * seconds)].float().cpu().numpy().T
            del audio
            sf.write(str(out), wav, rate, subtype="FLOAT")
            extra = {"writer": "soundfile, 32-bit float, mono, 48 kHz, the pipeline's output unchanged",
                     "prompt_sent": sent(job), "pipeline": "tools/sound/generate.py run_moss_torch",
                     "sample_seconds": job["_sample_seconds"], "runtime": runtime}
            out.with_suffix(".json").write_text(json.dumps(recipe(job, extra), indent=2) + "\n")
            print(f"moss-pt {job['slot']} {out.name}", flush=True)
        del vae
        free()
        mark("vae", t0)
    return stage


def rusage(text):
    """The peaks /usr/bin/time printed: on a Mac (-l) resident set and physical footprint (Metal buffers
    included), on Linux (-v) the resident set."""
    out = {}
    for key, name in (("max_rss_gb", "maximum resident set size"), ("peak_footprint_gb", "peak memory footprint")):
        m = re.search(r"(\d+)\s+" + name, text)
        if m:
            out[key] = round(int(m.group(1)) / 1e9, 2)
    m = re.search(r"Maximum resident set size \(kbytes\): (\d+)", text)
    if m:
        out["max_rss_gb"] = round(int(m.group(1)) * 1024 / 1e9, 2)
    return out


def mem_available_gb():
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) / 1e6
    except OSError:
        return None
    return None


def wait_for_memory(need_gb, model):
    """Linux shares this machine with other heavy jobs: start only with the memory free, so nothing swaps."""
    for _ in range(60):
        have = mem_available_gb()
        if have is None or have >= need_gb:
            return
        print(f"{model}: {have:.0f} GB free, {need_gb} GB wanted; waiting", flush=True)
        time.sleep(30)
    raise SystemExit(f"{model}: {need_gb} GB of memory never came free in 30 minutes")


def worker(jobfile):
    jobs = json.loads(Path(jobfile).read_text())
    def run_voice_torch(jobs):
        import voice
        return voice.run_voice_torch(jobs)

    by = {("stable", "mlx"): run_stable, ("moss", "mlx"): run_moss, ("moss", "torch"): run_moss_torch, ("voice", "torch"): run_voice_torch}
    stages = by[(jobs[0]["model"], jobs[0].get("backend", "mlx"))](jobs)
    if stages:
        Path(jobfile).with_suffix(".stages").write_text(json.dumps(stages))


def run_jobs(jobs):
    """Run jobs in chunks, each chunk one worker process holding the render lock, measured by time."""
    # /tmp is RAM on Linux: keep the compiler's cache and scratch on disk, and its workers few.
    env = dict(os.environ)
    env.setdefault("TORCHINDUCTOR_COMPILE_THREADS", "4")
    env.setdefault("TORCHINDUCTOR_CACHE_DIR", str(models.WORK / "inductor"))
    env.setdefault("TRITON_CACHE_DIR", str(models.WORK / "triton"))
    env.setdefault("TMPDIR", str(models.WORK / "tmp"))
    os.makedirs(env["TMPDIR"], exist_ok=True)
    for model, back in CHUNK:
        mine = [j for j in jobs if j["model"] == model and j.get("backend", "mlx") == back]
        n = CHUNK[(model, back)]
        for i in range(0, len(mine), n):
            chunk = mine[i:i + n]
            with tempfile.NamedTemporaryFile("w", suffix=".json", dir=models.WORK, delete=False) as f:
                json.dump(chunk, f)
            jobfile = Path(f.name)
            try:
                if back == "torch":
                    wait_for_memory(models.spec(model, back)["memory_gb"], model)
                t = time.time()
                py = models.spec(model, back).get("python")
                py = str(Path(__file__).resolve().parent / py) if py else sys.executable
                res = subprocess.run(LOCK + TIME + [py, str(Path(__file__).resolve()), "--worker", f.name],
                                     stderr=subprocess.PIPE, text=True, env=env)
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
    ap.add_argument("brief", nargs="*", help="one or more briefs, made in one run")
    ap.add_argument("--slot", action="append")
    ap.add_argument("--model", choices=list(models.MODELS))
    ap.add_argument("--prompt", action="append")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--worker")
    a = ap.parse_args()
    if a.worker:
        return worker(a.worker)
    back = models.backend()
    if back == "torch" and a.model not in ("moss", "voice"):
        raise SystemExit("on the torch backend moss and voice are ported: pass --model moss or --model voice")
    jobs = [j for b in a.brief for j in jobs_for(load_brief(b), a.slot, a.model, a.prompt, back)]
    if not a.force:
        jobs = [j for j in jobs if not Path(j["out"]).exists()]
    print(f"{len(jobs)} takes to make", flush=True)
    models.WORK.mkdir(parents=True, exist_ok=True)
    run_jobs(jobs)


if __name__ == "__main__":
    main()
