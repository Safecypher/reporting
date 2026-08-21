"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { href: "/uploads", label: "Uploads", icon: "database" },
  { href: "/verifications", label: "Verifications", icon: "chart" },
  { href: "/revenue", label: "Revenue", icon: "bank" },
  { href: "/sla", label: "SLA", icon: "signal" },
  { href: "/settings/pricing", label: "Pricing", icon: "cog" },
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
        const isActive = pathname?.startsWith(item.href) ?? false;

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
