import { expect, test } from "bun:test";
import { KEEP, backupName, backupsToRemove, type BackupFile } from "../../server/persist/backup.ts";
import { loadConfig } from "../../server/settings/config.ts";

test("default backups keep twelve recent copies and seven days with backups", () => {
  const rules = loadConfig({ gus: "", game: "" }).rules;
  const keep = {
    days: rules.num("BackupKeepDays"),
    hours: rules.num("BackupKeepHours"),
    bytes: rules.num("BackupMaxGigabytes") * 2 ** 30,
  };
  expect(keep).toEqual(KEEP);

  const files: BackupFile[] = [];
  const daily: string[] = [];
  for (let day = 0; day < 10; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(Date.UTC(2026, 0, day * 3 + 1, hour));
      files.push({ name: backupName(at, files.length + 1), bytes: 10 * 2 ** 30 });
    }
    daily.push(files.at(-1)!.name);
  }
  const removed = new Set(backupsToRemove(files, files.at(-1)!.name, keep, Infinity));
  const retained = files.map((file) => file.name).filter((name) => !removed.has(name));
  const expected = new Set([...daily.slice(-7), ...files.slice(-12).map((f) => f.name)]);
  expect(retained).toEqual([...expected].sort());
});
