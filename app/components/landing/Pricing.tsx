export default function Pricing() {
  const features = [
    "Fully autonomous AI trading",
    "Percentage-based position sizing",
    "Works 24/7 — no intervention needed",
    "All trades verifiable on-chain",
    "Bring your own OpenRouter API key — choose any AI model you want (~€10-20/mo)",
  ];

  return (
    <section id="pricing" className="bg-white py-24 md:py-32 px-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-4xl md:text-6xl font-black uppercase tracking-wide text-center text-black">
          One plan. One price.
        </h2>

        {/* Pricing card */}
        <div className="mt-14 mx-auto max-w-lg bg-black text-white p-10 md:p-14">
          <div className="text-center">
            <span
              className="text-7xl md:text-8xl font-black font-mono"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              €100
            </span>
            <span className="text-lg font-light text-white/40 font-mono ml-2">
              /month
            </span>
          </div>

          <ul className="mt-10 space-y-4">
            {features.map((feature) => (
              <li key={feature} className="flex items-start">
                <span className="text-white/30 mr-3 font-mono shrink-0">—</span>
                <span className="text-sm md:text-base font-light">{feature}</span>
              </li>
            ))}
          </ul>

          <a
            href="#hero"
            className="block mt-10 w-full text-center border border-white py-4 uppercase tracking-[0.2em] font-mono text-sm text-white hover:bg-white hover:text-black transition-colors"
          >
            Get started
          </a>
        </div>

        <p className="mt-8 text-center text-sm text-gray-400 font-mono max-w-lg mx-auto">
          No free trial. The case study is your trial. Watch the bot trade live
          before you pay a cent.
        </p>
      </div>
    </section>
  );
}
