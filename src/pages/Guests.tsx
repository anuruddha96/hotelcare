import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams, Link } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Users, Plus, Search, Star } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';

const Guests = () => {
  const { user, profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t } = useTranslation();
  const [guests, setGuests] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', nationality: '',
    id_document_type: '', id_document_number: '', company_name: '', notes: '',
  });
  const basePath = `/${organizationSlug || 'rdhotels'}`;

  useEffect(() => {
    if (user) fetchGuests();
  }, [user]);

  const fetchGuests = async () => {
    setLoadingData(true);
    const { data } = await supabase
      .from('guests')
      .select('*')
      .order('last_name', { ascending: true })
      .limit(500);
    if (data) setGuests(data);
    setLoadingData(false);
  };

  const createGuest = async () => {
    if (!form.first_name || !form.last_name) {
      toast.error(t('pms.guests.firstLastRequired'));
      return;
    }
    const { error } = await supabase.from('guests').insert({
      ...form,
      organization_slug: profile?.organization_slug || organizationSlug,
      hotel_id: profile?.assigned_hotel,
    });
    if (error) {
      toast.error(t('pms.guests.failedToCreate'));
    } else {
      toast.success(t('pms.guests.guestCreated'));
      setCreateOpen(false);
      setForm({ first_name: '', last_name: '', email: '', phone: '', nationality: '', id_document_type: '', id_document_number: '', company_name: '', notes: '' });
      fetchGuests();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to={`${basePath}/auth`} replace />;

  const filtered = guests.filter((g) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const name = `${g.first_name} ${g.last_name}`.toLowerCase();
    return name.includes(term) || g.email?.toLowerCase().includes(term) || g.phone?.includes(term);
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5" /> {t('pms.guests.directory')}
            <Badge variant="secondary">{guests.length}</Badge>
          </h1>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('pms.guests.searchGuests')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-56 h-9"
              />
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1">
              <Plus className="h-4 w-4" /> {t('pms.guests.addGuest')}
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('pms.guests.name')}</TableHead>
                    <TableHead>{t('pms.guests.email')}</TableHead>
                    <TableHead>{t('pms.guests.phone')}</TableHead>
                    <TableHead>{t('pms.guests.nationality')}</TableHead>
                    <TableHead>{t('pms.guests.vip')}</TableHead>
                    <TableHead>{t('pms.guests.company')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingData ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('pms.loading')}</TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('pms.guests.noGuestsFound')}</TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((g) => (
                      <TableRow key={g.id} className="cursor-pointer hover:bg-accent/50">
                        <TableCell>
                          <Link to={`${basePath}/guests/${g.id}`} className="font-medium text-primary hover:underline">
                            {g.first_name} {g.last_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{g.email || '-'}</TableCell>
                        <TableCell className="text-sm">{g.phone || '-'}</TableCell>
                        <TableCell className="text-sm">{g.nationality || '-'}</TableCell>
                        <TableCell>
                          {g.vip_status === 'vip' && (
                            <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{g.company_name || '-'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Create Guest Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('pms.guests.addNewGuest')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('pms.guests.firstName')} *</Label>
              <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.lastName')} *</Label>
              <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.email')}</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.phone')}</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.nationality')}</Label>
              <Input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.company')}</Label>
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.idType')}</Label>
              <Input placeholder={t('pms.guests.idPlaceholder')} value={form.id_document_type} onChange={(e) => setForm({ ...form, id_document_type: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.idNumber')}</Label>
              <Input value={form.id_document_number} onChange={(e) => setForm({ ...form, id_document_number: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={createGuest}>{t('pms.guests.createGuest')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Guests;
