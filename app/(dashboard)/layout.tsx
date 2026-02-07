"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Activity, Settings, BarChart3, FlaskConical } from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: Activity },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Backtest", href: "/backtest", icon: FlaskConical },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.05)] backdrop-blur-sm bg-white/95">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <Link href="/dashboard" className="flex items-center">
                <span className="font-mono text-2xl font-bold tracking-[0.2em] text-black">
                  FOUR86
                </span>
              </Link>
            </div>
            <nav className="hidden md:flex md:items-center md:space-x-2">
              {navigation.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-black text-white"
                        : "text-gray-500 hover:text-black hover:bg-gray-100"
                    )}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
            <div className="flex items-center">
              <UserButton afterSignOutUrl="/" />
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
