import type { Metadata } from "next";
import UtilityNav from "./utility-nav";
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
        <UtilityNav />
      </body>
    </html>
  );
}
