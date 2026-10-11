export type SystemKey = "mac" | "windows" | "linux";
export const SYSTEMS: Record<SystemKey, { key: SystemKey; name: string }>;
export interface Download {
  name: string;
  url: string;
  size: number;
  label: string;
}
export interface Pick {
  primary: Download | undefined;
  secondary: Download | undefined;
}
export function detectSystem(nav: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
}): SystemKey | "other";
export function pickAssets(release: {
  assets?: { name: string; browser_download_url: string; size: number }[];
}): Record<SystemKey, Pick> & { sums: Download | undefined };
export function megabytes(bytes: number): string;
