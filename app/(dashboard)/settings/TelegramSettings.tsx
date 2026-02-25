"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MessageSquare, Copy, Check, Unlink, Send, Bell } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function TelegramSettings() {
  const { user } = useUser();
  const { toast } = useToast();
  const userId = user?.id || "";

  // Queries
  const settings = useQuery(
    api.telegram.telegramQueries.getSettings,
    userId ? { userId } : "skip"
  );

  // Mutations
  const generateCode = useMutation(api.telegram.telegramMutations.generateVerificationCode);
  const unlinkTelegram = useMutation(api.telegram.telegramMutations.unlinkTelegram);
  const updatePrefs = useMutation(api.telegram.telegramMutations.updateNotificationPrefs);
  const sendTest = useAction(api.telegram.notifier.sendTestNotification);

  // Local state
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const isLinked = settings?.isLinked ?? false;

  const handleGenerateCode = async () => {
    try {
      setIsGenerating(true);
      const code = await generateCode({ userId });
      setVerificationCode(code);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate verification code.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCode = () => {
    if (!verificationCode) return;
    navigator.clipboard.writeText(`/link ${verificationCode}`);
    setCodeCopied(true);
    toast({ title: "Copied", description: "Link command copied to clipboard." });
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handleUnlink = async () => {
    try {
      await unlinkTelegram({ userId });
      setVerificationCode(null);
      toast({ title: "Unlinked", description: "Telegram account has been disconnected." });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to unlink Telegram.",
        variant: "destructive",
      });
    }
  };

  const handleToggle = async (
    field: "notifyTradeOpened" | "notifyTradeClosed" | "notifyRiskAlerts" | "notifyDailySummary",
    value: boolean
  ) => {
    try {
      await updatePrefs({ userId, [field]: value });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update notification preference.",
        variant: "destructive",
      });
    }
  };

  const handleIntervalChange = async (value: string) => {
    try {
      await updatePrefs({ userId, positionUpdateInterval: parseInt(value, 10) });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update position update interval.",
        variant: "destructive",
      });
    }
  };

  const handleTestNotification = async () => {
    try {
      setIsTesting(true);
      await sendTest({ userId });
      toast({ title: "Test sent", description: "Check your Telegram for the test message." });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send test notification.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6 pt-4">
      {/* Connection Status */}
      <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-gray-900 flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Telegram Integration
              </CardTitle>
              <CardDescription className="text-gray-600">
                Receive trade notifications and control your bot via Telegram
              </CardDescription>
            </div>
            <Badge
              variant={isLinked ? "default" : "secondary"}
              className={
                isLinked
                  ? "bg-green-100 text-green-800 border-green-200"
                  : "bg-gray-100 text-gray-600 border-gray-200"
              }
            >
              {isLinked ? "Connected" : "Not Connected"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLinked ? (
            <>
              {!verificationCode ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Link your Telegram account to receive real-time trade notifications and send commands to your bot.
                  </p>
                  <Button
                    onClick={handleGenerateCode}
                    disabled={isGenerating}
                    className="bg-gray-900 text-white hover:bg-gray-800"
                  >
                    {isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isGenerating ? "Generating..." : "Generate Link Code"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Send this command to <span className="font-semibold text-gray-900">@Four86Bot</span> on Telegram:
                  </p>
                  <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <code className="flex-1 font-mono text-sm text-gray-900 tabular-nums">
                      /link {verificationCode}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyCode}
                      className="border-gray-200 shrink-0"
                    >
                      {codeCopied ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Code expires in 15 minutes. After sending the command, this page will update automatically.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Your Telegram is connected and receiving notifications.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="border-gray-200 text-gray-600">
                    <Unlink className="mr-2 h-4 w-4" />
                    Unlink
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Unlink Telegram?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You will stop receiving notifications and lose the ability to control your bot via Telegram. You can re-link at any time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleUnlink}>Unlink</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      {isLinked && (
        <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
          <CardHeader>
            <CardTitle className="text-gray-900">Notification Preferences</CardTitle>
            <CardDescription className="text-gray-600">
              Choose which notifications to receive on Telegram
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-gray-900">Trade Opened</Label>
                <p className="text-sm text-gray-500">
                  Get notified when a new position is opened
                </p>
              </div>
              <Switch
                checked={settings?.notifyTradeOpened ?? true}
                onCheckedChange={(checked) => handleToggle("notifyTradeOpened", checked)}
              />
            </div>

            <Separator className="bg-gray-200" />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-gray-900">Trade Closed</Label>
                <p className="text-sm text-gray-500">
                  Get notified when a position is closed with P&L details
                </p>
              </div>
              <Switch
                checked={settings?.notifyTradeClosed ?? true}
                onCheckedChange={(checked) => handleToggle("notifyTradeClosed", checked)}
              />
            </div>

            <Separator className="bg-gray-200" />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-gray-900">Risk Alerts</Label>
                <p className="text-sm text-gray-500">
                  Circuit breaker triggers, emergency closes, and bot errors
                </p>
              </div>
              <Switch
                checked={settings?.notifyRiskAlerts ?? true}
                onCheckedChange={(checked) => handleToggle("notifyRiskAlerts", checked)}
              />
            </div>

            <Separator className="bg-gray-200" />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-gray-900">Daily Summary</Label>
                <p className="text-sm text-gray-500">
                  Receive a daily performance digest
                </p>
              </div>
              <Switch
                checked={settings?.notifyDailySummary ?? true}
                onCheckedChange={(checked) => handleToggle("notifyDailySummary", checked)}
              />
            </div>

            <Separator className="bg-gray-200" />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-gray-900 flex items-center gap-1.5">
                  <Bell className="h-4 w-4" />
                  Position Updates
                </Label>
                <p className="text-sm text-gray-500">
                  Periodic status updates for open positions
                </p>
              </div>
              <Select
                value={String(settings?.positionUpdateInterval ?? 0)}
                onValueChange={handleIntervalChange}
              >
                <SelectTrigger className="w-[140px] border-gray-200 text-gray-900">
                  <SelectValue placeholder="Off" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Off</SelectItem>
                  <SelectItem value="5">Every 5 min</SelectItem>
                  <SelectItem value="10">Every 10 min</SelectItem>
                  <SelectItem value="20">Every 20 min</SelectItem>
                  <SelectItem value="30">Every 30 min</SelectItem>
                  <SelectItem value="45">Every 45 min</SelectItem>
                  <SelectItem value="60">Every 60 min</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test & Actions */}
      {isLinked && (
        <Card className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-gray-200">
          <CardHeader>
            <CardTitle className="text-gray-900">Test Connection</CardTitle>
            <CardDescription className="text-gray-600">
              Send a test message to verify your Telegram connection
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleTestNotification}
              disabled={isTesting}
              variant="outline"
              className="border-gray-200"
            >
              {isTesting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {isTesting ? "Sending..." : "Send Test Notification"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
