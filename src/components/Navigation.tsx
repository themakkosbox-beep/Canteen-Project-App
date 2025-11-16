"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import Image from "next/image";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/pos", label: "POS" },
  { href: "/transactions", label: "Transactions" },
  { href: "/admin", label: "Admin" },
  { href: "/admin/settings", label: "Admin Settings" },
];

interface NavigationProps {
  brandName: string;
}

const DEFAULT_BRAND_PRIMARY = "Camp Canteen";
const DEFAULT_BRAND_SECONDARY = "Point of Sale";
const DEFAULT_BRAND_TAGLINE = "Camp Canteen POS";

const resolveActiveHref = (pathname: string): string | null => {
  let active: { href: string; score: number } | null = null;

  NAV_LINKS.forEach((link) => {
    let score = 0;
    if (link.href === '/') {
      score = pathname === '/' ? 1 : 0;
    } else if (pathname === link.href) {
      score = link.href.length + 1;
    } else if (pathname.startsWith(`${link.href}/`)) {
      score = link.href.length;
    }

    if (score > 0 && (!active || score > active.score)) {
      active = { href: link.href, score };
    }
  });

  return active?.href ?? (pathname === '/' ? '/' : null);
};

export default function Navigation({ brandName }: NavigationProps) {
  const pathname = usePathname();

  const links = useMemo(() => {
    const activeHref = resolveActiveHref(pathname ?? '/');
    return NAV_LINKS.map((link) => ({
      ...link,
      isActive: activeHref === link.href,
    }));
  }, [pathname]);

  const displayBrand = brandName?.trim()
    ? brandName.trim()
    : `${DEFAULT_BRAND_PRIMARY} ${DEFAULT_BRAND_SECONDARY}`;

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <Image
            alt={`${brandName?.trim() ? brandName.trim() : DEFAULT_BRAND_PRIMARY} identity mark`}
            className="h-9 w-9"
            height={36}
            src="/logo-canteen.svg"
            width={36}
            priority
          />
          <div className="flex flex-col">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-camp-500">
              {brandName ? DEFAULT_BRAND_TAGLINE : DEFAULT_BRAND_PRIMARY}
            </span>
            <span className="text-lg font-semibold text-gray-900">
              {displayBrand}
            </span>
          </div>
        </div>
        <nav className="flex items-center gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                link.isActive
                  ? "bg-camp-500 text-white shadow"
                  : "text-gray-600 hover:bg-camp-50 hover:text-camp-600"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
