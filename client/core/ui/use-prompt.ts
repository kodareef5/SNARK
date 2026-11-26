/** The action a finger can take, including its progress throughout a held search. */
export function usePrompt(prompt: string): string {
  if (!prompt) return "";
  for (const line of prompt.split("\n")) {
    if (line.startsWith("E use  ")) return "Use " + line.slice(7);
    if (line.startsWith("hold E  ")) return "Hold: " + line.slice(8);
    if (line.startsWith("searching the ")) return "S" + line.slice(1);
    const action = /(?:^| {3,})E +(.+?)(?: {3,}|$)/.exec(line)?.[1];
    if (action) return action.charAt(0).toUpperCase() + action.slice(1);
  }
  return "";
}
