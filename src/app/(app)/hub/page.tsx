import { redirect } from "next/navigation";

/** The old workspace picker. The sidebar replaced it; kept so bookmarks and old links still land somewhere. */
export default function HubPage() {
  redirect("/dashboard");
}
