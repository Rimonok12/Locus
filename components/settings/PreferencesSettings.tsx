"use client";
/* ─── Locus · settings › preferences (theme, sidebar, shortcuts) ─── */

import { Keyboard } from "lucide-react";
import { ui, useUI, type Theme } from "@/lib/ui";
import { Button, Switch } from "@/components/primitives/controls";
import { Card, Row, Section, SettingsPage } from "./kit";

/* Fixed palettes: a preview must show its own theme no matter which one is active. */
interface Palette { canvas: string; sidebar: string; line: string; bar: string; strong: string; accent: string }
const LIGHT: Palette = { canvas: "#f9f7f7", sidebar: "#f1f3f9", line: "#dbe2ef", bar: "#dbe2ef", strong: "#a9b8d3", accent: "#3f72af" };
const DARK: Palette = { canvas: "#0c1a2c", sidebar: "#091523", line: "#24466e", bar: "#16365c", strong: "#2e5583", accent: "#6ea2dd" };
const DOTS = ["#f2c94c", "#3f72af", "#dbe2ef", "#30a46c"];

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: "system", label: "System", hint: "Match your device" },
  { value: "light", label: "Light", hint: "Always light" },
  { value: "dark", label: "Dark", hint: "Always dark" },
];

function MiniApp({ p }: { p: Palette }) {
  return (
    <div className="absolute inset-0 flex" style={{ background: p.canvas }}>
      <div className="flex w-[30%] flex-col gap-[5px] px-[7px] py-2" style={{ background: p.sidebar, borderRight: `1px solid ${p.line}` }}>
        <span className="h-[5px] w-3/4 rounded-full" style={{ background: p.strong }} />
        <span className="mt-1 h-[5px] w-full rounded-full" style={{ background: p.accent }} />
        <span className="h-[5px] w-2/3 rounded-full" style={{ background: p.bar }} />
        <span className="h-[5px] w-4/5 rounded-full" style={{ background: p.bar }} />
        <span className="h-[5px] w-1/2 rounded-full" style={{ background: p.bar }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[18px] items-center px-2" style={{ borderBottom: `1px solid ${p.line}` }}>
          <span className="h-[5px] w-1/3 rounded-full" style={{ background: p.strong }} />
        </div>
        {DOTS.map((dot, i) => (
          <div key={i} className="flex items-center gap-1.5 px-2 py-[6px]" style={{ borderBottom: `1px solid ${p.line}` }}>
            <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: dot }} />
            <span className="h-[5px] rounded-full" style={{ width: `${[64, 48, 72, 40][i]}%`, background: p.bar }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ThemePreview({ theme }: { theme: Theme }) {
  if (theme === "light") return <MiniApp p={LIGHT} />;
  if (theme === "dark") return <MiniApp p={DARK} />;
  return (
    <>
      <MiniApp p={LIGHT} />
      <div className="absolute inset-0" style={{ clipPath: "polygon(58% 0, 100% 0, 100% 100%, 42% 100%)" }}>
        <MiniApp p={DARK} />
      </div>
    </>
  );
}

export default function PreferencesSettings() {
  const theme = useUI((s) => s.theme);
  const collapsed = useUI((s) => s.sidebarCollapsed);

  return (
    <SettingsPage title="Preferences" description="Personal preferences for this browser. They don't affect your teammates.">
      <Section title="Interface theme" description="Choose how Locus looks to you. System follows your device's appearance.">
        <div className="grid grid-cols-3 gap-2.5 sm:gap-4" role="radiogroup" aria-label="Interface theme">
          {THEMES.map((t) => {
            const on = theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => ui.setTheme(t.value)}
                className="focus-ring group flex flex-col gap-2 rounded-lg text-left"
              >
                <span
                  className={`relative block h-[72px] w-full overflow-hidden rounded-lg border transition-[box-shadow,border-color] sm:h-[96px] ${
                    on ? "border-accent ring-2 ring-accent-soft" : "border-line-strong group-hover:border-faint"
                  }`}
                >
                  <ThemePreview theme={t.value} />
                </span>
                <span className="flex items-center gap-2 px-0.5">
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      on ? "border-accent bg-accent" : "border-line-strong"
                    }`}
                  >
                    {on && <span className="h-1.5 w-1.5 rounded-full bg-accent-ink" />}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[13px] font-medium ${on ? "text-ink" : "text-dim"}`}>{t.label}</span>
                    <span className="hidden text-xxs text-faint sm:block">{t.hint}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Layout">
        <Card>
          <Row
            label="Collapse sidebar"
            description={<>Hide the sidebar on larger screens to focus on your work. Toggle it anytime with <kbd>[</kbd></>}
          >
            <Switch
              label="Collapse sidebar"
              checked={collapsed}
              onChange={(v) => { if (v !== useUI.getState().sidebarCollapsed) ui.toggleSidebar(); }}
            />
          </Row>
          <Row
            label="Keyboard shortcuts"
            description={<>Locus is built for the keyboard. Press <kbd>?</kbd> anywhere to see every shortcut.</>}
          >
            <Button size="sm" className="max-sm:h-8" icon={<Keyboard size={13} />} onClick={ui.openShortcuts}>View shortcuts</Button>
          </Row>
        </Card>
      </Section>
    </SettingsPage>
  );
}
