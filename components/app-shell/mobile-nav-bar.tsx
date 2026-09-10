import Image from "next/image";

import { SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Small-viewport-only top bar carrying the sidebar trigger.
 *
 * Below `md` (768px) the shadcn `<Sidebar>` renders as a closed `Sheet`
 * with no built-in opener — this bar is that opener. `md:hidden` below
 * must stay in lockstep with `MOBILE_BREAKPOINT` in `hooks/use-mobile.ts`
 * (also 768px): if one changes without the other, either a dead trigger
 * shows on desktop or a viewport range exists where neither the sidebar
 * nor this bar renders.
 *
 * No client directive needed — this is a plain composition with no state
 * of its own. `SidebarTrigger` is already a client component, and it
 * works here because `SidebarProvider` sits above this tree in the
 * server layout.
 */
export function MobileNavBar() {
  return (
    <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-border bg-background px-3 py-2 md:hidden">
      <SidebarTrigger aria-label="Open navigation" />
      <Image
        src="/logo.svg"
        alt="Safecypher"
        width={120}
        height={26}
        className="h-6 w-auto"
      />
    </header>
  );
}
