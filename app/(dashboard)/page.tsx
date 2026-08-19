import { redirect } from "next/navigation";

/**
 * Dashboard index — Verifications (DASH-01) is the primary authenticated
 * landing view; Uploads (Plan 05) is the secondary nav item. This route has
 * no content of its own.
 */
export default function DashboardIndexPage() {
  redirect("/verifications");
}
