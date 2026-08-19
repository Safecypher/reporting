import Image from "next/image";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";

/**
 * Server-side session guard (AUTH-03 defence-in-depth) + app shell.
 * proxy.ts already redirects unauthenticated requests before this layout
 * ever renders; this getUser() call is a second, independent enforcement
 * layer in case proxy.ts is ever bypassed or misconfigured (Security
 * Domain V4 — never rely on a single gate).
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-3 py-4">
          <Image src="/logo.svg" alt="Safecypher" width={120} height={26} />
        </SidebarHeader>
        <Separator />
        <SidebarContent className="px-2 py-2">
          <SidebarNav />
        </SidebarContent>
        <SidebarFooter className="px-2 py-2">
          <Separator className="mb-2" />
          <SignOutButton />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <main className="flex flex-1 flex-col">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
