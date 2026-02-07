/**
 * Pure formatting functions for Telegram messages.
 * Uses regular Telegram Markdown: *bold*, `monospace`, _italic_
 * No Convex imports - these are pure TypeScript functions.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

export function formatPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Trade Opened
// ---------------------------------------------------------------------------

interface TradeOpenedData {
  symbol: string;
  side: string;
  sizeUsd: number;
  leverage: number;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence?: number;
  reasoning: string;
}

export function formatTradeOpened(data: TradeOpenedData): string {
  const sideEmoji = data.side.toUpperCase() === "LONG" ? "\u{1F7E2}" : "\u{1F534}";
  const lines: string[] = [
    `${sideEmoji} *Trade Opened*`,
    "",
    `*${data.symbol} ${data.side.toUpperCase()}* at \`${formatUsd(data.entryPrice)}\``,
    `Size: \`${formatUsd(data.sizeUsd)}\` | Leverage: \`${data.leverage}x\``,
  ];

  if (data.stopLoss !== undefined) {
    lines.push(`Stop Loss: \`${formatUsd(data.stopLoss)}\``);
  }
  if (data.takeProfit !== undefined) {
    lines.push(`Take Profit: \`${formatUsd(data.takeProfit)}\``);
  }
  if (data.confidence !== undefined) {
    lines.push(`Confidence: \`${data.confidence}%\``);
  }

  lines.push("");
  lines.push(`_Reasoning: ${data.reasoning}_`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Trade Closed
// ---------------------------------------------------------------------------

interface TradeClosedData {
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  durationMs: number;
}

export function formatTradeClosed(data: TradeClosedData): string {
  const isProfit = data.pnl >= 0;
  const pnlEmoji = isProfit ? "\u{1F7E2}" : "\u{1F534}";
  const headerEmoji = isProfit ? "\u{2705}" : "\u{274C}";

  const lines: string[] = [
    `${headerEmoji} *Trade Closed*`,
    "",
    `*${data.symbol} ${data.side.toUpperCase()}*`,
    `Entry: \`${formatUsd(data.entryPrice)}\` \u{2192} Exit: \`${formatUsd(data.exitPrice)}\``,
    `${pnlEmoji} P&L: \`${formatUsd(data.pnl)}\` (\`${formatPct(data.pnlPct)}\`)`,
    `Duration: \`${formatDuration(data.durationMs)}\``,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Risk Alert
// ---------------------------------------------------------------------------

interface RiskAlertData {
  type: string;
  message: string;
  details?: string;
}

export function formatRiskAlert(data: RiskAlertData): string {
  const lines: string[] = [
    `\u{26A0}\u{FE0F} *Risk Alert*`,
    "",
    `*Type:* \`${data.type}\``,
    `*Message:* ${data.message}`,
  ];

  if (data.details) {
    lines.push("");
    lines.push(`_${data.details}_`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Daily Summary
// ---------------------------------------------------------------------------

interface DailySummaryData {
  equity: number;
  dailyPnl: number;
  dailyPnlPct: number;
  openPositions: number;
  tradeCount: number;
  winRate: number;
}

export function formatDailySummary(data: DailySummaryData): string {
  const pnlEmoji = data.dailyPnl >= 0 ? "\u{1F7E2}" : "\u{1F534}";

  const lines: string[] = [
    `\u{1F4CA} *Daily Summary*`,
    "",
    `Equity: \`${formatUsd(data.equity)}\``,
    `${pnlEmoji} Daily P&L: \`${formatUsd(data.dailyPnl)}\` (\`${formatPct(data.dailyPnlPct)}\`)`,
    "",
    `Trades: \`${data.tradeCount}\``,
    `Win Rate: \`${data.winRate.toFixed(1)}%\``,
    `Open Positions: \`${data.openPositions}\``,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

interface PositionData {
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  leverage: number;
}

export function formatPositions(positions: PositionData[]): string {
  if (positions.length === 0) {
    return "\u{1F4AD} *Open Positions*\n\nNo open positions.";
  }

  const lines: string[] = [
    `\u{1F4AD} *Open Positions* (${positions.length})`,
    "",
  ];

  for (const pos of positions) {
    const pnlEmoji = pos.unrealizedPnl >= 0 ? "\u{1F7E2}" : "\u{1F534}";
    lines.push(
      `*${pos.symbol} ${pos.side.toUpperCase()}* \`${pos.leverage}x\``,
    );
    lines.push(
      `Entry: \`${formatUsd(pos.entryPrice)}\` | Now: \`${formatUsd(pos.currentPrice)}\``,
    );
    lines.push(
      `${pnlEmoji} uPnL: \`${formatUsd(pos.unrealizedPnl)}\` (\`${formatPct(pos.unrealizedPnlPct)}\`)`,
    );
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Bot Status
// ---------------------------------------------------------------------------

interface BotConfigData {
  isActive: boolean;
  modelName: string;
  symbols: string[];
  circuitBreakerState?: string;
}

interface AccountStateData {
  accountValue: number;
  marginUsed?: number;
  withdrawable?: number;
}

export function formatStatus(
  botConfig: BotConfigData,
  accountState: AccountStateData,
): string {
  const statusEmoji = botConfig.isActive ? "\u{1F7E2}" : "\u{1F534}";
  const statusText = botConfig.isActive ? "Active" : "Inactive";

  const lines: string[] = [
    `\u{1F916} *Bot Status*`,
    "",
    `Status: ${statusEmoji} \`${statusText}\``,
    `Model: \`${botConfig.modelName}\``,
    `Symbols: \`${botConfig.symbols.join(", ")}\``,
    `Account Value: \`${formatUsd(accountState.accountValue)}\``,
  ];

  if (botConfig.circuitBreakerState) {
    lines.push(`Circuit Breaker: \`${botConfig.circuitBreakerState}\``,);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// P&L
// ---------------------------------------------------------------------------

interface TradeForPnl {
  symbol: string;
  pnl?: number;
  pnlPct?: number;
  side: string;
  executedAt: number;
}

export function formatPnl(trades: TradeForPnl[]): string {
  if (trades.length === 0) {
    return "\u{1F4B0} *Today's P&L*\n\nNo trades today.";
  }

  let totalPnl = 0;
  const tradeLines: string[] = [];

  for (const t of trades) {
    const pnl = t.pnl ?? 0;
    totalPnl += pnl;
    const pnlEmoji = pnl >= 0 ? "\u{1F7E2}" : "\u{1F534}";
    const pctStr = t.pnlPct !== undefined ? ` (${formatPct(t.pnlPct)})` : "";
    const time = new Date(t.executedAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    tradeLines.push(
      `${pnlEmoji} \`${time}\` *${t.symbol}* ${t.side.toUpperCase()} \`${formatUsd(pnl)}\`${pctStr}`,
    );
  }

  const totalEmoji = totalPnl >= 0 ? "\u{1F7E2}" : "\u{1F534}";

  const lines: string[] = [
    `\u{1F4B0} *Today's P&L*`,
    "",
    ...tradeLines,
    "",
    `${totalEmoji} *Total: \`${formatUsd(totalPnl)}\`*`,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export function formatBalance(accountState: AccountStateData): string {
  const lines: string[] = [
    `\u{1F4B3} *Account Balance*`,
    "",
    `Account Value: \`${formatUsd(accountState.accountValue)}\``,
  ];

  if (accountState.marginUsed !== undefined) {
    lines.push(`Margin Used: \`${formatUsd(accountState.marginUsed)}\``);
  }
  if (accountState.withdrawable !== undefined) {
    lines.push(`Withdrawable: \`${formatUsd(accountState.withdrawable)}\``);
  }

  return lines.join("\n");
}
