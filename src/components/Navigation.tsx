"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/pos", label: "POS" },
  { href: "/operations", label: "Operations" },
  { href: "/transactions", label: "Transactions" },
  { href: "/admin", label: "Catalog" },
  { href: "/admin/settings", label: "Settings" },
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
  const [resolvedBrand, setResolvedBrand] = useState(brandName);

  useEffect(() => {
    let active = true;
    const loadBrand = async () => {
      try {
        const response = await fetch("/api/settings/brand");
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { brandName?: string };
        if (active && payload?.brandName) {
          setResolvedBrand(payload.brandName);
        }
      } catch {
        // fall back to the server-provided brand
      }
    };

    void loadBrand();
    return () => {
      active = false;
    };
  }, []);

  const links = useMemo(() => {
    const activeHref = resolveActiveHref(pathname ?? '/');
    return NAV_LINKS.map((link) => ({
      ...link,
      isActive: activeHref === link.href,
    }));
  }, [pathname]);

  const displayBrand = resolvedBrand?.trim()
    ? resolvedBrand.trim()
    : `${DEFAULT_BRAND_PRIMARY} ${DEFAULT_BRAND_SECONDARY}`;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 shadow-soft">
            <Image
              alt={`${resolvedBrand?.trim() ? resolvedBrand.trim() : DEFAULT_BRAND_PRIMARY} identity mark`}
              className="h-8 w-8"
              height={32}
              src="/logo-canteen.svg"
              width={32}
              priority
            />
          </div>
          <div className="flex flex-col">
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-emerald-600">
              {resolvedBrand ? DEFAULT_BRAND_TAGLINE : DEFAULT_BRAND_PRIMARY}
            </span>
            <span className="text-lg font-semibold text-gray-900">
              {displayBrand}
            </span>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                link.isActive
                  ? "bg-emerald-600 text-white shadow-soft"
                  : "text-gray-600 hover:bg-emerald-50 hover:text-emerald-700"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/pos"
            className="pos-button px-4 py-2 text-xs sm:text-sm"
          >
            Start Register
          </Link>
        </nav>
      </div>
    </header>
  );
}
