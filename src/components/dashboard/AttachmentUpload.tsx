import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Camera, Upload, X, File, Image as ImageIcon, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AttachmentUploadProps {
  ticketId?: string;
  onAttachmentsChange: (attachments: string[]) => void;
  maxFiles?: number;
  className?: string;
}

export interface AttachmentFile {
  file: File;
  preview?: string;
  type: 'image' | 'document';
  uploading?: boolean;
  uploaded?: boolean;
  url?: string;
}

export interface AttachmentUploadRef {
  uploadAttachments: () => Promise<string[]>;
  uploadWithTicketId: (ticketId: string) => Promise<string[]>;
  getAttachments: () => AttachmentFile[];
  hasAttachments: () => boolean;
}

export const AttachmentUpload = forwardRef<AttachmentUploadRef, AttachmentUploadProps>(({ 
  ticketId, 
  onAttachmentsChange, 
  maxFiles = 5,
  className 
}, ref) => {
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    uploadAttachments: async () => {
      if (!ticketId || attachments.length === 0) return [];
      return await uploadAttachmentsInternal(ticketId);
    },
    uploadWithTicketId: async (id: string) => {
      if (!id || attachments.length === 0) return [];
      return await uploadAttachmentsInternal(id);
    },
    getAttachments: () => attachments,
    hasAttachments: () => attachments.length > 0
  }));

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;

    const newFiles: AttachmentFile[] = [];
    
    for (let i = 0; i < files.length && (attachments.length + newFiles.length < maxFiles); i++) {
      const file = files[i];
      
      // Check file size (10MB limit)
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: `${file.name} is larger than 10MB`,
          variant: 'destructive',
        });
        continue;
      }

      const isImage = file.type.startsWith('image/');
      const attachment: AttachmentFile = {
        file,
        type: isImage ? 'image' : 'document',
        uploading: false,
        uploaded: false,
      };

      // Create preview for images
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (e) => {
          attachment.preview = e.target?.result as string;
          setAttachments(prev => [...prev]);
        };
        reader.readAsDataURL(file);
      }

      newFiles.push(attachment);
    }

    const updatedAttachments = [...attachments, ...newFiles];
    setAttachments(updatedAttachments);
    
    // For ticket creation workflow, we don't upload immediately
    // Instead, we pass empty array and handle upload after ticket creation
    if (!ticketId) {
      onAttachmentsChange([]);
    }
  };

  const uploadAttachmentsInternal = async (targetTicketId: string): Promise<string[]> => {
    if (!targetTicketId || attachments.length === 0) return [];

    setUploading(true);
    const uploadedPaths: string[] = [];

    try {
      for (let i = 0; i < attachments.length; i++) {
        const attachment = attachments[i];
        if (attachment.uploaded || attachment.uploading) continue;

        // Update attachment state to show uploading
        setAttachments(prev => prev.map((att, idx) => 
          idx === i ? { ...att, uploading: true } : att
        ));

        const fileExt = attachment.file.name.split('.').pop();
        const fileName = `${targetTicketId}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

        const { data, error } = await supabase.storage
          .from('ticket-attachments')
          .upload(fileName, attachment.file, {
            cacheControl: '3600',
            upsert: false
          });

        if (error) {
          console.error('Upload error:', error);
          toast({
            title: 'Upload failed',
            description: `Failed to upload ${attachment.file.name}`,
            variant: 'destructive',
          });
          continue;
        }

        // Store path only (not public URL) since bucket is private
        uploadedPaths.push(data.path);

        // Update attachment state to show uploaded
        setAttachments(prev => prev.map((att, idx) => 
          idx === i ? { ...att, uploading: false, uploaded: true, url: data.path } : att
        ));
      }

      onAttachmentsChange(uploadedPaths);
      return uploadedPaths;
    } finally {
      setUploading(false);
    }
  };

  // Legacy method for backward compatibility
  const uploadAttachments = async (): Promise<string[]> => {
    if (!ticketId || attachments.length === 0) return [];
    return await uploadAttachmentsInternal(ticketId);
  };

  const removeAttachment = (index: number) => {
    const newAttachments = attachments.filter((_, i) => i !== index);
    setAttachments(newAttachments);
    
    // Update parent with currently uploaded URLs only
    const uploadedUrls = newAttachments.filter(att => att.uploaded && att.url).map(att => att.url!);
    onAttachmentsChange(uploadedUrls);
  };

  const getFileIcon = (attachment: AttachmentFile) => {
    if (attachment.type === 'image') {
      return <ImageIcon className="h-4 w-4" />;
    }
    
    const ext = attachment.file.name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') {
      return <FileText className="h-4 w-4 text-red-500" />;
    }
    
    return <File className="h-4 w-4" />;
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => cameraInputRef.current?.click()}
          className="flex items-center gap-2"
        >
          <Camera className="h-4 w-4" />
          Camera
        </Button>
        
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2"
        >
          <Upload className="h-4 w-4" />
          Files
        </Button>

        {attachments.length > 0 && (
          <Badge variant="secondary">
            {attachments.length}/{maxFiles} files
          </Badge>
        )}
      </div>

      {/* Hidden file inputs */}
      <Input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt"
        onChange={(e) => handleFileSelect(e.target.files)}
        className="hidden"
      />
      
      <Input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleFileSelect(e.target.files)}
        className="hidden"
      />

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Attachments</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {attachments.map((attachment, index) => (
              <Card key={index} className="relative">
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    {attachment.preview ? (
                      <img 
                        src={attachment.preview} 
                        alt="Preview" 
                        className="w-10 h-10 object-cover rounded"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                        {getFileIcon(attachment)}
                      </div>
                    )}
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {attachment.file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(attachment.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      
                      {attachment.uploading && (
                        <div className="mt-1">
                          <div className="w-full bg-muted rounded-full h-1">
                            <div className="bg-primary h-1 rounded-full animate-pulse w-1/2"></div>
                          </div>
                        </div>
                      )}
                      
                      {attachment.uploaded && (
                        <Badge variant="default" className="mt-1 text-xs">
                          Uploaded
                        </Badge>
                      )}
                    </div>
                    
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAttachment(index)}
                      className="h-8 w-8 p-0"
                      disabled={attachment.uploading}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Upload all button for when ticketId is available */}
      {ticketId && attachments.length > 0 && !attachments.every(a => a.uploaded) && (
        <Button
          type="button"
          onClick={uploadAttachments}
          disabled={uploading}
          className="w-full"
        >
          {uploading ? 'Uploading...' : 'Upload All Attachments'}
        </Button>
      )}
    </div>
  );
});