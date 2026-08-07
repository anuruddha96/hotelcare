import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenues } from '@/hooks/useVenues';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

type Staff = {
  id: string;
  full_name: string;
  nickname: string | null;
  role: string;
};

const SCOPABLE_ROLES = ['supervisor', 'housekeeping'];

/**
 * SLNT-only: grant supervisors and housekeepers access to one or more venues.
 * A person with no venue selected keeps the organization-wide view, which is
 * exactly how every other tenant behaves.
 */
export const StaffVenueAccess: React.FC = () => {
  const { profile } = useAuth();
  const { venues, loading: venuesLoading } = useVenues();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [scopes, setScopes] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const orgSlug = profile?.organization_slug ?? '';

  const load = async () => {
    if (!orgSlug) return;
    setLoading(true);
    const [{ data: people }, { data: rows }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, nickname, role, acts_as_housekeeper')
        .eq('organization_slug', orgSlug)
        .is('deleted_at', null)
        .order('full_name'),
      supabase.from('user_property_scopes').select('user_id, venue_id').eq('organization_slug', orgSlug),
    ]);

    const filtered = (people ?? []).filter(
      (p: any) => SCOPABLE_ROLES.includes(p.role) || p.acts_as_housekeeper,
    );
    setStaff(filtered as Staff[]);

    const map: Record<string, Set<string>> = {};
    (rows ?? []).forEach((r: { user_id: string; venue_id: string }) => {
      (map[r.user_id] ??= new Set()).add(r.venue_id);
    });
    setScopes(map);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) => `${s.full_name} ${s.nickname ?? ''}`.toLowerCase().includes(q));
  }, [staff, search]);

  const toggle = async (userId: string, venueId: string) => {
    const current = scopes[userId] ?? new Set<string>();
    const key = `${userId}:${venueId}`;
    setBusy(key);

    if (current.has(venueId)) {
      const { error } = await supabase
        .from('user_property_scopes')
        .delete()
        .eq('user_id', userId)
        .eq('venue_id', venueId);
      setBusy(null);
      if (error) return toast.error(error.message);
      current.delete(venueId);
    } else {
      const { error } = await supabase.from('user_property_scopes').insert({
        user_id: userId,
        venue_id: venueId,
        organization_slug: orgSlug,
        created_by: profile?.id ?? null,
      });
      setBusy(null);
      if (error) return toast.error(error.message);
      current.add(venueId);
    }
    setScopes((prev) => ({ ...prev, [userId]: new Set(current) }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" /> Staff venue access
        </CardTitle>
        <CardDescription>
          Choose which venues each supervisor or housekeeper can see. No selection means full
          access to every venue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder="Search staff…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />

        {loading || venuesLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : venues.length === 0 ? (
          <p className="text-sm text-muted-foreground">Create venues first.</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No supervisors or housekeepers found.</p>
        ) : (
          <div className="space-y-3">
            {visible.map((s) => {
              const mine = scopes[s.id] ?? new Set<string>();
              return (
                <div key={s.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{s.full_name}</p>
                      <p className="text-xs text-muted-foreground">{s.role.replace(/_/g, ' ')}</p>
                    </div>
                    <Badge variant={mine.size ? 'default' : 'secondary'}>
                      {mine.size ? `${mine.size} venue(s)` : 'All venues'}
                    </Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {venues.map((v) => {
                      const key = `${s.id}:${v.id}`;
                      return (
                        <label
                          key={v.id}
                          className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-accent/50"
                        >
                          <Checkbox
                            checked={mine.has(v.id)}
                            disabled={busy === key}
                            onCheckedChange={() => toggle(s.id, v.id)}
                          />
                          <span className="truncate">{v.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StaffVenueAccess;
