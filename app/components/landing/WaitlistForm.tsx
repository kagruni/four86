"use client";

import { useState, FormEvent } from "react";
import { useClerk } from "@clerk/nextjs";

interface WaitlistFormProps {
  variant?: "dark" | "light";
}

export default function WaitlistForm({ variant = "dark" }: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const clerk = useClerk();

  const isDark = variant === "dark";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !email.includes("@") || !email.includes(".")) {
      setError("Enter a valid email.");
      return;
    }

    setLoading(true);
    try {
      await clerk.joinWaitlist({ emailAddress: email });
      setSubmitted(true);
      setEmail("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      if (message.includes("already")) {
        setError("You're already on the list.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <p
        className={`font-mono text-sm tracking-wide ${
          isDark ? "text-white/70" : "text-black/70"
        }`}
      >
        You&apos;re on the list.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col md:flex-row gap-0 w-full max-w-md"
    >
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        className={`
          w-full px-4 py-3 font-mono text-sm tracking-wide
          border outline-none
          transition-colors
          ${
            isDark
              ? "border-white/40 bg-transparent text-white placeholder:text-white/30 focus:border-white"
              : "border-black bg-white text-gray-900 placeholder:text-gray-400 focus:border-black"
          }
          md:border-r-0
        `}
        style={{ borderRadius: 0 }}
      />
      <button
        type="submit"
        disabled={loading}
        className={`
          px-8 py-3 font-mono text-sm uppercase tracking-[0.2em]
          border transition-colors whitespace-nowrap cursor-pointer
          disabled:opacity-50 disabled:cursor-not-allowed
          ${
            isDark
              ? "border-white/40 text-white bg-transparent hover:bg-white hover:text-black hover:border-white"
              : "border-black text-white bg-black hover:bg-white hover:text-black"
          }
        `}
        style={{ borderRadius: 0 }}
      >
        {loading ? "Joining..." : "Join the waitlist"}
      </button>
      {error && (
        <p
          className={`absolute mt-14 font-mono text-xs ${
            isDark ? "text-white/50" : "text-gray-500"
          }`}
        >
          {error}
        </p>
      )}
    </form>
  );
}
