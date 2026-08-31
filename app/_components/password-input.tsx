"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

type PasswordInputProps = {
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  autoComplete?: string;
  className?: string;
  disabled?: boolean;
  id: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  value: string;
};

export function PasswordInput({
  ariaDescribedBy,
  ariaInvalid = false,
  autoComplete = "current-password",
  className = "",
  disabled = false,
  id,
  onChange,
  value,
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);
  const toggleLabel = isVisible ? "Hide password" : "Show password";

  return (
    <div className="relative">
      <input
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        autoComplete={autoComplete}
        className={`${className} pr-12`}
        disabled={disabled}
        id={id}
        onChange={onChange}
        type={isVisible ? "text" : "password"}
        value={value}
      />
      <button
        aria-label={toggleLabel}
        aria-pressed={isVisible}
        className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/25 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => setIsVisible((visible) => !visible)}
        type="button"
      >
        {isVisible ? (
          <EyeOff aria-hidden="true" className="size-5" />
        ) : (
          <Eye aria-hidden="true" className="size-5" />
        )}
      </button>
    </div>
  );
}
