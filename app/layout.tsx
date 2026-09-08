import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Persistent AI Video Studio",
  description: "Persistent projects, multi-profile Veo generation, local-first media.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
