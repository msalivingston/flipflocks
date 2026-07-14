"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

type SignupErrors = {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  form?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<SignupErrors>({});
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateSignup({
      firstName,
      lastName,
      email,
      password,
    });

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
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

      if (data.user && data.session) {
        router.push("/onboarding");
        return;
      }

      if (data.user && !data.session) {
        setSuccessMessage(
          "Account created. Please check your email to confirm your account, then sign in to continue setup.",
        );
        setIsSubmitting(false);
        return;
      }

      setErrors({
        form: "We could not confirm that your account was created. Please try again.",
      });
      setIsSubmitting(false);
    } catch {
      setErrors({
        form: "We could not reach the signup service. Please check your connection and try again.",
      });
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-[0.95rem] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
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
          <p className="mt-1 text-xs font-normal text-stone-500 sm:text-[13px]">
            Use at least 8 characters.
          </p>
        </div>

        {errors.form ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            role="alert"
          >
            {errors.form}
          </p>
        ) : null}

        {successMessage ? (
          <div
            className="rounded-lg border border-[#b7d7b9] bg-[#eff8ed] px-3 py-2 text-sm font-semibold leading-6 text-[#16572a]"
            role="status"
          >
            <p>{successMessage}</p>
            <Link
              className="mt-1 inline-block font-bold underline underline-offset-2"
              href="/login"
            >
              Sign in
            </Link>
          </div>
        ) : null}

        <p className="rounded-lg border border-[#dbe8d8] bg-[#fffaf1] px-3 py-2 text-xs font-semibold leading-5 text-stone-600 sm:text-[13px]">
          Plans start at $5/month or $50/year. Full Flock is $29/month or
          $270/year for active sellers who need more room and more sale types.
          You&apos;ll choose your plan after setting up your farm basics.
        </p>

        <button
          className="flex min-h-10 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:text-[15px]"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Creating your account..." : "Create my farm store"}
        </button>

        <p className="px-1 text-center text-xs leading-5 text-stone-500 sm:text-[13px]">
          By creating an account, you agree to our{" "}
          <Link
            className="font-semibold text-[#1f6f38] underline underline-offset-2"
            href="#"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            className="whitespace-nowrap font-semibold text-[#1f6f38] underline underline-offset-2"
            href="#"
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
      <label className="text-xs font-bold text-stone-950 sm:text-[13px]" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        autoComplete={autoComplete}
        className={`mt-1 min-h-10 w-full rounded-md border bg-white px-3 text-sm font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:ring-2 focus:ring-[#246f38]/25 sm:text-[15px] ${
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
        <p className="mt-1 text-xs font-semibold text-red-700 sm:text-[13px]" id={errorId}>
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
}: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}) {
  const nextErrors: SignupErrors = {};

  if (!firstName.trim()) {
    nextErrors.firstName = "Enter your first name.";
  }

  if (!lastName.trim()) {
    nextErrors.lastName = "Enter your last name.";
  }

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

  return nextErrors;
}

function friendlyAuthError(message: string) {
  if (message.toLowerCase().includes("already")) {
    return "An account may already exist for this email. Try signing in instead.";
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
