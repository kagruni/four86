export default function Footer() {
  return (
    <footer className="bg-black border-t border-white/10">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Wordmark */}
          <p className="text-lg font-mono font-bold tracking-[0.2em] text-white uppercase">
            Four86
          </p>

          {/* Links */}
          <nav className="flex items-center">
            <a
              href="#"
              className="text-sm font-mono text-white/40 hover:text-white transition-colors"
            >
              Terms
            </a>
            <span className="mx-3 text-white/20">&middot;</span>
            <a
              href="#"
              className="text-sm font-mono text-white/40 hover:text-white transition-colors"
            >
              Privacy
            </a>
            <span className="mx-3 text-white/20">&middot;</span>
            <a
              href="#"
              className="text-sm font-mono text-white/40 hover:text-white transition-colors"
            >
              Contact
            </a>
          </nav>

          {/* Social */}
          <div className="flex items-center gap-4">
            {/* X / Twitter */}
            <a
              href="#"
              className="opacity-40 hover:opacity-100 transition-opacity"
              aria-label="X / Twitter"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="white"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            {/* Telegram */}
            <a
              href="#"
              className="opacity-40 hover:opacity-100 transition-opacity"
              aria-label="Telegram"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="white"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="border-t border-white/5 py-4 px-6 text-center">
        <p className="text-xs text-white/20 font-mono">
          four86 is a trading software tool. Not financial advice. Trade at your
          own risk.
        </p>
      </div>
    </footer>
  );
}
