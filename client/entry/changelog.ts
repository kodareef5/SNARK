// The entry build takes this edition from CHANGELOG.txt. Older editions stay in the linked text file.
declare const __TITLE_RELEASE__: { version: string; notes: { title: string; body: string }[] };

export function mountChangelog(): void {
  const log = document.querySelector<HTMLElement>("#title-changelog");
  if (!log) return;
  const release = __TITLE_RELEASE__;
  const edition = log.querySelector<HTMLElement>(".release-version")!;
  const track = log.querySelector<HTMLElement>(".release-track")!;
  edition.textContent = "Changelog · " + release.version;
  let words = 0;
  for (const { title, body } of release.notes) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = body;
    track.append(heading, paragraph);
    words += (title + " " + body).split(/\s+/).length;
  }
  // Allow time for the first line to rise through the empty space beneath the rider.
  track.style.animationDuration = Math.max(18, words / 2.6) + 12 + "s";

  const pause = document.querySelector<HTMLButtonElement>(".release-pause")!;
  pause.onclick = () => {
    const paused = log.classList.toggle("paused");
    pause.title = paused ? "Resume changelog" : "Pause changelog";
    pause.setAttribute("aria-label", pause.title);
  };
  log.hidden = false;
}
