import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { ConvexProviderWithClerk } from "@/components/providers/convex-provider";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"] });

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
      <html lang="en" className="dark">
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
