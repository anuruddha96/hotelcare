import { useState, useEffect } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Lock, Shield, User, Mail, Bell, Volume2, MapPin } from 'lucide-react';

import { toast } from 'sonner';
import { useNotifications } from '@/hooks/useNotifications';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { useTranslation } from '@/hooks/useTranslation';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: string;
  focusTarget?: 'location';
}

export function SettingsDialog({ open, onOpenChange, initialTab, focusTarget }: SettingsDialogProps) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const { requestNotificationPermission, notificationPermission, playNotificationSound, ensureAudioUnlocked } = useNotifications();
  const { preferences, updatePreferences, clearBannerDismissal } = useNotificationPreferences();
  const [isLoading, setIsLoading] = useState(false);
  const [isTogglingNotifications, setIsTogglingNotifications] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'housekeeping': return 'Housekeeping';
      case 'reception': return 'Reception';
      case 'maintenance': return 'Maintenance';
      case 'manager': return 'Manager';
      case 'admin': return 'Administrator';
      case 'marketing': return 'Marketing';
      case 'control_finance': return 'Control & Finance';
      case 'hr': return 'Human Resources';
      case 'front_office': return 'Front Office';
      case 'top_management': return 'Top Management';
      default: return role;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-500';
      case 'manager': return 'bg-blue-500';
      case 'maintenance': return 'bg-green-500';
      case 'reception': return 'bg-purple-500';
      case 'housekeeping': return 'bg-orange-500';
      case 'marketing': return 'bg-pink-500';
      case 'control_finance': return 'bg-indigo-500';
      case 'hr': return 'bg-yellow-500';
      case 'front_office': return 'bg-teal-500';
      case 'top_management': return 'bg-gray-900';
      default: return 'bg-gray-500';
    }
  };

  const handlePasswordChange = async () => {
    if (!passwordData.newPassword || !passwordData.confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters long');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword
      });

      if (error) throw error;

      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });

      toast.success('Password updated successfully!');
    } catch (error: any) {
      console.error('Error updating password:', error);
      toast.error(error.message || 'Failed to update password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendPasswordReset = async () => {
    if (!profile?.email) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
        redirectTo: `${window.location.origin}/auth`
      });

      if (error) throw error;

      toast.success('Password reset email sent! Check your inbox.');
    } catch (error: any) {
      console.error('Error sending password reset:', error);
      toast.error(error.message || 'Failed to send password reset email');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleBrowserNotifications = async (enabled: boolean) => {
    setIsTogglingNotifications(true);
    try {
      // Unlock audio on iOS
      ensureAudioUnlocked();

      if (enabled) {
        // Request permission first
        const granted = await requestNotificationPermission();
        if (granted) {
          await updatePreferences({ browser_notifications_enabled: true });
          clearBannerDismissal(); // Clear any previous dismissal
          toast.success(t('notifications.enabled'));
        } else {
          toast.error(t('notifications.permissionDenied'));
        }
      } else {
        await updatePreferences({ browser_notifications_enabled: false });
        toast.info(t('notifications.disabled'));
      }
    } catch (error) {
      console.error('Error toggling notifications:', error);
      toast.error('Failed to update notification settings');
    } finally {
      setIsTogglingNotifications(false);
    }
  };

  const handleToggleSoundNotifications = async (enabled: boolean) => {
    await updatePreferences({ sound_notifications_enabled: enabled });
    if (enabled) {
      playNotificationSound();
    }
  };

  const handleTestNotification = () => {
    playNotificationSound();
    toast.success(t('notifications.testSuccess'), {
      duration: 3000
    });

    // Also try browser notification if enabled
    if (notificationPermission === 'granted' && preferences.browser_notifications_enabled) {
      try {
        new Notification(t('notifications.testTitle'), {
          body: t('notifications.testBody'),
          icon: '/favicon.ico'
        });
      } catch (error) {
        console.log('Browser notification test failed:', error);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl mx-auto max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
        </DialogHeader>
        
        <SettingsTabs initialTab={initialTab} focusTarget={focusTarget} open={open} profile={profile} t={t} onOpenChange={onOpenChange} body={{ /* placeholder, see below */ }} />
        <Tabs value={undefined as any} className="hidden" />
          
          <TabsContent value="account" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {t('settings.accountInformation')}
                </CardTitle>
                <CardDescription>
                  {t('settings.accountInformationDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t('settings.fullName')}</Label>
                    <p className="text-sm text-muted-foreground p-2 bg-muted rounded-md">
                      {profile?.full_name || t('settings.notSet')}
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t('settings.nickname')}</Label>
                    <p className="text-sm text-muted-foreground p-2 bg-muted rounded-md">
                      {profile?.nickname || t('settings.notSet')}
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t('settings.email')}</Label>
                    <p className="text-sm text-muted-foreground p-2 bg-muted rounded-md flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      {profile?.email}
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t('settings.role')}</Label>
                    <div className="p-2">
                      <Badge 
                        className={`${getRoleColor(profile?.role || '')} text-white`}
                      >
                        {getRoleLabel(profile?.role || '')}
                      </Badge>
                    </div>
                  </div>
                  
                  {profile?.assigned_hotel && (
                    <div className="space-y-2 sm:col-span-2">
                      <Label className="text-sm font-medium">{t('settings.assignedHotel')}</Label>
                      <p className="text-sm text-muted-foreground p-2 bg-muted rounded-md">
                        {profile.assigned_hotel}
                      </p>
                    </div>
                  )}
                </div>
                
                <div className="pt-4 border-t">
                  <p className="text-xs text-muted-foreground">
                    {t('settings.lastLogin')}: {profile?.last_login ? new Date(profile.last_login).toLocaleString() : t('settings.never')}
                  </p>
                </div>
              </CardContent>
            </Card>
            <LocationAccessCard />
          </TabsContent>


          <TabsContent value="notifications" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  {t('notifications.settings')}
                </CardTitle>
                <CardDescription>
                  {t('notifications.settingsDescription')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Browser Notifications Toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{t('notifications.browserNotifications')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t('notifications.browserNotificationsDesc')}
                    </p>
                    {notificationPermission === 'denied' && (
                      <p className="text-xs text-destructive">
                        {t('notifications.permissionBlocked')}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={preferences.browser_notifications_enabled && notificationPermission === 'granted'}
                    onCheckedChange={handleToggleBrowserNotifications}
                    disabled={isTogglingNotifications || notificationPermission === 'denied'}
                  />
                </div>

                {/* Sound & Vibration Toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Volume2 className="h-4 w-4" />
                      {t('notifications.soundVibration')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t('notifications.soundVibrationDesc')}
                    </p>
                  </div>
                  <Switch
                    checked={preferences.sound_notifications_enabled}
                    onCheckedChange={handleToggleSoundNotifications}
                  />
                </div>

                {/* Test Notification Button */}
                <div className="pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={handleTestNotification}
                    className="w-full"
                  >
                    <Bell className="h-4 w-4 mr-2" />
                    {t('notifications.sendTest')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="security" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-5 w-5" />
                  {t('settings.changePassword')}
                </CardTitle>
                <CardDescription>
                  {t('settings.changePasswordDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new_password">{t('settings.newPassword')}</Label>
                    <Input
                      id="new_password"
                      type="password"
                      value={passwordData.newPassword}
                      onChange={(e) => setPasswordData(prev => ({
                        ...prev,
                        newPassword: e.target.value
                      }))}
                      placeholder={t('settings.enterNewPassword')}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="confirm_password">{t('settings.confirmNewPassword')}</Label>
                    <Input
                      id="confirm_password"
                      type="password"
                      value={passwordData.confirmPassword}
                      onChange={(e) => setPasswordData(prev => ({
                        ...prev,
                        confirmPassword: e.target.value
                      }))}
                      placeholder={t('settings.confirmNewPasswordPlaceholder')}
                    />
                  </div>
                  
                  <Button
                    onClick={handlePasswordChange}
                    disabled={isLoading}
                    className="w-full"
                  >
                    <Lock className="h-4 w-4 mr-2" />
                    {isLoading ? t('settings.updating') : t('settings.updatePassword')}
                  </Button>
                </div>
                
                <div className="border-t pt-4">
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">{t('settings.alternativeResetEmail')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.alternativeResetEmailDesc')}
                    </p>
                    <Button
                      variant="outline"
                      onClick={handleSendPasswordReset}
                      disabled={isLoading}
                      className="w-full"
                    >
                      <Mail className="h-4 w-4 mr-2" />
                      {t('settings.sendResetEmail')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  {t('settings.securityInformation')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    • {t('settings.securityTip1')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    • {t('settings.securityTip2')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    • {t('settings.securityTip3')}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        
        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('settings.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

  );
}

function LocationAccessCard() {
  const [optIn, setOptInState] = useState(false);
  const [permState, setPermState] = useState<string>('unsupported');
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  const refresh = async () => {
    const m = await import('@/lib/locationPreference');
    setOptInState(m.getOptIn());
    setPermState(await m.getBrowserPermissionState());
    setAddress(m.getCachedFix()?.address ?? null);
  };
  useEffect(() => { void refresh(); }, []);

  const enable = async () => {
    setBusy(true);
    const m = await import('@/lib/locationPreference');
    const fix = await m.requestLocationOnce();
    setBusy(false);
    if (fix) toast.success('Location enabled');
    else toast.error('Could not get your location. Check browser permission.');
    await refresh();
  };
  const disable = async () => {
    const m = await import('@/lib/locationPreference');
    m.clearLocation();
    toast.success('Location access disabled');
    await refresh();
  };

  const permBadgeColor =
    permState === 'granted' ? 'bg-green-500'
    : permState === 'denied' ? 'bg-red-500'
    : 'bg-muted-foreground';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" /> Location access
        </CardTitle>
        <CardDescription>
          Saved once — used for attendance sign-in. You won't be prompted on every refresh.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="space-y-1">
            <div className="text-sm">
              Status:{' '}
              <Badge variant={optIn ? 'default' : 'secondary'}>
                {optIn ? 'Enabled' : 'Disabled'}
              </Badge>
              <Badge className={`${permBadgeColor} text-white ml-1.5`}>
                browser: {permState}
              </Badge>
            </div>
            {address && (
              <p className="text-xs text-muted-foreground">Last fix: {address}</p>
            )}
          </div>
          {optIn ? (
            <Button size="sm" variant="outline" onClick={disable}>Disable</Button>
          ) : (
            <Button size="sm" onClick={enable} disabled={busy || permState === 'denied'}>
              {busy ? 'Requesting…' : 'Enable'}
            </Button>
          )}
        </div>
        {permState === 'denied' && (
          <p className="text-xs text-destructive">
            Location is blocked at the browser level. Open your browser site settings for this page and allow Location, then click Enable.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
