"use client";
/* STUB — to be implemented */
import { ViewHeader } from "@/components/app/Header";

export default function ProjectsView({ tab, teamKey }: { tab: "all" | "started" | "planned" | "backlog" | "completed"; teamKey?: string }) {
  void [tab, teamKey];
  return <ViewHeader title="ProjectsView" />;
}
