import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Trash2, AlertCircle, CheckCircle, Loader2, HardDrive, Database, ChevronDown, ChevronUp } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface StorageFile {
  bucket: string;
  path: string;
  name: string;
  size: number;
  createdAt: string;
}

export function PhotoCleanupManager() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [storageStatus, setStorageStatus] = useState<any>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set(['room-photos', 'dnd-photos']));
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

  const toggleBucket = (bucketName: string) => {
    const newExpanded = new Set(expandedBuckets);
    if (newExpanded.has(bucketName)) {
      newExpanded.delete(bucketName);
    } else {
      newExpanded.add(bucketName);
    }
    setExpandedBuckets(newExpanded);
  };

  const toggleFileSelection = (filePath: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(filePath)) {
      newSelected.delete(filePath);
    } else {
      newSelected.add(filePath);
    }
    setSelectedFiles(newSelected);
  };

  const toggleBucketSelection = (bucketName: string) => {
    const bucketFiles = storageStatus?.files?.filter((f: StorageFile) => f.bucket === bucketName) || [];
    const allSelected = bucketFiles.every((f: StorageFile) => selectedFiles.has(f.path));
    
    const newSelected = new Set(selectedFiles);
    if (allSelected) {
      bucketFiles.forEach((f: StorageFile) => newSelected.delete(f.path));
    } else {
      bucketFiles.forEach((f: StorageFile) => newSelected.add(f.path));
    }
    setSelectedFiles(newSelected);
  };

  const deleteSelectedFiles = async () => {
    if (selectedFiles.size === 0) {
      toast({
        variant: "destructive",
        title: "No files selected",
        description: "Please select files to delete",
      });
      return;
    }

    setIsDeleting(true);

    try {
      // Group files by bucket
      const filesByBucket = new Map<string, string[]>();
      selectedFiles.forEach(filePath => {
        const file = storageStatus?.files?.find((f: StorageFile) => f.path === filePath);
        if (file) {
          if (!filesByBucket.has(file.bucket)) {
            filesByBucket.set(file.bucket, []);
          }
          filesByBucket.get(file.bucket)!.push(filePath);
        }
      });

      let totalDeleted = 0;
      let totalFreed = 0;

      // Delete files from each bucket
      for (const [bucket, files] of filesByBucket) {
        const { data, error } = await supabase.functions.invoke('delete-storage-files', {
          body: { bucket, files }
        });

        if (error) throw error;

        totalDeleted += data.deletedCount;
        totalFreed += data.freedMB;
      }

      toast({
        title: "Files Deleted",
        description: `Deleted ${totalDeleted} files (~${totalFreed.toFixed(2)} MB freed)`,
      });

      setSelectedFiles(new Set());
      await fetchStorageStatus();
    } catch (error: any) {
      console.error('Delete error:', error);
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: error.message || "Failed to delete files",
      });
    } finally {
      setIsDeleting(false);
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
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Storage by Bucket:</div>
                    {selectedFiles.size > 0 && (
                      <Button 
                        onClick={deleteSelectedFiles} 
                        disabled={isDeleting}
                        variant="destructive"
                        size="sm"
                      >
                        {isDeleting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete {selectedFiles.size} files
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {storageStatus.buckets.map((bucket: any) => {
                      const bucketFiles = storageStatus.files?.filter((f: StorageFile) => f.bucket === bucket.name) || [];
                      const selectedInBucket = bucketFiles.filter((f: StorageFile) => selectedFiles.has(f.path)).length;
                      const isExpanded = expandedBuckets.has(bucket.name);
                      
                      return (
                        <Collapsible key={bucket.name} open={isExpanded} onOpenChange={() => toggleBucket(bucket.name)}>
                          <div className="border rounded-lg">
                            <CollapsibleTrigger className="w-full">
                              <div className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors">
                                <div className="flex items-center gap-3">
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  <Database className="h-4 w-4 text-muted-foreground" />
                                  <span className="font-medium">{bucket.name}</span>
                                  <Badge variant="secondary">{bucket.fileCount} files</Badge>
                                  {selectedInBucket > 0 && (
                                    <Badge variant="default">{selectedInBucket} selected</Badge>
                                  )}
                                </div>
                                <span className="text-sm text-muted-foreground">
                                  {bucket.sizeMB.toFixed(2)} MB
                                </span>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="border-t p-3 space-y-2">
                                <div className="flex items-center gap-2 pb-2 border-b">
                                  <Checkbox
                                    checked={bucketFiles.length > 0 && bucketFiles.every((f: StorageFile) => selectedFiles.has(f.path))}
                                    onCheckedChange={() => toggleBucketSelection(bucket.name)}
                                  />
                                  <span className="text-sm font-medium">Select All</span>
                                </div>
                                <div className="max-h-64 overflow-y-auto space-y-1">
                                  {bucketFiles.map((file: StorageFile) => (
                                    <div key={file.path} className="flex items-center gap-2 p-2 hover:bg-muted/30 rounded text-sm">
                                      <Checkbox
                                        checked={selectedFiles.has(file.path)}
                                        onCheckedChange={() => toggleFileSelection(file.path)}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="truncate">{file.name}</div>
                                        <div className="text-xs text-muted-foreground">
                                          {(file.size / 1024).toFixed(2)} KB • {new Date(file.createdAt).toLocaleDateString()}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      );
                    })}
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
