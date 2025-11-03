"use client";

import { ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { ConvexProviderWithClerk as ConvexClerkProvider } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexProviderWithClerk({ children }: { children: ReactNode }) {
  return (
    <ConvexClerkProvider client={convex} useAuth={useAuth}>
      {children}
    </ConvexClerkProvider>
  );
}
