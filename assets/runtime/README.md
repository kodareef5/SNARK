# Runtime assets

Pack files are build output, written to `client/dist/assets` and not committed.
`core.snpk` is rebuilt from content definitions and `assets/source` on every
client build.

A pack that must be reviewed or pinned (for example a large map) may be
committed here once a storage policy for large binaries is decided. Nothing is
stored here yet.
