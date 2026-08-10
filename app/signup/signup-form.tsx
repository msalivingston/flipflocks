"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  authCallbackUrl,
  friendlyVerificationResendError,
  signupSuccessNextStep,
} from "@/lib/auth-email-verification";
import { legalRoutes } from "@/lib/legal";
import { supabase } from "@/lib/supabase";

type SignupErrors = {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  form?: string;
};

type SignupView = "form" | "check-email" | "resend-only";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupForm({
  initialResendMode = false,
}: {
  initialResendMode?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<SignupView>(
    initialResendMode ? "resend-only" : "form",
  );
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [errors, setErrors] = useState<SignupErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const resendLock = useRef(false);

  useEffect(() => {
    if (!resendAvailableAt) return;

    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (nextNow >= resendAvailableAt) {
        setResendAvailableAt(0);
        window.clearInterval(timer);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendAvailableAt]);

  const resendSecondsRemaining = resendAvailableAt
    ? Math.max(0, Math.ceil((resendAvailableAt - now) / 1000))
    : 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateSignup({
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
    });

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const callbackUrl = authCallbackUrl(window.location.origin);

    setErrors({});
    setIsSubmitting(true);

    try {
      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: callbackUrl,
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
            },
          },
        }),
        15000,
      );

      if (error) {
        setErrors({ form: friendlyAuthError(error.message) });
        setIsSubmitting(false);
        return;
      }

      if (signupSuccessNextStep(data) === "onboarding") {
        router.push("/onboarding");
        return;
      }

      setPendingEmail(normalizedEmail);
      setEmail(normalizedEmail);
      setResendMessage(null);
      setResendError(null);
      setView("check-email");
      setIsSubmitting(false);
      return;
    } catch {
      setErrors({
        form: "We could not reach the signup service. Please check your connection and try again.",
      });
      setIsSubmitting(false);
    }
  }

  async function handleResendVerification() {
    if (resendLock.current || isResending || resendSecondsRemaining > 0) return;

    const normalizedEmail = (pendingEmail || email).trim().toLowerCase();
    if (!emailPattern.test(normalizedEmail)) {
      setResendMessage(null);
      setResendError("Enter a valid email address.");
      return;
    }

    resendLock.current = true;
    setIsResending(true);
    setResendMessage(null);
    setResendError(null);

    try {
      const callbackUrl = authCallbackUrl(window.location.origin);
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: {
          emailRedirectTo: callbackUrl,
        },
      });

      if (error) {
        const friendlyError = friendlyVerificationResendError(error.message);
        const isRateLimited = friendlyError.startsWith("Please wait");
        setResendError(friendlyError);
        setResendAvailableAt(Date.now() + (isRateLimited ? 60000 : 10000));
        setNow(Date.now());
        return;
      }

      setPendingEmail(normalizedEmail);
      setEmail(normalizedEmail);
      setResendMessage("Verification email sent. Check your inbox and spam folder.");
      setResendAvailableAt(Date.now() + 30000);
      setNow(Date.now());
      if (view === "resend-only") setView("check-email");
    } catch {
      setResendError("We could not resend the verification email. Please try again.");
      setResendAvailableAt(Date.now() + 10000);
      setNow(Date.now());
    } finally {
      resendLock.current = false;
      setIsResending(false);
    }
  }

  function useDifferentEmail() {
    setView("form");
    setEmail(pendingEmail || email.trim().toLowerCase());
    setPassword("");
    setConfirmPassword("");
    setErrors({});
    setResendMessage(null);
    setResendError(null);
  }

  if (view === "check-email") {
    return (
      <CheckEmailState
        email={pendingEmail}
        isResending={isResending}
        onResend={() => void handleResendVerification()}
        onUseDifferentEmail={useDifferentEmail}
        resendError={resendError}
        resendMessage={resendMessage}
        resendSecondsRemaining={resendSecondsRemaining}
      />
    );
  }

  if (view === "resend-only") {
    return (
      <section className="rounded-[0.95rem] bg-white px-4 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
        <h2 className="font-serif text-[1.55rem] font-semibold leading-tight text-stone-950 sm:text-[1.8rem]">
          Resend verification email
        </h2>
        <p className="mt-2 text-sm font-medium leading-6 text-stone-600">
          Enter the email address you used to sign up. For privacy, we will not
          confirm whether an account exists.
        </p>
        <div className="mt-4 space-y-3">
          <Field
            autoComplete="email"
            id="resend-email"
            inputMode="email"
            label="Email address"
            onChange={setEmail}
            type="email"
            value={email}
          />
          <ResendFeedback error={resendError} message={resendMessage} />
          <button
            className="flex min-h-12 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-base font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-10 sm:text-[15px]"
            disabled={isResending || resendSecondsRemaining > 0}
            onClick={() => void handleResendVerification()}
            type="button"
          >
            {resendButtonLabel(isResending, resendSecondsRemaining)}
          </button>
          <div className="flex flex-col gap-2 border-t border-stone-200 pt-3 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between">
            <Link className="text-[#1f6f38] underline underline-offset-2" href="/signup">
              Return to signup
            </Link>
            <Link className="text-[#1f6f38] underline underline-offset-2" href="/login">
              Sign in
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[0.95rem] bg-white px-4 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
      <h2 className="font-serif text-[1.55rem] font-semibold leading-tight text-stone-950 sm:text-[1.8rem]">
        Create your account
      </h2>

      <form className="mt-3.5 space-y-3" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            autoComplete="given-name"
            error={errors.firstName}
            id="first-name"
            label="First name *"
            onChange={setFirstName}
            value={firstName}
          />
          <Field
            autoComplete="family-name"
            error={errors.lastName}
            id="last-name"
            label="Last name *"
            onChange={setLastName}
            value={lastName}
          />
        </div>

        <Field
          autoComplete="email"
          error={errors.email}
          id="email"
          inputMode="email"
          label="Email address *"
          onChange={setEmail}
          type="email"
          value={email}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Field
              autoComplete="new-password"
              error={errors.password}
              id="password"
              label="Password *"
              onChange={setPassword}
              type="password"
              value={password}
            />
            <p className="mt-1 text-sm font-normal text-stone-600 sm:text-[13px] sm:text-stone-500">
              Use at least 8 characters.
            </p>
          </div>
          <Field
            autoComplete="new-password"
            error={errors.confirmPassword}
            id="confirm-password"
            label="Confirm password *"
            onChange={setConfirmPassword}
            type="password"
            value={confirmPassword}
          />
        </div>

        {errors.form ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            role="alert"
          >
            {errors.form}
          </p>
        ) : null}

        <p className="rounded-lg border border-[#dbe8d8] bg-[#fffaf1] px-3 py-2 text-sm font-semibold leading-5 text-stone-600 sm:text-[13px]">
          Plans start at $5/month or $50/year. Market is $29/month or
          $270/year for active sellers who need more room and more sale types.
          You&apos;ll choose your plan after setting up your farm basics.
        </p>

        <button
          className="flex min-h-12 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-base font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-10 sm:text-[15px]"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Creating your account..." : "Create my farm store"}
        </button>

        <p className="px-1 text-center text-sm leading-5 text-stone-500 sm:text-[13px]">
          By creating an account, you agree to our{" "}
          <Link
            className="font-semibold text-[#1f6f38] underline underline-offset-2"
            href={legalRoutes.terms}
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            className="whitespace-nowrap font-semibold text-[#1f6f38] underline underline-offset-2"
            href={legalRoutes.privacy}
          >
            Privacy Policy
          </Link>
          .
        </p>

        <div className="border-t border-stone-200 pt-3 text-center text-sm text-stone-500">
          Already have an account?{" "}
          <Link
            className="font-bold text-[#1f6f38] underline underline-offset-2"
            href="/login"
          >
            Sign in
          </Link>
        </div>
      </form>
    </section>
  );
}

function CheckEmailState({
  email,
  isResending,
  onResend,
  onUseDifferentEmail,
  resendError,
  resendMessage,
  resendSecondsRemaining,
}: {
  email: string;
  isResending: boolean;
  onResend: () => void;
  onUseDifferentEmail: () => void;
  resendError: string | null;
  resendMessage: string | null;
  resendSecondsRemaining: number;
}) {
  return (
    <section className="rounded-[0.95rem] bg-white px-4 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
      <h2 className="font-serif text-[1.65rem] font-semibold leading-tight text-stone-950 sm:text-[1.9rem]">
        Check your email
      </h2>
      <p className="mt-3 text-base font-medium leading-7 text-stone-700">
        We sent a verification link to{" "}
        <strong className="break-all text-stone-950">{email}</strong>. Click the
        link to verify your email and continue setting up your FlockFront account.
      </p>
      <p className="mt-3 rounded-lg border border-[#dbe8d8] bg-[#fffaf1] px-3 py-2 text-sm font-semibold leading-6 text-stone-600">
        Don&apos;t see it? Check your spam folder or resend the email.
      </p>

      <div className="mt-4 space-y-3">
        <ResendFeedback error={resendError} message={resendMessage} />
        <button
          className="flex min-h-12 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-base font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-10 sm:text-[15px]"
          disabled={isResending || resendSecondsRemaining > 0}
          onClick={onResend}
          type="button"
        >
          {resendButtonLabel(isResending, resendSecondsRemaining)}
        </button>
        <button
          className="flex min-h-12 w-full items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-[#1f6f38] shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 sm:min-h-10 sm:text-[15px]"
          onClick={onUseDifferentEmail}
          type="button"
        >
          Use a different email
        </button>
      </div>

      <p className="mt-4 border-t border-stone-200 pt-3 text-center text-sm font-medium text-stone-600">
        Already have an account?{" "}
        <Link className="font-bold text-[#1f6f38] underline underline-offset-2" href="/login">
          Sign in
        </Link>
      </p>
    </section>
  );
}

function ResendFeedback({
  error,
  message,
}: {
  error: string | null;
  message: string | null;
}) {
  if (error) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-800" role="alert">
        {error}
      </p>
    );
  }

  return message ? (
    <p className="rounded-lg border border-[#b7d7b9] bg-[#eff8ed] px-3 py-2 text-sm font-semibold leading-6 text-[#16572a]" role="status">
      {message}
    </p>
  ) : null;
}

function resendButtonLabel(isResending: boolean, secondsRemaining: number) {
  if (isResending) return "Resending verification email...";
  if (secondsRemaining > 0) return `Resend available in ${secondsRemaining}s`;
  return "Resend verification email";
}

type FieldProps = {
  autoComplete?: string;
  error?: string;
  id: string;
  inputMode?: "email";
  label: string;
  onChange: (value: string) => void;
  type?: "email" | "password" | "text";
  value: string;
};

function Field({
  autoComplete,
  error,
  id,
  inputMode,
  label,
  onChange,
  type = "text",
  value,
}: FieldProps) {
  const errorId = `${id}-error`;

  return (
    <div>
      <label className="text-sm font-bold text-stone-950 sm:text-[13px]" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        autoComplete={autoComplete}
        className={`mt-1 min-h-12 w-full rounded-md border bg-white px-3 text-base font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:ring-2 focus:ring-[#246f38]/25 sm:min-h-10 sm:text-[15px] ${
          error
            ? "border-red-400 focus:border-red-500"
            : "border-stone-300 focus:border-[#246f38]"
        }`}
        id={id}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
      {error ? (
        <p className="mt-1 text-sm font-semibold text-red-700 sm:text-[13px]" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function validateSignup({
  firstName,
  lastName,
  email,
  password,
  confirmPassword,
}: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}) {
  const nextErrors: SignupErrors = {};

  if (!firstName.trim()) nextErrors.firstName = "Enter your first name.";
  if (!lastName.trim()) nextErrors.lastName = "Enter your last name.";

  if (!email.trim()) {
    nextErrors.email = "Enter your email address.";
  } else if (!emailPattern.test(email.trim())) {
    nextErrors.email = "Enter a valid email address.";
  }

  if (!password) {
    nextErrors.password = "Create a password.";
  } else if (password.length < 8) {
    nextErrors.password = "Use at least 8 characters.";
  }

  if (!confirmPassword) {
    nextErrors.confirmPassword = "Confirm your password.";
  } else if (password !== confirmPassword) {
    nextErrors.confirmPassword = "Passwords do not match.";
  }

  return nextErrors;
}

function friendlyAuthError(message: string) {
  if (message.toLowerCase().includes("already")) {
    return "We could not complete signup. Try signing in, resetting your password, or using a different email.";
  }

  return message || "We could not create your account. Please try again.";
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Request timed out."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
