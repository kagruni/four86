"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion } from "framer-motion";
import TelegramSettings from "./TelegramSettings";

const AI_MODELS = [
  { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5 (Recommended)" },
  { value: "openai/gpt-5", label: "GPT-5" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { value: "openai/gpt-4.1", label: "GPT-4.1" },
  { value: "google/gemini-3-pro", label: "Gemini 3 Pro" },
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2 (Alpha Arena Winner)" },
  { value: "deepseek/deepseek-chat-v3.1", label: "DeepSeek Chat V3.1" },
  { value: "deepseek/deepseek-v3.2-speciale", label: "DeepSeek V3.2 Speciale" },
  { value: "deepseek/deepseek-r1", label: "DeepSeek R1" },
  { value: "qwen/qwen3-max", label: "Qwen3 Max (Alpha Arena #2)" },
  { value: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast" },
  { value: "x-ai/grok-4-fast", label: "Grok 4 Fast" },
  { value: "x-ai/grok-code-fast-1", label: "Grok Code Fast 1" },
  { value: "z-ai/glm-4.7", label: "GLM-4.7" },
  { value: "z-ai/glm-4.6", label: "GLM-4.6" },
  { value: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
  { value: "moonshotai/kimi-k2-thinking", label: "Kimi K2 Thinking" },
  { value: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" },
  { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
] as const;

const TRADING_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"] as const;

const botConfigSchema = z.object({
  modelName: z.string().min(1, "AI model is required"),
  symbols: z.array(z.string()).min(1, "Select at least one symbol"),
  maxLeverage: z.number().min(1).max(20),
  maxPositionSize: z.number().min(1).max(100),
  maxDailyLoss: z.number().min(1).max(50),
  minAccountValue: z.number().min(0),
  startingCapital: z.number().min(0),
  isActive: z.boolean(),

  // Tier 1: Essential Risk Controls
  perTradeRiskPct: z.number().min(0.5).max(10),
  maxTotalPositions: z.number().min(1).max(5),
  maxSameDirectionPositions: z.number().min(1).max(3),
  consecutiveLossLimit: z.number().min(2).max(5),

  // Tier 2: Trading Behavior
  tradingMode: z.enum(["conservative", "balanced", "aggressive"]),
  minEntryConfidence: z.number().min(0.50).max(0.80),
  minRiskRewardRatio: z.number().min(1.0).max(3.0),
  stopOutCooldownHours: z.number().min(0).max(24),

  // Tier 3: Advanced
  minEntrySignals: z.number().min(1).max(4),
  require4hAlignment: z.boolean(),
  tradeVolatileMarkets: z.boolean(),
  volatilitySizeReduction: z.number().min(25).max(75),
  stopLossAtrMultiplier: z.number().min(1.0).max(3.0),
});

const credentialsSchema = z.object({
  openrouterApiKey: z.string().optional(),
  hyperliquidPrivateKey: z.string().optional(),
  hyperliquidAddress: z.string().optional(),
  hyperliquidTestnet: z.boolean(),
});

type BotConfigFormData = z.infer<typeof botConfigSchema>;
type CredentialsFormData = z.infer<typeof credentialsSchema>;

const tabFadeVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2 },
};

export default function SettingsPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const userId = user?.id || "";

  // Queries (only run when userId is available)
  const botConfig = useQuery(api.queries.getBotConfig, userId ? { userId } : "skip");
  const userCredentials = useQuery(api.queries.getUserCredentials, userId ? { userId } : "skip");

  // Mutations
  const upsertBotConfig = useMutation(api.mutations.upsertBotConfig);
  const saveUserCredentials = useMutation(api.mutations.saveUserCredentials);

  // Bot config state
  const [botConfigData, setBotConfigData] = useState<BotConfigFormData>({
    modelName: "anthropic/claude-sonnet-4.5",
    symbols: ["BTC"],
    maxLeverage: 5,
    maxPositionSize: 10,
    maxDailyLoss: 5,
    minAccountValue: 100,
    startingCapital: 1000,
    isActive: false,

    // Tier 1: Essential Risk Controls (Balanced defaults)
    perTradeRiskPct: 2.0,
    maxTotalPositions: 3,
    maxSameDirectionPositions: 2,
    consecutiveLossLimit: 3,

    // Tier 2: Trading Behavior (Balanced defaults)
    tradingMode: "balanced",
    minEntryConfidence: 0.60,
    minRiskRewardRatio: 2.0,
    stopOutCooldownHours: 6,

    // Tier 3: Advanced (Balanced defaults)
    minEntrySignals: 2,
    require4hAlignment: false,
    tradeVolatileMarkets: true,
    volatilitySizeReduction: 50,
    stopLossAtrMultiplier: 1.5,
  });

  // Credentials state
  const [credentialsData, setCredentialsData] = useState<CredentialsFormData>({
    openrouterApiKey: "",
    hyperliquidPrivateKey: "",
    hyperliquidAddress: "",
    hyperliquidTestnet: true,
  });

  const [showPrivateKeys, setShowPrivateKeys] = useState({
    openrouter: false,
    hyperliquid: false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const [tradingPromptMode, setTradingPromptMode] = useState("alpha_arena");
  const [riskWarnings, setRiskWarnings] = useState<string[]>([]);

  // Load existing bot config
  useEffect(() => {
    if (botConfig) {
      setBotConfigData({
        modelName: botConfig.modelName,
        symbols: botConfig.symbols,
        maxLeverage: botConfig.maxLeverage,
        maxPositionSize: botConfig.maxPositionSize,
        maxDailyLoss: botConfig.maxDailyLoss,
        minAccountValue: botConfig.minAccountValue,
        startingCapital: botConfig.startingCapital,
        isActive: botConfig.isActive,

        // Tier 1: Essential Risk Controls
        perTradeRiskPct: botConfig.perTradeRiskPct ?? 2.0,
        maxTotalPositions: botConfig.maxTotalPositions ?? 3,
        maxSameDirectionPositions: botConfig.maxSameDirectionPositions ?? 2,
        consecutiveLossLimit: botConfig.consecutiveLossLimit ?? 3,

        // Tier 2: Trading Behavior
        tradingMode: botConfig.tradingMode ?? "balanced",
        minEntryConfidence: botConfig.minEntryConfidence ?? 0.60,
        minRiskRewardRatio: botConfig.minRiskRewardRatio ?? 2.0,
        stopOutCooldownHours: botConfig.stopOutCooldownHours ?? 6,

        // Tier 3: Advanced
        minEntrySignals: botConfig.minEntrySignals ?? 2,
        require4hAlignment: botConfig.require4hAlignment ?? false,
        tradeVolatileMarkets: botConfig.tradeVolatileMarkets ?? true,
        volatilitySizeReduction: botConfig.volatilitySizeReduction ?? 50,
        stopLossAtrMultiplier: botConfig.stopLossAtrMultiplier ?? 1.5,
      });
      setTradingPromptMode(botConfig.tradingPromptMode ?? "alpha_arena");
    }
  }, [botConfig]);

  // Load existing credentials
  useEffect(() => {
    if (userCredentials) {
      setCredentialsData({
        openrouterApiKey: userCredentials.hasOpenrouterApiKey ? "••••••••" : "",
        hyperliquidPrivateKey: userCredentials.hasHyperliquidPrivateKey ? "••••••••" : "",
        hyperliquidAddress: userCredentials.hyperliquidAddress || "",
        hyperliquidTestnet: userCredentials.hyperliquidTestnet,
      });
    }
  }, [userCredentials]);

  // Real-time risk warnings - informational only, doesn't block saving
  useEffect(() => {
    const warnings: string[] = [];

    // Warning 1: High combined risk exposure (informational)
    const maxPossibleRisk = botConfigData.perTradeRiskPct * botConfigData.maxTotalPositions;
    if (maxPossibleRisk > botConfigData.maxDailyLoss) {
      warnings.push(
        `⚠️ High risk exposure: ${botConfigData.perTradeRiskPct}% per trade × ${botConfigData.maxTotalPositions} positions = ${maxPossibleRisk.toFixed(1)}% total exposure exceeds ${botConfigData.maxDailyLoss}% daily loss limit. This may trigger early stop-out.`
      );
    }

    // Warning 2: Same-direction exceeds total (logical inconsistency)
    if (botConfigData.maxSameDirectionPositions > botConfigData.maxTotalPositions) {
      warnings.push(
        `⚠️ Logical inconsistency: Max same-direction positions (${botConfigData.maxSameDirectionPositions}) exceeds max total positions (${botConfigData.maxTotalPositions}). The lower limit will apply.`
      );
    }

    setRiskWarnings(warnings);
  }, [
    botConfigData.perTradeRiskPct,
    botConfigData.maxTotalPositions,
    botConfigData.maxDailyLoss,
    botConfigData.maxSameDirectionPositions,
  ]);

  const handleSymbolToggle = (symbol: string) => {
    setBotConfigData((prev) => ({
      ...prev,
      symbols: prev.symbols.includes(symbol)
        ? prev.symbols.filter((s) => s !== symbol)
        : [...prev.symbols, symbol],
    }));
  };

  // Trading mode preset handler - auto-fills related settings
  const handleTradingModeChange = (mode: "conservative" | "balanced" | "aggressive") => {
    setBotConfigData((prev) => {
      const baseUpdate = { ...prev, tradingMode: mode };

      if (mode === "conservative") {
        return {
          ...baseUpdate,
          perTradeRiskPct: 1.5,
          minEntryConfidence: 0.70,
          minRiskRewardRatio: 2.5,
          minEntrySignals: 3,
          require4hAlignment: true,
        };
      } else if (mode === "aggressive") {
        return {
          ...baseUpdate,
          perTradeRiskPct: 3.0,
          minEntryConfidence: 0.55,
          minRiskRewardRatio: 1.5,
          minEntrySignals: 2,
          require4hAlignment: false,
        };
      } else {
        // Balanced
        return {
          ...baseUpdate,
          perTradeRiskPct: 2.0,
          minEntryConfidence: 0.60,
          minRiskRewardRatio: 2.0,
          minEntrySignals: 2,
          require4hAlignment: false,
        };
      }
    });
  };

  const handleSaveBotConfig = async () => {
    try {
      setIsSavingConfig(true);
      setErrors({});

      const validatedData = botConfigSchema.parse(botConfigData);

      // Note: Risk warnings are shown in UI but don't block saving
      // This allows experimentation with different risk parameters

      // Explicitly construct the mutation payload with only expected fields
      const mutationPayload = {
        userId,
        modelName: validatedData.modelName,
        isActive: validatedData.isActive,
        startingCapital: validatedData.startingCapital,
        symbols: validatedData.symbols,
        maxLeverage: validatedData.maxLeverage,
        maxPositionSize: validatedData.maxPositionSize,
        maxDailyLoss: validatedData.maxDailyLoss,
        minAccountValue: validatedData.minAccountValue,

        // Tier 1: Essential Risk Controls
        perTradeRiskPct: validatedData.perTradeRiskPct,
        maxTotalPositions: validatedData.maxTotalPositions,
        maxSameDirectionPositions: validatedData.maxSameDirectionPositions,
        consecutiveLossLimit: validatedData.consecutiveLossLimit,

        // Tier 2: Trading Behavior
        tradingMode: validatedData.tradingMode,
        minEntryConfidence: validatedData.minEntryConfidence,
        minRiskRewardRatio: validatedData.minRiskRewardRatio,
        stopOutCooldownHours: validatedData.stopOutCooldownHours,

        // Tier 3: Advanced
        minEntrySignals: validatedData.minEntrySignals,
        require4hAlignment: validatedData.require4hAlignment,
        tradeVolatileMarkets: validatedData.tradeVolatileMarkets,
        volatilitySizeReduction: validatedData.volatilitySizeReduction,
        stopLossAtrMultiplier: validatedData.stopLossAtrMultiplier,
        tradingPromptMode,
      };

      console.log("Saving bot config:", mutationPayload);

      await upsertBotConfig(mutationPayload);

      toast({
        title: "Bot configuration saved",
        description: "Your trading bot settings have been updated successfully.",
      });
    } catch (error) {
      console.error("Error saving bot config:", error);
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            fieldErrors[err.path[0].toString()] = err.message;
          }
        });
        setErrors(fieldErrors);
        toast({
          title: "Validation error",
          description: "Please check the form for errors.",
          variant: "destructive",
        });
      } else if (error instanceof Error) {
        toast({
          title: "Error",
          description: error.message || "Failed to save bot configuration. Please try again.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to save bot configuration. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleSaveCredentials = async () => {
    try {
      setIsSavingCredentials(true);
      setErrors({});

      // Only send credentials that have been modified (not masked)
      const credentialsToSave: any = {
        userId,
        hyperliquidTestnet: credentialsData.hyperliquidTestnet,
      };

      if (credentialsData.openrouterApiKey && credentialsData.openrouterApiKey !== "••••••••") {
        credentialsToSave.openrouterApiKey = credentialsData.openrouterApiKey;
      }

      if (credentialsData.hyperliquidPrivateKey && credentialsData.hyperliquidPrivateKey !== "••••••••") {
        credentialsToSave.hyperliquidPrivateKey = credentialsData.hyperliquidPrivateKey;
      }

      if (credentialsData.hyperliquidAddress) {
        credentialsToSave.hyperliquidAddress = credentialsData.hyperliquidAddress;
      }

      await saveUserCredentials(credentialsToSave);

      toast({
        title: "Credentials saved",
        description: "Your API credentials have been securely stored.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save credentials. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingCredentials(false);
    }
  };

  if (!userId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-gray-900" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-gray-900 tracking-tight">Bot Settings</h1>
          <p className="text-gray-600">Configure your trading bot parameters and API credentials</p>
        </div>

        <Tabs defaultValue="credentials" className="w-full">
          <TabsList className="bg-gray-100 p-1 w-full grid grid-cols-4">
            <TabsTrigger
              value="credentials"
              className="data-[state=active]:bg-black data-[state=active]:text-white text-gray-600"
            >
              Credentials
            </TabsTrigger>
            <TabsTrigger
              value="risk-strategy"
              className="data-[state=active]:bg-black data-[state=active]:text-white text-gray-600"
            >
              Risk & Strategy
            </TabsTrigger>
            <TabsTrigger
              value="advanced"
              className="data-[state=active]:bg-black data-[state=active]:text-white text-gray-600"
            >
              Advanced
            </TabsTrigger>
            <TabsTrigger
              value="telegram"
              className="data-[state=active]:bg-black data-[state=active]:text-white text-gray-600"
            >
              Telegram
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Credentials */}
          <TabsContent value="credentials">
            <motion.div
              initial={tabFadeVariants.initial}
              animate={tabFadeVariants.animate}
              transition={tabFadeVariants.transition}
              className="space-y-6 pt-4"
            >
              {/* Security Warning */}
              <Alert className="border-gray-200">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Security Notice</AlertTitle>
                <AlertDescription>
                  Your API keys and private keys are stored securely in the database. Never share them with anyone.
                  Always use testnet mode when testing new strategies.
                </AlertDescription>
              </Alert>

              {/* AI Provider Credentials */}
              <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
                <CardHeader>
                  <CardTitle className="text-gray-900">OpenRouter API Settings</CardTitle>
                  <CardDescription className="text-gray-600">
                    Configure your OpenRouter API key for all AI trading models
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* OpenRouter API Key */}
                  <div className="space-y-2">
                    <Label htmlFor="openrouter-key" className="text-gray-900">OpenRouter API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        id="openrouter-key"
                        type={showPrivateKeys.openrouter ? "text" : "password"}
                        value={credentialsData.openrouterApiKey}
                        onChange={(e) =>
                          setCredentialsData((prev) => ({
                            ...prev,
                            openrouterApiKey: e.target.value,
                          }))
                        }
                        placeholder="Enter your OpenRouter API key"
                        className="flex-1 text-gray-900 placeholder:text-gray-400"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowPrivateKeys(prev => ({ ...prev, openrouter: !prev.openrouter }))}
                        className="border-gray-200"
                      >
                        {showPrivateKeys.openrouter ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500">Required for all AI models: Claude, GPT, Gemini, DeepSeek, Grok, GLM, Llama, and Kimi</p>
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button
                      onClick={handleSaveCredentials}
                      disabled={isSavingCredentials}
                      className="bg-gray-900 text-white hover:bg-gray-800"
                    >
                      {isSavingCredentials && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {isSavingCredentials ? "Saving..." : "Save OpenRouter API Key"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Hyperliquid Credentials */}
              <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
                <CardHeader>
                  <CardTitle className="text-gray-900">Hyperliquid Settings</CardTitle>
                  <CardDescription className="text-gray-600">
                    Configure your Hyperliquid wallet credentials and network
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Private Key */}
                  <div className="space-y-2">
                    <Label htmlFor="private-key" className="text-gray-900">Private Key</Label>
                    <div className="flex gap-2">
                      <Input
                        id="private-key"
                        type={showPrivateKeys.hyperliquid ? "text" : "password"}
                        value={credentialsData.hyperliquidPrivateKey}
                        onChange={(e) =>
                          setCredentialsData((prev) => ({
                            ...prev,
                            hyperliquidPrivateKey: e.target.value,
                          }))
                        }
                        placeholder="0x..."
                        className="flex-1 text-gray-900 placeholder:text-gray-400"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowPrivateKeys(prev => ({ ...prev, hyperliquid: !prev.hyperliquid }))}
                        className="border-gray-200"
                      >
                        {showPrivateKeys.hyperliquid ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    {errors.hyperliquidPrivateKey && (
                      <p className="text-sm text-red-600">{errors.hyperliquidPrivateKey}</p>
                    )}
                  </div>

                  {/* Wallet Address */}
                  <div className="space-y-2">
                    <Label htmlFor="address" className="text-gray-900">Wallet Address</Label>
                    <Input
                      id="address"
                      type="text"
                      value={credentialsData.hyperliquidAddress}
                      onChange={(e) =>
                        setCredentialsData((prev) => ({
                          ...prev,
                          hyperliquidAddress: e.target.value,
                        }))
                      }
                      placeholder="0x..."
                      className="text-gray-900 placeholder:text-gray-400"
                    />
                    {errors.hyperliquidAddress && (
                      <p className="text-sm text-red-600">{errors.hyperliquidAddress}</p>
                    )}
                  </div>

                  <Separator className="bg-gray-200" />

                  {/* Testnet Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="testnet-mode" className="text-gray-900">Testnet Mode</Label>
                      <p className="text-sm text-gray-500">
                        Use Hyperliquid testnet for safe testing (recommended)
                      </p>
                    </div>
                    <Switch
                      id="testnet-mode"
                      checked={credentialsData.hyperliquidTestnet}
                      onCheckedChange={(checked) =>
                        setCredentialsData((prev) => ({
                          ...prev,
                          hyperliquidTestnet: checked,
                        }))
                      }
                    />
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button
                      onClick={handleSaveCredentials}
                      disabled={isSavingCredentials}
                      className="bg-gray-900 text-white hover:bg-gray-800"
                    >
                      {isSavingCredentials && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {isSavingCredentials ? "Saving..." : "Save Hyperliquid Credentials"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          {/* Tab 2: Risk & Strategy */}
          <TabsContent value="risk-strategy">
            <motion.div
              initial={tabFadeVariants.initial}
              animate={tabFadeVariants.animate}
              transition={tabFadeVariants.transition}
              className="space-y-6 pt-4"
            >
              {/* AI Model Selection */}
              <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
                <CardHeader>
                  <CardTitle className="text-gray-900">AI Model</CardTitle>
                  <CardDescription className="text-gray-600">
                    Select the AI model for trading decisions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label htmlFor="model" className="text-gray-900">Model</Label>
                    <Select
                      value={botConfigData.modelName}
                      onValueChange={(value) =>
                        setBotConfigData((prev) => ({ ...prev, modelName: value }))
                      }
                    >
                      <SelectTrigger id="model" className="text-gray-900">
                        <SelectValue placeholder="Select an AI model" />
                      </SelectTrigger>
                      <SelectContent>
                        {AI_MODELS.map((model) => (
                          <SelectItem key={model.value} value={model.value}>
                            {model.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.modelName && (
                      <p className="text-sm text-red-600">{errors.modelName}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Trading Prompt Mode */}
              <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
                <CardHeader>
                  <CardTitle className="text-gray-900">Trading Prompt Mode</CardTitle>
                  <CardDescription className="text-gray-600">
                    Controls how market data is formatted for the AI model
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label htmlFor="trading-prompt-mode" className="text-gray-900">Prompt Mode</Label>
                    <Select
                      value={tradingPromptMode}
                      onValueChange={(value) => setTradingPromptMode(value)}
                    >
                      <SelectTrigger id="trading-prompt-mode" className="text-gray-900">
                        <SelectValue placeholder="Select a trading prompt mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alpha_arena">Alpha Arena (Recommended)</SelectItem>
                        <SelectItem value="compact">Compact Signals</SelectItem>
                        <SelectItem value="detailed">Detailed Analysis</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-500">
                      {tradingPromptMode === "alpha_arena" && "Replicates winning Alpha Arena strategy with leverage and TP/SL discipline"}
                      {tradingPromptMode === "compact" && "Pre-processed signal-based analysis (150-line prompt)"}
                      {tradingPromptMode === "detailed" && "Comprehensive 680-line prompt system with full technical analysis"}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Trading Symbols */}
              <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
                <CardHeader>
                  <CardTitle className="text-gray-900">Trading Symbols</CardTitle>
                  <CardDescription className="text-gray-600">
                    Select which cryptocurrencies to trade
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {TRADING_SYMBOLS.map((symbol) => (
                      <div key={symbol} className="flex items-center space-x-2">
                        <Checkbox
                          id={symbol}
                          checked={botConfigData.symbols.includes(symbol)}
                          onCheckedChange={() => handleSymbolToggle(symbol)}
                        />
                        <Label
                          htmlFor={symbol}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer text-gray-900"
                        >
                          {symbol}
                          {symbol === "XRP" && (
                            <span className="ml-2 text-xs text-gray-500">(Mainnet only)</span>
                          )}
                        </Label>
                      </div>
                    ))}
                    {errors.symbols && (
                      <p className="text-sm text-red-600">{errors.symbols}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Risk Management */}
              <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
                <CardHeader>
                  <CardTitle className="text-gray-900">Risk Management</CardTitle>
                  <CardDescription className="text-gray-600">
                    Configure risk parameters for your trading bot
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Max Leverage */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="leverage" className="text-gray-900">Max Leverage</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.maxLeverage}x</span>
                    </div>
                    <Slider
                      id="leverage"
                      min={1}
                      max={20}
                      step={1}
                      value={[botConfigData.maxLeverage]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, maxLeverage: value }))
                      }
                    />
                  </div>

                  {/* Max Position Size */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="position-size" className="text-gray-900">Max Position Size</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.maxPositionSize}%</span>
                    </div>
                    <Slider
                      id="position-size"
                      min={1}
                      max={100}
                      step={1}
                      value={[botConfigData.maxPositionSize]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, maxPositionSize: value }))
                      }
                    />
                  </div>

                  {/* Max Daily Loss */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="daily-loss" className="text-gray-900">Max Daily Loss</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.maxDailyLoss}%</span>
                    </div>
                    <Slider
                      id="daily-loss"
                      min={1}
                      max={50}
                      step={1}
                      value={[botConfigData.maxDailyLoss]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, maxDailyLoss: value }))
                      }
                    />
                  </div>

                  {/* Min Account Value */}
                  <div className="space-y-2">
                    <Label htmlFor="min-account" className="text-gray-900">Min Account Value ($)</Label>
                    <Input
                      id="min-account"
                      type="number"
                      value={botConfigData.minAccountValue}
                      onChange={(e) =>
                        setBotConfigData((prev) => ({
                          ...prev,
                          minAccountValue: parseFloat(e.target.value) || 0,
                        }))
                      }
                      placeholder="100"
                      className="text-gray-900 placeholder:text-gray-400"
                    />
                    {errors.minAccountValue && (
                      <p className="text-sm text-red-600">{errors.minAccountValue}</p>
                    )}
                  </div>

                  {/* Starting Capital - Hidden (used internally for tracking only) */}

                  {/* Stop Loss - Removed (always enabled for safety) */}

                  <Separator className="bg-gray-200" />

                  {/* Tier 1: Essential Risk Controls */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="per-trade-risk" className="text-gray-900">Per-Trade Risk</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.perTradeRiskPct.toFixed(1)}%</span>
                    </div>
                    <Slider
                      id="per-trade-risk"
                      min={0.5}
                      max={10}
                      step={0.1}
                      value={[botConfigData.perTradeRiskPct]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, perTradeRiskPct: value }))
                      }
                    />
                    <p className="text-xs text-gray-500">How much of your account to risk per trade (0.5% - 10%)</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="max-total-positions" className="text-gray-900">Max Total Positions</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.maxTotalPositions}</span>
                    </div>
                    <Slider
                      id="max-total-positions"
                      min={1}
                      max={5}
                      step={1}
                      value={[botConfigData.maxTotalPositions]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, maxTotalPositions: value }))
                      }
                    />
                    <p className="text-xs text-gray-500">Maximum concurrent positions</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="max-same-dir" className="text-gray-900">Max Same-Direction Positions</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.maxSameDirectionPositions}</span>
                    </div>
                    <Slider
                      id="max-same-dir"
                      min={1}
                      max={3}
                      step={1}
                      value={[botConfigData.maxSameDirectionPositions]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, maxSameDirectionPositions: value }))
                      }
                    />
                    <p className="text-xs text-gray-500">Max LONG or SHORT positions at once</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="consecutive-loss" className="text-gray-900">Consecutive Loss Limit</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.consecutiveLossLimit}</span>
                    </div>
                    <Slider
                      id="consecutive-loss"
                      min={2}
                      max={5}
                      step={1}
                      value={[botConfigData.consecutiveLossLimit]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, consecutiveLossLimit: value }))
                      }
                    />
                    <p className="text-xs text-gray-500">Reduce risk after X losses in a row</p>
                  </div>
                </CardContent>
              </Card>

              {/* Trading Strategy */}
              <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
                <CardHeader>
                  <CardTitle className="text-gray-900">Trading Strategy</CardTitle>
                  <CardDescription className="text-gray-600">
                    Configure trading behavior and entry requirements
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Trading Mode Preset */}
                  <div className="space-y-2">
                    <Label htmlFor="trading-mode" className="text-gray-900">Trading Mode</Label>
                    <Select
                      value={botConfigData.tradingMode}
                      onValueChange={(value: "conservative" | "balanced" | "aggressive") =>
                        handleTradingModeChange(value)
                      }
                    >
                      <SelectTrigger id="trading-mode" className="text-gray-900">
                        <SelectValue placeholder="Select trading mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="conservative">Conservative (Higher confidence, fewer trades)</SelectItem>
                        <SelectItem value="balanced">Balanced (Standard settings)</SelectItem>
                        <SelectItem value="aggressive">Aggressive (More trades, lower confidence)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-500">
                      Preset adjusts confidence, risk/reward, and signal requirements
                    </p>
                  </div>

                  {/* Min Entry Confidence */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="min-confidence" className="text-gray-900">Minimum Entry Confidence</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.minEntryConfidence.toFixed(2)}</span>
                    </div>
                    <Slider
                      id="min-confidence"
                      min={0.50}
                      max={0.80}
                      step={0.01}
                      value={[botConfigData.minEntryConfidence]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, minEntryConfidence: value }))
                      }
                    />
                    <p className="text-xs text-gray-500">Minimum AI confidence to enter trades</p>
                  </div>

                  {/* Min Risk/Reward Ratio */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="min-rr" className="text-gray-900">Minimum Risk/Reward Ratio</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.minRiskRewardRatio.toFixed(1)}:1</span>
                    </div>
                    <Slider
                      id="min-rr"
                      min={1.0}
                      max={3.0}
                      step={0.1}
                      value={[botConfigData.minRiskRewardRatio]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, minRiskRewardRatio: value }))
                      }
                    />
                    <p className="text-xs text-gray-500">Minimum reward per unit of risk</p>
                  </div>

                  {/* Stop-Out Cooldown */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="cooldown" className="text-gray-900">Stop-Out Cooldown Period</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.stopOutCooldownHours}h</span>
                    </div>
                    <Slider
                      id="cooldown"
                      min={0}
                      max={24}
                      step={1}
                      value={[botConfigData.stopOutCooldownHours]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, stopOutCooldownHours: value }))
                      }
                    />
                    <p className="text-xs text-gray-500">Wait time before re-entering same symbol after stop loss</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          {/* Tab 3: Advanced */}
          <TabsContent value="advanced">
            <motion.div
              initial={tabFadeVariants.initial}
              animate={tabFadeVariants.animate}
              transition={tabFadeVariants.transition}
              className="space-y-6 pt-4"
            >
              {/* Advanced Settings */}
              <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
                <CardHeader>
                  <CardTitle className="text-gray-900">Advanced Settings</CardTitle>
                  <CardDescription className="text-gray-600">
                    Technical analysis parameters (modify with caution)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <Alert className="border-yellow-400 bg-yellow-50">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    <AlertTitle className="text-yellow-800">Warning</AlertTitle>
                    <AlertDescription className="text-yellow-700">
                      Only modify these settings if you understand technical analysis. Incorrect values can lead to losses.
                    </AlertDescription>
                  </Alert>

                  {/* Min Entry Signals */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="min-signals" className="text-gray-900">Minimum Entry Signals</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.minEntrySignals}</span>
                    </div>
                    <Slider
                      id="min-signals"
                      min={1}
                      max={4}
                      step={1}
                      value={[botConfigData.minEntrySignals]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, minEntrySignals: value }))
                      }
                    />
                    <p className="text-xs text-gray-500">How many indicators must align to enter a trade</p>
                  </div>

                  {/* Require 4H Alignment */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="require-4h" className="text-gray-900">Require 4-Hour Trend Alignment</Label>
                      <p className="text-sm text-gray-500">
                        Only enter trades aligned with 4-hour trend (more conservative)
                      </p>
                    </div>
                    <Switch
                      id="require-4h"
                      checked={botConfigData.require4hAlignment}
                      onCheckedChange={(checked) =>
                        setBotConfigData((prev) => ({ ...prev, require4hAlignment: checked }))
                      }
                    />
                  </div>

                  {/* Trade Volatile Markets */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="trade-volatile" className="text-gray-900">Trade in Volatile Markets</Label>
                      <p className="text-sm text-gray-500">
                        Allow trading when ATR3 {'>'} 1.5x ATR14 (volatile conditions)
                      </p>
                    </div>
                    <Switch
                      id="trade-volatile"
                      checked={botConfigData.tradeVolatileMarkets}
                      onCheckedChange={(checked) =>
                        setBotConfigData((prev) => ({ ...prev, tradeVolatileMarkets: checked }))
                      }
                    />
                  </div>

                  {/* Volatility Size Reduction */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="volatility-reduction" className="text-gray-900">Volatility Position Size Reduction</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.volatilitySizeReduction}%</span>
                    </div>
                    <Slider
                      id="volatility-reduction"
                      min={25}
                      max={75}
                      step={5}
                      value={[botConfigData.volatilitySizeReduction]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, volatilitySizeReduction: value }))
                      }
                    />
                    <p className="text-xs text-gray-500">Reduce position size by X% in volatile conditions</p>
                  </div>

                  {/* Stop Loss ATR Multiplier */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="atr-multiplier" className="text-gray-900">Stop Loss ATR Multiplier</Label>
                      <span className="text-sm text-gray-600 font-mono">{botConfigData.stopLossAtrMultiplier.toFixed(1)}x</span>
                    </div>
                    <Slider
                      id="atr-multiplier"
                      min={1.0}
                      max={3.0}
                      step={0.1}
                      value={[botConfigData.stopLossAtrMultiplier]}
                      onValueChange={([value]) =>
                        setBotConfigData((prev) => ({ ...prev, stopLossAtrMultiplier: value }))
                      }
                    />
                    <p className="text-xs text-gray-500">Stop loss = Entry +/- (ATR x multiplier)</p>
                  </div>
                </CardContent>
              </Card>

              {/* Risk Warnings - Informational Only */}
              {riskWarnings.length > 0 && (
                <Alert className="border-yellow-400 bg-yellow-50">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <AlertTitle className="text-yellow-800">Risk Warnings (Informational)</AlertTitle>
                  <AlertDescription className="text-yellow-700">
                    <p className="mb-2 text-sm">The following settings may increase risk. You can still save and experiment:</p>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      {riskWarnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </motion.div>
          </TabsContent>

          {/* Tab 4: Telegram */}
          <TabsContent value="telegram">
            <motion.div
              initial={tabFadeVariants.initial}
              animate={tabFadeVariants.animate}
              transition={tabFadeVariants.transition}
            >
              <TelegramSettings />
            </motion.div>
          </TabsContent>
        </Tabs>

        {/* Sticky Save Bot Configuration Button */}
        <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 py-4 -mx-8 px-8">
          <div className="flex justify-end">
            <Button
              onClick={handleSaveBotConfig}
              disabled={isSavingConfig}
              className="bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSavingConfig && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSavingConfig ? "Saving..." : "Save Bot Configuration"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
