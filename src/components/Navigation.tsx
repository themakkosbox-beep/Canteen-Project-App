"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/pos", label: "POS" },
  { href: "/admin", label: "Admin" },
];

export default function Navigation() {
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

  return (
    <header className="bg-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="text-lg font-semibold text-camp-700">Camp Canteen POS</div>
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
