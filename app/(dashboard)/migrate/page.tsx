"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function MigrationPage() {
  const { toast } = useToast();
  const runMigration = useAction(api.migrations.runMigration.runRemoveStopLossEnabledMigration);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleRunMigration = async () => {
    try {
      setIsRunning(true);
      setResult(null);

      const migrationResult = await runMigration();
      setResult(migrationResult);

      if (migrationResult.success) {
        toast({
          title: "Migration Complete",
          description: `Updated ${migrationResult.updatedRecords} record(s)`,
        });
      } else {
        toast({
          title: "Migration Failed",
          description: "Check console for details",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Migration error:", error);
      toast({
        title: "Error",
        description: "Failed to run migration. Check console for details.",
        variant: "destructive",
      });
      setResult({ success: false, error: String(error) });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Database Migration</h1>
        <p className="text-gray-600 mt-2">
          Run database migrations to update schema
        </p>
      </div>

      <Alert className="border-yellow-400 bg-yellow-50">
        <AlertCircle className="h-4 w-4 text-yellow-600" />
        <AlertTitle className="text-yellow-800">Warning</AlertTitle>
        <AlertDescription className="text-yellow-700">
          This migration will remove the deprecated <code>stopLossEnabled</code> field from your bot configuration.
          This is a one-time operation required to fix schema validation errors.
        </AlertDescription>
      </Alert>

      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900">Remove stopLossEnabled Field</CardTitle>
          <CardDescription className="text-gray-600">
            Click the button below to run the migration that removes the deprecated field from your bot configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleRunMigration}
            disabled={isRunning}
            className="bg-gray-900 text-white hover:bg-gray-800"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running Migration...
              </>
            ) : (
              <>
                Run Migration
              </>
            )}
          </Button>

          {result && (
            <div className="mt-4">
              {result.success ? (
                <Alert className="border-green-400 bg-green-50">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertTitle className="text-green-800">Success</AlertTitle>
                  <AlertDescription className="text-green-700">
                    Migration completed successfully!
                    <br />
                    Total records: {result.totalRecords}
                    <br />
                    Updated records: {result.updatedRecords}
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-red-400 bg-red-50">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertTitle className="text-red-800">Failed</AlertTitle>
                  <AlertDescription className="text-red-700">
                    {result.error || "Migration failed"}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
