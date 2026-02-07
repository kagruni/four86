import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen">
      {/* Left Panel - Dark branding side */}
      <div className="hidden lg:flex lg:w-1/2 bg-gray-950 items-center justify-center relative overflow-hidden">
        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Radial glow behind title */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="h-[400px] w-[400px] rounded-full opacity-20"
            style={{
              background:
                "radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%)",
            }}
          />
        </div>

        {/* Pulsing ring */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-64 w-64 rounded-full border border-white/5 animate-pulse" />
          <div className="absolute h-80 w-80 rounded-full border border-white/[0.02] animate-[pulse_3s_ease-in-out_infinite]" />
          <div className="absolute h-96 w-96 rounded-full border border-white/[0.01] animate-[pulse_4s_ease-in-out_infinite]" />
        </div>

        {/* Content */}
        <div className="relative z-10 text-center">
          <h1 className="font-mono text-6xl font-bold tracking-[0.3em] text-white">
            FOUR86
          </h1>
          <p className="mt-4 font-mono text-sm uppercase tracking-widest text-gray-400">
            AI Crypto Trading Bot
          </p>
        </div>

        {/* Bottom atmospheric text */}
        <div className="absolute bottom-8 left-0 right-0 text-center">
          <p className="font-mono text-xs text-gray-600">
            Autonomous Trading on Hyperliquid DEX
          </p>
        </div>
      </div>

      {/* Right Panel - Sign Up Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-white p-8">
        <div className="w-full max-w-md">
          {/* Mobile-only branding */}
          <div className="mb-8 text-center lg:hidden">
            <h1 className="font-mono text-4xl font-bold tracking-[0.2em] text-black">
              FOUR86
            </h1>
            <p className="mt-2 font-mono text-sm uppercase tracking-widest text-gray-400">
              AI Crypto Trading Bot
            </p>
          </div>

          <SignUp
            appearance={{
              elements: {
                rootBox: "mx-auto",
                card: "bg-white shadow-lg border border-gray-200",
                headerTitle: "text-black",
                headerSubtitle: "text-black/60",
                socialButtonsBlockButton:
                  "border-2 border-black text-black hover:bg-black hover:text-white transition-colors",
                socialButtonsBlockButtonText: "text-black font-semibold",
                formButtonPrimary:
                  "bg-black text-white hover:bg-black/90 border-2 border-black",
                formFieldInput:
                  "border-2 border-black focus:border-black focus:ring-black",
                footerActionLink:
                  "text-black hover:text-black/80 font-semibold",
                identityPreviewText: "text-black",
                identityPreviewEditButtonIcon: "text-black",
                formFieldLabel: "text-black font-semibold",
                dividerLine: "bg-black",
                dividerText: "text-black",
                formResendCodeLink: "text-black hover:text-black/80",
                otpCodeFieldInput: "border-2 border-black",
                formFieldInputShowPasswordButton: "text-black",
              },
              layout: {
                socialButtonsPlacement: "bottom",
                socialButtonsVariant: "blockButton",
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
