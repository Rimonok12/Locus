"use client";
/* ─── Locus · route → view switch ─── */

import { useEffect } from "react";
import { navigate, useRoute } from "@/lib/router";
import NotFound from "./NotFound";
import TeamIssuesView from "@/components/views/TeamIssuesView";
import MyIssuesView from "@/components/views/MyIssuesView";
import InboxView from "@/components/views/InboxView";
import ProjectsView from "@/components/views/ProjectsView";
import ProjectView from "@/components/views/ProjectView";
import CyclesView from "@/components/views/CyclesView";
import CycleView from "@/components/views/CycleView";
import ViewsView from "@/components/views/ViewsView";
import SavedView from "@/components/views/SavedView";
import SearchView from "@/components/views/SearchView";
import IssueView from "@/components/issue/IssueView";
import SettingsView from "@/components/settings/SettingsView";

export default function RouteView() {
  const { route, path } = useRoute();

  // bare /:slug → My issues
  useEffect(() => {
    if (path.split("/").filter(Boolean).length === 1) navigate({ kind: "my-issues", tab: "assigned" }, { replace: true });
  }, [path]);

  switch (route.kind) {
    case "inbox": return <InboxView />;
    case "my-issues": return <MyIssuesView tab={route.tab} />;
    case "team": return <TeamIssuesView teamKey={route.key} tab={route.tab} />;
    case "team-cycles": return <CyclesView teamKey={route.key} />;
    case "cycle": return <CycleView teamKey={route.key} number={route.number} />;
    case "team-projects": return <ProjectsView tab="all" teamKey={route.key} />;
    case "projects": return <ProjectsView tab={route.tab} />;
    case "project": return <ProjectView id={route.id} tab={route.tab} />;
    case "issue": return <IssueView identifier={route.identifier} />;
    case "views": return <ViewsView />;
    case "view": return <SavedView id={route.id} />;
    case "search": return <SearchView />;
    case "settings": return <SettingsView section={route.section} teamKey={route.teamKey} />;
    case "not-found":
      return <NotFound />;
  }
}
