/** Small shared SVG-chart helpers - kept dependency-free (no chart library in this app), same spirit as src/lib/viz/palette.ts. */

/** Rounds up to the next 1/2/5 x 10^n so axis ticks land on round numbers. */
export function niceStep(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export interface Point {
  x: number;
  y: number;
}

/** "M x0,y0 L x1,y1 L x2,y2 ..." for a <path>. */
export function linePath(points: Point[]): string {
  if (!points.length) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
    .join(" ");
}

/** Closed polygon path tracing the top edge forward then the bottom edge backward - for a low/high confidence band. */
export function bandPath(top: Point[], bottom: Point[]): string {
  if (!top.length || top.length !== bottom.length) return "";
  const forward = top.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const backward = [...bottom].reverse().map((p) => `L${p.x},${p.y}`).join(" ");
  return `${forward} ${backward} Z`;
}
