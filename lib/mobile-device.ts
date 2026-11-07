// Copyright © 2026 Alen Pepa
export type MobileProfile = { family: "iphone" | "ipad" | "samsung" | "android" | "other" | "desktop"; mobile: boolean };
export type MobileNavigator = { userAgent?: string; platform?: string; maxTouchPoints?: number; userAgentData?: { mobile?: boolean; platform?: string } };
const read = <T>(value: () => T, fallback: T): T => { try { return value(); } catch { return fallback; } };

// User-agent hints choose conservative app policies, never a chip model, RAM
// capacity, speed grade or proof that WebGPU works. Actual capabilities win.
export function mobileProfile(nav: MobileNavigator): MobileProfile {
  const ua = read(() => nav.userAgent || "", "").slice(0, 1000);
  const platform = read(() => nav.platform || "", "");
  const touches = read(() => nav.maxTouchPoints || 0, 0);
  const hintedMobile = read(() => nav.userAgentData?.mobile === true, false);
  if (/iPhone|iPod/i.test(ua)) return { family: "iphone", mobile: true };
  if (/iPad/i.test(ua) || /MacIntel|Macintosh/i.test(`${platform} ${ua}`) && touches > 1) return { family: "ipad", mobile: true };
  if (/Android/i.test(ua)) return { family: /SamsungBrowser|\bSM-[A-Z0-9]+/i.test(ua) ? "samsung" : "android", mobile: true };
  if (hintedMobile || /Mobile|Windows Phone/i.test(ua)) return { family: "other", mobile: true };
  return { family: "desktop", mobile: false };
}

export function mobileExecutionLimits(profile: MobileProfile | undefined, backend: "cpu" | "webgpu", contextWindow: number) {
  const mobile = profile?.mobile === true;
  const context = Math.min(contextWindow, mobile ? 2048 : 4096);
  return { contextWindow: context, outputTokens: Math.min(Math.floor(context / 2), backend === "cpu" ? mobile ? 128 : 384 : mobile ? 256 : 768), characterBudget: mobile ? 2400 : 6000, maxCpuThreads: mobile ? 2 : 8 };
}

// These are app planning ceilings, not measured free RAM/VRAM. Entering a large
// physical RAM budget must not bypass a phone browser's conservative profile.
export function mobileMemoryCeilings(profile: MobileProfile | undefined) {
  if (!profile?.mobile) return null;
  const constrained = profile.family === "iphone" || profile.family === "other";
  return { gpuPlanningGB: constrained ? 1.5 : 3, cpuWeightBytes: constrained ? 750_000_000 : 1_600_000_000 };
}
