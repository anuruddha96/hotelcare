import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff } from 'lucide-react';

export default function Auth() {
  const { signIn, signUp, user, loading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-mesh">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent animate-glow"></div>
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

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    
    if (error) {
      toast.error(error.message || 'Failed to send reset email');
    } else {
      toast.success('Password reset email sent! Check your inbox.');
      setForgotPasswordOpen(false);
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
    <div className="min-h-screen relative overflow-hidden gradient-mesh">
      {/* Floating Background Elements */}
      <div className="floating-element w-72 h-72 -top-36 -left-36 animate-float"></div>
      <div className="floating-element w-96 h-96 -bottom-48 -right-48 animate-float"></div>
      <div className="floating-element w-64 h-64 top-1/4 -right-32 animate-float"></div>
      
      <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
        <div className="w-full max-w-6xl grid lg:grid-cols-1 gap-12 items-center justify-center">
          
          {/* Login Card - Centered */}
          <div className="flex justify-center animate-slide-in">
            <Card className="w-full max-w-md glass-card hover-lift animate-glow">
              <CardHeader className="text-center space-y-6 pb-6">
                <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center animate-float">
                  <img 
                    src="/lovable-uploads/f8d09d0b-f11c-4c6e-88b7-dff8c26a8824.png" 
                    alt="RD Hotels" 
                    className="w-10 h-10 object-contain"
                  />
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-2xl font-bold text-foreground">
                    Welcome to RD Hotels
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Sign in to access your dashboard
                  </p>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email" className="text-sm font-medium">Email or Username</Label>
                    <Input
                      id="signin-email"
                      name="email"
                      type="text"
                      required
                      placeholder="Enter your credentials"
                      className="h-12 focus-ring modern-button"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="signin-password" className="text-sm font-medium">Password</Label>
                    <div className="relative">
                      <Input
                        id="signin-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="Enter your password"
                        className="h-12 pr-12 focus-ring"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-12 px-3 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <Eye className="h-5 w-5 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                  </div>
                  
                  <Button 
                    type="submit" 
                    className="w-full h-12 text-base font-medium modern-button bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90" 
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Signing In...</span>
                      </div>
                    ) : (
                      'Sign In'
                    )}
                  </Button>
                </form>
                
                <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" className="w-full text-sm text-muted-foreground hover:text-foreground">
                      Forgot your password?
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="w-[95vw] max-w-md glass-card">
                    <DialogHeader>
                      <DialogTitle>Reset Password</DialogTitle>
                      <DialogDescription>
                        Enter your email to receive a password reset link
                      </DialogDescription>
                    </DialogHeader>
                    
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="reset-email">Email Address</Label>
                        <Input
                          id="reset-email"
                          name="reset-email"
                          type="email"
                          required
                          placeholder="your@email.com"
                          className="h-11 focus-ring"
                        />
                      </div>
                      <Button type="submit" className="w-full modern-button" disabled={resetLoading}>
                        {resetLoading ? (
                          <div className="flex items-center space-x-2">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Sending...</span>
                          </div>
                        ) : (
                          'Send Reset Link'
                        )}
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}