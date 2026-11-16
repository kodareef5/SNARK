# Wing, round 2: accepted, with the final fuzz and a tidy

The veins are a network now: a few long trunks of different lengths, branching unevenly and rejoining, the same on
both faces, reading from the saddle and from below and falling into the slate at a distance. The wing is accepted.

Two last things, then stop:

1. **The final fuzz.** The fuzz study is accepted in its fourth round (`tex/studies/fuzz/`, finer and calmer than the
   one you painted the arm with). Your `source/accepted_fuzz/` holds copies of an earlier round's pictures; read the
   study's own delivered layers instead, every time `paint.py` runs (if they are missing, run the study's `build.py`,
   which writes them byte for byte; never edit the study), delete the copies, and paint again. Change nothing else.
2. **Tidy for the repository.** Keep in your folder what rebuilds the layers: `paint.py` and what it imports,
   `check.py`, `review.py`, `REPORT.md`, `BRIEF.md`, the `FEEDBACK_*.md` and `artist_*.last.txt` files, and under
   `source/` only the generated originals your script reads, with their prompts, and small data files. Move anything
   else into `superseded/` (left out of the repository). List in your `.gitignore` anything under `source/` that
   `paint.py` writes again. Leave no TypeScript file anywhere in your folder. Run `paint.py` from a clean `layers/`
   twice and confirm the same bytes. Add a short "Files" section to `REPORT.md`: what the build reads and that it
   rebuilds byte for byte.
