"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { useState, useEffect } from "react";

const navigation = [
  { name: "Dashboard", href: "/dashboard" },
  { name: "Analytics", href: "/analytics" },
  { name: "Backtest", href: "/backtest" },
  { name: "Settings", href: "/settings" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-black/10 backdrop-blur-sm bg-white/95">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center">
              <Link href="/" className="flex items-center">
                <Image
                  src="/vectorlogo.svg"
                  alt="Four86"
                  width={80}
                  height={38}
                  className="h-8 w-auto"
                  priority
                />
              </Link>
            </div>
            <nav className="hidden md:flex md:items-center md:gap-6">
              {navigation.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "font-mono text-xs uppercase tracking-[0.15em] transition-colors",
                      isActive
                        ? "text-black"
                        : "text-black/40 hover:text-black"
                    )}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </nav>
            <div className="flex items-center">
              {mounted && <UserButton afterSignOutUrl="/" />}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
