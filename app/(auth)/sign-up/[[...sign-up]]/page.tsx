import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-black">Four86</h1>
          <p className="mt-2 text-sm text-black/60">AI Crypto Trading Bot</p>
        </div>
        <SignUp 
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "bg-white shadow-xl border-2 border-black",
              headerTitle: "text-black",
              headerSubtitle: "text-black/60",
              socialButtonsBlockButton: "border-2 border-black text-black hover:bg-black hover:text-white transition-colors",
              socialButtonsBlockButtonText: "text-black font-semibold",
              formButtonPrimary: "bg-black text-white hover:bg-black/90 border-2 border-black",
              formFieldInput: "border-2 border-black focus:border-black focus:ring-black",
              footerActionLink: "text-black hover:text-black/80 font-semibold",
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
  );
}
