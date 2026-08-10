import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  authCallbackError,
  authCallbackUrl,
  friendlyVerificationResendError,
  signupSuccessNextStep,
  waitForBrowserAuthSession,
} from "../lib/auth-email-verification.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const signupPath = path.join(root, "app/signup/signup-form.tsx");
const callbackPath = path.join(root, "app/auth/callback/auth-callback-client.tsx");
const onboardingPath = path.join(
  root,
  "app/onboarding/_components/onboarding-flow.tsx",
);
const resetRequestPath = path.join(root, "app/_components/password-reset-request.tsx");
const resetFormPath = path.join(root, "app/reset-password/reset-password-form.tsx");

function recoveredSession() {
  return {
    access_token: "access-token",
    expires_in: 3600,
    refresh_token: "refresh-token",
    token_type: "bearer",
    user: { id: "seller-id" },
  };
}

test("signup callback URLs use the exact current browser origin", () => {
  assert.equal(
    authCallbackUrl("https://www.flockfront.com"),
    "https://www.flockfront.com/auth/callback",
  );
  assert.equal(
    authCallbackUrl("http://localhost:3000"),
    "http://localhost:3000/auth/callback",
  );
  assert.equal(
    authCallbackUrl("http://localhost:3000/"),
    "http://localhost:3000/auth/callback",
  );
});

test("session recovery waits for a delayed Supabase auth event", async () => {
  const session = recoveredSession();
  let callback;
  let unsubscribed = false;
  const auth = {
    async getSession() {
      return { data: { session: null }, error: null };
    },
    onAuthStateChange(nextCallback) {
      callback = nextCallback;
      setTimeout(() => callback("SIGNED_IN", session), 5);
      return {
        data: {
          subscription: {
            unsubscribe() {
              unsubscribed = true;
            },
          },
        },
      };
    },
  };

  const result = await waitForBrowserAuthSession(auth, {
    hasRecoverySignal: true,
    timeoutMs: 100,
  });

  assert.equal(result.error, null);
  assert.equal(result.session, session);
  assert.equal(unsubscribed, true);
});

test("session recovery fails closed immediately for a genuinely unauthenticated visit", async () => {
  let unsubscribed = false;
  const auth = {
    async getSession() {
      return { data: { session: null }, error: null };
    },
    onAuthStateChange() {
      return {
        data: {
          subscription: {
            unsubscribe() {
              unsubscribed = true;
            },
          },
        },
      };
    },
  };

  const result = await waitForBrowserAuthSession(auth, {
    hasRecoverySignal: false,
    timeoutMs: 1000,
  });

  assert.equal(result.session, null);
  assert.match(result.error.message, /No authentication session/);
  assert.equal(unsubscribed, true);
});

test("expired callback links receive a recoverable message", () => {
  assert.match(
    authCallbackError({
      hash: "#error=access_denied&error_code=otp_expired",
      origin: "https://www.flockfront.com",
      search: "",
    }),
    /expired.*Request a new verification email/i,
  );
  assert.equal(
    authCallbackError({
      hash: "",
      origin: "https://www.flockfront.com",
      search: "",
    }),
    null,
  );
});

test("resend errors distinguish rate limits without exposing account existence", () => {
  assert.match(
    friendlyVerificationResendError("Email rate limit exceeded"),
    /wait a minute/i,
  );
  assert.equal(
    friendlyVerificationResendError("User not found"),
    "We could not resend the verification email. Please try again.",
  );
});

test("signup supplies callback URL and preserves immediate-session onboarding", async () => {
  const signup = await readFile(signupPath, "utf8");
  const session = recoveredSession();

  assert.match(signup, /authCallbackUrl\(window\.location\.origin\)/);
  assert.match(signup, /supabase\.auth\.signUp\([\s\S]*?emailRedirectTo: callbackUrl/);
  assert.equal(
    signupSuccessNextStep({ user: { id: "seller-id" }, session }),
    "onboarding",
  );
  assert.match(
    signup,
    /if \(signupSuccessNextStep\(data\) === "onboarding"\)[\s\S]*?router\.push\("\/onboarding"\)/,
  );
});

test("successful signup with the live null-user null-session shape shows check email", async () => {
  const response = {
    data: { user: null, session: null },
    error: null,
  };

  assert.equal(response.error, null);
  assert.equal(signupSuccessNextStep(response.data), "check-email");

  const signup = await readFile(signupPath, "utf8");
  assert.ok(signup.indexOf("if (error)") < signup.indexOf("signupSuccessNextStep(data)"));
  assert.doesNotMatch(signup, /data\.user && !data\.session/);
});

test("no-session signup shows the complete mobile-usable check-email state", async () => {
  const signup = await readFile(signupPath, "utf8");

  assert.match(
    signup,
    /signupSuccessNextStep\(data\) === "onboarding"[\s\S]*?setView\("check-email"\)/,
  );
  assert.match(signup, />\s*Check your email\s*</);
  assert.match(signup, /We sent a verification link to/);
  assert.match(signup, /continue setting up your FlockFront account/);
  assert.match(signup, /Check your spam folder or resend the email/);
  assert.match(signup, />\s*Use a different email\s*</);
  assert.match(signup, />\s*Sign in\s*</);
  assert.match(signup, /break-all[^>]*>\{email\}/);
  assert.match(signup, /min-h-12/);
  assert.match(signup, /sm:grid-cols-2/);
});

test("resend uses the pending email, callback, loading, success, and cooldown states", async () => {
  const signup = await readFile(signupPath, "utf8");

  assert.match(
    signup,
    /supabase\.auth\.resend\(\{[\s\S]*?type: "signup",[\s\S]*?email: normalizedEmail,[\s\S]*?emailRedirectTo: callbackUrl/,
  );
  assert.match(signup, /resendLock\.current/);
  assert.match(signup, /Resending verification email\.\.\./);
  assert.match(signup, /Verification email sent\. Check your inbox and spam folder\./);
  assert.match(signup, /Resend available in \$\{secondsRemaining\}s/);
  assert.match(signup, /friendlyVerificationResendError/);
  assert.match(signup, /We could not resend the verification email\. Please try again\./);
});

test("changing email preserves names and clears both password fields", async () => {
  const signup = await readFile(signupPath, "utf8");
  const changeBlock = signup.match(
    /function useDifferentEmail\(\) \{[\s\S]*?\n  \}/,
  )?.[0] ?? "";

  assert.match(changeBlock, /setEmail\(pendingEmail \|\| email\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(changeBlock, /setPassword\(""\)/);
  assert.match(changeBlock, /setConfirmPassword\(""\)/);
  assert.doesNotMatch(changeBlock, /setFirstName|setLastName|updateUser/);
});

test("callback waits for recovery, validates the user, and routes to onboarding", async () => {
  const callback = await readFile(callbackPath, "utf8");

  assert.match(callback, /authCallbackError\(window\.location\)/);
  assert.match(callback, /waitForBrowserAuthSession\(supabase\.auth/);
  assert.match(callback, /await supabase\.auth\.getUser\(\)/);
  assert.match(callback, /router\.replace\("\/onboarding"\)/);
  assert.match(callback, /expired or has already been used/);
  assert.match(callback, /missing or malformed/);
  assert.match(callback, /href="\/signup\?resend=1"/);
  assert.match(callback, /href="\/login"/);
  assert.match(callback, /href="\/signup"/);
  assert.doesNotMatch(callback, /exchangeCodeForSession|cookies\(|createServerClient/);
});

test("onboarding waits for Auth recovery but still redirects unauthenticated users", async () => {
  const onboarding = await readFile(onboardingPath, "utf8");

  assert.match(onboarding, /waitForBrowserAuthSession\(supabase\.auth/);
  assert.match(onboarding, /hasBrowserAuthRecoverySignal\(window\.location\)/);
  assert.match(
    onboarding,
    /if \(sessionResult\.error \|\| !sessionResult\.session\)[\s\S]*?router\.replace\("\/login"\)/,
  );
  assert.doesNotMatch(onboarding, /hasPersistedSupabaseSession|window\.localStorage/);
});

test("password reset behavior remains on the existing current-origin recovery path", async () => {
  const [request, form] = await Promise.all([
    readFile(resetRequestPath, "utf8"),
    readFile(resetFormPath, "utf8"),
  ]);

  assert.match(request, /const redirectTo = `\$\{window\.location\.origin\}\/reset-password`/);
  assert.match(request, /supabase\.auth\.resetPasswordForEmail/);
  assert.match(form, /event === "PASSWORD_RECOVERY"/);
  assert.match(form, /supabase\.auth\.updateUser\(\{\s*password/);
  assert.match(form, /await supabase\.auth\.signOut\(\)/);
});

test("existing-account handling remains deliberately non-disclosing", async () => {
  const signup = await readFile(signupPath, "utf8");

  assert.equal(
    signupSuccessNextStep({ user: { id: "obfuscated" }, session: null }),
    "check-email",
  );
  assert.doesNotMatch(signup, /account may already exist/i);
  assert.doesNotMatch(signup, /user already registered/i);
  assert.match(signup, /For privacy, we will not\s+confirm whether an account exists/);
});
