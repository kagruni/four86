import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { ConvexProviderWithClerk } from "@/components/providers/convex-provider";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "Four86 - AI Crypto Trading Bot",
  description: "Autonomous AI trading on Hyperliquid DEX",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${inter.variable} ${jetbrainsMono.variable} ${manrope.variable}`}
      >
        <body className={inter.className}>
          <ConvexProviderWithClerk>
            {children}
            <Toaster />
          </ConvexProviderWithClerk>
        </body>
      </html>
    </ClerkProvider>
  );
}
