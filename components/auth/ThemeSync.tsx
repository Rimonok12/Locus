"use client";
/* ─── Locus · theme sync for public pages (auth, onboarding, landing) ───
   The root layout applies the saved theme before first paint; this keeps it in
   sync afterwards (OS light/dark switches while the page is open). */

import { useEffect } from "react";
import { applyTheme, useUI } from "@/lib/ui";

export function useThemeSync() {
  const theme = useUI((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}

export default function ThemeSync() {
  useThemeSync();
  return null;
}
