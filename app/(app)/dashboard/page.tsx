import { redirect } from "next/navigation";

/** The home screen moved from /dashboard. Keep old links working. */
export default function DashboardPage() {
  redirect("/home");
}
