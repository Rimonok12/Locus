"use client";

import dynamic from "next/dynamic";

const App = dynamic(() => import("@/components/App"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center" style={{ background: "#f9f7f7" }}>
      <div className="text-sm font-medium" style={{ color: "#3f72af" }}>
        Loading Locus…
      </div>
    </div>
  ),
});

export default function Page() {
  return <App />;
}
