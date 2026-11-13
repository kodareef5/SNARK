# Performance scenarios

Benchmarks live in `tools/bench.ts` and run with `bun run bench`. They are not
part of the check. The tool builds the sizing target, prints each measurement
with its budget, writes `artifacts/bench.json`, and exits non-zero on a miss.

Record results with the machine line the tool prints in
[performance](../../planning/quality/performance.md). Add a scenario to the tool
when a new system has a cost worth budgeting; add a file here only if a scenario
needs data that does not belong in the tool.
