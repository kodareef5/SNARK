# Tidy an accepted study for the repository

Your study is accepted. Before it is committed, tidy its folder so that what stays is exactly what rebuilds the
accepted pictures:

1. Move everything superseded into `superseded/` in your folder (it is left out of the repository): earlier rounds'
   generated originals and prompts that the accepted build no longer reads, copies of earlier rounds' pictures,
   reports, configs or scripts, trial outputs, and anything else the accepted build does not need. Keep `checks/` as
   it is (it is left out too).
2. Keep at the top of your folder: the delivered sets, `study.json`, `build.py`, `check.py` and any module or config
   they import, `REPORT.md`, `BRIEF.md`, the `FEEDBACK_*.md` files and the `artist_*.last.txt` files. Keep under
   `source/` the generated originals the accepted build reads, with the prompt of each, and any small data file the
   build reads.
3. Write a `.gitignore` in your folder listing, one path a line from the folder (`/name.png`), every file the build
   writes again: the delivered sets, and the derived working files under `source/` (fields, per-element layers,
   arrays). Those stay on disk; the repository keeps what makes them. Never list `study.json`: it stays in the
   repository.
4. Run `build.py` from a clean state (the files your `.gitignore` lists deleted first) and confirm that it writes
   every delivered picture byte for byte as accepted (compare hashes before and after), with nothing it needs left in
   `superseded/` or ignored without being rebuilt.
5. Add a short section "Files" at the end of `REPORT.md`: which originals the accepted build reads, what the
   `.gitignore` leaves out, the size of what remains, and that the rebuild matched byte for byte.

Leave no TypeScript file anywhere in your folder, `superseded/` and `checks/` included: every `.ts` file under the
asset folders is type-checked with the game, ignored or not. Rename what you keep of them to `.ts.txt`.

Do not change any delivered picture. If the rebuild does not match, say so and stop.
