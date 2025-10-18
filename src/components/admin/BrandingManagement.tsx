import { useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Palette, Image, Type, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const BrandingManagement = () => {
  const { organization, refreshTenant } = useTenant();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  
  const isEnterprise = organization?.settings?.subscription_tier === 'enterprise' || 
                       (organization as any)?.allow_custom_branding;

  const [formData, setFormData] = useState({
    custom_logo_url: (organization as any)?.custom_logo_url || '',
    custom_favicon_url: (organization as any)?.custom_favicon_url || '',
    custom_app_name: (organization as any)?.custom_app_name || organization?.name || '',
    custom_primary_color: (organization as any)?.custom_primary_color || 'hsl(200, 76%, 58%)',
    custom_secondary_color: (organization as any)?.custom_secondary_color || 'hsl(0, 0%, 42%)',
    custom_login_background: (organization as any)?.custom_login_background || '',
    custom_welcome_message: (organization as any)?.custom_welcome_message || '',
    logo_scale: (organization as any)?.logo_scale || 3,
  });

  const handleSave = async () => {
    if (!organization?.id) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          ...formData,
          allow_custom_branding: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', organization.id);

      if (error) throw error;

      toast({
        title: 'Branding Updated',
        description: 'Your custom branding has been saved. Refresh the page to see changes.',
      });

      await refreshTenant();
      
      // Reload page to apply new branding
      setTimeout(() => window.location.reload(), 1500);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!organization?.id) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          custom_logo_url: null,
          custom_favicon_url: null,
          custom_app_name: null,
          custom_primary_color: 'hsl(200, 76%, 58%)',
          custom_secondary_color: 'hsl(0, 0%, 42%)',
          custom_login_background: null,
          custom_welcome_message: null,
          logo_scale: 3,
          updated_at: new Date().toISOString(),
        })
        .eq('id', organization.id);

      if (error) throw error;

      toast({
        title: 'Branding Reset',
        description: 'Branding has been reset to defaults. Refreshing...',
      });

      setTimeout(() => window.location.reload(), 1000);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isEnterprise) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Enterprise Feature: Custom Branding
          </CardTitle>
          <CardDescription>
            White-label your HotelCare.app instance with your own branding
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertDescription>
              Custom branding is available on the <strong>Enterprise plan</strong> ($299/month).
              <br />
              <br />
              <strong>Included features:</strong>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Custom logo and favicon</li>
                <li>Custom brand colors</li>
                <li>Custom app name</li>
                <li>Custom login background</li>
                <li>Unlimited hotels</li>
                <li>White-label option</li>
                <li>Custom domain support</li>
              </ul>
            </AlertDescription>
          </Alert>
          <Button className="w-full" size="lg">
            Upgrade to Enterprise
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Custom Branding
          </CardTitle>
          <CardDescription>
            Customize the look and feel of your HotelCare.app instance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Preview */}
          <div className="p-6 border rounded-lg bg-muted/50">
            <h3 className="text-sm font-medium mb-4">Preview</h3>
            <div className="flex items-center gap-4">
              {formData.custom_logo_url ? (
                <img src={formData.custom_logo_url} alt="Logo preview" className="h-16 w-auto" />
              ) : (
                <BrandLogo size="lg" />
              )}
              <div>
                <p className="font-semibold text-lg">{formData.custom_app_name || 'Your App Name'}</p>
                <div className="flex gap-2 mt-2">
                  <div 
                    className="w-12 h-12 rounded border" 
                    style={{ backgroundColor: formData.custom_primary_color }}
                    title="Primary Color"
                  />
                  <div 
                    className="w-12 h-12 rounded border" 
                    style={{ backgroundColor: formData.custom_secondary_color }}
                    title="Secondary Color"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* App Name */}
          <div className="space-y-2">
            <Label htmlFor="app_name" className="flex items-center gap-2">
              <Type className="h-4 w-4" />
              Application Name
            </Label>
            <Input
              id="app_name"
              value={formData.custom_app_name}
              onChange={(e) => setFormData({ ...formData, custom_app_name: e.target.value })}
              placeholder="My Hotel Operations"
            />
          </div>

          {/* Logo URL */}
          <div className="space-y-2">
            <Label htmlFor="logo_url" className="flex items-center gap-2">
              <Image className="h-4 w-4" />
              Logo URL
            </Label>
            <Input
              id="logo_url"
              value={formData.custom_logo_url}
              onChange={(e) => setFormData({ ...formData, custom_logo_url: e.target.value })}
              placeholder="https://yourdomain.com/logo.png"
            />
            <p className="text-xs text-muted-foreground">Recommended: 15:5 ratio (e.g., 600x200px) PNG with transparent background</p>
          </div>

          {/* Logo Scale */}
          <div className="space-y-3">
            <Label htmlFor="logo_scale" className="flex items-center justify-between">
              <span>Logo Size (Header)</span>
              <span className="text-sm font-normal text-muted-foreground">{formData.logo_scale}rem</span>
            </Label>
            <input
              id="logo_scale"
              type="range"
              min="2"
              max="8"
              step="0.5"
              value={formData.logo_scale}
              onChange={(e) => setFormData({ ...formData, logo_scale: parseFloat(e.target.value) })}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Small</span>
              <span>Medium</span>
              <span>Large</span>
            </div>
          </div>

          {/* Favicon URL */}
          <div className="space-y-2">
            <Label htmlFor="favicon_url">Favicon URL</Label>
            <Input
              id="favicon_url"
              value={formData.custom_favicon_url}
              onChange={(e) => setFormData({ ...formData, custom_favicon_url: e.target.value })}
              placeholder="https://yourdomain.com/favicon.png"
            />
            <p className="text-xs text-muted-foreground">Recommended: 32x32px or 64x64px PNG</p>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="primary_color">Primary Color (HSL)</Label>
              <Input
                id="primary_color"
                value={formData.custom_primary_color}
                onChange={(e) => setFormData({ ...formData, custom_primary_color: e.target.value })}
                placeholder="hsl(200, 76%, 58%)"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondary_color">Secondary Color (HSL)</Label>
              <Input
                id="secondary_color"
                value={formData.custom_secondary_color}
                onChange={(e) => setFormData({ ...formData, custom_secondary_color: e.target.value })}
                placeholder="hsl(0, 0%, 42%)"
              />
            </div>
          </div>

          {/* Login Background */}
          <div className="space-y-2">
            <Label htmlFor="login_bg">Login Background URL (Optional)</Label>
            <Input
              id="login_bg"
              value={formData.custom_login_background}
              onChange={(e) => setFormData({ ...formData, custom_login_background: e.target.value })}
              placeholder="https://yourdomain.com/background.jpg"
            />
          </div>

          {/* Welcome Message */}
          <div className="space-y-2">
            <Label htmlFor="welcome_msg">Welcome Message (Optional)</Label>
            <Textarea
              id="welcome_msg"
              value={formData.custom_welcome_message}
              onChange={(e) => setFormData({ ...formData, custom_welcome_message: e.target.value })}
              placeholder="Welcome to our operations platform"
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={loading} className="flex-1">
              {loading ? 'Saving...' : 'Save Branding'}
            </Button>
            <Button onClick={handleReset} variant="outline" disabled={loading}>
              Reset to Default
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
