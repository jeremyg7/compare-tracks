export function formatDb(value: number | null, suffix = "dB"): string {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }
  return `${value.toFixed(1)} ${suffix}`;
}
