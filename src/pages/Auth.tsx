import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useParams, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { SwipeAction } from '@/components/ui/swipe-action';
import { useTranslation } from '@/hooks/useTranslation';
import hotelcareLogoAuth from '@/assets/hotelcare-logo-auth.png';

export default function Auth() {
 const { signIn, signUp, user, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (user) {
    return <Navigate to={`/${organizationSlug || 'rdhotels'}`} replace />;
  }

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const emailOrUsername = formData.get('email') as string;
    const password = formData.get('password') as string;

    const { error } = await signIn(emailOrUsername, password);
    
    if (error) {
      toast.error(error.message || t('auth.invalidCredentials'));
    } else {
      toast.success(t('auth.welcomeBack'));
    }
    
    setIsLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const fullName = formData.get('fullName') as string;

    const { error } = await signUp(email, password, fullName);
    
    if (error) {
      toast.error(error.message || t('auth.couldNotCreate'));
    } else {
      toast.success(t('auth.accountCreated'));
    }
    
    setIsLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get('reset-email') as string;

    const { error } = await supabase.functions.invoke('send-password-reset', {
      body: { email }
    });
    
    if (error) {
      toast.error(error.message || t('auth.failedReset'));
    } else {
      toast.success(t('auth.passwordResetSent'));
      setForgotPasswordOpen(false);
    }
    
    setResetLoading(false);
  };

  const handleSendOTP = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get('otp-email') as string;

    const { error } = await supabase.functions.invoke('send-otp-password-reset', {
      body: { email }
    });
    
    if (error) {
      toast.error(error.message || t('auth.failedOtp'));
    } else {
      toast.success(t('auth.otpSent'));
      setOtpEmail(email);
      setOtpStep(true);
    }
    
    setResetLoading(false);
  };

  const handleVerifyOTP = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    
    if (!otpCode || otpCode.length !== 6) {
      toast.error(t('auth.invalidOtp'));
      setResetLoading(false);
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      toast.error(t('auth.passwordTooShort'));
      setResetLoading(false);
      return;
    }

    const { error } = await supabase.functions.invoke('verify-otp-reset-password', {
      body: { 
        email: otpEmail,
        otp_code: otpCode,
        new_password: newPassword
      }
    });
    
    if (error) {
      toast.error(error.message || t('auth.failedResetPassword'));
    } else {
      toast.success(t('auth.resetSuccess'));
      setForgotPasswordOpen(false);
      setOtpStep(false);
      setOtpCode('');
      setNewPassword('');
      setOtpEmail('');
    }
    
    setResetLoading(false);
  };

  const handleSendSMSOTP = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const phone = formData.get('sms-phone') as string;

    const { error } = await supabase.functions.invoke('send-sms-otp', {
      body: { phone }
    });
    
    if (error) {
      toast.error(error.message || t('auth.failedSms'));
    } else {
      toast.success(t('auth.smsCodeSent'));
      setOtpEmail(phone);
      setOtpStep(true);
    }
    
    setResetLoading(false);
  };

  const handleSendLoginLink = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get('login-email') as string;

    const { error } = await supabase.functions.invoke('generate-login-link', {
      body: { email }
    });
    
    if (error) {
      toast.error(error.message || t('auth.failedLoginLink'));
    } else {
      toast.success(t('auth.loginLinkSent'));
      setForgotPasswordOpen(false);
    }
    
    setResetLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#359FDB]/10 to-[#6B6B6B]/5 p-3 sm:p-4">
      <Card className="w-full max-w-sm sm:max-w-lg shadow-2xl border-0">
        <CardHeader className="text-center space-y-2 sm:space-y-3 pb-4 sm:pb-6">
          <div className="mx-auto flex flex-col items-center justify-center gap-0 -space-y-2">
            <img
              src={hotelcareLogoAuth}
              alt="Hotel Care Logo"
              className="h-32 sm:h-40 md:h-48 w-auto object-contain"
            />
            <span className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-[#359FDB] to-[#6B6B6B] bg-clip-text text-transparent">
              Hotel Care
            </span>
          </div>
          <CardTitle className="text-lg sm:text-xl lg:text-2xl font-semibold text-foreground/80">
            {t('auth.hotelManagement')}
          </CardTitle>
          <CardDescription className="text-sm sm:text-base px-2 sm:px-0">
            {t('auth.manageOperations')}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <div className="w-full">
            <h3 className="text-lg font-semibold text-center mb-4">{t('auth.signIn')}</h3>
            
            <form onSubmit={handleSignIn} className="space-y-3 sm:space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signin-email" className="text-sm">{t('auth.emailOrUsername')}</Label>
                <Input
                  id="signin-email"
                  name="email"
                  type="text"
                  required
                  placeholder={t('auth.enterEmail')}
                  className="h-9 sm:h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signin-password" className="text-sm">{t('auth.password')}</Label>
                <div className="relative">
                  <Input
                    id="signin-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder={t('auth.enterPassword')}
                    className="h-9 sm:h-10 pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-9 sm:h-10 px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
               <Button
                  type="submit"
                  className="w-full h-10 sm:h-11"
                  disabled={isLoading}
                >
                  {isLoading ? t('auth.signingIn') : t('auth.signIn')}
                </Button>
              
              <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full mt-2 h-8 text-xs sm:text-sm">
                    {t('auth.forgotPassword')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-[95vw] max-w-sm sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-lg sm:text-xl">{t('auth.resetOrResend')}</DialogTitle>
                    <DialogDescription className="text-sm">
                      {t('auth.resetOrResendDesc')}
                    </DialogDescription>
                  </DialogHeader>
                  {!otpStep ? (
                    <Tabs defaultValue="otp" className="w-full">
                      <TabsList className="grid w-full grid-cols-4 h-8 sm:h-10">
                        <TabsTrigger value="otp" className="text-xs sm:text-sm">{t('auth.emailOTP')}</TabsTrigger>
                        <TabsTrigger value="sms" className="text-xs sm:text-sm">{t('auth.smsOTP')}</TabsTrigger>
                        <TabsTrigger value="email" className="text-xs sm:text-sm">{t('auth.emailLink')}</TabsTrigger>
                        <TabsTrigger value="login-link" className="text-xs sm:text-sm">{t('auth.loginLink')}</TabsTrigger>
                      </TabsList>
                      
                      <TabsContent value="otp">
                        <form onSubmit={handleSendOTP} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="otp-email">{t('auth.email')}</Label>
                            <Input
                              id="otp-email"
                              name="otp-email"
                              type="email"
                              required
                              placeholder={t('auth.enterYourEmail')}
                            />
                          </div>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? t('auth.sending') : t('auth.sendVerificationCode')}
                          </Button>
                        </form>
                      </TabsContent>
                      
                      <TabsContent value="email">
                        <form onSubmit={handleForgotPassword} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="reset-email">{t('auth.email')}</Label>
                            <Input
                              id="reset-email"
                              name="reset-email"
                              type="email"
                              required
                              placeholder={t('auth.enterYourEmail')}
                            />
                          </div>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? t('auth.sending') : t('auth.sendResetLink')}
                          </Button>
                        </form>
                      </TabsContent>
                      
                      <TabsContent value="sms">
                        <form onSubmit={handleSendSMSOTP} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="sms-phone">{t('auth.phoneNumber')}</Label>
                            <Input
                              id="sms-phone"
                              name="sms-phone"
                              type="tel"
                              required
                              placeholder={t('auth.enterPhone')}
                            />
                          </div>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? t('auth.sending') : t('auth.sendSMSCode')}
                          </Button>
                        </form>
                      </TabsContent>
                      
                      <TabsContent value="login-link">
                        <form onSubmit={handleSendLoginLink} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="login-email">{t('auth.email')}</Label>
                            <Input
                              id="login-email"
                              name="login-email"
                              type="email"
                              required
                              placeholder={t('auth.enterYourEmail')}
                            />
                          </div>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? t('auth.sending') : t('auth.sendLoginLink')}
                          </Button>
                        </form>
                      </TabsContent>
                    </Tabs>
                  ) : (
                    <div className="space-y-4">
                      <div className="text-center">
                        <h4 className="font-medium mb-2">{t('auth.enterVerificationCode')}</h4>
                        <p className="text-sm text-muted-foreground mb-4">
                          {t('auth.codeSentTo')} {otpEmail}
                        </p>
                      </div>
                      
                      <form onSubmit={handleVerifyOTP} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="otp-code">{t('auth.verificationCode')}</Label>
                          <div className="flex justify-center">
                            <InputOTP 
                              maxLength={6} 
                              value={otpCode}
                              onChange={setOtpCode}
                            >
                              <InputOTPGroup>
                                <InputOTPSlot index={0} />
                                <InputOTPSlot index={1} />
                                <InputOTPSlot index={2} />
                                <InputOTPSlot index={3} />
                                <InputOTPSlot index={4} />
                                <InputOTPSlot index={5} />
                              </InputOTPGroup>
                            </InputOTP>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="new-password">{t('auth.newPassword')}</Label>
                          <div className="relative">
                            <Input
                              id="new-password"
                              type={showNewPassword ? "text" : "password"}
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              required
                              placeholder={t('auth.enterNewPassword')}
                              className="pr-10"
                              minLength={6}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                              onClick={() => setShowNewPassword(!showNewPassword)}
                            >
                              {showNewPassword ? (
                                <EyeOff className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <Eye className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                          </div>
                        </div>
                        
                        <div className="flex gap-2">
                          <Button 
                            type="button" 
                            variant="outline" 
                            className="w-full"
                            onClick={() => {
                              setOtpStep(false);
                              setOtpCode('');
                              setNewPassword('');
                            }}
                          >
                            {t('auth.back')}
                          </Button>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? t('auth.resetting') : t('auth.resetPassword')}
                          </Button>
                        </div>
                      </form>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
