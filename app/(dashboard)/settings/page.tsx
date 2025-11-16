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
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const AI_MODELS = [
  { value: "glm-4.6", label: "GLM-4.6 (ZhipuAI) - Latest" },
  { value: "glm-4-plus", label: "GLM-4-Plus (ZhipuAI)" },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "openai/gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "google/gemini-pro-1.5", label: "Gemini Pro 1.5" },
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
  stopLossEnabled: z.boolean(),
});

const credentialsSchema = z.object({
  zhipuaiApiKey: z.string().optional(),
  openrouterApiKey: z.string().optional(),
  hyperliquidPrivateKey: z.string().optional(),
  hyperliquidAddress: z.string().optional(),
  hyperliquidTestnet: z.boolean(),
});

type BotConfigFormData = z.infer<typeof botConfigSchema>;
type CredentialsFormData = z.infer<typeof credentialsSchema>;

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
    modelName: "glm-4.6",
    symbols: ["BTC"],
    maxLeverage: 5,
    maxPositionSize: 10,
    maxDailyLoss: 5,
    minAccountValue: 100,
    startingCapital: 1000,
    isActive: false,
    stopLossEnabled: true,
  });

  // Credentials state
  const [credentialsData, setCredentialsData] = useState<CredentialsFormData>({
    zhipuaiApiKey: "",
    openrouterApiKey: "",
    hyperliquidPrivateKey: "",
    hyperliquidAddress: "",
    hyperliquidTestnet: true,
  });

  const [showPrivateKeys, setShowPrivateKeys] = useState({
    zhipuai: false,
    openrouter: false,
    hyperliquid: false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);

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
        stopLossEnabled: botConfig.stopLossEnabled,
      });
    }
  }, [botConfig]);

  // Load existing credentials
  useEffect(() => {
    if (userCredentials) {
      setCredentialsData({
        zhipuaiApiKey: userCredentials.hasZhipuaiApiKey ? "••••••••" : "",
        openrouterApiKey: userCredentials.hasOpenrouterApiKey ? "••••••••" : "",
        hyperliquidPrivateKey: userCredentials.hasHyperliquidPrivateKey ? "••••••••" : "",
        hyperliquidAddress: userCredentials.hyperliquidAddress || "",
        hyperliquidTestnet: userCredentials.hyperliquidTestnet,
      });
    }
  }, [userCredentials]);

  const handleSymbolToggle = (symbol: string) => {
    setBotConfigData((prev) => ({
      ...prev,
      symbols: prev.symbols.includes(symbol)
        ? prev.symbols.filter((s) => s !== symbol)
        : [...prev.symbols, symbol],
    }));
  };

  const handleSaveBotConfig = async () => {
    try {
      setIsSavingConfig(true);
      setErrors({});

      const validatedData = botConfigSchema.parse(botConfigData);

      await upsertBotConfig({
        userId,
        ...validatedData,
      });

      toast({
        title: "Bot configuration saved",
        description: "Your trading bot settings have been updated successfully.",
      });
    } catch (error) {
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

      if (credentialsData.zhipuaiApiKey && credentialsData.zhipuaiApiKey !== "••••••••") {
        credentialsToSave.zhipuaiApiKey = credentialsData.zhipuaiApiKey;
      }

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
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-gray-900">Bot Settings</h1>
          <p className="text-gray-600">Configure your trading bot parameters and API credentials</p>
        </div>

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
        <Card className="bg-white border-gray-200">
          <CardHeader>
            <CardTitle className="text-gray-900">AI Provider Settings</CardTitle>
            <CardDescription className="text-gray-600">
              Configure API keys for AI trading models
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* ZhipuAI API Key */}
            <div className="space-y-2">
              <Label htmlFor="zhipuai-key" className="text-gray-900">ZhipuAI API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="zhipuai-key"
                  type={showPrivateKeys.zhipuai ? "text" : "password"}
                  value={credentialsData.zhipuaiApiKey}
                  onChange={(e) =>
                    setCredentialsData((prev) => ({
                      ...prev,
                      zhipuaiApiKey: e.target.value,
                    }))
                  }
                  placeholder="Enter your ZhipuAI API key"
                  className="flex-1 text-gray-900 placeholder:text-gray-400"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowPrivateKeys(prev => ({ ...prev, zhipuai: !prev.zhipuai }))}
                  className="border-gray-200"
                >
                  {showPrivateKeys.zhipuai ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-gray-500">Required for GLM-4-Plus model</p>
            </div>

            <Separator className="bg-gray-200" />

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
              <p className="text-xs text-gray-500">Required for Claude, GPT, and Gemini models</p>
            </div>

            <div className="flex justify-end pt-4">
              <Button
                onClick={handleSaveCredentials}
                disabled={isSavingCredentials}
                className="bg-gray-900 text-white hover:bg-gray-800"
              >
                {isSavingCredentials && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSavingCredentials ? "Saving..." : "Save AI Credentials"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Hyperliquid Credentials */}
        <Card className="bg-white border-gray-200">
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

        {/* AI Model Selection */}
        <Card className="bg-white border-gray-200">
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

        {/* Trading Symbols */}
        <Card className="bg-white border-gray-200">
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
        <Card className="bg-white border-gray-200">
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
                <span className="text-sm text-gray-600">{botConfigData.maxLeverage}x</span>
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
                <span className="text-sm text-gray-600">{botConfigData.maxPositionSize}%</span>
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
                <span className="text-sm text-gray-600">{botConfigData.maxDailyLoss}%</span>
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

            {/* Starting Capital */}
            <div className="space-y-2">
              <Label htmlFor="starting-capital" className="text-gray-900">Starting Capital ($)</Label>
              <Input
                id="starting-capital"
                type="number"
                value={botConfigData.startingCapital}
                onChange={(e) =>
                  setBotConfigData((prev) => ({
                    ...prev,
                    startingCapital: parseFloat(e.target.value) || 0,
                  }))
                }
                placeholder="1000"
                className="text-gray-900 placeholder:text-gray-400"
              />
              {errors.startingCapital && (
                <p className="text-sm text-red-600">{errors.startingCapital}</p>
              )}
            </div>

            {/* Stop Loss */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="stop-loss"
                checked={botConfigData.stopLossEnabled}
                onCheckedChange={(checked) =>
                  setBotConfigData((prev) => ({
                    ...prev,
                    stopLossEnabled: checked === true,
                  }))
                }
              />
              <Label
                htmlFor="stop-loss"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer text-gray-900"
              >
                Enable Stop Loss
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Save Bot Configuration Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSaveBotConfig}
            disabled={isSavingConfig}
            className="bg-gray-900 text-white hover:bg-gray-800"
          >
            {isSavingConfig && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSavingConfig ? "Saving..." : "Save Bot Configuration"}
          </Button>
        </div>
      </div>
    </div>
  );
}
