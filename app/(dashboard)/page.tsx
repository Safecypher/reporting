/**
 * Dashboard index. Verifications (DASH-01) is the primary authenticated view
 * and is built in Plan 01-06 (Wave 3). Until it exists, this index renders a
 * lightweight placeholder inside the app shell so the authenticated area
 * (sidebar, sign out) is reachable rather than bouncing to a 404.
 *
 * INTERIM (remove in 01-06): once /verifications exists, either restore
 * `redirect("/verifications")` here or make this a real landing.
 */
export default function DashboardIndexPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-lg font-medium text-foreground">
        Verifications
      </h1>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        The verifications-over-time view is coming in the next step. You are
        signed in — use the sidebar to navigate or sign out.
      </p>
    </div>
  );
}
