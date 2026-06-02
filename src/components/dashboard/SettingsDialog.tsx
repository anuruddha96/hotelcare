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
import { BrowserLocationHelpDialog } from './BrowserLocationHelpDialog';

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
  const [activeTab, setActiveTab] = useState<string>(initialTab || 'account');
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Sync tab when opened with a requested initial tab
  useEffect(() => {
    if (open && initialTab) setActiveTab(initialTab);
  }, [open, initialTab]);

  // Scroll & highlight the location card when requested
  useEffect(() => {
    if (!open || focusTarget !== 'location') return;
    const id = window.setTimeout(() => {
      const el = document.getElementById('settings-location-access');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'transition-all');
      window.setTimeout(() => {
        el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2');
      }, 2400);
    }, 120);
    return () => window.clearTimeout(id);
  }, [open, focusTarget]);

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
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="account">{t('settings.tabAccount')}</TabsTrigger>
            <TabsTrigger value="notifications">{t('settings.tabNotifications')}</TabsTrigger>
            <TabsTrigger value="security">{t('settings.tabSecurity')}</TabsTrigger>
          </TabsList>
          
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
  const { t } = useTranslation();
  const [optIn, setOptInState] = useState(false);
  const [permState, setPermState] = useState<string>('unsupported');
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const refresh = async () => {
    const m = await import('@/lib/locationPreference');
    setOptInState(m.getOptIn());
    setPermState(await m.getBrowserPermissionState());
    setAddress(m.getCachedFix()?.address ?? null);
  };
  useEffect(() => {
    void refresh();
    const handler = () => { void refresh(); };
    window.addEventListener('hc:location-permission-changed', handler);
    return () => window.removeEventListener('hc:location-permission-changed', handler);
  }, []);

  const enable = async () => {
    setBusy(true);
    const m = await import('@/lib/locationPreference');
    const fix = await m.requestLocationOnce();
    setBusy(false);
    if (fix) toast.success(t('settings.location.enableSuccess'));
    else {
      toast.error(t('settings.location.enableFailed'));
      setHelpOpen(true);
    }
    await refresh();
  };
  const disable = async () => {
    const m = await import('@/lib/locationPreference');
    m.clearLocation();
    toast.success(t('settings.location.disableSuccess'));
    await refresh();
  };

  const permBadgeColor =
    permState === 'granted' ? 'bg-green-500'
    : permState === 'denied' ? 'bg-red-500'
    : 'bg-muted-foreground';

  return (
    <>
      <Card id="settings-location-access" className="scroll-mt-4 rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" /> {t('settings.location.title')}
          </CardTitle>
          <CardDescription>
            {t('settings.location.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="space-y-1">
              <div className="text-sm">
                {t('settings.location.statusLabel')}:{' '}
                <Badge variant={optIn ? 'default' : 'secondary'}>
                  {optIn ? t('settings.location.enabled') : t('settings.location.disabled')}
                </Badge>
                <Badge className={`${permBadgeColor} text-white ml-1.5`}>
                  {t('settings.location.browserLabel')}: {permState}
                </Badge>
              </div>
              {address && (
                <p className="text-xs text-muted-foreground">{t('settings.location.lastFix')}: {address}</p>
              )}
              {permState === 'granted' && optIn && (
                <p className="text-xs text-muted-foreground">{t('settings.location.permissionGranted')}</p>
              )}
            </div>
            {optIn ? (
              <Button size="sm" variant="outline" onClick={disable}>{t('settings.location.disable')}</Button>
            ) : (
              <Button size="sm" onClick={enable} disabled={busy || permState === 'denied'}>
                {busy ? t('settings.location.requesting') : t('settings.location.enable')}
              </Button>
            )}
          </div>
          {permState === 'denied' && (
            <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
              <p className="text-xs text-destructive font-medium">
                {t('settings.location.blockedTitle')}
              </p>
              <Button size="sm" variant="default" onClick={() => setHelpOpen(true)}>
                <MapPin className="h-3 w-3 mr-1" /> {t('settings.location.blockedHelpCta')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <BrowserLocationHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        reason={permState === 'denied' ? 'denied' : 'blocked'}
      />
    </>
  );
}
