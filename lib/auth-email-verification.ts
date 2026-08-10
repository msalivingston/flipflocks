import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

export const authCallbackPath = "/auth/callback";

type AuthSessionClient = {
  getSession: () => Promise<{
    data: { session: Session | null };
    error: Error | null;
  }>;
  onAuthStateChange: (
    callback: (event: AuthChangeEvent, session: Session | null) => void,
  ) => {
    data: {
      subscription: {
        unsubscribe: () => void;
      };
    };
  };
};

type BrowserLocation = Pick<Location, "hash" | "origin" | "search">;

export type AuthSessionRecoveryResult =
  | { session: Session; error: null }
  | { session: null; error: Error };

export function authCallbackUrl(origin: string) {
  return `${origin.replace(/\/$/, "")}${authCallbackPath}`;
}

export function signupSuccessNextStep(data: { session: unknown | null }) {
  return data.session ? "onboarding" : "check-email";
}

export function hasBrowserAuthRecoverySignal(location: BrowserLocation) {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(location.search);

  return (
    hashParams.has("access_token") ||
    hashParams.has("refresh_token") ||
    hashParams.get("type") === "signup" ||
    searchParams.has("code")
  );
}

export function authCallbackError(location: BrowserLocation) {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(location.search);
  const errorCode =
    hashParams.get("error_code") ??
    searchParams.get("error_code") ??
    hashParams.get("error") ??
    searchParams.get("error");

  if (!errorCode) return null;

  const normalized = errorCode.toLowerCase();
  if (normalized.includes("expired")) {
    return "This verification link has expired. Request a new verification email and try again.";
  }

  return "This verification link is invalid or has already been used. Request a new verification email and try again.";
}

export function friendlyVerificationResendError(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("rate limit") ||
    normalized.includes("too many") ||
    normalized.includes("after")
  ) {
    return "Please wait a minute before requesting another verification email.";
  }

  return "We could not resend the verification email. Please try again.";
}

export async function waitForBrowserAuthSession(
  auth: AuthSessionClient,
  {
    hasRecoverySignal,
    timeoutMs = 8000,
  }: {
    hasRecoverySignal: boolean;
    timeoutMs?: number;
  },
): Promise<AuthSessionRecoveryResult> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};

    const finish = (result: AuthSessionRecoveryResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      finish({
        session: null,
        error: new Error("Auth session recovery timed out."),
      });
    }, timeoutMs);

    const {
      data: { subscription },
    } = auth.onAuthStateChange((_event, session) => {
      if (session) finish({ session, error: null });
    });
    unsubscribe = () => subscription.unsubscribe();
    if (settled) unsubscribe();

    void auth.getSession().then(({ data, error }) => {
      if (error) {
        finish({ session: null, error });
        return;
      }

      if (data.session) {
        finish({ session: data.session, error: null });
        return;
      }

      if (!hasRecoverySignal) {
        finish({
          session: null,
          error: new Error("No authentication session was found."),
        });
      }
    }).catch(() => {
      finish({
        session: null,
        error: new Error("Auth session recovery failed."),
      });
    });
  });
}
