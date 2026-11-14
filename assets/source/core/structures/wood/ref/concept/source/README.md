# Wood-tier concept sources

Open `gallery.html` to browse the selected paintings and dimension guide together.

- `generations/`: all 21 native image-tool PNGs, including superseded paintings.
- `prompts/`: full prompts for every generation and revision; the manifest pairs them with their input references.
- `manifest.json`: tool provenance, selections, native sizes and checksums.
- `DESIGN.md`: copy of the final construction and material specification.
- `dimensions.png`, `dimensions.json`: exact envelopes, opening positions and stair dimensions.
- `make_dimensions.py`: generates that new technical drawing using Pillow; does not edit any painting.
- `guides/`, `make_guides.py`: original geometric blocking used to constrain house viewpoints and stairs. This is a simple reference renderer, not the proposed final game mesh or material system.
- `review/`: critique, selection reasons and dimensional interpretation notes.

The built-in `image_gen` tool was used for every painting and every painted revision. No API/CLI fallback was used. Native files are kept at the sizes returned by the tool, without artificial enlargement. The geometry guides were refined during the session; the current guide code and images record the final corrected blocking.

Run the two Python scripts from this directory or the parent folder to recreate only the guides. They need Pillow and NumPy (`make_guides.py`); they do not call an image API. Recreating a painting requires its saved prompt and listed original input images.
