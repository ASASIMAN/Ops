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

/**
 * A smoothed line through the points (monotone cubic, Fritsch-Carlson):
 * the curve passes through every point and never overshoots between two of
 * them, so a smooth line can't show a peak or dip the data doesn't have.
 * Also works on points given right-to-left (see smoothBandPath).
 */
export function smoothPath(points: Point[]): string {
  const n = points.length;
  if (n < 3) return linePath(points);

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    slope.push(dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i]);
  }

  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent.push(0);
    } else {
      const a = 2 * dx[i] + dx[i - 1];
      const b = dx[i] + 2 * dx[i - 1];
      tangent.push((a + b) / (a / slope[i - 1] + b / slope[i]));
    }
  }
  tangent.push(slope[n - 2]);

  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const third = dx[i] / 3;
    d +=
      ` C${points[i].x + third},${points[i].y + tangent[i] * third}` +
      ` ${points[i + 1].x - third},${points[i + 1].y - tangent[i + 1] * third}` +
      ` ${points[i + 1].x},${points[i + 1].y}`;
  }
  return d;
}

/** bandPath with both edges smoothed the same way as smoothPath. */
export function smoothBandPath(top: Point[], bottom: Point[]): string {
  if (!top.length || top.length !== bottom.length) return "";
  const back = [...bottom].reverse();
  const backCurve = smoothPath(back).replace(/^M[^ ]+/, "");
  return `${smoothPath(top)} L${back[0].x},${back[0].y}${backCurve} Z`;
}
