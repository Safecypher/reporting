import { redirect } from "next/navigation";

/**
 * Dashboard index. Verifications (DASH-01) is the primary authenticated view
 * — redirect straight there. This restores the redirect that Plan 01-02 left
 * as an interim placeholder pending this plan (01-06) building /verifications.
 */
export default function DashboardIndexPage() {
  redirect("/verifications");
}
