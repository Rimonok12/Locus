"use client";
/* ─── Locus · project page (overview · issues · updates) ─── */

import { useSync } from "@/lib/sync/store";
import NotFound from "@/components/app/NotFound";
import ProjectOverview from "@/components/projects/ProjectOverview";
import ProjectIssues from "@/components/projects/ProjectIssues";
import ProjectUpdates from "@/components/projects/ProjectUpdates";
import { leavingProjects } from "@/components/projects/projectActions";

export default function ProjectView({ id, tab }: { id: string; tab: "overview" | "issues" | "updates" }) {
  const project = useSync((s) => s.projects[id]);
  if (!project) return leavingProjects.has(id) ? null : <NotFound what="project" />;
  switch (tab) {
    case "issues": return <ProjectIssues key={id} project={project} />;
    case "updates": return <ProjectUpdates key={id} project={project} />;
    default: return <ProjectOverview key={id} project={project} />;
  }
}
