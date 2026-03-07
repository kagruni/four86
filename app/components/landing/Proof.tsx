export default function Proof() {
  return (
    <section id="proof" className="bg-white py-24 md:py-32 px-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-4xl md:text-6xl font-black uppercase tracking-wide text-center text-black">
          Don&apos;t trust. Verify.
        </h2>

        <p className="mt-8 text-base md:text-lg font-light text-center text-gray-500 font-mono max-w-2xl mx-auto leading-relaxed">
          The bot trades on Hyperliquid — a fully on-chain perpetual futures
          exchange. Every single trade is publicly verifiable. No screenshots. No
          fake PnL. Just the blockchain.
        </p>

        {/* Wallet display */}
        <div className="mt-14 mx-auto max-w-md border border-black p-8 md:p-10 text-center">
          <p className="text-xs tracking-[0.3em] text-gray-400 font-mono uppercase">
            Live balance
          </p>
          <p className="mt-2 text-sm font-mono text-gray-400">
            0x1a2B...9f4E
          </p>
          <p
            className="mt-4 text-5xl md:text-6xl font-black font-mono text-black"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            $1,000.00
          </p>
        </div>

        {/* Verification links */}
        <div className="mt-8 text-center font-mono text-sm">
          <a
            href="#"
            className="text-gray-400 hover:text-black hover:underline underline-offset-4 transition-colors"
          >
            Hyperliquid Explorer
          </a>
          <span className="mx-3 text-gray-300">&middot;</span>
          <a
            href="#"
            className="text-gray-400 hover:text-black hover:underline underline-offset-4 transition-colors"
          >
            HypurrScan
          </a>
          <span className="mx-3 text-gray-300">&middot;</span>
          <a
            href="#"
            className="text-gray-400 hover:text-black hover:underline underline-offset-4 transition-colors"
          >
            CoinGlass
          </a>
        </div>
      </div>
    </section>
  );
}
