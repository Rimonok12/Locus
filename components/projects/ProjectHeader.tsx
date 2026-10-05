"use client";
/* ─── Locus · project page header (crumbs · tabs · favorite / link / more) ─── */

import { useMemo, type ReactNode } from "react";
import { Archive, Link2, MoreHorizontal, Star } from "lucide-react";
import { useSync } from "@/lib/sync/store";
import { toggleFavorite } from "@/lib/sync/actions";
import type { ProjectTab } from "@/lib/router";
import { HeaderTab, ViewHeader } from "@/components/app/Header";
import { Button, IconButton } from "@/components/primitives/controls";
import { Dropdown } from "@/components/primitives/overlay";
import { ActionMenu } from "@/components/primitives/SelectMenu";
import { ProjectIcon } from "@/components/primitives/icons";
import { copyProjectLink, projectActionItems, setProjectArchived } from "./projectActions";
import { useIsFavoriteProject } from "./shared";
import type { Project } from "@/lib/types";

export default function ProjectHeader({
  project, tab, actions, sub,
}: { project: Project; tab: ProjectTab; actions?: ReactNode; sub?: ReactNode }) {
  const id = project.id;
  const favorite = useIsFavoriteProject(id);
  // counted only when the issue / update maps change (not on every store write)
  const issues = useSync((s) => s.issues);
  const updates = useSync((s) => s.project_updates);
  const issueCount = useMemo(() => {
    let n = 0;
    for (const i of Object.values(issues)) if (i.project_id === id && !i.archived_at) n++;
    return n;
  }, [issues, id]);
  const updateCount = useMemo(() => {
    let n = 0;
    for (const u of Object.values(updates)) if (u.project_id === id) n++;
    return n;
  }, [updates, id]);

  const tabs: { value: ProjectTab; label: string; count?: number }[] = [
    { value: "overview", label: "Overview" },
    { value: "issues", label: "Issues", count: issueCount },
    { value: "updates", label: "Updates", count: updateCount },
  ];

  return (
    <ViewHeader
      crumbs={[{ label: "Projects", to: { kind: "projects", tab: "all" } }]}
      icon={<ProjectIcon icon={project.icon} color={project.color} size={16} />}
      title={project.name}
      tabs={tabs.map((t) => (
        <HeaderTab key={t.value} active={tab === t.value} to={{ kind: "project", id, tab: t.value }}>
          {t.label}
          {t.count ? <span className="text-xxs tabular-nums text-faint">{t.count}</span> : null}
        </HeaderTab>
      ))}
      actions={
        <>
          {actions}
          <span className="hidden items-center gap-1.5 sm:flex">
            <IconButton
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => { void toggleFavorite("project", id); }}
              size={30}
              className={favorite ? "!text-warning" : ""}
            >
              <Star size={15} className={favorite ? "fill-current" : ""} />
            </IconButton>
            <IconButton label="Copy project link" onClick={() => copyProjectLink(id)} size={30}>
              <Link2 size={15} />
            </IconButton>
          </span>
          <Dropdown
            width={220}
            align="end"
            trigger={(p) => (
              <IconButton ref={p.ref} onClick={p.onClick} aria-expanded={p["aria-expanded"]} active={p.open} label="Project actions" size={32}>
                <MoreHorizontal size={16} />
              </IconButton>
            )}
          >
            {(close) => <ActionMenu onDone={close} items={projectActionItems(project, { favorite, leaveOnDelete: true })} />}
          </Dropdown>
        </>
      }
      sub={
        <>
          {project.archived_at && (
            <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-raised px-3 py-1.5 text-[12.5px] text-dim md:px-4">
              <span className="flex items-center gap-2"><Archive size={13} className="text-faint" /> This project is archived and hidden from project lists.</span>
              <Button size="xs" variant="secondary" onClick={() => { void setProjectArchived(project, false); }} className="h-7 sm:h-6">Unarchive</Button>
            </div>
          )}
          {sub}
        </>
      }
    />
  );
}
