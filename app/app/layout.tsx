import "server-only";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getValidatedUserId } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const userId = await getValidatedUserId(session);
  if (!userId) redirect("/");
  return children;
}
