export type Sized = { id: string; width: number; height: number };

export type JustifiedItem<T extends Sized> = T & {
  displayWidth: number;
  displayHeight: number;
};

export type JustifiedRow<T extends Sized> = {
  items: JustifiedItem<T>[];
  height: number;
};

export function justify<T extends Sized>(
  items: T[],
  containerWidth: number,
  targetHeight: number,
  gap: number,
): JustifiedRow<T>[] {
  if (containerWidth <= 0 || items.length === 0) return [];

  const rows: JustifiedRow<T>[] = [];
  let row: T[] = [];
  let aspects: number[] = [];

  const flush = (stretch: boolean) => {
    if (!row.length) return;
    const aspectSum = aspects.reduce((a, b) => a + b, 0);
    const gaps = gap * Math.max(0, row.length - 1);
    let height = targetHeight;
    if (stretch) {
      height = (containerWidth - gaps) / aspectSum;
    }
    height = Math.min(Math.max(height, targetHeight * 0.62), targetHeight * 1.4);
    const widths = aspects.map((a) => a * height);
    if (stretch && widths.length) {
      const used = widths.reduce((a, b) => a + b, 0) + gaps;
      widths[widths.length - 1] += containerWidth - used;
    }
    rows.push({
      height,
      items: row.map((item, i) => ({
        ...item,
        displayWidth: Math.max(1, widths[i] ?? 0),
        displayHeight: height,
      })),
    });
    row = [];
    aspects = [];
  };

  for (const item of items) {
    const ar = item.width / Math.max(item.height, 1);
    row.push(item);
    aspects.push(ar);
    const widthAtTarget =
      aspects.reduce((a, b) => a + b, 0) * targetHeight + gap * (row.length - 1);
    if (widthAtTarget >= containerWidth) flush(true);
  }

  if (row.length) {
    const widthAtTarget =
      aspects.reduce((a, b) => a + b, 0) * targetHeight + gap * (row.length - 1);
    flush(widthAtTarget / containerWidth > 0.72);
  }

  return rows;
}
