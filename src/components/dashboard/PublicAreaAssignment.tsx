import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Archive, Check, Loader2, MapPin, Plus, RotateCcw, Search, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { getLocalDateString } from '@/lib/utils';

interface PublicAreaAssignmentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: { id: string; full_name: string; nickname: string | null }[];
  hotelName: string;
  onAssigned: () => void;
}

interface PublicAreaDefinition {
  id: string;
  hotel_name: string;
  name: string;
  description: string | null;
  icon: string;
  task_type: string;
  sort_order: number;
  is_active: boolean;
}

const PUBLIC_AREA_TYPES = [
  { value: 'public_area_cleaning', label: 'General area', icon: '🧹' },
  { value: 'lobby_cleaning', label: 'Entrance / lobby', icon: '🏨' },
  { value: 'reception_cleaning', label: 'Reception', icon: '🛎️' },
  { value: 'guest_toilets', label: 'Restrooms', icon: '🚻' },
  { value: 'stairways_cleaning', label: 'Corridors / stairs', icon: '🚶' },
  { value: 'common_areas_cleaning', label: 'Common area', icon: '🏠' },
  { value: 'back_office_cleaning', label: 'Office / back office', icon: '🏢' },
  { value: 'kitchen_cleaning', label: 'Kitchen', icon: '🍳' },
  { value: 'breakfast_room_cleaning', label: 'Breakfast / dining', icon: '🍽️' },
  { value: 'gym_cleaning', label: 'Gym / fitness', icon: '🏋️' },
  { value: 'sauna_cleaning', label: 'Sauna', icon: '♨️' },
  { value: 'jacuzzi_cleaning', label: 'Jacuzzi / wellness', icon: '🫧' },
] as const;

const MANAGE_PUBLIC_AREA_ROLES = new Set([
  'admin',
  'top_management',
  'top_management_manager',
  'manager',
  'housekeeping_manager',
  'supervisor',
  'reception_manager',
  'back_office_manager',
]);

const areaTypeDetails = (taskType: string) =>
  PUBLIC_AREA_TYPES.find((item) => item.value === taskType) ?? PUBLIC_AREA_TYPES[0];

export function PublicAreaAssignment({ open, onOpenChange, staff, hotelName, onAssigned }: PublicAreaAssignmentProps) {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const db = supabase as any;

  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const [areas, setAreas] = useState<PublicAreaDefinition[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(false);
  const [areaLoadFailed, setAreaLoadFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [manageMode, setManageMode] = useState(false);
  const [creatingArea, setCreatingArea] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaDescription, setNewAreaDescription] = useState('');
  const [newAreaType, setNewAreaType] = useState('public_area_cleaning');
  const [areaToArchive, setAreaToArchive] = useState<PublicAreaDefinition | null>(null);

  const copy = (key: string, fallback: string) => {
    const translated = t(key);
    return translated && translated !== key ? translated : fallback;
  };

  const canManageAreas = Boolean(
    profile?.is_super_admin || (profile?.role && MANAGE_PUBLIC_AREA_ROLES.has(profile.role)),
  );

  const activeAreas = useMemo(
    () => areas.filter((area) => area.is_active),
    [areas],
  );

  const archivedAreas = useMemo(
    () => areas.filter((area) => !area.is_active),
    [areas],
  );

  const filteredAreas = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return activeAreas;
    return activeAreas.filter((area) =>
      `${area.name} ${area.description ?? ''}`.toLocaleLowerCase().includes(term),
    );
  }, [activeAreas, search]);

  const loadAreas = async () => {
    if (!hotelName) return;
    setLoadingAreas(true);
    setAreaLoadFailed(false);
    try {
      const { data, error } = await db
        .from('hotel_public_areas')
        .select('id, hotel_name, name, description, icon, task_type, sort_order, is_active')
        .eq('hotel_name', hotelName)
        .order('is_active', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      setAreas((data ?? []) as PublicAreaDefinition[]);
    } catch (error) {
      console.error('[PublicAreaAssignment] failed to load property areas:', error);
      setAreas([]);
      setAreaLoadFailed(true);
      toast.error(copy('publicArea.loadFailed', 'Could not load public areas for this property'));
    } finally {
      setLoadingAreas(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setManageMode(false);
    setNewAreaName('');
    setNewAreaDescription('');
    setNewAreaType('public_area_cleaning');
    setAreaToArchive(null);
    void loadAreas();
  }, [open, hotelName]);

  // Do not keep stale selections if a manager archives an area while this
  // dialog is open or after a refresh.
  useEffect(() => {
    const activeIds = new Set(activeAreas.map((area) => area.id));
    setSelectedAreas((current) => {
      const next = new Set(Array.from(current).filter((id) => activeIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [activeAreas]);

  const toggleArea = (id: string) => {
    setSelectedAreas((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateArea = async () => {
    if (!user || !canManageAreas || !hotelName) return;
    const name = newAreaName.trim();
    const description = newAreaDescription.trim();
    if (!name) {
      toast.error(copy('publicArea.nameRequired', 'Enter a name for the public area'));
      return;
    }
    if (name.length > 80) {
      toast.error(copy('publicArea.nameTooLong', 'Area name must be 80 characters or fewer'));
      return;
    }

    const duplicate = areas.find((area) => area.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate?.is_active) {
      toast.info(copy('publicArea.alreadyExists', 'That public area already exists for this property'));
      setSelectedAreas((current) => new Set(current).add(duplicate.id));
      return;
    }
    if (duplicate && !duplicate.is_active) {
      await restoreArea(duplicate, true);
      return;
    }

    setCreatingArea(true);
    try {
      const type = areaTypeDetails(newAreaType);
      const nextSort = activeAreas.reduce((max, area) => Math.max(max, area.sort_order), 0) + 10;
      const { data, error } = await db
        .from('hotel_public_areas')
        .insert({
          hotel_name: hotelName,
          name,
          description: description || null,
          icon: type.icon,
          task_type: type.value,
          sort_order: nextSort,
          is_active: true,
          created_by: user.id,
        })
        .select('id, hotel_name, name, description, icon, task_type, sort_order, is_active')
        .single();

      if (error) throw error;
      const created = data as PublicAreaDefinition;
      setAreas((current) => [...current, created]);
      setSelectedAreas((current) => new Set(current).add(created.id));
      setNewAreaName('');
      setNewAreaDescription('');
      setNewAreaType('public_area_cleaning');
      toast.success(copy('publicArea.created', 'Public area added for this property'));
    } catch (error: any) {
      console.error('[PublicAreaAssignment] failed to create area:', error);
      if (error?.code === '23505') {
        toast.error(copy('publicArea.alreadyExists', 'That public area already exists for this property'));
      } else {
        toast.error(copy('publicArea.createFailed', 'Failed to add public area'));
      }
    } finally {
      setCreatingArea(false);
    }
  };

  const archiveArea = async (area: PublicAreaDefinition) => {
    if (!canManageAreas) return;
    try {
      const { error } = await db
        .from('hotel_public_areas')
        .update({ is_active: false })
        .eq('id', area.id)
        .eq('hotel_name', hotelName);
      if (error) throw error;

      setAreas((current) => current.map((item) =>
        item.id === area.id ? { ...item, is_active: false } : item,
      ));
      setSelectedAreas((current) => {
        const next = new Set(current);
        next.delete(area.id);
        return next;
      });
      toast.success(copy('publicArea.archived', 'Public area removed from future assignments'));
    } catch (error) {
      console.error('[PublicAreaAssignment] failed to archive area:', error);
      toast.error(copy('publicArea.archiveFailed', 'Failed to remove public area'));
    } finally {
      setAreaToArchive(null);
    }
  };

  const restoreArea = async (area: PublicAreaDefinition, selectAfterRestore = false) => {
    if (!canManageAreas) return;
    try {
      const { error } = await db
        .from('hotel_public_areas')
        .update({ is_active: true })
        .eq('id', area.id)
        .eq('hotel_name', hotelName);
      if (error) throw error;

      setAreas((current) => current.map((item) =>
        item.id === area.id ? { ...item, is_active: true } : item,
      ));
      if (selectAfterRestore) {
        setSelectedAreas((current) => new Set(current).add(area.id));
        setNewAreaName('');
        setNewAreaDescription('');
        setNewAreaType('public_area_cleaning');
      }
      toast.success(copy('publicArea.restored', 'Public area restored'));
    } catch (error) {
      console.error('[PublicAreaAssignment] failed to restore area:', error);
      toast.error(copy('publicArea.restoreFailed', 'Failed to restore public area'));
    }
  };

  const handleAssign = async () => {
    if (!selectedStaffId || selectedAreas.size === 0 || !user) return;
    if (!profile?.organization_slug) {
      toast.error('Organization access could not be verified');
      return;
    }

    const chosenAreas = activeAreas.filter((area) => selectedAreas.has(area.id));
    if (chosenAreas.length === 0) {
      toast.error(copy('publicArea.noActiveSelection', 'Select at least one active public area'));
      return;
    }

    setSubmitting(true);
    try {
      const today = getLocalDateString();
      const tasks = chosenAreas.map((area) => ({
        task_name: area.name,
        task_description: [area.description, notes ? `Notes: ${notes}` : null].filter(Boolean).join('\n\n') || null,
        task_type: area.task_type || 'public_area_cleaning',
        assigned_to: selectedStaffId,
        assigned_by: user.id,
        assigned_date: today,
        hotel: hotelName,
        priority,
        status: 'assigned',
        organization_slug: profile.organization_slug,
      }));

      const { error } = await supabase.from('general_tasks').insert(tasks as any);
      if (error) throw error;

      const staffName = staff.find((member) => member.id === selectedStaffId)?.full_name || 'staff';
      toast.success(`Assigned ${chosenAreas.length} public area(s) to ${staffName}`);

      setSelectedStaffId('');
      setSelectedAreas(new Set());
      setNotes('');
      setPriority(1);
      onAssigned();
      onOpenChange(false);
    } catch (error) {
      console.error('Error assigning public areas:', error);
      toast.error('Failed to assign public areas');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[92dvh] max-w-xl flex-col overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-5 pb-4 pt-5 sm:px-6">
            <div className="flex items-start justify-between gap-3 pr-7">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 shrink-0 text-primary" />
                  {t('publicArea.title')}
                </DialogTitle>
                <p className="mt-1 truncate text-xs text-muted-foreground">{hotelName}</p>
              </div>
              {canManageAreas && (
                <Button
                  type="button"
                  size="sm"
                  variant={manageMode ? 'secondary' : 'outline'}
                  className="h-8 shrink-0"
                  onClick={() => setManageMode((value) => !value)}
                >
                  <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                  {manageMode
                    ? copy('publicArea.doneManaging', 'Done')
                    : copy('publicArea.manageAreas', 'Manage areas')}
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('publicArea.selectHousekeeper')}</label>
                <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('publicArea.choosePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.full_name} {member.nickname ? `(${member.nickname})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {manageMode && canManageAreas && (
                <div className="rounded-xl border bg-muted/25 p-3 sm:p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Plus className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">{copy('publicArea.addNew', 'Add a public area')}</p>
                      <p className="text-xs text-muted-foreground">
                        {copy('publicArea.savedForProperty', 'Saved only for this property, so every venue can keep its own list.')}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_190px]">
                    <Input
                      value={newAreaName}
                      onChange={(event) => setNewAreaName(event.target.value)}
                      placeholder={copy('publicArea.namePlaceholder', 'Area name, e.g. Rooftop Terrace')}
                      maxLength={80}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !creatingArea) {
                          event.preventDefault();
                          void handleCreateArea();
                        }
                      }}
                    />
                    <Select value={newAreaType} onValueChange={setNewAreaType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PUBLIC_AREA_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.icon} {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    className="mt-2"
                    value={newAreaDescription}
                    onChange={(event) => setNewAreaDescription(event.target.value)}
                    placeholder={copy('publicArea.descriptionPlaceholder', 'Short cleaning instruction or location detail (optional)')}
                    maxLength={300}
                    rows={2}
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleCreateArea()}
                      disabled={creatingArea || !newAreaName.trim()}
                    >
                      {creatingArea ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                      {copy('publicArea.addArea', 'Add area')}
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-medium">
                    {t('publicArea.selectAreas')}
                  </label>
                  <Badge variant={selectedAreas.size > 0 ? 'secondary' : 'outline'}>
                    {selectedAreas.size} {t('publicArea.selected')}
                  </Badge>
                </div>

                {(activeAreas.length > 5 || search) && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={copy('publicArea.search', 'Search public areas…')}
                      className="pl-9"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  {loadingAreas ? (
                    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {copy('publicArea.loading', 'Loading public areas…')}
                    </div>
                  ) : areaLoadFailed ? (
                    <div className="rounded-lg border border-dashed p-4 text-center">
                      <p className="text-sm text-muted-foreground">
                        {copy('publicArea.loadFailed', 'Could not load public areas for this property')}
                      </p>
                      <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void loadAreas()}>
                        {copy('common.retry', 'Retry')}
                      </Button>
                    </div>
                  ) : filteredAreas.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-5 text-center">
                      <p className="text-sm font-medium">
                        {search
                          ? copy('publicArea.noSearchResults', 'No public areas match your search')
                          : copy('publicArea.noneConfigured', 'No public areas are configured for this property')}
                      </p>
                      {!search && canManageAreas && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {copy('publicArea.useManage', 'Use Manage areas to add the spaces this venue actually has.')}
                        </p>
                      )}
                    </div>
                  ) : (
                    filteredAreas.map((area) => {
                      const isSelected = selectedAreas.has(area.id);
                      const icon = area.icon || areaTypeDetails(area.task_type).icon;
                      return (
                        <div
                          key={area.id}
                          role="button"
                          tabIndex={0}
                          className={`group flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'hover:border-primary/30 hover:bg-muted/60'
                          }`}
                          onClick={() => toggleArea(area.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              toggleArea(area.id);
                            }
                          }}
                        >
                          <div onClick={(event) => event.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleArea(area.id)}
                              aria-label={`Select ${area.name}`}
                            />
                          </div>
                          <span className="text-xl" aria-hidden>{icon}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-5">{area.name}</p>
                            {area.description && (
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{area.description}</p>
                            )}
                          </div>
                          {manageMode && canManageAreas && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                              title={copy('publicArea.archive', 'Remove from future assignments')}
                              onClick={(event) => {
                                event.stopPropagation();
                                setAreaToArchive(area);
                              }}
                            >
                              <Archive className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {manageMode && canManageAreas && archivedAreas.length > 0 && (
                  <details className="rounded-lg border bg-muted/20 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      {copy('publicArea.archivedAreas', 'Archived areas')} ({archivedAreas.length})
                    </summary>
                    <div className="mt-2 space-y-1.5">
                      {archivedAreas.map((area) => (
                        <div key={area.id} className="flex items-center gap-2 rounded-md bg-background px-2.5 py-2">
                          <span aria-hidden>{area.icon || '🧹'}</span>
                          <span className="min-w-0 flex-1 truncate text-sm">{area.name}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => void restoreArea(area)}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            {copy('publicArea.restore', 'Restore')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('publicArea.priority')}</label>
                  <Select value={String(priority)} onValueChange={(value) => setPriority(Number(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">{t('publicArea.normal')}</SelectItem>
                      <SelectItem value="2">{t('publicArea.high')}</SelectItem>
                      <SelectItem value="3">{t('publicArea.urgent')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('publicArea.notes')}</label>
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder={t('publicArea.notesPlaceholder')}
                    rows={2}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t bg-background px-5 py-4 sm:px-6">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleAssign}
              disabled={!selectedStaffId || selectedAreas.size === 0 || submitting || loadingAreas || areaLoadFailed}
              className="w-full sm:w-auto"
            >
              {submitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('publicArea.assigning')}</>
              ) : (
                <><Check className="mr-2 h-4 w-4" />{t('publicArea.assign')} {selectedAreas.size}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(areaToArchive)} onOpenChange={(nextOpen) => !nextOpen && setAreaToArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy('publicArea.archiveTitle', 'Remove this public area?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy(
                'publicArea.archiveDescription',
                'It will disappear from future assignments for this property. Existing and historical tasks will stay unchanged, and the area can be restored later.',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => areaToArchive && void archiveArea(areaToArchive)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {copy('publicArea.archiveAction', 'Remove area')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
