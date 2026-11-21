// The build supplies the structured contents of CHANGELOG.txt.
declare const __TITLE_RELEASES__: { version: string; date: string; groups: { feature: string; bullets: string[] }[] }[];

export function mountChangelog(): void {
  const log = document.querySelector<HTMLElement>("#title-changelog");
  if (!log) return;
  for (const release of __TITLE_RELEASES__) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    const date = document.createElement("time");
    date.dateTime = release.date;
    date.textContent = release.date;
    heading.append(release.version + " ", date);
    section.append(heading);
    for (const group of release.groups) {
      const feature = document.createElement("h4");
      feature.textContent = group.feature;
      const list = document.createElement("ul");
      for (const bullet of group.bullets) {
        const line = document.createElement("li");
        line.textContent = bullet;
        list.append(line);
      }
      section.append(feature, list);
    }
    log.append(section);
  }
  log.hidden = false;
}
