// The poster stays visible until the subject has drawn in the studio.

export function wireModels(): void {
  let open: { figure: HTMLElement; stage: HTMLElement; button: HTMLButtonElement; frame: HTMLIFrameElement; timer: number } | null = null;
  const status = (figure: HTMLElement, text: string): void => {
    const line = figure.querySelector<HTMLElement>("[data-model-status]")!;
    line.hidden = !text;
    line.textContent = text;
  };
  const close = (failure = ""): void => {
    if (!open) return;
    const { figure, stage, button, frame, timer } = open;
    const restoreFocus = document.activeElement === frame;
    open = null;
    clearTimeout(timer);
    frame.remove();
    delete stage.dataset.modelState;
    button.setAttribute("aria-expanded", "false");
    button.textContent = failure ? "Retry 3D" : "View in 3D";
    status(figure, failure);
    if (restoreFocus) button.focus();
  };
  document.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-view]");
    const figure = button?.closest<HTMLElement>("[data-model]");
    const stage = figure?.querySelector<HTMLElement>("[data-model-stage]");
    if (!button || !figure || !stage) return;
    const again = open?.button === button;
    close();
    if (again) return;

    const frame = document.createElement("iframe");
    frame.src = button.dataset.view!;
    frame.title = `${button.dataset.label} in 3D`;
    frame.className = "studio";
    frame.tabIndex = -1;
    frame.style.opacity = "0";
    frame.style.pointerEvents = "none";
    frame.setAttribute("aria-hidden", "true");
    stage.dataset.modelState = "loading";
    button.setAttribute("aria-expanded", "true");
    button.textContent = "Cancel 3D";
    status(figure, "Loading 3D model…");
    const timer = window.setTimeout(() => close("The 3D model took too long to load."), 45_000);
    open = { figure, stage, button, frame, timer };
    stage.append(frame);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) close();
  });
  addEventListener("message", (event) => {
    if (!open || event.origin !== location.origin || event.source !== open.frame.contentWindow || event.data?.source !== "snark-studio") return;
    if (event.data.type === "ready") {
      const { figure, stage, button, frame, timer } = open;
      clearTimeout(timer);
      stage.dataset.modelState = "ready";
      frame.removeAttribute("aria-hidden");
      frame.removeAttribute("tabindex");
      frame.style.removeProperty("opacity");
      frame.style.removeProperty("pointer-events");
      button.textContent = "Close 3D";
      status(figure, "");
      if (document.activeElement === button) frame.focus();
    } else if (event.data.type === "error") close("The 3D model could not be loaded.");
    else if (event.data.type === "close") close();
  });
}
