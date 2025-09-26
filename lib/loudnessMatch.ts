export function computeLoudnessOffsets(
  lufsByTrack: Record<string, number | null>,
  capDb = 12
): Record<string, number> {
  const result: Record<string, number> = {};
  const validValues = Object.entries(lufsByTrack)
    .map(([, value]) => value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (validValues.length === 0) {
    Object.keys(lufsByTrack).forEach((key) => {
      result[key] = 0;
    });
    return result;
  }

  const target = Math.min(...validValues);

  Object.entries(lufsByTrack).forEach(([key, value]) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      result[key] = 0;
      return;
    }

    const delta = value - target;
    const offset = Math.min(Math.max(delta, 0), capDb);
    result[key] = Number.isFinite(offset) ? offset : 0;
  });

  return result;
}

export function offsetToGain(offsetDb: number): number {
  return Math.pow(10, -offsetDb / 20);
}
