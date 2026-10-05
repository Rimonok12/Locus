"use client";
/* STUB — to be implemented */
import { ViewHeader } from "@/components/app/Header";

export default function SettingsView({ section, teamKey }: { section: import("@/lib/router").SettingsSection; teamKey?: string }) {
  void [section, teamKey];
  return <ViewHeader title="SettingsView" />;
}
