interface ProofProps {
  walletAddress?: string;
  balance?: string;
}

export default function Proof({
  walletAddress = "0xAb3f...9e1D",
  balance = "$1,000.00",
}: ProofProps) {
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
            Bot wallet
          </p>
          <p className="mt-2 text-sm font-mono text-gray-400">
            {walletAddress}
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <p
              className="text-5xl md:text-6xl font-black font-mono text-black"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {balance}
            </p>
          </div>
          {/* LIVE badge */}
          <div className="mt-3 inline-flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <span className="text-xs font-mono tracking-[0.2em] text-green-600 uppercase">
              Live
            </span>
          </div>
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
