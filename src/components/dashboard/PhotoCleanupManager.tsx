import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Trash2, AlertCircle, CheckCircle, Loader2, HardDrive, Database } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export function PhotoCleanupManager() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [storageStatus, setStorageStatus] = useState<any>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchStorageStatus();
  }, []);

  const fetchStorageStatus = async () => {
    setLoadingStatus(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-storage-status', {
        method: 'GET',
      });

      if (error) throw error;
      setStorageStatus(data);
    } catch (error: any) {
      console.error('Storage status error:', error);
      toast({
        variant: "destructive",
        title: "Failed to fetch storage status",
        description: error.message,
      });
    } finally {
      setLoadingStatus(false);
    }
  };

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

      // Refresh storage status after cleanup
      await fetchStorageStatus();
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
    <div className="space-y-6">
      {/* Storage Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Storage Status
          </CardTitle>
          <CardDescription>
            Current storage usage and metrics
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingStatus ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : storageStatus ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-muted/50 p-4 rounded-lg">
                  <div className="text-sm text-muted-foreground">Total Storage</div>
                  <div className="text-2xl font-bold">
                    {storageStatus.totalSizeGB.toFixed(2)} GB
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {storageStatus.totalSizeMB.toFixed(2)} MB
                  </div>
                </div>
                <div className="bg-muted/50 p-4 rounded-lg">
                  <div className="text-sm text-muted-foreground">Total Files</div>
                  <div className="text-2xl font-bold">{storageStatus.totalFiles}</div>
                </div>
                <div className="bg-muted/50 p-4 rounded-lg">
                  <div className="text-sm text-muted-foreground">Pending Cleanup</div>
                  <div className="text-2xl font-bold text-destructive">
                    {storageStatus.pendingCleanup.total}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    files older than 3 days
                  </div>
                </div>
              </div>

              {storageStatus.buckets.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Storage by Bucket:</div>
                  <div className="space-y-2">
                    {storageStatus.buckets.map((bucket: any) => (
                      <div key={bucket.name} className="flex items-center justify-between p-3 bg-muted/30 rounded">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{bucket.name}</span>
                          <Badge variant="secondary">{bucket.fileCount} files</Badge>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {bucket.sizeMB.toFixed(2)} MB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Unable to load storage status</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Cleanup Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Storage Cleanup
          </CardTitle>
          <CardDescription>
            Delete daily room photos older than 3 days to free up storage space
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>What will be deleted:</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>DND (Do Not Disturb) photos older than 3 days</li>
              <li>Room completion photos older than 3 days</li>
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
              <li>All photos less than 3 days old</li>
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

        <Alert className="bg-muted/50">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Automatic Cleanup</AlertTitle>
          <AlertDescription>
            This cleanup process runs automatically every day at 2:00 AM UTC to keep storage usage low.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
    </div>
  );
}
