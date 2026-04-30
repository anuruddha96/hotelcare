import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Coffee, Search } from "lucide-react";

export default function Breakfast() {
  const [code, setCode] = useState("");
  const [room, setRoom] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function lookup() {
    setBusy(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("breakfast-lookup", {
      body: { code: code.trim(), room: room.trim(), date },
    });
    setBusy(false);
    if (error) { setResult({ status: "error", message: error.message }); return; }
    setResult(data);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Coffee className="h-6 w-6" /> Breakfast Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Hotel code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="mika-2026" autoFocus />
          </div>
          <div>
            <Label>Room number</Label>
            <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Q-101" />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Button onClick={lookup} disabled={busy || !code || !room} className="w-full">
            <Search className="h-4 w-4 mr-2" /> Check
          </Button>

          {result && (
            <div className="mt-4 rounded-lg border p-4 space-y-2">
              {result.status === "eligible" && (
                <>
                  <Badge className="bg-green-600">Eligible for breakfast</Badge>
                  <div className="text-2xl font-bold">Room {result.room}</div>
                  <div className="text-sm text-muted-foreground">Pax: {result.pax} · Breakfasts: {result.breakfast}{result.all_inclusive > 0 ? ` · All-inclusive: ${result.all_inclusive}` : ""}</div>
                  <div>
                    <div className="font-semibold mt-2">Guests:</div>
                    <ul className="list-disc list-inside">
                      {(result.guest_names ?? []).map((n: string, i: number) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                </>
              )}
              {result.status === "not_eligible" && (
                <>
                  <Badge variant="destructive">Not eligible for breakfast</Badge>
                  <div>Room {result.room} · Pax {result.pax}</div>
                </>
              )}
              {result.status === "not_found" && (
                <Badge variant="outline">No reservation found for this room/date</Badge>
              )}
              {result.status === "invalid_code" && (
                <Badge variant="destructive">Invalid hotel code</Badge>
              )}
              {result.status === "error" && (
                <div className="text-red-600 text-sm">{result.message}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
