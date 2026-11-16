"""Spoken lines from MOSS-VoiceGenerator: a voice designed from a description (an accent, an age, a mood), saying a
line, with no reference recording. generate.py runs it as the model "voice" on the torch backend, a chunk at a time
in a worker that holds the render lock, in the Stable venv (`.venv-stable`, transformers 5), which its code needs:

    tools/sound/.venv/bin/python -W ignore tools/sound/generate.py <brief.json> --model voice

A prompt for it gives `text` (the line) and `instruction` (the voice). Staged to fit 8 GB: every line's codes are
sampled with the language model on the GPU and the codec on the CPU, then the language model goes and the codec
decodes on the GPU. Each take is seeded (torch.manual_seed) before it samples. The model's own code is the pinned
snapshot's (trust_remote_code from the local snapshot only).
"""

import gc
import json
import time
import types
from pathlib import Path

import models

VOICE = models.MODELS["voice"]["torch"]
FRAMES_PER_SECOND = 12.5  # the codec: 24 kHz, 1920 samples a frame


def parse_audio_codes(self, start_length, audio_codes):
    """The snapshot's MossTTSDelayProcessor._parse_audio_codes, with its split mended: it hands torch.split the indices
    where segments break, where torch.split wants each segment's length, so a line whose codes hold a pad gap (two
    segments or more) fails. The rest is as written there."""
    import torch

    audio_codes = self.apply_de_delay_pattern(audio_codes)
    non_pad = ~(audio_codes == self.model_config.audio_pad_code).all(dim=1)
    if not non_pad.any():
        return []
    idx = torch.nonzero(non_pad).squeeze(1)
    breaks = (torch.where(idx[1:] != idx[:-1] + 1)[0] + 1).tolist()
    sizes = [b - a for a, b in zip([0] + breaks, breaks + [len(idx)])]
    codes_list = [audio_codes[s] for s in torch.split(idx, sizes)]
    decoded = [d for c in codes_list for d in self.decode_audio_codes([c])]  # one at a time: the codec streams batches of one
    if start_length > 0 and codes_list and decoded:
        first = codes_list[0].shape[0]
        if first > 0:
            ratio = max(0.0, min(float(start_length) / float(first), 1.0))
            if ratio >= 1.0:
                decoded = decoded[1:]
            elif ratio > 0.0:
                decoded[0] = decoded[0][..., int(decoded[0].shape[-1] * ratio):]
    return decoded


def run_voice_torch(jobs):
    import numpy as np
    import soundfile as sf
    import torch
    from huggingface_hub import snapshot_download
    from transformers import AutoConfig, AutoModel, AutoTokenizer
    from transformers.dynamic_module_utils import get_class_from_dynamic_module

    import generate

    torch.backends.cuda.enable_cudnn_sdp(False)
    cuda = torch.device("cuda")
    vg = snapshot_download(VOICE["repo"], revision=VOICE["revision"])
    codec = snapshot_download(VOICE["codec"]["repo"], revision=VOICE["codec"]["revision"])
    stage = {}

    def free():
        gc.collect()
        torch.cuda.empty_cache()

    def mark(name, t0):
        stage[name] = {"seconds": round(time.time() - t0, 1), "gpu_peak_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2)}
        torch.cuda.reset_peak_memory_stats()
        print(f"voice {name} {stage[name]}", flush=True)

    runtime = {"torch": torch.__version__, "cuda": torch.version.cuda, "device": torch.cuda.get_device_name(0)}
    t0 = time.time()
    # Built from its parts: AutoProcessor in transformers 5 hands the processor's own __init__ a `revision` it refuses.
    Processor = get_class_from_dynamic_module("processing_moss_tts.MossTTSDelayProcessor", vg)
    processor = Processor(tokenizer=AutoTokenizer.from_pretrained(vg, trust_remote_code=True),
                          audio_tokenizer=AutoModel.from_pretrained(codec, trust_remote_code=True),
                          model_config=AutoConfig.from_pretrained(vg, trust_remote_code=True), normalize_inputs=True)
    processor._parse_audio_codes = types.MethodType(parse_audio_codes, processor)
    model = AutoModel.from_pretrained(vg, trust_remote_code=True, attn_implementation="sdpa", torch_dtype=torch.bfloat16).to(cuda)
    model.eval()
    rate = processor.model_config.sampling_rate
    mark("load", t0)

    t0 = time.time()
    codes = {}
    with torch.no_grad():
        for job in jobs:
            s = job["settings"]
            t1 = time.time()
            torch.manual_seed(int(job["seed"]))
            batch = processor([[processor.build_user_message(text=job["prompt"], instruction=job["instruction"])]], mode="generation")
            out = model.generate(input_ids=batch["input_ids"].to(cuda), attention_mask=batch["attention_mask"].to(cuda),
                                 max_new_tokens=int(float(job["seconds"]) * FRAMES_PER_SECOND) + 40, **s)
            codes[job["out"]] = [(start, ids.cpu()) for start, ids in out]
            job["_sample_seconds"] = round(time.time() - t1, 1)
            print(f"voice sampled {Path(job['out']).name} {job['_sample_seconds']}s", flush=True)
    del model
    free()
    mark("lm", t0)

    t0 = time.time()
    processor.audio_tokenizer = processor.audio_tokenizer.to(cuda)
    with torch.no_grad():
        for job in jobs:
            out = Path(job["out"])
            out.parent.mkdir(parents=True, exist_ok=True)
            try:
                msg = processor.decode(codes.pop(job["out"]))[0]
            except Exception as e:  # one line that will not decode is skipped, not its chunk
                print(f"voice {out.name}: decode failed ({type(e).__name__}: {e}); skipped", flush=True)
                continue
            if msg is None or not msg.audio_codes_list:
                print(f"voice {out.name}: no audio came out; skipped", flush=True)
                continue
            # A line in more than one segment (the model left a pad gap) is its segments in order.
            wav = np.concatenate([np.asarray(a.float().cpu().numpy(), dtype=np.float32).reshape(-1) for a in msg.audio_codes_list])
            sf.write(str(out), np.asarray(wav, dtype=np.float32), rate, subtype="FLOAT")
            extra = {"instruction": job["instruction"], "writer": f"soundfile, 32-bit float, mono, {rate} Hz, the codec's output unchanged",
                     "pipeline": "tools/sound/voice.py run_voice_torch", "sample_seconds": job["_sample_seconds"], "segments": len(msg.audio_codes_list), "runtime": runtime,
                     "codec": VOICE["codec"]}
            out.with_suffix(".json").write_text(json.dumps(generate.recipe(job, extra), indent=2) + "\n")
            print(f"voice {job['slot']} {out.name}", flush=True)
    mark("codec", t0)
    return stage
