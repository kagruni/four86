"use client";

import Image from "next/image";
import Link from "next/link";
import GameOfLife from "./GameOfLife";
import WaitlistForm from "./WaitlistForm";

interface HeroProps {
  isSignedIn?: boolean;
}

export default function Hero({ isSignedIn = false }: HeroProps) {
  const navItems = [
    { label: "Proof", href: "#proof" },
    { label: "Pricing", href: "#pricing" },
    { label: "How it works", href: "#how-it-works" },
  ];

  return (
    <section
      id="hero"
      className="relative min-h-screen bg-black overflow-hidden flex flex-col"
    >
      {/* Game of Life background */}
      <GameOfLife cellSize={5} opacity={0.2} />

      {/* Vignette overlay */}
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 20%, rgba(0,0,0,0.6) 60%, rgba(0,0,0,1) 85%)",
        }}
      />

      {/* Navbar */}
      <nav className="relative z-10 w-full px-6 md:px-10 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center">
          <Image
            src="/vectorlogo.svg"
            alt="Four86"
            width={100}
            height={48}
            className="h-10 w-auto invert"
            priority
          />
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-mono text-white/40 hover:text-white transition-colors tracking-wide uppercase"
            >
              {item.label}
            </a>
          ))}
        </div>

        <div>
          {isSignedIn ? (
            <Link
              href="/dashboard"
              className="text-sm font-mono text-white border border-white/40 px-6 py-2 uppercase tracking-[0.15em] hover:bg-white hover:text-black transition-colors"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className="text-sm font-mono text-white border border-white/40 px-6 py-2 uppercase tracking-[0.15em] hover:bg-white hover:text-black transition-colors"
            >
              Log in
            </Link>
          )}
        </div>
      </nav>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
        <h1
          className="font-heading font-black uppercase leading-[0.9] tracking-[0.08em] text-white"
          style={{
            fontSize: "clamp(2.5rem, 10vw, 8rem)",
          }}
        >
          Universal
          <br />
          high income
          <br />
          is coming
        </h1>

        <p className="mt-8 text-sm md:text-base font-light text-white/50 font-mono max-w-xl tracking-wide">
          AI-powered trading. Fully autonomous. Every trade verifiable on-chain.
        </p>

        <div className="mt-10">
          <WaitlistForm variant="dark" />
        </div>

        <p className="mt-6 text-xs text-white/25 font-mono tracking-wider">
          2,847 people on the waitlist
        </p>
      </div>
    </section>
  );
}
