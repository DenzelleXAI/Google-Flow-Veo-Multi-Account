"use client";

import { usePathname } from "next/navigation";

export default function UtilityNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav className="utility-nav" aria-label="Studio utility navigation">
      <a href="/">Workspace</a>
      <a href="/assets">Assets</a>
      <a href="/generations">History</a>
      <a href="/extensions">Extensions</a>
      <a href="/backups">Backups</a>
      <a href="/setup">Setup</a>
      <a href="/profiles">Profiles</a>
      <a href="/logout">Logout</a>
    </nav>
  );
}
