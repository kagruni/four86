"use client";

import GameOfLife from "./GameOfLife";
import WaitlistForm from "./WaitlistForm";

export default function Hero() {
  return (
    <section
      id="hero"
      className="relative min-h-screen bg-black overflow-hidden flex items-center justify-center pt-16"
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

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 py-20">
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
          is here
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
