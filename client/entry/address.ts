export function worldUrl(input: string, base: string): string {
  const url = new URL(input, base);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw Error("Use an HTTP or HTTPS server address.");
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/(?:index|play)\.html$/, "/").replace(/\/?$/, "/");
  return url.href;
}
