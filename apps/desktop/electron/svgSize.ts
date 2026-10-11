/** The size of a drawing in CSS pixels, from its viewBox. A drawing without one is given a default size. */
export function svgSize(svg: string): { width: number; height: number } {
  const box = /<svg\b[^>]*\bviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(
    svg,
  );
  const width = Number(box?.[1]);
  const height = Number(box?.[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : { width: 800, height: 600 };
}
