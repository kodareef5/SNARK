export interface LabelBox { left: number; top: number; right: number; bottom: number }

export function mapLabelBox(x: number, y: number, textWidth: number, edge: LabelBox, occupied: readonly LabelBox[]): LabelBox | null {
  const width = textWidth + 8, height = 18, offset = 10;
  const places: [number, number][] = [[x + offset, y - height / 2], [x - width - offset, y - height / 2],
    [x - width / 2, y - height - offset], [x - width / 2, y + offset]];
  for (const [left, top] of places) {
    const right = left + width, bottom = top + height;
    if (left < edge.left || top < edge.top || right > edge.right || bottom > edge.bottom) continue;
    if (occupied.some((b) => left < b.right && right > b.left && top < b.bottom && bottom > b.top)) continue;
    return { left, top, right, bottom };
  }
  return null;
}
