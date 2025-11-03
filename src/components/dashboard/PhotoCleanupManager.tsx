import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Trash2, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function PhotoCleanupManager() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();

  const runCleanup = async () => {
    setIsRunning(true);
    setResult(null);

    try {
      // Call the edge function
      const { data, error } = await supabase.functions.invoke('cleanup-old-photos', {
        method: 'POST',
      });

      if (error) throw error;

      setResult(data);

      toast({
        title: "Cleanup Completed",
        description: data.message,
      });
    } catch (error: any) {
      console.error('Cleanup error:', error);

      toast({
        variant: "destructive",
        title: "Cleanup Failed",
        description: error.message || "Failed to run photo cleanup",
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="h-5 w-5" />
          Storage Cleanup
        </CardTitle>
        <CardDescription>
          Delete non-critical photos older than 2 weeks to free up storage space
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>What will be deleted:</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>DND (Do Not Disturb) photos older than 2 weeks</li>
              <li>Room completion photos older than 2 weeks</li>
            </ul>
          </AlertDescription>
        </Alert>

        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>What will be kept:</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Lost and found photos (kept permanently)</li>
              <li>Maintenance issue photos (kept permanently)</li>
              <li>Ticket attachments (kept permanently)</li>
              <li>All photos less than 2 weeks old</li>
            </ul>
          </AlertDescription>
        </Alert>

        <Button 
          onClick={runCleanup} 
          disabled={isRunning}
          className="w-full"
        >
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running Cleanup...
            </>
          ) : (
            <>
              <Trash2 className="mr-2 h-4 w-4" />
              Run Storage Cleanup
            </>
          )}
        </Button>

        {result && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Cleanup Results:</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>DND photos deleted: {result.details.deletedDndPhotos}</li>
                <li>Completion photos deleted: {result.details.deletedCompletionPhotos}</li>
                <li>Storage files removed: {result.details.deletedStorageFiles}</li>
                <li>Storage freed: ~{result.details.storageFreedMB.toFixed(2)} MB</li>
                {result.details.errors.length > 0 && (
                  <li className="text-destructive">
                    Errors: {result.details.errors.length} (check console)
                  </li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
