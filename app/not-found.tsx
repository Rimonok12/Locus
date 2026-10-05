/* ─── Locus · global 404 ─── */

import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { buttonClass } from "@/components/auth/utils";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <AuthCard
      icon={
        <span className="flex h-11 items-center justify-center rounded-xl border border-line bg-surface px-3 font-mono text-[15px] font-semibold tracking-[0.08em] text-dim shadow-card">
          404
        </span>
      }
      title="Page not found"
      subtitle="The page you’re looking for doesn’t exist, has moved, or you don’t have access to it."
      plain
    >
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
        <a href="/" className={buttonClass("primary", "lg", "w-full sm:w-auto")}>Go to Locus</a>
      </div>
    </AuthCard>
  );
}
