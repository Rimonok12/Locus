"use client";
/* ─── Locus · in-app not found ─── */

import { navigate } from "@/lib/router";
import { Button, EmptyState } from "@/components/primitives/controls";
import { ViewHeader } from "./Header";

export default function NotFound({ what = "page" }: { what?: string }) {
  return (
    <>
      <ViewHeader title="Not found" />
      <EmptyState
        title={`This ${what} doesn’t exist`}
        body="It may have been deleted, or you might not have access to it."
        action={<Button variant="primary" onClick={() => navigate({ kind: "my-issues", tab: "assigned" })}>Go to My issues</Button>}
      />
    </>
  );
}
