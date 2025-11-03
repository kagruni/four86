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
import { useToast } from "@/hooks/use-toast";

const AI_MODELS = [
  { value: "glm-4-plus", label: "GLM-4-Plus (ZhipuAI)" },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "openai/gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "google/gemini-pro-1.5", label: "Gemini Pro 1.5" },
] as const;

const TRADING_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"] as const;

const settingsSchema = z.object({
  modelName: z.string().min(1, "AI model is required"),
  symbols: z.array(z.string()).min(1, "Select at least one symbol"),
  maxLeverage: z.number().min(1).max(20),
  maxPositionSize: z.number().min(1).max(100),
  maxDailyLoss: z.number().min(1).max(50),
  minAccountValue: z.number().min(0),
  hyperliquidPrivateKey: z.string().min(1, "Private key is required"),
  hyperliquidAddress: z.string().min(1, "Address is required"),
  startingCapital: z.number().min(0),
  isActive: z.boolean(),
  stopLossEnabled: z.boolean(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export default function SettingsPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const userId = user?.id || "";

  const botConfig = useQuery(api.queries.getBotConfig, { userId });
  const upsertBotConfig = useMutation(api.mutations.upsertBotConfig);

  const [formData, setFormData] = useState<SettingsFormData>({
    modelName: "glm-4-plus",
    symbols: ["BTC"],
    maxLeverage: 5,
    maxPositionSize: 10,
    maxDailyLoss: 5,
    minAccountValue: 100,
    hyperliquidPrivateKey: "",
    hyperliquidAddress: "",
    startingCapital: 1000,
    isActive: false,
    stopLossEnabled: true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Load existing config
  useEffect(() => {
    if (botConfig) {
      setFormData({
        modelName: botConfig.modelName,
        symbols: botConfig.symbols,
        maxLeverage: botConfig.maxLeverage,
        maxPositionSize: botConfig.maxPositionSize,
        maxDailyLoss: botConfig.maxDailyLoss,
        minAccountValue: botConfig.minAccountValue,
        hyperliquidPrivateKey: botConfig.hyperliquidPrivateKey,
        hyperliquidAddress: botConfig.hyperliquidAddress,
        startingCapital: botConfig.startingCapital,
        isActive: botConfig.isActive,
        stopLossEnabled: botConfig.stopLossEnabled,
      });
    }
  }, [botConfig]);

  const handleSymbolToggle = (symbol: string) => {
    setFormData((prev) => ({
      ...prev,
      symbols: prev.symbols.includes(symbol)
        ? prev.symbols.filter((s) => s !== symbol)
        : [...prev.symbols, symbol],
    }));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setErrors({});

      // Validate form data
      const validatedData = settingsSchema.parse(formData);

      // Save to Convex
      await upsertBotConfig({
        userId,
        ...validatedData,
      });

      toast({
        title: "Settings saved",
        description: "Your bot configuration has been updated successfully.",
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
          description: "Failed to save settings. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Bot Settings</h1>
          <p className="text-white/70">Configure your trading bot parameters</p>
        </div>

        {/* AI Model Selection */}
        <Card className="bg-black border-white/20">
          <CardHeader>
            <CardTitle className="text-white">AI Model</CardTitle>
            <CardDescription className="text-white/70">
              Select the AI model for trading decisions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select
                value={formData.modelName}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, modelName: value }))
                }
              >
                <SelectTrigger id="model">
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
                <p className="text-sm text-white/70">{errors.modelName}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Trading Symbols */}
        <Card className="bg-black border-white/20">
          <CardHeader>
            <CardTitle className="text-white">Trading Symbols</CardTitle>
            <CardDescription className="text-white/70">
              Select which cryptocurrencies to trade
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {TRADING_SYMBOLS.map((symbol) => (
                <div key={symbol} className="flex items-center space-x-2">
                  <Checkbox
                    id={symbol}
                    checked={formData.symbols.includes(symbol)}
                    onCheckedChange={() => handleSymbolToggle(symbol)}
                  />
                  <Label
                    htmlFor={symbol}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {symbol}
                  </Label>
                </div>
              ))}
              {errors.symbols && (
                <p className="text-sm text-white/70">{errors.symbols}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Risk Management */}
        <Card className="bg-black border-white/20">
          <CardHeader>
            <CardTitle className="text-white">Risk Management</CardTitle>
            <CardDescription className="text-white/70">
              Configure risk parameters for your trading bot
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Max Leverage */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="leverage">Max Leverage</Label>
                <span className="text-sm text-white/70">{formData.maxLeverage}x</span>
              </div>
              <Slider
                id="leverage"
                min={1}
                max={20}
                step={1}
                value={[formData.maxLeverage]}
                onValueChange={([value]) =>
                  setFormData((prev) => ({ ...prev, maxLeverage: value }))
                }
              />
            </div>

            {/* Max Position Size */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="position-size">Max Position Size</Label>
                <span className="text-sm text-white/70">{formData.maxPositionSize}%</span>
              </div>
              <Slider
                id="position-size"
                min={1}
                max={100}
                step={1}
                value={[formData.maxPositionSize]}
                onValueChange={([value]) =>
                  setFormData((prev) => ({ ...prev, maxPositionSize: value }))
                }
              />
            </div>

            {/* Max Daily Loss */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="daily-loss">Max Daily Loss</Label>
                <span className="text-sm text-white/70">{formData.maxDailyLoss}%</span>
              </div>
              <Slider
                id="daily-loss"
                min={1}
                max={50}
                step={1}
                value={[formData.maxDailyLoss]}
                onValueChange={([value]) =>
                  setFormData((prev) => ({ ...prev, maxDailyLoss: value }))
                }
              />
            </div>

            {/* Min Account Value */}
            <div className="space-y-2">
              <Label htmlFor="min-account">Min Account Value ($)</Label>
              <Input
                id="min-account"
                type="number"
                value={formData.minAccountValue}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    minAccountValue: parseFloat(e.target.value) || 0,
                  }))
                }
                placeholder="100"
              />
              {errors.minAccountValue && (
                <p className="text-sm text-white/70">{errors.minAccountValue}</p>
              )}
            </div>

            {/* Starting Capital */}
            <div className="space-y-2">
              <Label htmlFor="starting-capital">Starting Capital ($)</Label>
              <Input
                id="starting-capital"
                type="number"
                value={formData.startingCapital}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    startingCapital: parseFloat(e.target.value) || 0,
                  }))
                }
                placeholder="1000"
              />
              {errors.startingCapital && (
                <p className="text-sm text-white/70">{errors.startingCapital}</p>
              )}
            </div>

            {/* Stop Loss */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="stop-loss"
                checked={formData.stopLossEnabled}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({
                    ...prev,
                    stopLossEnabled: checked === true,
                  }))
                }
              />
              <Label
                htmlFor="stop-loss"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Enable Stop Loss
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Hyperliquid Credentials */}
        <Card className="bg-black border-white/20">
          <CardHeader>
            <CardTitle className="text-white">Hyperliquid API Credentials</CardTitle>
            <CardDescription className="text-white/70">
              Enter your Hyperliquid wallet credentials
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="private-key">Private Key</Label>
              <Input
                id="private-key"
                type="password"
                value={formData.hyperliquidPrivateKey}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    hyperliquidPrivateKey: e.target.value,
                  }))
                }
                placeholder="0x..."
              />
              {errors.hyperliquidPrivateKey && (
                <p className="text-sm text-white/70">{errors.hyperliquidPrivateKey}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Wallet Address</Label>
              <Input
                id="address"
                type="text"
                value={formData.hyperliquidAddress}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    hyperliquidAddress: e.target.value,
                  }))
                }
                placeholder="0x..."
              />
              {errors.hyperliquidAddress && (
                <p className="text-sm text-white/70">{errors.hyperliquidAddress}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-white text-black hover:bg-white/90"
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}
