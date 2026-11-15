// What a GLSL ES 3.00 compiler and linker would refuse in a program's texts, as far as the fake context can tell
// without types. Compiling, after the preprocessor's branches are taken as its defines say: a text whose first line is
// not #version 300 es; a call to a function no text declares, or with a count of arguments none of its declarations
// takes; a name nothing declares; a function called and never defined. Linking: a fragment input the vertex text does
// not write with the same type and qualifier, and a uniform the two declare as different types. It cannot see a wrong
// type passed or returned, a swizzle a type lacks, precision, a GPU's limits, or what a program draws.

const TYPES = new Set([
  "void", "bool", "int", "uint", "float", "vec2", "vec3", "vec4", "bvec2", "bvec3", "bvec4", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4",
  "mat2", "mat3", "mat4", "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4",
  "sampler2D", "sampler3D", "samplerCube", "sampler2DShadow", "samplerCubeShadow", "sampler2DArray", "sampler2DArrayShadow",
  "isampler2D", "isampler3D", "isamplerCube", "isampler2DArray", "usampler2D", "usampler3D", "usamplerCube", "usampler2DArray",
]);
const QUALIFIERS = new Set(["const", "uniform", "in", "out", "inout", "flat", "smooth", "centroid", "highp", "mediump", "lowp", "invariant", "layout", "location", "std140", "shared", "packed"]);
const KEYWORDS = new Set(["if", "else", "for", "while", "do", "return", "discard", "break", "continue", "switch", "case", "default", "true", "false", "precision", "struct"]);
const BUILTINS = new Set([
  "radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt",
  "abs", "sign", "floor", "trunc", "round", "roundEven", "ceil", "fract", "mod", "modf", "min", "max", "clamp", "mix", "step", "smoothstep", "isnan", "isinf",
  "floatBitsToInt", "floatBitsToUint", "intBitsToFloat", "uintBitsToFloat", "packSnorm2x16", "unpackSnorm2x16", "packUnorm2x16", "unpackUnorm2x16", "packHalf2x16", "unpackHalf2x16",
  "length", "distance", "dot", "cross", "normalize", "faceforward", "reflect", "refract", "matrixCompMult", "outerProduct", "transpose", "determinant", "inverse",
  "lessThan", "lessThanEqual", "greaterThan", "greaterThanEqual", "equal", "notEqual", "any", "all", "not",
  "textureSize", "texture", "textureProj", "textureLod", "textureOffset", "texelFetch", "texelFetchOffset", "textureProjOffset", "textureLodOffset", "textureProjLod",
  "textureProjLodOffset", "textureGrad", "textureGradOffset", "textureProjGrad", "textureProjGradOffset", "dFdx", "dFdy", "fwidth",
  "gl_Position", "gl_PointSize", "gl_VertexID", "gl_InstanceID", "gl_FragCoord", "gl_FrontFacing", "gl_PointCoord", "gl_FragDepth",
]);

interface Token {
  t: string;
  line: number;
}

/** An #if's condition: whole numbers, defined(), the macros' values (0 for one not defined), comparisons, ! && || and arithmetic. */
function condition(expr: string, macros: Map<string, string>): number {
  const text = expr.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_, a: string | undefined, b: string | undefined) => (macros.has(a ?? b ?? "") ? "1" : "0")).replace(/[A-Za-z_]\w*/g, (n) => macros.get(n)?.trim() || "0");
  const t = text.match(/\d+\.?\d*|&&|\|\||==|!=|<=|>=|[()<>!+\-*/]/g) ?? [];
  let i = 0;
  type Ops = Record<string, (a: number, b: number) => number>;
  const binary = (next: () => number, ops: Ops) => (): number => {
    let v = next();
    while (ops[t[i] ?? ""]) v = ops[t[i++]!]!(v, next());
    return v;
  };
  const atom = (): number => {
    const x = t[i++];
    if (x === "(") {
      const v = or();
      i++;
      return v;
    }
    if (x === "!") return atom() === 0 ? 1 : 0;
    if (x === "-") return -atom();
    return Number(x);
  };
  const mul = binary(atom, { "*": (a, b) => a * b, "/": (a, b) => a / b });
  const add = binary(mul, { "+": (a, b) => a + b, "-": (a, b) => a - b });
  const cmp = binary(add, { "<": (a, b) => +(a < b), ">": (a, b) => +(a > b), "<=": (a, b) => +(a <= b), ">=": (a, b) => +(a >= b) });
  const eq = binary(cmp, { "==": (a, b) => +(a === b), "!=": (a, b) => +(a !== b) });
  const and = binary(eq, { "&&": (a, b) => +(a !== 0 && b !== 0) });
  const or: () => number = binary(and, { "||": (a, b) => +(a !== 0 || b !== 0) });
  return or();
}

/**
 * The text's tokens as a preprocessor leaves them: comments, directives and the lines of branches not taken out; and
 * the names its #define lines declare. Macros are not expanded, which a name's use does not need.
 */
function tokens(text: string): { list: Token[]; macros: string[] } {
  const list: Token[] = [];
  const macros = new Map<string, string>();
  const branches: { on: boolean; taken: boolean }[] = [];
  const live = (): boolean => branches.every((b) => b.on);
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/\/\/.*$/gm, "");
  bare.split("\n").forEach((line, i) => {
    const d = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    if (d) {
      const [, word, rest] = d as unknown as [string, string, string];
      const top = branches.at(-1);
      if (word === "ifdef" || word === "ifndef" || word === "if") {
        const on = word === "if" ? condition(rest, macros) !== 0 : macros.has(rest.trim()) === (word === "ifdef");
        branches.push({ on, taken: on });
      } else if (top && word === "elif") {
        top.on = !top.taken && condition(rest, macros) !== 0;
        top.taken ||= top.on;
      } else if (top && word === "else") [top.on, top.taken] = [!top.taken, true];
      else if (word === "endif") branches.pop();
      else if (word === "define" && live()) {
        const m = /^([A-Za-z_]\w*)\s*(.*)$/.exec(rest);
        if (m) macros.set(m[1]!, m[2]!);
      }
      return;
    }
    if (!live()) return;
    for (const m of line.matchAll(/[A-Za-z_]\w*|\d+\.\d*(?:[eE][+-]?\d+)?[uUfF]?|\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?[uUfF]?|\S/g)) list.push({ t: m[0], line: i + 1 });
  });
  return { list, macros: [...macros.keys()] };
}

const isName = (t: string): boolean => /^[A-Za-z_]/.test(t);

/** The index just past the bracket that closes the one at `at`. */
function closing(list: Token[], at: number): number {
  let depth = 0;
  for (let i = at; i < list.length; i++) {
    const t = list[i]!.t;
    if (t === "(" || t === "[") depth++;
    else if (t === ")" || t === "]") depth--;
    if (depth === 0) return i + 1;
  }
  return list.length;
}

/** How many arguments the brackets at `at` hold. */
function arity(list: Token[], at: number): number {
  const end = closing(list, at);
  if (end - at === 2 || (end - at === 3 && list[at + 1]!.t === "void")) return 0;
  let depth = 0;
  let n = 1;
  for (let i = at; i < end; i++) {
    const t = list[i]!.t;
    if (t === "(" || t === "[") depth++;
    else if (t === ")" || t === "]") depth--;
    else if (t === "," && depth === 1) n++;
  }
  return n;
}

interface Declared {
  names: Set<string>;
  functions: Map<string, { arities: Set<number>; defined: boolean }>;
  /** Where each name was declared as a function or not: a name both is refused where it is called as the other. */
  declarations: Set<number>;
}

/**
 * Every name the text declares: after a type (with its array size), after a comma in a declaration's list, a uniform
 * block's name, and each #define. A name after a type and before a bracket is a function.
 */
function declared(list: Token[], macros: string[]): Declared {
  const names = new Set(macros);
  const functions = new Map<string, { arities: Set<number>; defined: boolean }>();
  const declarations = new Set<number>();
  let listing = -1;
  let depth = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i]!.t;
    if (t === "(" || t === "[") depth++;
    else if (t === ")" || t === "]") depth--;
    if (t === ";" || t === "{" || t === "}" || depth < listing) listing = -1;
    if (t === "uniform" && isName(list[i + 1]?.t ?? "") && list[i + 2]?.t === "{") names.add(list[i + 1]!.t);
    if (t === "," && depth === listing && isName(list[i + 1]?.t ?? "") && !TYPES.has(list[i + 1]!.t) && !QUALIFIERS.has(list[i + 1]!.t)) {
      names.add(list[i + 1]!.t);
      declarations.add(i + 1);
    }
    if (!TYPES.has(t) || list[i - 1]?.t === ".") continue;
    let at = i + 1;
    if (list[at]?.t === "[") at = closing(list, at);
    const name = list[at]?.t ?? "";
    if (!isName(name) || TYPES.has(name) || KEYWORDS.has(name) || QUALIFIERS.has(name)) continue;
    declarations.add(at);
    if (list[at + 1]?.t === "(" && depth === 0) {
      const f = functions.get(name) ?? functions.set(name, { arities: new Set(), defined: false }).get(name)!;
      f.arities.add(arity(list, at + 1));
      if (list[closing(list, at + 1)]?.t === "{") f.defined = true;
    } else {
      names.add(name);
      listing = depth;
    }
  }
  return { names, functions, declarations };
}

const compiled = new Map<string, string[]>();
const linked = new Map<string, string[]>();

/** What a GLSL ES 3.00 compiler would say of the text, a line an error; none if it would take it. */
export function compileErrors(text: string): string[] {
  return compiled.get(text) ?? compiled.set(text, compile(text)).get(text)!;
}

function compile(text: string): string[] {
  const errors: string[] = [];
  if (!text.startsWith("#version 300 es\n")) errors.push("ERROR: 0:1: '#version' : must be the text's first line, as 300 es");
  const { list, macros } = tokens(text);
  const { names, functions, declarations } = declared(list, macros);
  const called = new Set<string>();
  list.forEach(({ t, line }, i) => {
    if (!isName(t) || list[i - 1]?.t === "." || declarations.has(i) || TYPES.has(t) || KEYWORDS.has(t) || QUALIFIERS.has(t) || BUILTINS.has(t)) return;
    const say = (what: string): number => errors.push(`ERROR: 0:${line}: '${t}' : ${what}`);
    if (list[i + 1]?.t !== "(") {
      if (!names.has(t)) say("undeclared identifier");
      return;
    }
    const f = functions.get(t);
    if (!f || !f.arities.has(arity(list, i + 1))) say("no matching overloaded function found");
    else called.add(t);
  });
  for (const name of called) if (!functions.get(name)!.defined) errors.push(`ERROR: '${name}' : function is called but never defined`);
  return errors;
}

/** The variables declared at the top level with `qualifier` (in, out or uniform), each with its type and whether it is flat. */
function globals(text: string, qualifier: string): Map<string, string> {
  const { list } = tokens(text);
  const out = new Map<string, string>();
  let depth = 0;
  let statement: string[] = [];
  for (const { t } of list) {
    if (t === "{") depth++;
    if (t === "}") depth--;
    if (depth > 0 || t === "}") {
      statement = [];
      continue;
    }
    if (t !== ";") {
      statement.push(t);
      continue;
    }
    // A layout's brackets say where, not what.
    const s = statement.join(" ").replace(/layout \([^)]*\)/g, "").trim().split(" ");
    statement = [];
    if (!s.includes(qualifier)) continue;
    const type = s.find((w) => TYPES.has(w));
    if (!type) continue;
    const kind = `${s.includes("flat") ? "flat " : ""}${type}`;
    let take = true;
    for (const w of s.slice(s.indexOf(type) + 1)) {
      if (take && isName(w)) out.set(w, kind);
      take = w === ",";
    }
  }
  return out;
}

/** What a GLSL ES 3.00 linker would say of a vertex and a fragment text that each compile, a line an error. */
export function linkErrors(vertex: string, fragment: string): string[] {
  const key = `${vertex}\u0000${fragment}`;
  return linked.get(key) ?? linked.set(key, link(vertex, fragment)).get(key)!;
}

function link(vertex: string, fragment: string): string[] {
  const errors: string[] = [];
  const written = globals(vertex, "out");
  for (const [name, kind] of globals(fragment, "in")) {
    const wrote = written.get(name);
    if (wrote !== kind) errors.push(`ERROR: '${name}' : the fragment reads it as ${kind}, and the vertex text ${wrote ? `writes it as ${wrote}` : "does not write it"}`);
  }
  const theirs = globals(vertex, "uniform");
  for (const [name, kind] of globals(fragment, "uniform")) {
    const other = theirs.get(name)?.replace("flat ", "");
    if (other && other !== kind.replace("flat ", "")) errors.push(`ERROR: '${name}' : a uniform declared ${other} in the vertex text and ${kind} in the fragment`);
  }
  return errors;
}
