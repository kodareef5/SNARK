// The entry build takes this edition from CHANGELOG.txt. Older editions stay in the linked text file.
declare const __TITLE_RELEASE__: { version: string; notes: { title: string; body: string }[] };

export function mountChangelog(): void {
  const log = document.querySelector<HTMLElement>("#title-changelog");
  if (!log) return;
  const release = __TITLE_RELEASE__;
  const edition = log.querySelector<HTMLElement>(".release-version")!;
  const track = log.querySelector<HTMLElement>(".release-track")!;
  const group = document.createElement("div");
  group.className = "release-entries";
  let words = 0;
  for (const { title, body } of release.notes) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = body;
    group.append(heading, paragraph);
    words += (title + " " + body).split(/\s+/).length;
  }
  edition.textContent = release.version;
  const loop = group.cloneNode(true) as HTMLElement;
  loop.setAttribute("aria-hidden", "true");
  track.append(group, loop);
  track.style.animationDuration = Math.max(18, words / 2.6) + "s";

  const pause = log.querySelector<HTMLButtonElement>("button")!;
  pause.onclick = () => {
    const paused = log.classList.toggle("paused");
    pause.title = paused ? "Resume changelog" : "Pause changelog";
    pause.setAttribute("aria-label", pause.title);
  };
  log.hidden = false;
}
