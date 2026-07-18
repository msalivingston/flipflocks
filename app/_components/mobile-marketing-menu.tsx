import Link from "next/link";

type MobileMarketingMenuLink = {
  href: string;
  label: string;
};

export function MobileMarketingMenu({
  currentHref,
  links,
  variant = "hero",
}: Readonly<{
  currentHref?: string;
  links: MobileMarketingMenuLink[];
  variant?: "hero" | "light";
}>) {
  const isHero = variant === "hero";
  const buttonClassName = isHero
    ? "flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-white/35 bg-black/20 px-3 text-[15px] font-bold text-white/95 shadow-sm shadow-black/10 outline-none transition hover:bg-black/28 peer-focus-visible:ring-2 peer-focus-visible:ring-white/80"
    : "flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-[#d9cdb9] bg-white/60 px-3 text-[15px] font-bold text-[#10281c] shadow-sm shadow-[#6d532b]/5 outline-none transition hover:bg-[#fff4df] peer-focus-visible:ring-2 peer-focus-visible:ring-[#0e4a2d]";
  const menuClassName = isHero
    ? "absolute right-0 top-full z-20 mt-3 hidden w-44 gap-1 rounded-lg border border-white/25 bg-[#173322]/95 p-2 text-[15px] font-bold text-white shadow-xl shadow-black/25 backdrop-blur-sm peer-checked:grid"
    : "absolute right-0 top-full z-20 mt-3 hidden w-44 gap-1 rounded-lg border border-[#e8deca] bg-white/95 p-2 text-[15px] font-bold text-[#10281c] shadow-xl shadow-[#6d532b]/15 backdrop-blur-sm peer-checked:grid";
  const linkClassName = isHero
    ? "rounded-md px-3 py-2.5 transition hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
    : "rounded-md px-3 py-2.5 transition hover:bg-[#fff4df] focus-visible:bg-[#fff4df] focus-visible:outline-none";
  const activeLinkClassName = isHero
    ? "bg-white/10 text-white"
    : "bg-[#fff4df] text-[#0e4a2d]";

  return (
    <div className="relative md:hidden">
      <input
        id="mobile-marketing-menu-toggle"
        type="checkbox"
        aria-label="Menu"
        aria-controls="mobile-marketing-menu"
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
      <label
        htmlFor="mobile-marketing-menu-toggle"
        className={buttonClassName}
      >
        <span className="flex size-4 flex-col justify-center gap-1" aria-hidden="true">
          <span className="h-0.5 rounded-full bg-current" />
          <span className="h-0.5 rounded-full bg-current" />
          <span className="h-0.5 rounded-full bg-current" />
        </span>
        <span className="sr-only">Menu</span>
      </label>

      <nav
        id="mobile-marketing-menu"
        aria-label="Mobile primary navigation"
        className={menuClassName}
      >
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={link.href === currentHref ? "page" : undefined}
            className={`${linkClassName} ${
              link.href === currentHref ? activeLinkClassName : ""
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
