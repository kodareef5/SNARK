import { expect, test } from "bun:test";
import { dynamicLoads, madeArrays, stripComments } from "../../tools/policy.ts";

test("comments go and code stays where it was, whatever a string or a regular expression holds", () => {
  const src = ['const a = "/*";', 'import { x } from "../server/x.ts";', 'const b = "*/";', "// gone", "const c = 1; /* gone", "too */ const d = 2;"].join("\n");
  const out = stripComments(src);
  // The import between two strings is still there to be judged, and every line is on the line it was.
  expect(out.split("\n")).toEqual(['const a = "/*";', 'import { x } from "../server/x.ts";', 'const b = "*/";', "", "const c = 1; ", " const d = 2;"]);

  expect(stripComments('const url = "http://example.test/a"; // note')).toBe('const url = "http://example.test/a"; ');
  // A quote inside a regular expression opens no string, so the comment after it is still seen as one.
  expect(stripComments("const q = /[\"']/g; // gone\nconst r = a / b; // gone")).toBe("const q = /[\"']/g; \nconst r = a / b; ");
  expect(stripComments("return /\\/\\*/.test(s); /* gone */")).toBe("return /\\/\\*/.test(s); ");
  expect(stripComments("const t = `a ${ b ? '/*' : `c` } d`; // gone")).toBe("const t = `a ${ b ? '/*' : `c` } d`; ");
});

test("a load by a name the rules cannot read is counted, and one that is only written in a string is not", () => {
  expect(dynamicLoads('const m = await import(file);\nconst n = require("x");')).toBe(2);
  expect(dynamicLoads("const m = await import(`../server/${name}.ts`);")).toBe(1);
  expect(dynamicLoads('const text = "call import(x) or require(y)"; // import(z)')).toBe(0);
  expect(dynamicLoads("const hidden = '/*'; const m = import(file); const end = '*/';")).toBe(1);
});

test("an array made on every call is found by its line, and one only read, typed, written in a string or a comment is not", () => {
  const made = [
    "[a, b] = [x, y];",
    "const [c, d] = [x, y];",
    "let [e, f] = flag ? [x, y] : [y, x];",
    "if (flag) [p.q[0], p.q[1]] = [x, y];",
    "t.set([x, y, z], k * 3);",
    "for (const [k, v] of map) use(k, v);",
    "} else [g, h] = [y, x];",
  ];
  const fine = [
    "const [i, j] = band;",
    "const FLAT: readonly number[] = [-1, 0, 0];",
    "const WAYS: readonly (readonly [number, number])[] = [[1, 0], [0, 1]];",
    "const kept: { a: number }[] = [];",
    "rows[k] = [x, y];",
    "use([x, y]);",
    "type Pair = [number, number];",
    "interface Index { [key: string]: number }",
    'const text = "[a, b] = [x, y]; t.set([1], 0)"; // for (const [k, v] of map)',
    "for (const v of map.values()) use(v);",
  ];
  expect(madeArrays([...made, ...fine].join("\n")).map((m) => `${m.line} ${m.what}`)).toEqual(["1 destructured", "2 destructured", "3 destructured", "4 destructured", "5 set", "6 for", "7 destructured"]);
});
