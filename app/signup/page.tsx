/* ─── Locus · /signup ─── */

import type { Metadata } from "next";
import SignupForm from "@/components/auth/SignupForm";
import { safeNext } from "@/components/auth/utils";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage({ searchParams }: { searchParams: { next?: string | string[] } }) {
  return <SignupForm next={safeNext(searchParams.next)} />;
}
