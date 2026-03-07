"use client";

import { useUser } from "@clerk/nextjs";
import Hero from "./components/landing/Hero";
import Proof from "./components/landing/Proof";
import Pricing from "./components/landing/Pricing";
import CompoundTable from "./components/landing/CompoundTable";
import HowItWorks from "./components/landing/HowItWorks";
import Footer from "./components/landing/Footer";

export default function Home() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="font-mono text-sm tracking-[0.2em] text-white/30 uppercase">
          Four86
        </p>
      </div>
    );
  }

  return (
    <main className="bg-black">
      <Hero isSignedIn={!!isSignedIn} />
      <Proof />
      <Pricing />
      <CompoundTable />
      <HowItWorks />
      <Footer />
    </main>
  );
}
