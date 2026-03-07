"use client";

import GrowthCurve from "./GrowthCurve";

export default function CompoundEffect() {
  const data = [
    { month: 1, balance: "$2,427" },
    { month: 2, balance: "$5,898" },
    { month: 3, balance: "$13,295" },
    { month: 4, balance: "$31,975" },
    { month: 5, balance: "$77,316" },
    { month: 6, balance: "$187,309" },
  ];

  return (
    <section id="compound" className="bg-black py-24 md:py-32 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-4xl md:text-6xl font-black uppercase tracking-wide text-center text-white">
          The compound effect
        </h2>

        <p className="mt-4 text-sm text-white/30 font-mono text-center tracking-wide">
          $1,000 starting balance at ~3% daily
        </p>

        {/* Side by side: table + curve */}
        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center">
          {/* Left: Table */}
          <div>
            <table className="w-full font-mono border border-white/20">
              <thead>
                <tr className="border-b border-white/20">
                  <th className="text-left text-xs uppercase tracking-[0.2em] text-white/30 py-3 px-6 font-normal">
                    Month
                  </th>
                  <th className="text-right text-xs uppercase tracking-[0.2em] text-white/30 py-3 px-6 font-normal">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.month} className="border-b border-white/10">
                    <td className="text-white/40 py-4 px-6">{row.month}</td>
                    <td
                      className="text-right font-bold text-white py-4 px-6"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {row.balance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Right: Growth curve */}
          <div className="h-64 md:h-80">
            <GrowthCurve />
          </div>
        </div>

        <p className="mt-10 text-center text-xs text-white/20 font-mono max-w-lg mx-auto leading-relaxed">
          Projected returns based on testnet performance at ~3% daily
          compounding. Past performance does not guarantee future results.
          Trading involves risk of loss.
        </p>
      </div>
    </section>
  );
}
