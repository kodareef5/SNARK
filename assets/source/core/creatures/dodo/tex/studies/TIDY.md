# Tidy an accepted study for the repository

Your study is accepted. Before it is committed, tidy its folder so that what stays is exactly what rebuilds the accepted pictures:

1. Move everything superseded into `superseded/` in your folder (it is left out of the repository): earlier rounds' generated originals and prompts that the accepted build no longer reads, copies of earlier rounds' pictures, reports, configs or scripts, trial outputs, and anything else the accepted build does not need. Keep `checks/` as it is (it is left out too).
2. Keep at the top of your folder: the delivered sets, `study.json`, `build.py`, `check.py` and any module or config they import, `REPORT.md`, `BRIEF.md`, the `FEEDBACK_*.md` files and the `artist_*.last.txt` files. Keep under `source/` the generated originals the accepted build reads, with the prompt of each, and any small data file the build reads.
3. Run `build.py` from a clean state and confirm that it writes every delivered picture byte for byte as accepted (compare hashes before and after), with nothing it needs left in `superseded/`. Derived working files the build writes again (fields, per-element layers) may stay where the build writes them.
4. Add a short section "Files" at the end of `REPORT.md`: which originals the accepted build reads, and that the rebuild matched byte for byte.

Do not change any delivered picture. If the rebuild does not match, say so and stop.
