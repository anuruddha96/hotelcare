import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Download, Eye, FileText, Image as ImageIcon, File, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AttachmentViewerProps {
  attachments: string[];
  className?: string;
}

interface ParsedAttachment {
  url: string;
  filename: string;
  type: 'image' | 'document';
  extension: string;
}

export function AttachmentViewer({ attachments, className }: AttachmentViewerProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  if (!attachments || attachments.length === 0) {
    return null;
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

  const downloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Download failed:', error);
      // Fallback: open in new tab
      window.open(url, '_blank');
    }
  };

  const parsedAttachments = attachments.map(parseAttachment);
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
                    onClick={() => setSelectedImage(attachment.url)}
                  >
                    <img
                      src={attachment.url}
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
                        onClick={() => window.open(attachment.url, '_blank')}
                        className="h-8 w-8 p-0"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadFile(attachment.url, attachment.filename)}
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