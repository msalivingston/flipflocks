import Link from "next/link";

type PublicSignupCtaProps = Readonly<{
  children: React.ReactNode;
  className: string;
  disabledClassName?: string;
  href?: "/signup";
  sellerSignupsEnabled: boolean;
}>;

export function PublicSignupCta({
  children,
  className,
  disabledClassName = "",
  href = "/signup",
  sellerSignupsEnabled,
}: PublicSignupCtaProps) {
  if (!sellerSignupsEnabled) {
    return (
      <button
        aria-disabled="true"
        className={`${className} cursor-not-allowed opacity-65 ${disabledClassName}`}
        disabled
        type="button"
      >
        Coming Soon
      </button>
    );
  }

  return (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}
