import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export default function Auth() {
  const { signIn, signUp, user, loading } = useAuth();
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
    return <Navigate to="/" replace />;
  }

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const emailOrUsername = formData.get('email') as string;
    const password = formData.get('password') as string;

    // For now, just use direct sign in - username functionality can be added later
    const { error } = await signIn(emailOrUsername, password);
    
    if (error) {
      toast.error(error.message || 'Invalid login credentials');
    } else {
      toast.success('Welcome back!');
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
      toast.error(error.message || 'Could not create account');
    } else {
      toast.success('Account created! Please check your email to verify your account.');
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
      toast.error(error.message || 'Failed to send reset email');
    } else {
      toast.success('Password reset email sent! Check your inbox.');
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
      toast.error(error.message || 'Failed to send OTP');
    } else {
      toast.success('Verification code sent! Check your email.');
      setOtpEmail(email);
      setOtpStep(true);
    }
    
    setResetLoading(false);
  };

  const handleVerifyOTP = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    
    if (!otpCode || otpCode.length !== 6) {
      toast.error('Please enter a valid 6-digit code');
      setResetLoading(false);
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters long');
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
      toast.error(error.message || 'Failed to reset password');
    } else {
      toast.success('Password reset successful! You can now log in with your new password.');
      setForgotPasswordOpen(false);
      setOtpStep(false);
      setOtpCode('');
      setNewPassword('');
      setOtpEmail('');
    }
    
    setResetLoading(false);
  };

  const handleResendVerification = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get('resend-email') as string;

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      }
    });
    
    if (error) {
      toast.error(error.message || 'Failed to resend verification');
    } else {
      toast.success('Verification email sent! Check your inbox.');
      setForgotPasswordOpen(false);
    }
    
    setResetLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#359FDB]/10 to-[#6B6B6B]/5 p-3 sm:p-4">
      <Card className="w-full max-w-sm sm:max-w-lg shadow-2xl border-0">
        <CardHeader className="text-center space-y-3 sm:space-y-4 pb-4 sm:pb-6">
          <div className="mx-auto w-24 h-16 sm:w-32 sm:h-20 flex items-center justify-center">
            <img 
              src="/lovable-uploads/f8d09d0b-f11c-4c6e-88b7-dff8c26a8824.png" 
              alt="RD Hotels Logo" 
              className="max-w-full max-h-full object-contain"
            />
          </div>
          <CardTitle className="text-xl sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-[#359FDB] to-[#6B6B6B] bg-clip-text text-transparent">
            Hotel Management Dashboard
          </CardTitle>
          <CardDescription className="text-sm sm:text-base px-2 sm:px-0">
            Manage all hotel operations - rooms, maintenance, housekeeping, and service tickets
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <div className="w-full">
            <h3 className="text-lg font-semibold text-center mb-4">Sign In</h3>
            
            <form onSubmit={handleSignIn} className="space-y-3 sm:space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signin-email" className="text-sm">Email or Username</Label>
                <Input
                  id="signin-email"
                  name="email"
                  type="text"
                  required
                  placeholder="Enter your email or username"
                  className="h-9 sm:h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signin-password" className="text-sm">Password</Label>
                <div className="relative">
                  <Input
                    id="signin-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="Enter your password"
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
              <Button type="submit" className="w-full h-9 sm:h-10 text-sm" disabled={isLoading}>
                {isLoading ? 'Signing In...' : 'Sign In'}
              </Button>
              
              <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full mt-2 h-8 text-xs sm:text-sm">
                    Forgot Password / Resend Verification
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-[95vw] max-w-sm sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-lg sm:text-xl">Reset Password or Resend Verification</DialogTitle>
                    <DialogDescription className="text-sm">
                      Choose an option to reset your password or resend email verification.
                    </DialogDescription>
                  </DialogHeader>
                  {!otpStep ? (
                    <Tabs defaultValue="otp" className="w-full">
                      <TabsList className="grid w-full grid-cols-3 h-8 sm:h-10">
                        <TabsTrigger value="otp" className="text-xs sm:text-sm">OTP Reset</TabsTrigger>
                        <TabsTrigger value="email" className="text-xs sm:text-sm">Email Reset</TabsTrigger>
                        <TabsTrigger value="resend" className="text-xs sm:text-sm">Resend Verification</TabsTrigger>
                      </TabsList>
                      
                      <TabsContent value="otp">
                        <form onSubmit={handleSendOTP} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="otp-email">Email</Label>
                            <Input
                              id="otp-email"
                              name="otp-email"
                              type="email"
                              required
                              placeholder="Enter your email"
                            />
                          </div>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? 'Sending...' : 'Send Verification Code'}
                          </Button>
                        </form>
                      </TabsContent>
                      
                      <TabsContent value="email">
                        <form onSubmit={handleForgotPassword} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="reset-email">Email</Label>
                            <Input
                              id="reset-email"
                              name="reset-email"
                              type="email"
                              required
                              placeholder="Enter your email"
                            />
                          </div>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? 'Sending...' : 'Send Reset Link'}
                          </Button>
                        </form>
                      </TabsContent>
                      
                      <TabsContent value="resend">
                        <form onSubmit={handleResendVerification} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="resend-email">Email</Label>
                            <Input
                              id="resend-email"
                              name="resend-email"
                              type="email"
                              required
                              placeholder="Enter your email"
                            />
                          </div>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? 'Sending...' : 'Resend Verification'}
                          </Button>
                        </form>
                      </TabsContent>
                    </Tabs>
                  ) : (
                    <div className="space-y-4">
                      <div className="text-center">
                        <h4 className="font-medium mb-2">Enter Verification Code</h4>
                        <p className="text-sm text-muted-foreground mb-4">
                          We sent a 6-digit code to {otpEmail}
                        </p>
                      </div>
                      
                      <form onSubmit={handleVerifyOTP} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="otp-code">Verification Code</Label>
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
                          <Label htmlFor="new-password">New Password</Label>
                          <div className="relative">
                            <Input
                              id="new-password"
                              type={showNewPassword ? "text" : "password"}
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              required
                              placeholder="Enter new password"
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
                            Back
                          </Button>
                          <Button type="submit" className="w-full" disabled={resetLoading}>
                            {resetLoading ? 'Resetting...' : 'Reset Password'}
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