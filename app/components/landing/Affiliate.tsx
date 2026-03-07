export default function Affiliate() {
  const data = [
    { referrals: "10", monthly: "€300/mo" },
    { referrals: "50", monthly: "€1,500/mo" },
    { referrals: "200", monthly: "€6,000/mo" },
  ];

  return (
    <section id="affiliate" className="bg-white py-24 md:py-32 px-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-4xl md:text-6xl font-black uppercase tracking-wide text-center text-black">
          Earn 30% recurring
        </h2>

        <p className="mt-6 text-2xl md:text-3xl text-center font-light text-black">
          Refer someone. Earn €30/month. Forever.
        </p>

        {/* Affiliate table */}
        <div className="mt-14 mx-auto max-w-sm w-full">
          <table className="w-full font-mono border border-black">
            <thead>
              <tr className="border-b border-black">
                <th className="text-left text-xs uppercase tracking-[0.2em] text-gray-400 py-3 px-6 font-normal">
                  Referrals
                </th>
                <th className="text-right text-xs uppercase tracking-[0.2em] text-gray-400 py-3 px-6 font-normal">
                  Monthly
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.referrals} className="border-b border-gray-200">
                  <td className="text-gray-500 py-4 px-6">{row.referrals}</td>
                  <td
                    className="text-right font-bold text-black py-4 px-6"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {row.monthly}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-center text-sm text-gray-400 font-mono max-w-xl mx-auto">
          Every subscriber gets an affiliate link. No application. No tiers.
          Just 30% of every referral, every month.
        </p>
      </div>
    </section>
  );
}
