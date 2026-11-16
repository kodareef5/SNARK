# Body, round 3: accepted, and a tidy

The line on the back of the neck now shows in profile at the concept's depths and meets the head's streak as one
band; the fuzz, the mantle and the feet are right. The body is accepted; change nothing in what it paints.

Tidy for the repository, then stop. Keep in your folder what rebuilds the layers: `paint.py` and what it imports,
`check.py`, any review script, `REPORT.md`, `BRIEF.md`, the `FEEDBACK_*.md` and `artist_*.last.txt` files, and under
`source/` only the generated originals your script reads, with their prompts, and small data files. Your script must
read the accepted studies' own delivered layers (`tex/studies/<study>/`, running a study's `build.py` if they are
missing, never editing a study), not copies of them. Move anything else into `superseded/` (left out of the
repository). List in your `.gitignore` anything under `source/` that `paint.py` writes again. Leave no TypeScript file
anywhere in your folder (rename what you keep to `.ts.txt`). Run `paint.py` from a clean `layers/` twice and confirm the
same bytes. Add a short "Files" section to `REPORT.md`: what the build reads and that it rebuilds byte for byte.
