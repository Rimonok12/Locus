"use client";
/* ─── Locus · "Continue with Google" via Google Identity Services (ID-token flow) ───
   No client secret and no OAuth redirect: GIS hands us a signed ID token whose
   `nonce` claim is the SHA-256 of a random value we keep in memory; Supabase
   verifies the token and the raw nonce and creates the session. */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Spinner } from "@/components/primitives/controls";
import { authErrorMessage } from "./utils";
import { FormAlert } from "./AuthCard";

/* ─── minimal GIS typings ─── */
interface GoogleCredentialResponse { credential?: string; select_by?: string }
interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  use_fedcm_for_prompt?: boolean;
  ux_mode?: "popup" | "redirect";
  auto_select?: boolean;
  context?: "signin" | "signup" | "use";
  itp_support?: boolean;
}
interface GsiButtonConfiguration {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
  locale?: string;
}
interface GoogleAccountsId {
  initialize: (config: GoogleIdConfiguration) => void;
  renderButton: (parent: HTMLElement, options: GsiButtonConfiguration) => void;
  cancel: () => void;
  disableAutoSelect: () => void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
export const googleEnabled = Boolean(GOOGLE_CLIENT_ID);

const GSI_SRC = "https://accounts.google.com/gsi/client";
let gsiPromise: Promise<GoogleAccountsId> | null = null;

/** Load the GIS script once per page; retries after a failure. */
function loadGsi(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!gsiPromise) {
    gsiPromise = new Promise<GoogleAccountsId>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        const id = window.google?.accounts?.id;
        if (id) resolve(id); else reject(new Error("Google sign-in failed to initialise"));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("Google sign-in failed to load"));
      };
      document.head.appendChild(script);
    }).catch((e) => {
      gsiPromise = null;
      throw e;
    });
  }
  return gsiPromise;
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Status = "loading" | "ready" | "signing-in" | "unavailable";

/**
 * Renders Google's official button. Renders nothing when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset.
 * @param next same-origin path to land on after sign-in
 */
export function GoogleButton({ next, context = "signin" }: { next: string; context?: "signin" | "signup" }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef(next);
  nextRef.current = next;
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  /** bumped after a failed exchange so a fresh nonce is issued */
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!googleEnabled) return;
    let cancelled = false;
    let resizeObs: ResizeObserver | null = null;
    let themeObs: MutationObserver | null = null;
    let rendered = "";

    (async () => {
      try {
        const gsi = await loadGsi();
        const rawNonce = randomNonce();
        const hashedNonce = await sha256Hex(rawNonce);
        if (cancelled) return;

        gsi.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: hashedNonce,
          use_fedcm_for_prompt: true,
          ux_mode: "popup",
          context,
          itp_support: true,
          callback: async (response) => {
            if (cancelled) return;
            if (!response.credential) {
              setError("Google didn’t return a credential. Please try again.");
              return;
            }
            setError(null);
            setStatus("signing-in");
            let failure: unknown = null;
            try {
              const { error: signInError } = await supabase().auth.signInWithIdToken({
                provider: "google",
                token: response.credential,
                nonce: rawNonce,
              });
              failure = signInError;
            } catch (e) {
              failure = e;
            }
            if (failure) {
              setError(authErrorMessage(failure));
              setStatus("ready");
              // a nonce is single-use: re-initialise with a fresh one for the next attempt
              setGeneration((g) => g + 1);
              return;
            }
            window.location.assign(nextRef.current);
          },
        });

        const render = () => {
          const host = hostRef.current;
          if (!host || cancelled) return;
          const width = Math.round(Math.max(200, Math.min(400, host.getBoundingClientRect().width)));
          const dark = document.documentElement.classList.contains("dark");
          const key = `${width}:${dark}`;
          if (key === rendered) return;
          rendered = key;
          host.replaceChildren();
          gsi.renderButton(host, {
            type: "standard",
            theme: dark ? "filled_black" : "outline",
            size: "large",
            width,
            text: "continue_with",
            shape: "rectangular",
            logo_alignment: "center",
          });
        };

        render();
        setStatus("ready");
        if (hostRef.current) {
          resizeObs = new ResizeObserver(render);
          resizeObs.observe(hostRef.current);
        }
        themeObs = new MutationObserver(render);
        themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
      resizeObs?.disconnect();
      themeObs?.disconnect();
    };
  }, [generation, context]);

  if (!googleEnabled) return null;

  return (
    <div className="space-y-3">
      {status === "unavailable" ? (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-2.5 text-center text-[12.5px] text-faint">
          Google sign-in couldn’t load. Check your connection or content blocker, or continue with email.
        </p>
      ) : (
        <div className="relative min-h-[40px]">
          <div ref={hostRef} className={`flex w-full justify-center transition-opacity ${status === "ready" ? "opacity-100" : "opacity-0"}`} />
          {status === "loading" && <div className="skeleton absolute inset-x-0 top-0 h-10 rounded-md" aria-hidden />}
          {status === "signing-in" && (
            <div className="anim-fade absolute inset-x-0 top-0 flex h-10 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface text-[13px] font-medium text-dim">
              <Spinner size={14} /> Signing in with Google…
            </div>
          )}
        </div>
      )}
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}
