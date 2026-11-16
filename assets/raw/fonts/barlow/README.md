# Barlow Semi Condensed

Barlow Semi Condensed Medium (weight 500), by Jeremy Tribby. The unmodified
TrueType face and its SIL Open Font License 1.1 are kept together here.

Source: the [Google Fonts Barlow Semi Condensed directory](https://github.com/google/fonts/tree/main/ofl/barlowsemicondensed).
Files: `BarlowSemiCondensed-Medium.ttf` and `OFL.txt`, retrieved 2026-11-15.

The build publishes one content-hashed local face, its Brotli copy and the full
license. No font service is contacted at runtime. `tools/ui/font.ts` reads the
horizontal metrics used in `client/core/ui/font-metrics.ts`; the asset test
rejects stale metrics. Kerning and optional tabular substitutions are disabled
so the layout uses the face's actual default advances. Non-Latin text uses the
browser's fallback and conservative headless measurements.

SHA-256 of the preserved face:
`4998b693a190b76f2b11315844345a8546c1e2e6a320905507a9eed04edf8b48`.
