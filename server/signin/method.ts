// How survivors sign in is a method the host chooses (SignIn). The browser key stays what a session proves itself with:
// a method says whether a key may come in, and whom it stands for. Another way to sign in is another method in the table.

import type { Rules } from "../settings/rules.ts";

/** One request to a method's routes. `path` is under the world's own path, `base`; `who` is the client's address. */
export interface SignInCall {
  readonly req: Request;
  readonly url: URL;
  readonly path: string;
  readonly base: string;
  readonly who: string;
}

export interface SignInMethod {
  /** The word SignIn names it by. */
  readonly id: string;
  /** "" to let the browser with this key hash in, or why not, in words for whoever is asking. */
  admits(keyHash: Uint8Array): string;
  /** Whom the key is signed in as, such as "discord:80351110224678912", or "" where the method has no accounts. */
  subject(keyHash: Uint8Array): string;
  /** Signs `keyHash` in as `subject`, who is signed in on another key: a survivor arriving from another address. */
  carry(keyHash: Uint8Array, subject: string): void;
  /** Answers a request under /signin, or null where the path is not one of its own. */
  answer(call: SignInCall): Promise<Response> | Response | null;
  /** A session with this key was let in. `refuse` closes it, at once or later. */
  joined(keyHash: Uint8Array, refuse: () => void): void;
}

/** The browser key alone, as a server with nothing set: every key may come in, and none stands for an account. */
export const KEY_METHOD: SignInMethod = {
  id: "key",
  admits: () => "",
  subject: () => "",
  carry: () => {},
  answer: () => null,
  joined: () => {},
};

/** What SignIn names when no method has that name. It lets nobody in: a mistyped setting must not open the server. */
const unknown = (name: string): SignInMethod => ({
  ...KEY_METHOD,
  id: "",
  admits: () => `this server's SignIn setting names no way to sign in: ${name.slice(0, 40)}`,
});

/** The methods a server has, and the one its rules name now. */
export class SignIn {
  private readonly methods = new Map<string, SignInMethod>([[KEY_METHOD.id, KEY_METHOD]]);
  private readonly rules: Rules;

  constructor(rules: Rules, methods: readonly SignInMethod[] = []) {
    this.rules = rules;
    for (const m of methods) this.methods.set(m.id, m);
  }

  /** Read at each use, so the setting changes it while the server runs. */
  get method(): SignInMethod {
    const name = this.rules.text("SignIn").trim().toLowerCase() || KEY_METHOD.id;
    return this.methods.get(name) ?? unknown(name);
  }

  /** What entry-world.json says of it: null for the browser key, which asks nothing of the page. */
  entry(): { method: string } | null {
    const m = this.method;
    return m === KEY_METHOD ? null : { method: m.id };
  }
}
