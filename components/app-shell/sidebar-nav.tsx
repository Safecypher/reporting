"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  // Home is inserted FIRST (D-04): before this plan, nothing in the app
  // linked back to the root route, and the home page is the leadership
  // landing surface, so it must be reachable from every other screen.
  { href: "/", label: "Home", icon: "eye" },
  { href: "/uploads", label: "Uploads", icon: "database" },
  { href: "/verifications", label: "Verifications", icon: "chart" },
  { href: "/cards", label: "Cards", icon: "card" },
  { href: "/revenue", label: "Revenue", icon: "bank" },
  { href: "/sla", label: "SLA", icon: "signal" },
  { href: "/reconciliation", label: "Reconciliation", icon: "rotate" },
  { href: "/alignment", label: "Alignment", icon: "layers" },
] as const;

/**
 * Sidebar navigation for the authenticated app shell. Active item is styled
 * Cypher Blue via SidebarMenuButton's data-active state (already wired to
 * --sidebar-primary/--sidebar-accent-foreground in app/globals.css).
 */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <SidebarMenu>
      {NAV_ITEMS.map((item) => {
        // UI-SPEC E8: the root route needs an EXACT-match special case. A
        // plain prefix comparison (item.href a prefix of the current path)
        // is correct for every other entry, but "/" is a prefix of every
        // path in the app once it's in this list — without this branch,
        // Home would stay highlighted on every route, showing two active
        // entries at once (06-PATTERNS.md's explicit caution).
        const isActive =
          item.href === "/" ? pathname === "/" : (pathname?.startsWith(item.href) ?? false);

        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link href={item.href}>
                <svg aria-hidden="true" className="size-4">
                  <use href={`/icons.svg#${item.icon}`} />
                </svg>
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
