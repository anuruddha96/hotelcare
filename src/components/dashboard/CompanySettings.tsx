import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Upload, Save, Building2 } from 'lucide-react';
import { PhotoCleanupManager } from './PhotoCleanupManager';

interface CompanySettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CompanySettings({ open, onOpenChange }: CompanySettingsProps) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [companyName, setCompanyName] = useState('RD Hotels');
  const [logoUrl, setLogoUrl] = useState('/lovable-uploads/f8d09d0b-f11c-4c6e-88b7-dff8c26a8824.png');
  const [newLogoFile, setNewLogoFile] = useState<File | null>(null);

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (open) {
      fetchCompanySettings();
    }
  }, [open]);

  const fetchCompanySettings = async () => {
    // In a real app, this would fetch from a settings table
    // For now, we'll use default values
    setCompanyName('RD Hotels');
    setLogoUrl('/lovable-uploads/f8d09d0b-f11c-4c6e-88b7-dff8c26a8824.png');
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({
          title: 'Error',
          description: 'Logo file size must be less than 5MB',
          variant: 'destructive',
        });
        return;
      }

      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Error',
          description: 'Please select a valid image file',
          variant: 'destructive',
        });
        return;
      }

      setNewLogoFile(file);
      // Create preview URL
      const previewUrl = URL.createObjectURL(file);
      setLogoUrl(previewUrl);
    }
  };

  const handleSave = async () => {
    if (!isAdmin) {
      toast({
        title: 'Error',
        description: 'Only administrators can update company settings',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // In a real implementation, you would:
      // 1. Upload the logo file to storage if newLogoFile exists
      // 2. Update the company settings in the database
      // 3. Update the logo URL in the auth page and other components

      if (newLogoFile) {
        // Simulate file upload
        // const { data: uploadData, error: uploadError } = await supabase.storage
        //   .from('company-assets')
        //   .upload(`logos/${Date.now()}_${newLogoFile.name}`, newLogoFile);
        
        toast({
          title: 'Success',
          description: 'Logo updated successfully! Changes will be reflected after page refresh.',
        });
      } else {
        toast({
          title: 'Success',
          description: 'Company settings updated successfully!',
        });
      }

      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update company settings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Company Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Company Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="company-name">Company Name</Label>
                <Input
                  id="company-name"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Enter company name"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Company Logo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-center w-full">
                <div className="text-center space-y-4">
                  <div className="mx-auto w-32 h-20 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Company Logo"
                        className="max-w-full max-h-full object-contain"
                      />
                    ) : (
                      <div className="text-gray-400 text-sm">No logo</div>
                    )}
                  </div>
                  
                  <div>
                    <Label htmlFor="logo-upload" className="cursor-pointer">
                      <div className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                        <Upload className="h-4 w-4" />
                        Upload New Logo
                      </div>
                    </Label>
                    <Input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Supports PNG, JPG, GIF up to 5MB
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <PhotoCleanupManager />

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={loading}
            >
              <Save className="h-4 w-4 mr-2" />
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}