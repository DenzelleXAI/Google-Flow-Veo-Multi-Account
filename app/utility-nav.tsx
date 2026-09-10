"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

export default function UtilityNav() {
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  if (pathname === "/login") return null;

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      window.location.assign("/login");
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <nav className="utility-nav" aria-label="Studio utility navigation">
      <a href="/">Workspace</a>
      <a href="/assets">Assets</a>
      <a href="/generations">History</a>
      <a href="/extensions">Extensions</a>
      <a href="/backups">Backups</a>
      <a href="/setup">Setup</a>
      <a href="/profiles">Profiles</a>
      <button type="button" onClick={logout} disabled={loggingOut}>
        {loggingOut ? "Logging out…" : "Logout"}
      </button>
    </nav>
  );
}
