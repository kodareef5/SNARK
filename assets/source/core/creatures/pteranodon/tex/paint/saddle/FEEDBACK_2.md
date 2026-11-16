# Saddle, round 2: accepted, and a tidy

The cantle's grain runs along its bend, the chitin is bone and ivory with its growth layers, and the boss is a set
piece of chitin. The saddle is accepted; change nothing in what it paints. The white patches where the straps cross
are the modeller's to fix, as your report says.

Tidy for the repository, then stop. Keep in your folder what rebuilds the layers: `paint.py` and what it imports,
`check.py`, any review script, `REPORT.md`, `BRIEF.md`, the `FEEDBACK_*.md` and `artist_*.last.txt` files, and under
`source/` only the originals and small data files your script reads, with their prompts. Your script reads the saddle
study's own delivered layers (`tex/studies/saddle/`, running its `build.py` if they are missing, never editing it).
Move anything else into `superseded/` (left out of the repository). Write a `.gitignore` for `layers/`, `checks/`,
`superseded/` and anything under `source/` that `paint.py` writes again. Leave no TypeScript file in your folder. Run
`paint.py` from a clean `layers/` twice and confirm the same bytes. Add a short "Files" section to `REPORT.md`.
