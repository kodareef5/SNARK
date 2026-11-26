// CrossChat's chat formats and tags, read from its own config, and the coloured runs they make of a line.
import { expect, test } from "bun:test";
import { plainRuns } from "../../server/chat.ts";
import { CHAT_RUNS_MOST, runText } from "../../shared/net/chat.ts";
import {
  chooseFormat,
  chooseTags,
  formatLine,
  mapInk,
  readChatFormat,
  readChatSettings,
  readCrossChat,
  readLooseJson,
  type ChatFormat,
} from "../../shared/permissions/chat.ts";
import { readInk, readRichColor, stripRichColor, writeRichColor, writeRuns } from "../../shared/permissions/richcolor.ts";
import { TEXT_GLOBAL } from "../../shared/net/protocol.ts";

const GOLD = 0xffe600;
const RED = 0xff0000;

const SAMPLE = `{
  // CrossChat, as its sample ships
  "PermissionsFormatting": {
    "Default": {
      "ChatFormat": "{map}: {tags} {sender} {tribe}: {message}",
      "Priority": 0, // the higher the more priority it is given
      "Icon": "", // the icon to show before the name in chat
      "FormattingParts": {
        "map": "[{name}]",
        "tags": "{name}",
        "sender": "<RichColor Color=\\"1, 0.9, 0, 1\\">{name}</>",
        "tribe": "<RichColor Color=\\"1, 0.9, 0, 1\\">[{name}]</>",
        "message": "{message}"
      }
    },
    "Admin": {
      "ChatFormat": "{tags} {sender}: {message}",
      "Priority": 9999,
      "Icon": "",
      "FormattingParts": {
        "map": "[{name}]",
        "tags": "{name}",
        "sender": "<RichColor Color=\\"1, 0, 0, 1\\">{name}</>",
        "tribe": "[{name}]",
        "message": "{message}",
      },
    },
  },
  /* tags */
  "ChatTags": {
    "StackChatTags": true, // all tags show when true
    "Admin": { "Priority": 9999, "Icon": "", "Text": "<RichColor Color=\\"1, 0, 0, 1\\">[{icon}Admin]</>", "CanBeDisabled": true },
    "VIP": { "Priority": 10, "Icon": "", "Text": "<RichColor Color=\\"0, 1, 0, 1\\">[VIP]</>", "CanBeDisabled": true },
  },
  "MutedPermissionGroup": "Muted",
  "MapColors": { "TheIsland_WP": [0, 125, 125] }
}`;

const sample = readCrossChat(SAMPLE);
const groups = sample.value.groups;
const settings = sample.value.settings;
const fmt = (raw: unknown): ChatFormat => readChatFormat(raw).value!;

test("a line with no format and no tags is the name and the words, as before", () => {
  const runs = formatLine(null, [], { sender: "Ada", message: "hello there" });
  expect(runs).toStrictEqual(plainRuns("Ada", TEXT_GLOBAL, "hello there"));
});

test("CrossChat's sample config is read whole, comments and all", () => {
  expect(sample.faults).toEqual([]);
  expect([...groups.keys()]).toEqual(["Default", "Admin"]);
  expect(groups.get("Admin")!.priority).toBe(9999);
  expect(groups.get("Default")!.chatFormat).toBe("{map}: {tags} {sender} {tribe}: {message}");
  expect(settings.stackTags).toBe(true);
  expect(settings.tags.map((t) => t.name)).toEqual(["Admin", "VIP"]);
  expect(settings.mutedGroup).toBe("Muted");
  expect(mapInk(settings, "theisland_wp")).toBe((0 << 16) | (125 << 8) | 125);
  expect(readCrossChat({ Premium: { MutedPermissionGroup: "Hush" } }).value.settings.mutedGroup).toBe("Hush");
});

test("loose JSON keeps comment marks inside strings and names a broken file", () => {
  const read = readLooseJson(`{ "a": "x // y /* z */", /* c */ "b": [1, 2,], }`);
  expect(read).toEqual({ ok: true, value: { a: "x // y /* z */", b: [1, 2] } });
  const broken = readLooseJson(`{ "a": `);
  expect(broken.ok).toBe(false);
  expect(readLooseJson("{ /* open").ok).toBe(false);
  expect(readCrossChat("{ nope").faults.length).toBe(1);
});

test("a group's format colours the sender and puts the tribe in brackets", () => {
  const runs = formatLine(groups.get("Default")!, [], { sender: "Ada", tribe: "Owls", map: "TheIsland_WP", mapInk: 0x007d7d, message: "hi" });
  expect(runs).toStrictEqual([
    { text: "[TheIsland_WP]", ink: 0x007d7d },
    { text: ": " },
    { text: "Ada", ink: GOLD },
    { text: " " },
    { text: "[Owls]", ink: GOLD },
    { text: ": hi" },
  ]);
});

test("the group with the highest priority gives the format", () => {
  const chosen = chooseFormat([
    { name: "Default", format: groups.get("Default") },
    { name: "Builders", format: null },
    { name: "Admin", format: groups.get("Admin") },
  ]);
  expect(chosen).toBe(groups.get("Admin")!);
  expect(chooseFormat([{ name: "Builders" }])).toBeNull();
  expect(formatLine(chosen, [], { sender: "Ada", message: "hi" })).toStrictEqual([{ text: "Ada", ink: RED }, { text: ": hi" }]);
});

test("an admin's tag shows first, in its colour, and can be switched off", () => {
  const tags = chooseTags(settings, ["vip", "ADMIN", "Default"]);
  expect(tags.map((t) => t.name)).toEqual(["Admin", "VIP"]);
  expect(formatLine(null, tags, { sender: "Ada", message: "hi" })).toStrictEqual([
    { text: "[Admin]", ink: RED },
    { text: " " },
    { text: "[VIP]", ink: 0x00ff00 },
    { text: " " },
    { text: "Ada" },
    { text: ": hi" },
  ]);
  expect(chooseTags(settings, ["Admin", "VIP"], ["admin"]).map((t) => t.name)).toEqual(["VIP"]);
});

test("with stacking off only the highest tag shows", () => {
  const off = readChatSettings({ ChatTags: { StackChatTags: false, Admin: { Priority: 9, Text: "[A]" }, VIP: { Priority: 1, Text: "[V]" } } });
  expect(chooseTags(off.value, ["VIP", "Admin"]).map((t) => t.name)).toEqual(["Admin"]);
  const top = readChatSettings({ StackChatTags: false, ChatTags: { Admin: { Priority: 9, Text: "[A]" }, VIP: { Priority: 1, Text: "[V]" } } });
  expect(chooseTags(top.value, ["VIP", "Admin"]).map((t) => t.name)).toEqual(["Admin"]);
});

test("a tag that cannot be disabled stays on", () => {
  const s = readChatSettings({ ChatTags: { Owner: { Priority: 5, Text: "[Owner]", CanBeDisabled: false } } }).value;
  expect(chooseTags(s, ["Owner"], ["Owner"]).map((t) => t.name)).toEqual(["Owner"]);
});

test("an empty tribe, map or tag list leaves no gap", () => {
  const line = formatLine(groups.get("Default")!, [], { sender: "Ada", tribe: "", map: "", message: "hi" });
  expect(runText(line)).toBe("Ada: hi");
  expect(runText(formatLine(groups.get("Default")!, [], { sender: "Ada", map: "Ragnarok", message: "hi" }))).toBe("[Ragnarok]: Ada: hi");
  expect(runText(formatLine(groups.get("Default")!, chooseTags(settings, ["VIP"]), { sender: "Ada", tribe: "Owls", message: "hi" }))).toBe("[VIP] Ada [Owls]: hi");
  const bracketed = fmt({ ChatFormat: "{sender} ({tribe}) says: {message}" });
  expect(runText(formatLine(bracketed, [], { sender: "Ada", message: "hi" }))).toBe("Ada says: hi");
  expect(runText(formatLine(bracketed, [], { sender: "Ada", tribe: "Owls", message: "hi" }))).toBe("Ada (Owls) says: hi");
  for (const runs of [line, formatLine(null, [], { sender: "Ada", message: "hi" })]) {
    expect(runText(runs).startsWith(" ")).toBe(false);
    expect(runText(runs)).not.toContain("[]");
  }
});

test("markup typed in a message, a name or a tribe's name stays literal", () => {
  const typed = `<RichColor Color="1,0,0,1">x</>`;
  const runs = formatLine(groups.get("Default")!, [], { sender: typed, tribe: typed, message: typed });
  expect(runText(runs)).toBe(`${typed} [${typed}]: ${typed}`);
  expect(runs.every((r) => r.ink === undefined || r.ink === GOLD)).toBe(true);
  expect(runs.find((r) => r.text === typed)).toEqual({ text: typed, ink: GOLD });
  // A placeholder typed by a player is not filled in either.
  expect(runText(formatLine(null, [], { sender: "{message}", message: "{sender} {tags}" }))).toBe("{message}: {sender} {tags}");
});

test("the sender is always a run of its own", () => {
  const plain = fmt({ ChatFormat: "<{sender}> {message}", FormattingParts: { sender: "{name}" } });
  expect(formatLine(plain, [], { sender: "Ada", message: "hi" })).toStrictEqual([{ text: "<" }, { text: "Ada" }, { text: "> hi" }]);
  const red = fmt({ ChatFormat: `<RichColor Color="1,0,0,1">» {sender}: {message}</>` });
  expect(formatLine(red, [], { sender: "Ada", message: "hi" })).toStrictEqual([
    { text: "» ", ink: RED },
    { text: "Ada", ink: RED },
    { text: ": hi", ink: RED },
  ]);
});

test("more parts than a line may carry lose no text", () => {
  const inks = ["1,0,0,1", "0,1,0,1", "0,0,1,1", "1,1,0,1", "0,1,1,1", "1,0,1,1"];
  const tagged: Record<string, unknown> = {};
  inks.forEach((c, i) => (tagged[`G${i}`] = { Priority: 10 - i, Text: `<RichColor Color="${c}">[${i}]</>` }));
  const s = readChatSettings({ ChatTags: tagged }).value;
  const tags = chooseTags(s, Object.keys(tagged));
  const many = fmt({ ChatFormat: "{map}: {tags} {sender} {tribe}: {message}", FormattingParts: { tribe: `<RichColor Color="0.5,0.5,0.5,1">[{name}]</>` } });
  const words = { sender: "Ada", tribe: "Owls", map: "Center", mapInk: 0x123456, message: "hi" };
  const runs = formatLine(many, tags, words);
  expect(runs.length).toBeLessThanOrEqual(CHAT_RUNS_MOST);
  expect(runText(runs)).toBe("Center: [0] [1] [2] [3] [4] [5] Ada [Owls]: hi");
  expect(runs).toContainEqual({ text: "Ada" });
  const few = formatLine(fmt({}), tags, words);
  expect(runText(few)).toBe("[0] [1] [2] [3] [4] [5] Ada: hi");
  expect(few.slice(-2)).toStrictEqual([{ text: "Ada" }, { text: ": hi" }]);
  const early = formatLine(fmt({ ChatFormat: "{sender} {tags}: {message}" }), tags, words);
  expect(early.length).toBe(CHAT_RUNS_MOST);
  expect(early[0]).toStrictEqual({ text: "Ada" });
  expect(runText(early)).toBe("Ada [0] [1] [2] [3] [4] [5]: hi");
});

test("RichColor reads loose spacing, any case, 0 to 255 values and an unclosed tag", () => {
  expect(readRichColor(`a< richcolor   COLOR = " 1 ,0, 0 , 1 " >b</>c`)).toStrictEqual([{ text: "a" }, { text: "b", ink: RED }, { text: "c" }]);
  expect(readRichColor(`<RichColor Color="255, 128, 0, 1">hot</>`)).toStrictEqual([{ text: "hot", ink: 0xff8000 }]);
  expect(readRichColor(`x<RichColor Color="0,0,1,1">rest of it`)).toStrictEqual([{ text: "x" }, { text: "rest of it", ink: 0x0000ff }]);
  expect(readRichColor(`<RichColor Color="red">no</> <b>bold</b> </>`)).toStrictEqual([{ text: `<RichColor Color="red">no</> <b>bold</b> </>` }]);
  expect(readInk("1, 0.9, 0, 1")).toBe(GOLD);
  expect(readInk("(R=0,G=1,B=0,A=1)")).toBe(0x00ff00);
  expect(readInk("1, 0")).toBe(-1);
  expect(stripRichColor(`<RichColor Color="1,0,0,1">[Admin]</> Ada`)).toBe("[Admin] Ada");
  for (const ink of [RED, GOLD, 0x7f7f7f, 0x010203, 0x00ffff]) expect(readRichColor(writeRichColor("t", ink))).toStrictEqual([{ text: "t", ink }]);
  expect(writeRichColor("plain")).toBe("plain");
  expect(readRichColor(writeRuns([{ text: "a", ink: RED }, { text: "b" }]))).toStrictEqual([{ text: "a", ink: RED }, { text: "b" }]);
});

test("a config with a wrong type names the fault and keeps the rest", () => {
  const read = readCrossChat({
    PermissionsFormatting: { Admin: { ChatFormat: 5, Priority: "high", FormattingParts: { sender: `<RichColor Color="1,0,0,1">{name}</>` } }, Bad: "x" },
    ChatTags: { StackChatTags: "yes", Admin: { Priority: 9, Text: "[A]", CanBeDisabled: "no" }, Broken: 3 },
    MapColors: { Island: [1, 2], Center: [10, 20, 30] },
    MutedPermissionGroup: 7,
  });
  expect(read.faults).toEqual([
    "PermissionsFormatting.Admin.ChatFormat is not a string, so it was left out.",
    "PermissionsFormatting.Admin.Priority is not a number, so it was left out.",
    "PermissionsFormatting.Bad is not an object, so it was left out.",
    "ChatTags.StackChatTags is not a boolean, so it was left out.",
    "ChatTags.Admin.CanBeDisabled is not a boolean, so it was left out.",
    "ChatTags.Broken is not an object, so it was left out.",
    "MapColors.Island is not three numbers from 0 to 255, so it was left out.",
    "MutedPermissionGroup is not a string, so it was left out.",
  ]);
  const admin = read.value.groups.get("Admin")!;
  expect(admin.priority).toBe(0);
  expect(formatLine(admin, [], { sender: "Ada", message: "hi" })).toStrictEqual([{ text: "Ada", ink: RED }, { text: ": hi" }]);
  expect(read.value.settings.tags.map((t) => [t.name, t.canBeDisabled])).toEqual([["Admin", true]]);
  expect(read.value.settings.stackTags).toBe(true);
  expect(mapInk(read.value.settings, "Center")).toBe(0x0a141e);
  expect(read.value.settings.mutedGroup).toBe("Muted");
  expect(readChatFormat({ ChatFormat: "{tags} {message}" }).faults).toEqual(["ChatFormat has no {sender}, so its lines show none."]);
});
