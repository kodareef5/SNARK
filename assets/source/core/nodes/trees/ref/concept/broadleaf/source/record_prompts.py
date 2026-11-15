"""Rebuild the exact-prompt ledger from both generation manifests; stdlib only."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
entries = json.loads((root / 'source/generation_manifest.json').read_text())
banyan_manifest = root / 'source/banyan_generation.json'
if banyan_manifest.exists():
    entries += json.loads(banyan_manifest.read_text())
text = '# Exact image-generation prompts\n\nTool: built-in `image_gen.imagegen`. Initial paintings were generated from words alone. Later image inputs are original paintings generated for this task. No photographs or existing game art were used. Native PNGs are retained without resizing or resampling. Requested sizes in prompts are requests; actual output dimensions are listed in `DESIGN.md`.\n'
for entry in entries:
    references = ', '.join(entry.get('referenced_image_paths', entry.get('inputs', []))) or 'none'
    text += f"\n## {entry['id']}\n\nInput images: {references}. `transparent_background: false`.\n\n```text\n{entry['prompt']}\n```\n"
(root / 'prompts.md').write_text(text)
