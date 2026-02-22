"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  created_at: string;
  questions_used: number;
};

type SetRoleResponse =
  | { id: string; email: string; name: string | null; role: "user" | "admin"; created_at: string }
  | { error: string };

export default function AdminUsersTable({ initialUsers }: { initialUsers: AdminUserRow[] }) {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserRow[]>(initialUsers);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const adminsCount = useMemo(() => users.filter((u) => u.role === "admin").length, [users]);

  async function setRole(email: string, role: "user" | "admin") {
    setError("");
    setBusyEmail(email);
    try {
      const res = await fetch("/api/admin/set-role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const json = (await res.json().catch(() => ({}))) as SetRoleResponse;
      if (!res.ok) {
        if ("error" in json && typeof json.error === "string") throw new Error(json.error);
        throw new Error(`Failed to update role (${res.status}).`);
      }
      if ("error" in json) throw new Error(json.error);

      setUsers((prev) =>
        prev.map((u) => (u.email.toLowerCase() === email.toLowerCase() ? { ...u, role: json.role } : u)),
      );

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role.");
    } finally {
      setBusyEmail(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 12, color: "#444" }}>
        Total users: {users.length} • Admins: {adminsCount}
      </div>

      {error ? (
        <div style={{ padding: 10, border: "1px solid #f5c2c7", background: "#f8d7da", color: "#842029", borderRadius: 8 }}>
          {error}
        </div>
      ) : null}

      <div style={{ overflowX: "auto", border: "1px solid #e5e5e5", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#fafafa" }}>
              <th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e5e5" }}>Email</th>
              <th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e5e5" }}>Name</th>
              <th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e5e5" }}>Created</th>
              <th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e5e5" }}>Role</th>
              <th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e5e5" }}>Questions used</th>
              <th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e5e5" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const busy = busyEmail?.toLowerCase() === u.email.toLowerCase();
              return (
                <tr key={u.id}>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>{u.email}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0" }}>{u.name ?? "—"}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>
                    {new Date(u.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0" }}>{u.role}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0" }}>{u.questions_used}</td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>
                    {u.role === "admin" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void setRole(u.email, "user")}
                        style={{
                          fontSize: 12,
                          padding: "7px 10px",
                          borderRadius: 8,
                          border: "1px solid #e5e5e5",
                          background: "#fff",
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        Remove admin
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void setRole(u.email, "admin")}
                        style={{
                          fontSize: 12,
                          padding: "7px 10px",
                          borderRadius: 8,
                          border: "1px solid #111",
                          background: "#111",
                          color: "#fff",
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        Make admin
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 16, color: "#666" }}>
                  No users found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

