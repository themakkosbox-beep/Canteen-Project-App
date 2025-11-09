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

export default function Navigation({ brandName }: NavigationProps) {
  const pathname = usePathname();

  const links = useMemo(
    () =>
      NAV_LINKS.map((link) => {
        const isActive =
          pathname === link.href ||
          (link.href !== "/" && pathname.startsWith(link.href));

        return {
          ...link,
          isActive,
        };
      }),
    [pathname]
  );

  const displayBrand = brandName?.trim()
    ? brandName.trim()
    : `${DEFAULT_BRAND_PRIMARY} ${DEFAULT_BRAND_SECONDARY}`;

  return (
    <header className="bg-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
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
