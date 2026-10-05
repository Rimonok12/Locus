/* ─── Locus · date & text formatting ─── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function timeAgo(iso: string | number | null | undefined): string {
  if (!iso) return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/** compact age for dense rows: "3m", "2h", "5d", "Oct 2" */
export function shortAge(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d`;
  return formatDate(iso);
}

/** "Oct 5" (current year) or "Oct 5, 2025" */
export function formatDate(iso: string | null | undefined, withYear?: boolean): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const showYear = withYear ?? y !== new Date().getFullYear();
  return `${MONTHS[m - 1]} ${d}${showYear ? `, ${y}` : ""}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso);
  return dt.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 864e5);
}

/** Due date label + tone for issue rows. */
export function dueInfo(due: string | null | undefined): { label: string; tone: "overdue" | "soon" | "normal" } | null {
  if (!due) return null;
  const today = localToday();
  const diff = daysBetween(today, due);
  if (diff < 0) return { label: formatDate(due), tone: "overdue" };
  if (diff === 0) return { label: "Today", tone: "soon" };
  if (diff === 1) return { label: "Tomorrow", tone: "soon" };
  return { label: formatDate(due), tone: diff <= 7 ? "soon" : "normal" };
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

export function teamKeyFrom(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
  const words = letters.split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join("") : letters.replace(/\s/g, "");
  return (key.replace(/^[0-9]+/, "") || "TEAM").slice(0, 3);
}

/** Strip HTML to plain text (for previews / search). */
export function plainText(html: string, max = 240): string {
  const text = html.replace(/<\/(p|li|h[1-6]|blockquote|pre)>/g, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = () => (isMac() ? "⌘" : "Ctrl");
