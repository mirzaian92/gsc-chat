import "server-only";

import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getValidatedUserId } from "@/lib/auth";
import { getUserById, listUsersForAdmin } from "@/lib/appDb";
import AdminUsersTable from "./AdminUsersTable";

export default async function AdminPage() {
  const session = await getSession();
  const userId = await getValidatedUserId(session);
  if (!userId) redirect("/app");

  const me = await getUserById(userId);
  if (!me || me.role !== "admin") redirect("/app");

  const users = await listUsersForAdmin();

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: 16,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <a href="/app" style={{ color: "#444", textDecoration: "none" }}>
          ← Back to app
        </a>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: "8px 0 6px" }}>Admin</h1>
          <div style={{ fontSize: 13, color: "#444" }}>Manage users and admin role.</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <AdminUsersTable initialUsers={users} />
      </div>
    </main>
  );
}

