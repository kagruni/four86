export default function HowItWorks() {
  const steps = [
    {
      number: "01",
      word: "Connect",
      sentence:
        "Create a Hyperliquid account, deposit USDC, get an OpenRouter API key.",
    },
    {
      number: "02",
      word: "Activate",
      sentence:
        "Subscribe, connect your keys, and the bot starts trading.",
    },
    {
      number: "03",
      word: "Verify",
      sentence:
        "Watch every trade live on-chain. Withdraw profits anytime.",
    },
  ];

  return (
    <section id="how-it-works" className="bg-black py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-4xl md:text-6xl font-black uppercase tracking-wide text-center text-white">
          3 steps. That&apos;s it.
        </h2>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
          {steps.map((step) => (
            <div key={step.number} className="text-center">
              <p className="text-5xl md:text-6xl font-mono font-bold text-white/15">
                {step.number}
              </p>
              <p className="mt-4 text-xl font-black uppercase tracking-[0.15em] text-white">
                {step.word}
              </p>
              <p className="mt-3 text-sm font-light text-white/40 font-mono max-w-xs mx-auto leading-relaxed">
                {step.sentence}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
