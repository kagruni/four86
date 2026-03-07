"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { useState, useEffect } from "react";
import ThemeToggle from "@/app/components/ThemeToggle";

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
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 backdrop-blur-sm bg-background/95">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            {/* Logo */}
            <div className="flex items-center">
              <Link href="/" className="flex items-center">
                <Image
                  src="/vectorlogo.svg"
                  alt="Four86"
                  width={80}
                  height={38}
                  className="h-8 w-auto dark:invert"
                  priority
                />
              </Link>
            </div>

            {/* Desktop nav */}
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
                        ? "text-foreground"
                        : "text-foreground/40 hover:text-foreground"
                    )}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-4">
              <ThemeToggle />
              {mounted && <UserButton afterSignOutUrl="/" />}

              {/* Hamburger button (mobile) */}
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5 cursor-pointer"
                aria-label="Toggle menu"
              >
                <span
                  className={cn(
                    "block h-px w-5 bg-foreground transition-all duration-200",
                    menuOpen && "translate-y-[3.5px] rotate-45"
                  )}
                />
                <span
                  className={cn(
                    "block h-px w-5 bg-foreground transition-all duration-200",
                    menuOpen && "opacity-0"
                  )}
                />
                <span
                  className={cn(
                    "block h-px w-5 bg-foreground transition-all duration-200",
                    menuOpen && "-translate-y-[3.5px] -rotate-45"
                  )}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-border/50 bg-background">
            <div className="px-4 py-4 space-y-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      "block py-2 font-mono text-sm uppercase tracking-[0.15em] transition-colors",
                      isActive
                        ? "text-foreground"
                        : "text-foreground/40 hover:text-foreground"
                    )}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
