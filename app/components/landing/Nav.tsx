"use client";

import Image from "next/image";
import Link from "next/link";

interface NavProps {
  isSignedIn?: boolean;
}

export default function Nav({ isSignedIn = false }: NavProps) {
  const navItems = [
    { label: "Proof", href: "#proof" },
    { label: "Pricing", href: "#pricing" },
    { label: "How it works", href: "#how-it-works" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-sm border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center">
          <Image
            src="/vectorlogo.svg"
            alt="Four86"
            width={80}
            height={38}
            className="h-8 w-auto invert"
            priority
          />
        </Link>

        {/* Center nav links */}
        <div className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-xs font-mono text-white/40 hover:text-white transition-colors tracking-[0.15em] uppercase"
            >
              {item.label}
            </a>
          ))}
        </div>

        {/* Right CTA */}
        <div className="flex items-center gap-4">
          {isSignedIn && (
            <Link
              href="/dashboard"
              className="hidden md:inline-block text-xs font-mono text-white/40 hover:text-white transition-colors tracking-[0.15em] uppercase"
            >
              Dashboard
            </Link>
          )}
          <a
            href="#hero"
            className="text-xs font-mono text-white border border-white/40 px-5 py-2 uppercase tracking-[0.15em] hover:bg-white hover:text-black hover:border-white transition-colors"
          >
            Join waitlist
          </a>
        </div>
      </div>
    </nav>
  );
}
