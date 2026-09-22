"""One-shot, guarded edit of existing maintenance screens on this temporary branch.
Fails rather than silently modifying the wrong version. Removes itself and runner.
"""
from pathlib import Path

ROOT = Path('src/components/dashboard')

def change(file, old, new, count=1):
    path = Path(file)
    text = path.read_text()
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f'{file}: expected {count} instances, saw {actual} for {old[:100]!r}')
    path.write_text(text.replace(old, new))

p = ROOT / 'Dashboard.tsx'
change(p, "import { resolveHotelKeys } from '@/lib/hotelKeys';", "import { resolveHotelKeys } from '@/lib/hotelKeys';\nimport { maintenanceQueueBucket, maintenanceQueueCounts } from '@/lib/maintenanceQueue';")
change(p, "  status: 'open' | 'in_progress' | 'completed';\n  created_at: string;", "  status: 'open' | 'in_progress' | 'completed';\n  on_hold: boolean | null;\n  hold_reason: string | null;\n  sla_due_date: string | null;\n  created_at: string;")
change(p, "  const { t } = useTranslation();", "  const { t, language } = useTranslation();")
change(p, "priority: d.priority, status: d.status, created_at: d.created_at,", "priority: d.priority, status: d.status, on_hold: d.on_hold, hold_reason: d.hold_reason,\n        sla_due_date: d.sla_due_date, created_at: d.created_at,")
change(p, "    const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;", "    const matchesStatus = statusFilter === 'all' || maintenanceQueueBucket(ticket) === statusFilter;")
change(p, "  const [departmentFilter, setDepartmentFilter] = useState('all');\n", "")
change(p, "    const matchesDepartment = departmentFilter === 'all' || ticket.department === departmentFilter;\n    \n    return matchesSearch && matchesStatus && matchesPriority && matchesDepartment;", "    return matchesSearch && matchesStatus && matchesPriority;")
change(p, "  const getTicketCounts = () => {\n    return {\n      total: tickets.length,\n      open: tickets.filter(t => t.status === 'open').length,\n      inProgress: tickets.filter(t => t.status === 'in_progress').length,\n      completed: tickets.filter(t => t.status === 'completed').length,\n    };\n  };\n\n  const counts = getTicketCounts();", "  // The same mutually exclusive state mapping powers Housekeeping and main Maintenance.\n  const counts = maintenanceQueueCounts(tickets);")
change(p, "className=\"grid gap-4 grid-cols-2 sm:grid-cols-4\"", "className=\"grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6\"")
change(p, "{t('tickets.total')}</CardTitle>", "{language === 'hu' ? 'Összes karbantartási hiba' : 'Total maintenance issues'}</CardTitle>")
change(p, "{ticketLoadError ? '—' : counts.open}", "{ticketLoadError ? '—' : counts.active}")
change(p, "{ticketLoadError ? '—' : counts.inProgress}", "{ticketLoadError ? '—' : counts.progress}")
change(p, "{t('tickets.open')}</CardTitle>", "{language === 'hu' ? 'Aktív' : 'Active'}</CardTitle>")
change(p, "{t('tickets.inProgress')}</CardTitle>", "{language === 'hu' ? 'Folyamatban' : 'In progress'}</CardTitle>")
change(p, "              <Card>\n                <CardHeader className=\"pb-2\">\n                  <CardTitle className=\"text-xs sm:text-sm font-medium\">{t('tickets.completed')}</CardTitle>", "              <Card>\n                <CardHeader className=\"pb-2\">\n                  <CardTitle className=\"text-xs sm:text-sm font-medium\">{language === 'hu' ? 'Várakozik' : 'On hold'}</CardTitle>\n                </CardHeader>\n                <CardContent><div className=\"text-xl sm:text-2xl font-bold\">{ticketLoadError ? '—' : counts.hold}</div></CardContent>\n              </Card>\n              <Card>\n                <CardHeader className=\"pb-2\">\n                  <CardTitle className=\"text-xs sm:text-sm font-medium\">{language === 'hu' ? 'Jóváhagyásra vár' : 'Awaiting approval'}</CardTitle>\n                </CardHeader>\n                <CardContent><div className=\"text-xl sm:text-2xl font-bold\">{ticketLoadError ? '—' : counts.approval}</div></CardContent>\n              </Card>\n              <Card>\n                <CardHeader className=\"pb-2\">\n                  <CardTitle className=\"text-xs sm:text-sm font-medium\">{t('tickets.completed')}</CardTitle>")
change(p, "                      <SelectItem value=\"open\">{t('tickets.open')}</SelectItem>\n                      <SelectItem value=\"in_progress\">{t('tickets.inProgress')}</SelectItem>\n                      <SelectItem value=\"completed\">{t('tickets.completed')}</SelectItem>", "                      <SelectItem value=\"active\">{language === 'hu' ? 'Aktív' : 'Active'}</SelectItem>\n                      <SelectItem value=\"progress\">{t('tickets.inProgress')}</SelectItem>\n                      <SelectItem value=\"hold\">{language === 'hu' ? 'Várakozik' : 'On hold'}</SelectItem>\n                      <SelectItem value=\"approval\">{language === 'hu' ? 'Jóváhagyásra vár' : 'Awaiting approval'}</SelectItem>\n                      <SelectItem value=\"done\">{t('tickets.completed')}</SelectItem>")
start = '                  <Select value={departmentFilter} onValueChange={setDepartmentFilter}>'
end = '                  </Select>'
text = p.read_text()
assert text.count(start) == 1
before, remainder = text.split(start, 1)
assert end in remainder
_, after = remainder.split(end, 1)
p.write_text(before + after)
change(p, "statusFilter !== 'all' || priorityFilter !== 'all' || departmentFilter !== 'all'", "statusFilter !== 'all' || priorityFilter !== 'all'")
change(p, "                      onClick={() => setSelectedTicket(ticket)}", "                      onClick={() => setSelectedTicket(ticket)}\n                      onUpdated={() => void fetchTickets()}")

p = ROOT / 'MaintenancePhotosManagement.tsx'
change(p, "import { resolveHotelKeys } from '@/lib/hotelKeys';", "import { resolveHotelKeys } from '@/lib/hotelKeys';\nimport { maintenanceQueueBucket, maintenanceQueueCounts, maintenanceLocation } from '@/lib/maintenanceQueue';")
change(p, "  const [loading, setLoading] = useState(true);", "  const [loading, setLoading] = useState(true);\n  const [loadError, setLoadError] = useState<string | null>(null);")
change(p, "    setLoading(true);\n    try {\n      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);", "    setLoading(true);\n    setLoadError(null);\n    try {\n      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);")
change(p, "      const { data, error } = await (supabase as any).from('tickets')\n        .select(`", "      const all: MaintenanceTicket[] = [];\n      for (let offset = 0; ; offset += 1000) {\n        if (offset >= 50000) throw new Error('Too many maintenance issues to load.');\n        const { data, error } = await (supabase as any).from('tickets')\n        .select(`")
change(p, "        .order('created_at', { ascending: false })\n        .limit(300);\n      if (error) throw error;\n      setTickets((data || []) as MaintenanceTicket[]);", "        .order('created_at', { ascending: false })\n        .range(offset, offset + 999);\n        if (error) throw error;\n        all.push(...((data || []) as MaintenanceTicket[]));\n        if ((data || []).length < 1000) break;\n      }\n      setTickets(all);")
change(p, "      console.error('Failed to load maintenance tickets:', error);\n      setTickets([]);", "      console.error('Failed to load maintenance tickets:', error);\n      setLoadError(error instanceof Error ? error.message : 'Could not load maintenance issues');\n      setTickets([]);")
start = "  const visibleTickets = useMemo(() => tickets.filter((ticket) => {"
end = "  const statusLabel = (ticket: MaintenanceTicket) => {"
text = p.read_text()
assert text.count(start) == 1 and text.count(end) == 1
before, remainder = text.split(start, 1)
_, after = remainder.split(end, 1)
replacement = "  const visibleTickets = useMemo(() => tickets.filter(ticket =>\n    filter === 'all' || maintenanceQueueBucket(ticket) === filter), [tickets, filter]);\n  const counts = useMemo(() => maintenanceQueueCounts(tickets), [tickets]);\n\n"
p.write_text(before + replacement + end + after)
change(p, "    if (ticket.pending_supervisor_approval) return c.approval;\n    if (ticket.status === 'completed') return c.statusDone;", "    if (ticket.status === 'completed') return c.statusDone;\n    if (ticket.pending_supervisor_approval) return c.approval;")
change(p, "    if (ticket.pending_supervisor_approval) return 'bg-blue-100 text-blue-800 border-blue-200';\n    if (ticket.status === 'completed') return 'bg-green-100 text-green-800 border-green-200';", "    if (ticket.status === 'completed') return 'bg-green-100 text-green-800 border-green-200';\n    if (ticket.pending_supervisor_approval) return 'bg-blue-100 text-blue-800 border-blue-200';")
change(p, "      <MaintenanceIssueAnalytics />", "      {loadError && <div role=\"alert\" className=\"rounded-md border border-red-300 p-3 text-sm text-red-700\">{loadError} <Button type=\"button\" variant=\"outline\" onClick={() => void fetchTickets()}>Retry</Button></div>}\n      <MaintenanceIssueAnalytics />")
change(p, "      {loading ? <div", "      {loadError ? null : loading ? <div")
change(p, "Room {ticket.room_number} · {ticket.title}", "{maintenanceLocation(ticket.room_number, ticket.description, language)} · {ticket.title}")

p = ROOT / 'TicketDetailDialog.tsx'
change(p, "import { useTranslation } from '@/hooks/useTranslation';", "import { useTranslation } from '@/hooks/useTranslation';\nimport { canManageMaintenance, MaintenanceManagerControls } from './MaintenanceManagerControls';\nimport { maintenanceLocation } from '@/lib/maintenanceQueue';")
change(p, "  status: 'open' | 'in_progress' | 'completed';\n  created_at: string;", "  status: 'open' | 'in_progress' | 'completed';\n  department?: string;\n  on_hold: boolean | null;\n  pending_supervisor_approval: boolean | null;\n  sla_due_date: string | null;\n  created_at: string;")
change(p, "  const { t } = useTranslation();", "  const { t, language } = useTranslation();")
change(p, "                Room {ticket.room_number}", "                {maintenanceLocation(ticket.room_number, ticket.description, language)}")
change(p, "          <div className=\"space-y-4\">\n            <div className=\"flex flex-wrap gap-2\">", "          <div className=\"space-y-4\">\n            {ticket.department === 'maintenance' && canManageMaintenance(profile?.role) && (\n              <MaintenanceManagerControls ticket={{ ...ticket, resolution_text: ticket.resolution_text || null }}\n                language={language} onUpdated={() => { onTicketUpdated(); onOpenChange(false); }} />\n            )}\n            <div className=\"flex flex-wrap gap-2\">")
change(p, "              {canUpdateStatus && (", "              {canUpdateStatus && ticket.department !== 'maintenance' && (")
change(p, "              {canDelete && (", "              {canDelete && ticket.department !== 'maintenance' && (")
change(p, "            {canClose && ticket.status !== 'completed' && (", "            {canClose && ticket.department !== 'maintenance' && ticket.status !== 'completed' && (")

p = ROOT / 'TicketCard.tsx'
change(p, "import { Badge } from '@/components/ui/badge';", "import { useState } from 'react';\nimport { Badge } from '@/components/ui/badge';\nimport { Button } from '@/components/ui/button';\nimport { useAuth } from '@/hooks/useAuth';\nimport { canManageMaintenance, MaintenanceManagerControls } from './MaintenanceManagerControls';\nimport { maintenanceLocation, maintenanceQueueBucket } from '@/lib/maintenanceQueue';")
change(p, "  status: MaintenanceTicketStatus;\n  hold_reason?: string | null;", "  status: 'open' | 'in_progress' | 'completed';\n  updated_at: string;\n  on_hold: boolean | null;\n  pending_supervisor_approval: boolean | null;\n  hold_reason: string | null;\n  sla_due_date: string | null;\n  resolution_text: string | null;")
change(p, "  onClick: () => void;", "  onClick: () => void;\n  onUpdated?: () => void;")
change(p, "export function TicketCard({ ticket, onClick }: TicketCardProps) {\n  const { t, language } = useTranslation();", "export function TicketCard({ ticket, onClick, onUpdated }: TicketCardProps) {\n  const { t, language } = useTranslation();\n  const { profile } = useAuth();\n  const [showActions, setShowActions] = useState(false);\n  const canManage = ticket.department === 'maintenance' && canManageMaintenance(profile?.role);\n  const bucket = maintenanceQueueBucket(ticket);\n  const effectiveStatus: MaintenanceTicketStatus = bucket === 'hold' ? 'on_hold'\n    : bucket === 'approval' ? 'pending_supervisor_approval' : ticket.status;\n  const overdue = ticket.status !== 'completed' && !!ticket.sla_due_date\n    && new Date(ticket.sla_due_date).getTime() < Date.now();")
change(p, "maintenanceTicketStatusClass(ticket.status)", "maintenanceTicketStatusClass(effectiveStatus)")
change(p, "{getTranslatedStatus(ticket.status)}", "{getTranslatedStatus(effectiveStatus)}")
change(p, "{ticket.status === 'on_hold' && (", "{ticket.on_hold && ticket.status !== 'completed' && !ticket.pending_supervisor_approval && (")
change(p, "{t('ticketCard.room')} {ticket.room_number}", "{maintenanceLocation(ticket.room_number, ticket.description, language)}")
change(p, "          {ticket.assigned_to && <div className=\"flex items-center gap-1 text-xs text-muted-foreground\"><AlertCircle className=\"h-3 w-3\" />{t('ticketCard.assignedTo')} {ticket.assigned_to.full_name}</div>}\n        </div>\n      </CardContent>", "          {ticket.assigned_to && <div className=\"flex items-center gap-1 text-xs text-muted-foreground\"><AlertCircle className=\"h-3 w-3\" />{t('ticketCard.assignedTo')} {ticket.assigned_to.full_name}</div>}\n          {overdue && <p role=\"status\" className=\"text-xs font-medium text-red-700\">{language === 'hu' ? 'Lejárt határidő' : 'Overdue SLA'}</p>}\n        </div>\n        {canManage && <div className=\"border-t pt-2\" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>\n          <Button type=\"button\" size=\"sm\" variant=\"outline\" onClick={() => setShowActions(value => !value)}>{language === 'hu' ? 'Hiba kezelése' : 'Manage issue'}</Button>\n          {showActions && <MaintenanceManagerControls ticket={ticket} language={language} onUpdated={() => {\n            setShowActions(false); onUpdated?.();\n            window.dispatchEvent(new CustomEvent('maintenance-ticket-created'));\n          }} />}\n        </div>}\n      </CardContent>")

# Ensure no special-purpose workflow or one-shot patch files enter main.
Path('scripts/maintenance_complete_298.py').unlink()
Path('.github/workflows/maintenance-298-branch-apply.yml').unlink()
print('Applied maintenance #298 UI and queue patches; removed temporary tooling.')
