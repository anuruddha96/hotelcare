import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  nickname?: string;
  profile_picture_url?: string;
  phone_number?: string;
  role: 'housekeeping' | 'reception' | 'maintenance' | 'manager' | 'admin' | 'marketing' | 'control_finance' | 'hr' | 'front_office' | 'top_management' | 'housekeeping_manager' | 'maintenance_manager' | 'marketing_manager' | 'reception_manager' | 'back_office_manager' | 'control_manager' | 'finance_manager' | 'top_management_manager';
  created_at: string;
  updated_at: string;
  last_login?: string;
  assigned_hotel?: string;
  is_super_admin?: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (emailOrUsername: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string, userEmail?: string, userMetadata?: any) => {
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profileData && !profileError) {
        console.log('Profile fetched:', profileData);
        setProfile(profileData as any);
        return profileData;
      } else {
        console.warn('Profile not available, creating default profile...', profileError);
        const { data: upserted, error: upsertErr } = await supabase
          .from('profiles')
          .upsert({
            id: userId,
            email: userEmail || '',
            full_name: userMetadata?.full_name || userEmail?.split('@')[0] || 'New User',
            nickname: userMetadata?.username || userEmail?.split('@')[0],
            role: 'housekeeping',
            assigned_hotel: userMetadata?.assigned_hotel || null,
            organization_slug: 'rdhotels',
            last_login: new Date().toISOString(),
          })
          .select()
          .maybeSingle();

        if (!upsertErr && upserted) {
          console.log('Default profile created:', upserted);
          setProfile(upserted as any);
          return upserted;
        } else {
          console.error('Failed to create default profile:', upsertErr);
          setProfile(null);
          return null;
        }
      }
    } catch (error) {
      console.error('Profile fetch error:', error);
      setProfile(null);
      return null;
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Listen for auth changes FIRST (following Supabase best practices)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        
        console.log('Auth state changed:', event, session?.user?.email);
        // Only synchronous state updates in callback
        setSession(session);
        setUser(session?.user ?? null);
        
        // Defer profile fetching to prevent deadlock
        if (session?.user) {
          setTimeout(() => {
            if (isMounted) {
              fetchProfile(session.user.id, session.user.email, session.user.user_metadata);
            }
          }, 0);
        } else {
          setProfile(null);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        fetchProfile(session.user.id, session.user.email, session.user.user_metadata).finally(() => {
          if (isMounted) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (emailOrUsername: string, password: string) => {
    console.log('Attempting login with:', emailOrUsername);
    
    // First try with email - attempt case-insensitive email lookup
    let { error } = await supabase.auth.signInWithPassword({
      email: emailOrUsername,
      password,
    });
    
    // If direct email fails, try case-insensitive email lookup
    if (error && emailOrUsername.includes('@')) {
      console.log('Direct email login failed, trying case-insensitive email lookup');
      try {
        const { data: emailData, error: rpcError } = await supabase.rpc('get_email_case_insensitive', {
          p_email: emailOrUsername,
        });
        console.log('Case-insensitive email RPC lookup:', emailData, rpcError);
        
        if (emailData) {
          console.log('Found email with case-insensitive lookup, attempting login with:', emailData);
          const result = await supabase.auth.signInWithPassword({
            email: emailData as string,
            password,
          });
          error = result.error;
          console.log('Case-insensitive email login result:', result.error);
        }
      } catch (lookupError) {
        console.error('Case-insensitive email lookup failed:', lookupError);
      }
    }
    
    // If email login fails and input doesn't contain @, try username lookup
    if (error && !emailOrUsername.includes('@')) {
      console.log('Email login failed, trying username lookup');
      try {
        // Resolve email via secure RPC to bypass RLS during pre-auth
        const { data: emailData, error: rpcError } = await supabase.rpc('get_email_by_nickname', {
          p_nickname: emailOrUsername,
        });
        console.log('Username RPC lookup:', emailData, rpcError);
        
        if (emailData) {
          console.log('Found email for username, attempting login with:', emailData);
          const result = await supabase.auth.signInWithPassword({
            email: emailData as string,
            password,
          });
          error = result.error;
          console.log('Username-based login result:', result.error);
        }

      } catch (lookupError) {
        console.error('Username lookup failed:', lookupError);
        // Keep original error if username lookup fails
      }
    }
    
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      signIn,
      signUp,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};