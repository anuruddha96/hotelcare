import { useNavigate, useParams } from 'react-router-dom';
import { Ticket, Home, Users, Clock, TrendingUp, Receipt, MessageSquareText } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

type Current = 'tickets' | 'rooms' | 'housekeeping' | 'attendance' | 'revenue' | 'purchase-invoices' | 'reputation';
interface MainTabsBarProps { current?: Current; className?: string; }
const VISIBLE_ROLES = ['manager','housekeeping_manager','admin','top_management','top_management_manager','reception','front_office'];
const EXEC_ROLES = ['admin','top_management','top_management_manager'];

export function MainTabsBar({ current, className }: MainTabsBarProps) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const role = profile?.role || '';
  if (!VISIBLE_ROLES.includes(role)) return null;
  const orgPath = `/${organizationSlug || 'rdhotels'}`;
  const isExec = EXEC_ROLES.includes(role);
  const goDashboard = (tab: string) => navigate(`${orgPath}?tab=${tab}`);
  const base='inline-flex items-center justify-center gap-1 sm:gap-2 rounded-md px-2 sm:px-3 py-1.5 text-[11px] sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0';
  const btn=(key:Current)=>cn(base,current===key?'bg-primary text-primary-foreground shadow-sm':'text-muted-foreground hover:text-foreground hover:bg-background/60');
  return <div className={cn('w-full overflow-x-auto',className)}><div className="inline-flex h-10 sm:h-12 bg-muted rounded-md p-1 gap-1">
    <button type="button" className={btn('tickets')} onClick={()=>goDashboard('tickets')}><Ticket className="h-3 w-3 sm:h-4 sm:w-4"/><span>Maintenance</span></button>
    <button type="button" className={btn('rooms')} onClick={()=>goDashboard('rooms')}><Home className="h-3 w-3 sm:h-4 sm:w-4"/><span>Reception</span></button>
    <button type="button" className={btn('housekeeping')} onClick={()=>goDashboard('housekeeping')}><Users className="h-3 w-3 sm:h-4 sm:w-4"/><span>Housekeeping</span></button>
    <button type="button" className={btn('attendance')} onClick={()=>goDashboard('attendance')}><Clock className="h-3 w-3 sm:h-4 sm:w-4"/><span>HR</span></button>
    {isExec&&<><button type="button" className={btn('revenue')} onClick={()=>navigate(`${orgPath}/revenue`)}><TrendingUp className="h-3 w-3 sm:h-4 sm:w-4"/><span>Revenue Management</span></button>
    <button type="button" className={btn('reputation')} onClick={()=>navigate(`${orgPath}/reputation`)}><MessageSquareText className="h-3 w-3 sm:h-4 sm:w-4"/><span>Reputation</span></button>
    <button type="button" className={btn('purchase-invoices')} onClick={()=>navigate(`${orgPath}/purchase-invoices`)}><Receipt className="h-3 w-3 sm:h-4 sm:w-4"/><span>Invoices</span></button></>}
  </div></div>;
}
export default MainTabsBar;
