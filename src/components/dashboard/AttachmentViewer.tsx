import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Download, Eye, FileText, Image as ImageIcon, File, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface AttachmentViewerProps {
  attachments: string[];
  className?: string;
}

interface ParsedAttachment {
  url: string;
  signedUrl?: string;
  filename: string;
  type: 'image' | 'document';
  extension: string;
}

export function AttachmentViewer({ attachments, className }: AttachmentViewerProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [parsedAttachments, setParsedAttachments] = useState<ParsedAttachment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSignedUrls = async () => {
      if (!attachments || attachments.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const attachmentsWithSigned = await Promise.all(
          attachments.map(async (url) => {
            const parsed = parseAttachment(url);
            
            // Extract file path from URL for signed URL generation
            const urlParts = url.split('/');
            const bucketIndex = urlParts.findIndex(part => part === 'ticket-attachments');
            if (bucketIndex !== -1 && bucketIndex < urlParts.length - 1) {
              const filePath = urlParts.slice(bucketIndex + 1).join('/');
              
              // Generate signed URL with 1 hour expiry
              const { data: signedData } = await supabase.storage
                .from('ticket-attachments')
                .createSignedUrl(filePath, 3600);
              
              if (signedData?.signedUrl) {
                parsed.signedUrl = signedData.signedUrl;
              }
            }
            
            return parsed;
          })
        );
        
        setParsedAttachments(attachmentsWithSigned);
      } catch (error) {
        console.error('Error generating signed URLs:', error);
        // Fallback to original URLs
        setParsedAttachments(attachments.map(parseAttachment));
      } finally {
        setLoading(false);
      }
    };

    loadSignedUrls();
  }, [attachments]);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  if (loading) {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="text-sm text-muted-foreground">Loading attachments...</div>
      </div>
    );
  }

  const parseAttachment = (url: string): ParsedAttachment => {
    const filename = url.split('/').pop() || 'Unknown file';
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension);
    
    return {
      url,
      filename,
      type: isImage ? 'image' : 'document',
      extension,
    };
  };

  const getFileIcon = (attachment: ParsedAttachment) => {
    if (attachment.type === 'image') {
      return <ImageIcon className="h-4 w-4 text-blue-500" />;
    }
    
    switch (attachment.extension) {
      case 'pdf':
        return <FileText className="h-4 w-4 text-red-500" />;
      case 'doc':
      case 'docx':
        return <FileText className="h-4 w-4 text-blue-600" />;
      case 'txt':
        return <FileText className="h-4 w-4 text-gray-500" />;
      default:
        return <File className="h-4 w-4 text-gray-500" />;
    }
  };

  const downloadFile = async (attachment: ParsedAttachment) => {
    try {
      const downloadUrl = attachment.signedUrl || attachment.url;
      const response = await fetch(downloadUrl);
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = attachment.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('Download failed:', error);
      // Fallback: open in new tab
      const fallbackUrl = attachment.signedUrl || attachment.url;
      window.open(fallbackUrl, '_blank');
    }
  };

  const images = parsedAttachments.filter(att => att.type === 'image');
  const documents = parsedAttachments.filter(att => att.type === 'document');

  return (
    <div className={cn("space-y-4", className)}>
      {/* Images Grid */}
      {images.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            <span className="text-sm font-medium">Images</span>
            <Badge variant="secondary" className="text-xs">
              {images.length}
            </Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {images.map((attachment, index) => (
              <Card key={index} className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow">
                <CardContent className="p-0">
                  <div 
                    className="relative aspect-square bg-muted flex items-center justify-center"
                    onClick={() => setSelectedImage(attachment.signedUrl || attachment.url)}
                  >
                    <img
                      src={attachment.signedUrl || attachment.url}
                      alt={attachment.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                      <Eye className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  <div className="p-2">
                    <p className="text-xs text-muted-foreground truncate">
                      {attachment.filename}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Documents List */}
      {documents.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span className="text-sm font-medium">Documents</span>
            <Badge variant="secondary" className="text-xs">
              {documents.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {documents.map((attachment, index) => (
              <Card key={index} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {getFileIcon(attachment)}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {attachment.filename}
                        </p>
                        <Badge variant="outline" className="text-xs">
                          {attachment.extension.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(attachment.signedUrl || attachment.url, '_blank')}
                        className="h-8 w-8 p-0"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadFile(attachment)}
                        className="h-8 w-8 p-0"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Image Preview Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Image Preview</DialogTitle>
          </DialogHeader>
          {selectedImage && (
            <div className="flex items-center justify-center p-4">
              <img
                src={selectedImage}
                alt="Preview"
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}