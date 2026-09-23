"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Collapsible } from "radix-ui";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

const SETTINGS_ITEMS = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/pricing", label: "Pricing" },
] as const;

/**
 * Collapsible "Settings" group for the sidebar footer (D-01/D-02/D-04).
 * Sits above SignOutButton, holding the two configuration-surface links
 * that used to live mid-list in SidebarNav's flat NAV_ITEMS (D-05).
 */
export function SettingsNav() {
  const pathname = usePathname();
  const inSettings = pathname?.startsWith("/settings") ?? false;

  return (
    <SidebarMenu>
      <Collapsible.Root
        asChild
        // D-03: remounting on section-entry/exit (via `key`) re-reads
        // defaultOpen on every fresh mount, so a direct URL load, a
        // back/forward navigation and an in-app link click all land
        // expanded when under /settings. Do NOT replace this with a
        // useEffect that syncs state after render — that would flash
        // collapsed before expanding and racily fight manual toggles.
        defaultOpen={inSettings}
        key={inSettings ? "in-settings" : "outside"}
        className="group/collapsible"
      >
        <SidebarMenuItem>
          <Collapsible.Trigger asChild>
            <SidebarMenuButton>
              <svg aria-hidden="true" className="size-4">
                <use href="/icons.svg#cog" />
              </svg>
              <span>Settings</span>
              <svg
                aria-hidden="true"
                className="ml-auto size-4 transition-transform motion-reduce:transition-none group-data-[state=open]/collapsible:rotate-90"
              >
                <use href="/icons.svg#arrow-right" />
              </svg>
            </SidebarMenuButton>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <SidebarMenuSub>
              {SETTINGS_ITEMS.map((item) => {
                const isActive = pathname?.startsWith(item.href) ?? false;

                return (
                  <SidebarMenuSubItem key={item.href}>
                    <SidebarMenuSubButton asChild isActive={isActive}>
                      <Link href={item.href}>
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              })}
            </SidebarMenuSub>
          </Collapsible.Content>
        </SidebarMenuItem>
      </Collapsible.Root>
    </SidebarMenu>
  );
}
