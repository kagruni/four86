"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AnalyticsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-black">Analytics</h1>
        <p className="mt-2 text-sm text-gray-500">
          Performance analytics and charts
        </p>
      </div>

      <Card className="border-black">
        <CardHeader>
          <CardTitle className="text-black">Coming Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            Analytics features will be available soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
