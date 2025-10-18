import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useParams, Navigate } from 'react-router-dom';
import { useBranding } from '@/contexts/BrandingContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';

export default function Auth() {
  const { signIn, signUp, user, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t } = useTranslation();
  const { branding } = useBranding();
  const [isLoading, setIsLoading] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

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

  const handleMagicLink = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResetLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const email = formData.get('magic-email') as string;

    if (!email || !email.trim()) {
      toast.error('Please enter a valid email address');
      setResetLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/${organizationSlug || 'rdhotels'}`,
      },
    });
    
    if (error) {
      toast.error(error.message || 'Failed to send magic link');
    } else {
      toast.success('Magic link sent! Check your email to log in.', {
        duration: 5000,
      });
      setForgotPasswordOpen(false);
    }
    
    setResetLoading(false);
  };


  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/20">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-6 pb-6 px-6 sm:px-8 pt-8">
          <div className="flex justify-center">
            <div className="relative">
              <img
                src={branding.logoUrl}
                alt={branding.appName}
                className="w-auto object-contain"
                style={{ 
                  height: branding.logoScale ? `${branding.logoScale}rem` : '9rem',
                  maxHeight: '12rem'
                }}
              />
            </div>
          </div>
          <div className="space-y-2 text-center">
            <CardTitle className="text-2xl sm:text-3xl font-bold">
              {branding.welcomeMessage || 'Welcome'}
            </CardTitle>
            <CardDescription className="text-sm sm:text-base">
              The number one AI powered Hotel Management System
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 px-6 sm:px-8 pb-8">
          <div className="w-full">
            <h3 className="text-lg font-semibold text-center mb-4">Sign In</h3>
            
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signin-email">Email or Username</Label>
                <Input
                  id="signin-email"
                  name="email"
                  type="text"
                  required
                  placeholder="Enter your email or username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signin-password">Password</Label>
                <div className="relative">
                  <Input
                    id="signin-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="Enter your password"
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-10 px-3 hover:bg-transparent"
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
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? t('auth.signingIn') : t('auth.signIn')}
              </Button>
              
              <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full mt-2 h-8 text-xs sm:text-sm">
                    Forgot Password?
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-[95vw] max-w-sm sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-lg sm:text-xl">Get Magic Link</DialogTitle>
                    <DialogDescription className="text-sm">
                      Enter your email and we'll send you a magic link to log in.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleMagicLink} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="magic-email">Email</Label>
                      <Input
                        id="magic-email"
                        name="magic-email"
                        type="email"
                        required
                        placeholder="Enter your email"
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={resetLoading}>
                      {resetLoading ? 'Sending...' : 'Send Magic Link'}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
