import type { Metadata } from "next";
import { Unbounded, Manrope } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getSessionUser } from "@/lib/auth";

const display = Unbounded({
  subsets: ["latin", "cyrillic"],
  variable: "--font-display",
});

const body = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Xdesk — IT Helpdesk",
  description: "Простая система заявок для IT-отдела",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getSessionUser();

  return (
    <html lang="ru">
      <body className={`${display.variable} ${body.variable}`}>
        <div className={user ? "portal-shell" : "shell public-shell"}>
          <Header user={user} />
          <main className={user ? "portal-main" : "public-main"}>{children}</main>
          <Footer portal={Boolean(user)} />
        </div>
      </body>
    </html>
  );
}
