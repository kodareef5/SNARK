# Hurt and decay, round 4: accepted, and a tidy

The wing reads now: from below at 20 and 60 m the three hurt steps are told apart at a glance in every dye, step 3
says "nearly dead", the corpse darkens and dries along the vessels, and close up the wounds keep the shapes of round 3.
Accepted; change nothing in the four pictures.

Tidy for the repository, then stop. Keep in `tex/layers/` what rebuilds the four pictures: `paint.py` and what it
imports, `verify.py`, `review.py`, `contact.py` if your scripts use it, `REPORT.md`, `BRIEF.md`, the `FEEDBACK_*.md`
and `artist_*.last.txt` files, and under `source/` only the originals and small data files `paint.py` reads, with their
prompts. Move review pictures, trial outputs and anything else into `superseded/` (left out of the repository); keep
`REVIEW.jpg`, `DISTANCE_20M.png` and `DISTANCE_60M.png` only if they are this round's and say so in the report. Write a
`.gitignore` for `superseded/`, `checks/`, `look/` and anything `paint.py` writes again under `source/`. Leave no
TypeScript file in the folder. Run `paint.py` twice from clean and confirm the four pictures come out byte for byte as
accepted. Add a short "Files" section to `REPORT.md`.
