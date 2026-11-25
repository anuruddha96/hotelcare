import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAccessPolicy } from '@/hooks/useAccessPolicy';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkforce } from '@/hooks/useWorkforce';
import { todayBudapest } from '@/lib/budapestTime';
import { hotelName, matchesStaffSearch, type WorkforceStaff } from '@/lib/workforce/model';
import { WorkforceStaffDialog } from '@/components/workforce/WorkforceStaffDialog';
import { WorkforceAnalytics } from '@/components/workforce/WorkforceAnalytics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, ChevronRight, UserPlus } from 'lucide-react';

export function HrPeopleOverview() {
  const { profile } = useAuth();
  const { hrWorkspace } = useAccessPolicy();
  if (!hrWorkspace || !profile?.organization_slug) return null;
  return <EmployeeDirectory key={profile.id + ':' + profile.organization_slug} />;
}

function EmployeeDirectory() {
  const { t, language } = useTranslation();
  const tr = (en: string, hu: string) => language === 'hu' ? hu : en;
  const date = todayBudapest();
  const year = Number(date.slice(0,4)), month = Number(date.slice(5,7));
  const data = useWorkforce(year, month);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [account, setAccount] = useState('all');
  const [department, setDepartment] = useState('all');
  const [hotel, setHotel] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<WorkforceStaff> | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const dept = (s: WorkforceStaff) => data.departments.find(d => d.id === s.department_id)?.name ?? '—';
  const role = (s: WorkforceStaff) => data.jobRoles.find(d => d.id === s.job_role_id)?.name ?? '—';
  const staff = data.staff.filter(s => (status === 'all' || s.is_active === (status === 'active')) &&
    (account === 'all' || !!s.profile_id === (account === 'linked')) &&
    (department === 'all' || s.department_id === department) &&
    (hotel === 'all' || (s.hotel_id ?? 'company') === hotel) &&
    matchesStaffSearch([s.full_name, s.nickname, dept(s), role(s), hotelName(s.hotel_id)], query));
  const current = data.staff.find(s => s.id === selected);
  const active = data.staff.filter(s => s.is_active);
  const selectClass = 'min-h-10 rounded-md border bg-background px-3 text-sm';
  if (data.loading && !data.staff.length) return <p role="status">{tr('Loading employees…','Munkatársak betöltése…')}</p>;
  if (data.error) return <div role="alert"><p>{t('hr.error')}</p><Button onClick={() => void data.reload()}>{tr('Retry','Újra')}</Button></div>;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xl font-semibold">{current ? current.full_name : t('hr.directory')}</h2>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { setAnalytics(v => !v); setSelected(null); }}>{analytics ? tr('Directory','Névjegyzék') : tr('Workforce analytics','Munkaerő-elemzés')}</Button>
        {!current && !analytics && <Button onClick={() => setEditing({ full_name:'', is_active:true, employment_type:'full_time', daily_hours:8, start_date:date, sort_order:0 })}><UserPlus className="mr-2 size-4" />{tr('Add employee','Munkatárs hozzáadása')}</Button>}
      </div>
    </div>
    {analytics ? <WorkforceAnalytics data={data} year={year} month={month} /> : current ? <>
      <Button variant="ghost" onClick={() => setSelected(null)}><ArrowLeft className="mr-2 size-4" />{tr('Back to directory','Vissza a névjegyzékhez')}</Button>
      <Card><CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center gap-2"><Badge>{current.is_active ? tr('Active','Aktív') : tr('Former employee','Volt munkatárs')}</Badge><Badge variant="outline">{t(current.profile_id ? 'hr.linked' : 'hr.unlinked')}</Badge><Button className="ml-auto" variant="outline" onClick={() => setEditing({...current})}>{tr('Edit / link account','Szerkesztés / fiók kapcsolása')}</Button></div>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[[tr('Department','Részleg'),dept(current)],[tr('Position','Munkakör'),role(current)],[tr('Base property','Telephely'),hotelName(current.hotel_id)],[tr('Employment','Foglalkoztatás'),current.employment_type.replace('_',' ')],[tr('Daily hours','Napi órák'),String(current.daily_hours)],[tr('Start date','Kezdés'),current.start_date],[tr('End date','Befejezés'),current.end_date],[tr('Annual leave','Éves szabadság'),current.annual_leave_days == null ? null : String(current.annual_leave_days)],[tr('Phone','Telefon'),current.phone],[tr('Email','E-mail'),current.email]].map(([label,value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium break-words">{value || '—'}</dd></div>)}
        </dl>
      </CardContent></Card>
    </> : <>
      <div className="grid gap-3 sm:grid-cols-3">{[[tr('Active employees','Aktív munkatársak'),active.length],[tr('Linked accounts','Kapcsolt fiókok'),active.filter(s=>s.profile_id).length],[tr('Accounts to link','Kapcsolandó fiókok'),active.filter(s=>!s.profile_id).length]].map(([label,value])=><Card key={label}><CardContent className="pt-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p></CardContent></Card>)}</div>
      <div className="flex flex-wrap gap-2">
        <Input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={tr('Search name, role, hotel…','Név, munkakör, szálloda…')} aria-label={t('hr.search')} className="min-w-48 flex-1" />
        <select className={selectClass} aria-label={tr('Employment status','Foglalkoztatási állapot')} value={status} onChange={e=>setStatus(e.target.value)}><option value="active">{tr('Active','Aktív')}</option><option value="former">{tr('Former','Korábbi')}</option><option value="all">{tr('All statuses','Minden állapot')}</option></select>
        <select className={selectClass} aria-label={tr('Account status','Fiók állapota')} value={account} onChange={e=>setAccount(e.target.value)}><option value="all">{tr('All accounts','Minden fiók')}</option><option value="linked">{tr('Linked','Kapcsolt')}</option><option value="unlinked">{tr('Not linked','Nincs kapcsolva')}</option></select>
        <select className={selectClass} aria-label={tr('Department','Részleg')} value={department} onChange={e=>setDepartment(e.target.value)}><option value="all">{tr('All departments','Minden részleg')}</option>{data.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select className={selectClass} aria-label={tr('Property','Telephely')} value={hotel} onChange={e=>setHotel(e.target.value)}><option value="all">{tr('All properties','Minden telephely')}</option>{[...new Set(data.staff.map(s=>s.hotel_id ?? 'company'))].map(h=><option key={h} value={h}>{h==='company'?tr('Company','Cég'):hotelName(h)}</option>)}</select>
      </div>
      <p className="text-sm text-muted-foreground">{staff.length} {tr('employees shown','munkatárs')}</p>
      <ul className="divide-y rounded-lg border">{staff.map(s=><li key={s.id}><button type="button" className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" onClick={()=>setSelected(s.id)}><span className="min-w-0 flex-1"><span className="block font-medium">{s.full_name}</span><span className="block text-sm text-muted-foreground">{dept(s)} · {role(s)} · {hotelName(s.hotel_id)}</span></span><Badge variant="outline">{t(s.profile_id?'hr.linked':'hr.unlinked')}</Badge><ChevronRight className="size-4 shrink-0" /></button></li>)}</ul>
      {!staff.length && <p>{t('hr.empty')}</p>}
    </>}
    <WorkforceStaffDialog staff={editing} data={data} access="org" onClose={()=>setEditing(null)} />
  </section>;
}
