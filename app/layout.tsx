import type { Metadata } from "next";
import "./globals.css";
import "./utility-nav.css";
import "./veo-controls.css";

export const metadata: Metadata = {
  title: "Persistent AI Video Studio",
  description: "Persistent projects, multi-profile Veo generation, local-first media.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <nav className="utility-nav" aria-label="Studio utility navigation">
          <a href="/">Workspace</a>
          <a href="/extensions">Extensions</a>
          <a href="/setup">Setup</a>
          <a href="/profiles">Profiles</a>
        </nav>
      </body>
    </html>
  );
}
