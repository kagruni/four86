"use client";

import { useUser } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import Nav from "./components/landing/Nav";
import Hero from "./components/landing/Hero";
import Proof from "./components/landing/Proof";
import Pricing from "./components/landing/Pricing";
import CompoundEffect from "./components/landing/CompoundEffect";
import HowItWorks from "./components/landing/HowItWorks";
import Footer from "./components/landing/Footer";

export default function Home() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-foreground" />
      </div>
    );
  }

  return (
    <>
      <Nav isSignedIn={!!isSignedIn} />
      <main className="bg-black">
        <Hero />
        <Proof />
        <Pricing />
        <CompoundEffect />
        <HowItWorks />
        <Footer />
      </main>
    </>
  );
}
