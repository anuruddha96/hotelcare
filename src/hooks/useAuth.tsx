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

  useEffect(() => {
    let isMounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return;
        
        console.log('Auth state changed:', event, session?.user?.email);
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          setTimeout(async () => {
            if (!isMounted) return;
              try {
                const { data: profileData, error: profileError } = await supabase
                  .from('profiles')
                  .select('*')
                  .eq('id', session.user.id)
                  .maybeSingle();

                if (profileData && !profileError) {
                  console.log('Profile fetched:', profileData);
                  setProfile(profileData as any);
                } else {
                  console.warn('Profile not available, using secure role fallback', profileError);
                  // Fallback: fetch role securely and build a minimal profile so role-based UI still works
                  let roleFallback: any = undefined;
                  try {
                    const { data: roleData } = await supabase.rpc('get_user_role' as any, {
                      user_id: session.user.id,
                    });
                    roleFallback = roleData || 'maintenance';
                  } catch (e) {
                    console.error('Fallback role fetch failed:', e);
                    roleFallback = 'maintenance';
                  }

                  const minimalProfile = {
                    id: session.user.id,
                    email: session.user.email || '',
                    full_name: (session.user.user_metadata as any)?.full_name || (session.user.email || 'User'),
                    role: roleFallback,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    nickname: (session.user.user_metadata as any)?.nickname,
                    profile_picture_url: (session.user.user_metadata as any)?.avatar_url,
                  } as any;
                  setProfile(minimalProfile);
                }
              } catch (error) {
                console.error('Profile fetch error:', error);
                setProfile(null);
              }
              setLoading(false);
          }, 0);
        } else {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        setTimeout(async () => {
          if (!isMounted) return;
            try {
              const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .maybeSingle();

              if (profileData && !profileError) {
                console.log('Profile fetched:', profileData);
                setProfile(profileData as any);
              } else {
                console.warn('Profile not available, using secure role fallback', profileError);
                let roleFallback: any = undefined;
                try {
                  const { data: roleData } = await supabase.rpc('get_user_role' as any, {
                    user_id: session.user.id,
                  });
                  roleFallback = roleData || 'maintenance';
                } catch (e) {
                  console.error('Fallback role fetch failed:', e);
                  roleFallback = 'maintenance';
                }

                const minimalProfile = {
                  id: session.user.id,
                  email: session.user.email || '',
                  full_name: (session.user.user_metadata as any)?.full_name || (session.user.email || 'User'),
                  role: roleFallback,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  nickname: (session.user.user_metadata as any)?.nickname,
                  profile_picture_url: (session.user.user_metadata as any)?.avatar_url,
                } as any;
                setProfile(minimalProfile);
              }
            } catch (error) {
              console.error('Profile fetch error:', error);
              setProfile(null);
            }
            setLoading(false);
        }, 0);
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
    
    // First try with email
    let { error } = await supabase.auth.signInWithPassword({
      email: emailOrUsername,
      password,
    });
    
    // If email login fails and input doesn't contain @, try username lookup
    if (error && !emailOrUsername.includes('@')) {
      console.log('Email login failed, trying username lookup');
      try {
        // Look up email by username (nickname field)
        const { data: profileData, error: lookupError } = await supabase
          .from('profiles')
          .select('email')
          .eq('nickname', emailOrUsername)
          .single();
        
        console.log('Username lookup result:', profileData, lookupError);
        
        if (profileData?.email) {
          console.log('Found email for username, attempting login with:', profileData.email);
          // Try logging in with the found email
          const result = await supabase.auth.signInWithPassword({
            email: profileData.email,
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