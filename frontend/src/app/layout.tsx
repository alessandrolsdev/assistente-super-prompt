import type { Metadata } from "next";
import { Syne, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Fontes da aplicação, carregadas e auto-hospedadas por next/font.
 *
 * Antes elas vinham de um `@import url('https://fonts.googleapis.com/...')`
 * dentro de duas tags <style> em `page.tsx`, o que gerava um fetch externo
 * bloqueante a cada render. Aqui elas são baixadas no build e expostas como
 * variáveis CSS consumidas por `globals.css`.
 */
const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

/**
 * Metadados globais de SEO e da aba do navegador.
 * O Next.js injeta automaticamente no <head>.
 */
export const metadata: Metadata = {
  title: "Agentic Prompt Builder",
  description:
    "Pipeline de multiplos agentes LLM que transforma uma ideia bruta em um prompt otimizado.",
};

/**
 * Layout raiz da aplicação.
 * Envolve todas as páginas, define tipografia e cores de fundo globais e
 * suprime avisos de hidratação causados por extensões do navegador.
 *
 * @param props.children Rotas aninhadas e conteúdo da página.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${syne.variable} ${jetbrainsMono.variable} antialiased bg-zinc-950 text-zinc-50`}
      >
        {children}
      </body>
    </html>
  );
}
