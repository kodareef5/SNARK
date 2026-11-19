# Example server configurations

Each folder holds ARK's two files, `GameUserSettings.ini` and `Game.ini`, with
every key it sets written out and commented. Start a server on one with:

```sh
bun server/main.ts --config config/boosted-50x --db world.db
```

| Folder | What it is |
| --- | --- |
| `official` | Set as ARK's official servers are: rates at 1, difficulty 5 |
| `boosted-10x` | Experience, taming, harvesting, hatching and growing up ten times as fast |
| `boosted-50x` | The same at fifty |
| `dev` | What `bun run dev` reads: raising a creature takes minutes, damage numbers are shown, wild creatures are level 1 to 30, and the menu has the Creative entry |

A test reads every folder here and fails if anything in one is refused,
unknown or without effect (`tests/integration/round5.test.ts`). How the files
are read is in the [operator's guide](../planning/reference/operators.md);
every setting is in the [reference](../planning/reference/settings.md).
