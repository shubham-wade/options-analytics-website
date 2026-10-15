import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "NIFTY Risk Lab",
  description: "Read-only Zerodha analytics for NIFTY option scenario P&L and Greeks.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("nrl-theme")?.value;
  const dark = theme !== "light";

  return (
    <html
      lang="en"
      className={[dark ? "dark" : "", sans.variable, mono.variable].filter(Boolean).join(" ")}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
