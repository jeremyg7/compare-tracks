export interface LoudnessMatchSettings {
  enabled: boolean;
  targetLufs: number | null;
  offsets: Record<string, number>;
}

export function computeLoudnessOffsets(
  lufsByTrack: Record<string, number | null>,
  capDb = 12
): Record<string, number> {
  const entries = Object.entries(lufsByTrack).filter(([, value]) => value !== null) as Array<
    [string, number]
  >;

  if (entries.length === 0) {
    return Object.keys(lufsByTrack).reduce<Record<string, number>>((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {});
  }

  const target = entries.reduce((min, [, value]) => Math.min(min, value), Infinity);

  return Object.keys(lufsByTrack).reduce<Record<string, number>>((acc, key) => {
    const value = lufsByTrack[key];
    if (typeof value !== "number") {
      acc[key] = 0;
      return acc;
    }

    const delta = value - target;
    const offset = Math.min(Math.max(delta, 0), capDb);
    acc[key] = offset;
    return acc;
  }, {});
}

export function offsetToGain(offsetDb: number): number {
  return Math.pow(10, -offsetDb / 20);
}
