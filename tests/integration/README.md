# Integration tests

| File | Holds |
| --- | --- |
| `multiplayer.test.ts` | Join, movement, mutual visibility, structure sync; zero corrections on a clean link; convergence under loss; a hostile client; refusals; a crowded scene within the byte budget |
| `persistence.test.ts` | Restart round trip; removed content; commit callbacks; three process kills with conservation |
| `creatures.test.ts` | Dormancy, hunger deadlines while dormant, creatures across restart |
| `determinism.test.ts` | The same scenario under Bun and Node produces the same hash |

`fixtures/net.ts` runs a real server and real client sessions in one process on
virtual time. Nothing is mocked. The determinism test is skipped with a message
if Node 24 or later is not installed.
