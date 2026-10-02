import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PR Understanding · Know what you ship",
  description: "Understand your pull request, test your knowledge, and earn a verified GitHub check.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
