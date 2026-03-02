import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * Global Inter font configuration sourced from Google Fonts.
 * Kept local to avoid external fetch delays or CORS issues on deployment.
 */
const inter = Inter({ subsets: ["latin"] });

/**
 * Global SEO and Browser Tab Metadata configuration.
 * Next.js automatically injects these into the <head> tag.
 */
export const metadata: Metadata = {
  title: "Agentic Prompt Builder",
  description: "Um pipeline de 3 IAs trabalhando em conjunto para transformar sua ideia bruta no prompt perfeito.",
};

/**
 * Root Application Layout.
 * Wraps all pages. Contains typography definitions, global background colors,
 * and suppresses hydration warnings caused by browser extensions.
 * 
 * @param props.children The nested routes and page content.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${inter.className} antialiased bg-zinc-950 text-zinc-50`} >
        {children}
      </body>
    </html>
  );
}