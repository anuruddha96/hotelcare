import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Plus, Trash2, Save, RefreshCw, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import PmsSyncStatus from './PmsSyncStatus';
import { PMSActivationChecklist } from './PMSActivationChecklist';
import { AIRoomImportDialog } from './AIRoomImportDialog';
import { Sparkles } from 'lucide-react';

interface PMSConfig {
  id: string;
  hotel_id: string;
  pms_type: string;
  pms_hotel_id: string;
  is_active: boolean;
  sync_enabled: boolean;
  last_sync_at: string | null;
  credentials_secret_name?: string | null;
  auto_sync_enabled?: boolean;
  connection_mode?: string;
  last_test_at?: string | null;
  last_test_status?: string | null;
  last_test_error?: string | null;
  hide_pms_upload_page?: boolean;
}

interface RoomMapping {
  id: string;
  hotelcare_room_number: string;
  pms_room_id: string;
  pms_room_name: string | null;
  is_active: boolean;
}

interface Hotel {
  hotel_id: string;
  hotel_name: string;
}

export default function PMSConfigurationManagement() {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string>('');
  const [pmsConfig, setPmsConfig] = useState<PMSConfig | null>(null);
  const [roomMappings, setRoomMappings] = useState<RoomMapping[]>([]);
  const [linkedRooms, setLinkedRooms] = useState<Array<{ id: string; room_number: string; pms_room_id: string; pms_room_name: string | null }>>([]);
  const [loading, setLoading] = useState(false);
  const [aiImportOpen, setAiImportOpen] = useState(false);
  
  // Form states
  const [pmsHotelId, setPmsHotelId] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [connectionMode, setConnectionMode] = useState<'manual' | 'scheduled'>('manual');
  const [credentialsSecretName, setCredentialsSecretName] = useState('');
  const [hidePmsUploadPage, setHidePmsUploadPage] = useState(false);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newPmsRoomId, setNewPmsRoomId] = useState('');
  const [newPmsRoomName, setNewPmsRoomName] = useState('');

  useEffect(() => {
    fetchHotels();
  }, []);

  useEffect(() => {
    if (selectedHotelId) {
      fetchPMSConfig();
    }
  }, [selectedHotelId]);

  const fetchHotels = async () => {
    const { data, error } = await supabase
      .from('hotel_configurations')
      .select('hotel_id, hotel_name')
      .order('hotel_name');
    
    if (error) {
      toast.error('Failed to load hotels');
      return;
    }
    
    setHotels(data || []);
  };

  const fetchPMSConfig = async () => {
    setLoading(true);
    
    // Fetch PMS configuration
    const { data: config, error: configError } = await supabase
      .from('pms_configurations')
      .select('*')
      .eq('hotel_id', selectedHotelId)
      .eq('pms_type', 'previo')
      .single();
    
    if (config) {
      setPmsConfig(config as any);
      setPmsHotelId(config.pms_hotel_id);
      setSyncEnabled(config.sync_enabled);
      setAutoSyncEnabled((config as any).auto_sync_enabled ?? false);
      setConnectionMode(((config as any).connection_mode as 'manual' | 'scheduled') || 'manual');
      setCredentialsSecretName((config as any).credentials_secret_name || '');
      setHidePmsUploadPage((config as any).hide_pms_upload_page === true);

      // Fetch room mappings
      const { data: mappings, error: mappingsError } = await supabase
        .from('pms_room_mappings')
        .select('*')
        .eq('pms_config_id', config.id)
        .order('hotelcare_room_number');

      if (mappingsError) {
        toast.error('Failed to load room mappings');
      } else {
        setRoomMappings(mappings || []);
      }

      // Also surface rooms that are already linked to Previo via
      // pms_metadata.roomId, even when pms_room_mappings is empty. This
      // lets admins see the actual room ↔ Previo linkage that the sync
      // engine is using, and offer a "Backfill mappings" one-click fix.
      const { data: linked } = await supabase
        .from('rooms')
        .select('id, room_number, pms_metadata')
        .eq('hotel', config.hotel_id)
        .not('pms_metadata->roomId', 'is', null)
        .order('room_number');
      setLinkedRooms(
        (linked || []).map((r: any) => ({
          id: r.id,
          room_number: r.room_number,
          pms_room_id: String(r.pms_metadata?.roomId ?? ''),
          pms_room_name: r.pms_metadata?.previoName ?? r.pms_metadata?.roomKindName ?? null,
        })).filter(r => r.pms_room_id),
      );
    } else {
      setPmsConfig(null);
      setRoomMappings([]);
      setLinkedRooms([]);
      setPmsHotelId('');
      setAutoSyncEnabled(false);
      setConnectionMode('manual');
      setCredentialsSecretName('');
      setHidePmsUploadPage(false);
    }
    
    setLoading(false);
  };

  const savePMSConfig = async () => {
    if (!selectedHotelId || !pmsHotelId) {
      toast.error('Please select a hotel and enter PMS Hotel ID');
      return;
    }
    
    setLoading(true);
    
    if (pmsConfig) {
      // Update existing config
      const { error } = await supabase
        .from('pms_configurations')
        .update({
          pms_hotel_id: pmsHotelId,
          sync_enabled: syncEnabled,
          auto_sync_enabled: autoSyncEnabled,
          connection_mode: connectionMode,
          credentials_secret_name: credentialsSecretName || null,
          hide_pms_upload_page: hidePmsUploadPage,
          updated_at: new Date().toISOString()
        } as any)
        .eq('id', pmsConfig.id);

      if (error) {
        toast.error('Failed to update PMS configuration');
      } else {
        toast.success('PMS configuration updated');
        fetchPMSConfig();
      }
    } else {
      // Create new config — defaults to inactive + manual + no auto-sync
      const { data, error } = await supabase
        .from('pms_configurations')
        .insert({
          hotel_id: selectedHotelId,
          pms_type: 'previo',
          pms_hotel_id: pmsHotelId,
          sync_enabled: syncEnabled,
          auto_sync_enabled: autoSyncEnabled,
          connection_mode: connectionMode,
          credentials_secret_name: credentialsSecretName || null,
          hide_pms_upload_page: hidePmsUploadPage,
          is_active: false,
        } as any)
        .select()
        .single();

      if (error) {
        toast.error('Failed to create PMS configuration');
      } else {
        toast.success('PMS configuration created (inactive — flip "Active" to enable)');
        setPmsConfig(data as any);
      }
    }

    setLoading(false);
  };

  const addRoomMapping = async () => {
    if (!pmsConfig) {
      toast.error('Please save PMS configuration first');
      return;
    }
    
    if (!newRoomNumber || !newPmsRoomId) {
      toast.error('Please enter room number and PMS room ID');
      return;
    }
    
    setLoading(true);
    
    const { error } = await supabase
      .from('pms_room_mappings')
      .insert({
        pms_config_id: pmsConfig.id,
        hotelcare_room_number: newRoomNumber,
        pms_room_id: newPmsRoomId,
        pms_room_name: newPmsRoomName || null
      });
    
    if (error) {
      console.error('Room mapping error:', error);
      toast.error(`Failed to add room mapping: ${error.message}`);
    } else {
      toast.success('Room mapping added');
      setNewRoomNumber('');
      setNewPmsRoomId('');
      setNewPmsRoomName('');
      fetchPMSConfig();
    }
    
    setLoading(false);
  };

  const deleteRoomMapping = async (id: string) => {
    setLoading(true);
    
    const { error } = await supabase
      .from('pms_room_mappings')
      .delete()
      .eq('id', id);
    
    if (error) {
      toast.error('Failed to delete room mapping');
    } else {
      toast.success('Room mapping deleted');
      fetchPMSConfig();
    }
    
    setLoading(false);
  };

  /**
   * Backfill pms_room_mappings from rooms that already carry
   * pms_metadata.roomId — happens when an earlier import populated the
   * rooms table but skipped the mapping table (e.g. AI import in
   * suggest-only mode). Idempotent: existing mappings are preserved.
   */
  const backfillMappingsFromMetadata = async () => {
    if (!pmsConfig) return;
    if (linkedRooms.length === 0) {
      toast.info('No Previo-linked rooms found in the rooms table.');
      return;
    }
    setLoading(true);
    try {
      const existingByPmsId = new Map(roomMappings.map(m => [m.pms_room_id, m]));
      const toInsert = linkedRooms
        .filter(r => !existingByPmsId.has(r.pms_room_id))
        .map(r => ({
          pms_config_id: pmsConfig.id,
          hotelcare_room_id: r.id,
          hotelcare_room_number: r.room_number,
          pms_room_id: r.pms_room_id,
          pms_room_name: r.pms_room_name,
          is_active: true,
          mapping_status: 'active',
          last_verified_at: new Date().toISOString(),
        }));
      if (toInsert.length === 0) {
        toast.success('All linked rooms already have mappings.');
      } else {
        const { error } = await supabase.from('pms_room_mappings').insert(toInsert);
        if (error) throw error;
        toast.success(`Backfilled ${toInsert.length} room mapping(s).`);
        await fetchPMSConfig();
      }
    } catch (e: any) {
      toast.error(`Backfill failed: ${e?.message || 'unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  const testPrevioConnection = async () => {
    if (!pmsConfig) {
      toast.error('Please save PMS configuration first');
      return;
    }

    setLoading(true);
    toast.info('Testing Previo connection (read-only, no data is changed)…');

    const { data, error } = await supabase.functions.invoke('previo-test-connection', {
      body: { hotelId: pmsConfig.hotel_id }
    });

    setLoading(false);

    if (error || !data?.ok) {
      toast.error(`Connection failed: ${error?.message || data?.error || 'Unknown error'}`);
    } else {
      toast.success(`Connection OK — ${data.roomCount ?? 0} rooms visible (${data.latencyMs}ms)`);
    }
    fetchPMSConfig();
  };

  return (
    <>
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>PMS Configuration</CardTitle>
          <CardDescription>
            Configure Previo PMS integration and room mappings for your hotels
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Quick-find banner for the hide-toggle managers keep asking about */}
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900/60 dark:bg-blue-950/30">
            <Cable className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
            <div className="text-blue-900 dark:text-blue-200">
              <strong>Turn the legacy PMS Upload tab on/off here.</strong> Pick a hotel below, then scroll to the{' '}
              <em>"Hide legacy PMS Upload tab"</em> switch inside the Previo Configuration card.
              When ON, managers only see <strong>Team View → PMS Refresh</strong>.
            </div>
          </div>
          {/* Hotel Selection */}
          <div className="space-y-2">
            <Label>Select Hotel</Label>
            <Select value={selectedHotelId} onValueChange={setSelectedHotelId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a hotel" />
              </SelectTrigger>
              <SelectContent>
                {hotels.map(hotel => (
                  <SelectItem key={hotel.hotel_id} value={hotel.hotel_id}>
                    {hotel.hotel_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedHotelId && (
            <>
              {/* PMS Configuration */}
              <div className="space-y-4 p-4 border rounded-lg">
                <h3 className="font-semibold">Previo Configuration</h3>

                <div className="flex items-start gap-2 p-3 rounded-md border bg-muted/40">
                  <ShieldAlert className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    This hotel will not contact Previo until both <strong>Active</strong> and{' '}
                    <strong>Sync enabled</strong> are turned on. Scheduled background sync only runs
                    if <strong>Connection mode = Scheduled</strong> AND <strong>Auto-sync</strong> is on.
                    OttoFiori's existing setup is unaffected by this screen.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pms-hotel-id">Previo Hotel ID</Label>
                  <Input
                    id="pms-hotel-id"
                    value={pmsHotelId}
                    onChange={(e) => setPmsHotelId(e.target.value)}
                    placeholder="e.g., 788619"
                  />
                  <p className="text-sm text-muted-foreground">
                    The hotel ID from your Previo system
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="creds-secret-name">Credentials secret name</Label>
                  <Input
                    id="creds-secret-name"
                    value={credentialsSecretName}
                    onChange={(e) => setCredentialsSecretName(e.target.value)}
                    placeholder="e.g., PREVIO_HOTEL_GOZSDU"
                  />
                  <p className="text-sm text-muted-foreground">
                    Name of the Supabase secret holding <code>login:password</code> for this hotel.
                    Leave empty to fall back to the legacy global credentials (OttoFiori only).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Connection mode</Label>
                  <RadioGroup
                    value={connectionMode}
                    onValueChange={(v) => setConnectionMode(v as 'manual' | 'scheduled')}
                    className="flex gap-6"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="manual" id="mode-manual" />
                      <Label htmlFor="mode-manual" className="font-normal">Manual only</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="scheduled" id="mode-scheduled" />
                      <Label htmlFor="mode-scheduled" className="font-normal">Scheduled</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="sync-enabled"
                    checked={syncEnabled}
                    onCheckedChange={setSyncEnabled}
                  />
                  <Label htmlFor="sync-enabled">Sync enabled</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="auto-sync-enabled"
                    checked={autoSyncEnabled}
                    onCheckedChange={setAutoSyncEnabled}
                    disabled={connectionMode !== 'scheduled'}
                  />
                  <Label htmlFor="auto-sync-enabled">
                    Allow background auto-sync (scheduled mode only)
                  </Label>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
                  <div className="space-y-1">
                    <Label htmlFor="hide-pms-upload-page">Hide legacy PMS Upload tab</Label>
                    <p className="text-xs text-muted-foreground">
                      Managers will use Team View → PMS Refresh. Keep the upload tab visible only as a fallback.
                    </p>
                  </div>
                  <Switch
                    id="hide-pms-upload-page"
                    checked={hidePmsUploadPage}
                    onCheckedChange={setHidePmsUploadPage}
                  />
                </div>

                <div className="flex gap-2">
                  <Button onClick={savePMSConfig} disabled={loading}>
                    <Save className="w-4 h-4 mr-2" />
                    Save Configuration
                  </Button>
                  {pmsConfig && (
                    <Button onClick={testPrevioConnection} disabled={loading} variant="outline">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Test Connection
                    </Button>
                  )}
                </div>

                {pmsConfig?.last_test_at && (
                  <div className="flex items-center gap-2 text-sm">
                    {pmsConfig.last_test_status === 'ok' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    <span className="text-muted-foreground">
                      Last test: {new Date(pmsConfig.last_test_at).toLocaleString()}
                      {pmsConfig.last_test_error ? ` — ${pmsConfig.last_test_error}` : ''}
                    </span>
                  </div>
                )}

                {pmsConfig?.last_sync_at && (
                  <p className="text-sm text-muted-foreground">
                    Last synced: {new Date(pmsConfig.last_sync_at).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Setup checklist + sync status */}
              <PmsSyncStatus hotelId={selectedHotelId} />

              {/* Per-stage activation flags (kill-switch + 8 stage flags) */}
              <PMSActivationChecklist hotelId={selectedHotelId} />


              {/* Room Mappings */}
              {pmsConfig && (
                <div className="space-y-4 p-4 border rounded-lg">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">Room Mappings</h3>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        disabled={loading}
                        onClick={() => setAiImportOpen(true)}
                        title="Use AI to import Previo rooms into HotelCare (creates rooms + mappings)"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        AI import from Previo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={loading}
                        onClick={async () => {
                          setLoading(true);
                          toast.info('Fetching rooms from Previo and auto-mapping by number…');
                          const { data, error } = await supabase.functions.invoke('previo-sync-rooms', {
                            body: { hotelId: selectedHotelId, mapOnly: true },
                          });
                          setLoading(false);
                          if (error || (data as any)?.success === false) {
                            toast.error(`Auto-map failed: ${error?.message || (data as any)?.error || 'unknown'}`);
                            return;
                          }
                          const r = (data as any)?.results || {};
                          toast.success(`Auto-map complete — mapped ${r.mapped ?? 0}, unmapped ${(r.unmapped ?? []).length}`);
                          fetchPMSConfig();
                        }}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Auto-map from Previo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={loading || linkedRooms.length === 0}
                        onClick={backfillMappingsFromMetadata}
                        title="Create pms_room_mappings entries for rooms already linked via pms_metadata.roomId"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Backfill from metadata ({linkedRooms.length})
                      </Button>
                    </div>
                  </div>
                  <div className="p-3 bg-amber-50 dark:bg-amber-950 rounded-lg mb-4">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Important:</p>
                    <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                      Enter the <strong>actual room number</strong> from HotelCare (e.g., "101", "102", "201"), 
                      NOT the room type name. Use <strong>Auto-map from Previo</strong> to seed mappings from
                      Previo's room list — it links each Previo room to the existing HotelCare room whose
                      number matches (e.g. "DB/TW-102" → "102"). Any rooms it can't match are listed for you
                      to add manually below.
                    </p>
                  </div>


                  {/* Add New Mapping */}
                  <div className="grid grid-cols-4 gap-2">
                    <Input
                      placeholder="Room # (e.g., 101)"
                      value={newRoomNumber}
                      onChange={(e) => setNewRoomNumber(e.target.value)}
                    />
                    <Input
                      placeholder="Previo Room ID"
                      value={newPmsRoomId}
                      onChange={(e) => setNewPmsRoomId(e.target.value)}
                    />
                    <Input
                      placeholder="Room Name (optional)"
                      value={newPmsRoomName}
                      onChange={(e) => setNewPmsRoomName(e.target.value)}
                    />
                    <Button onClick={addRoomMapping} disabled={loading}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add
                    </Button>
                  </div>

                  {/* Existing Mappings */}
                  <div className="space-y-2">
                    {roomMappings.length === 0 ? (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          No entries in <code>pms_room_mappings</code> yet.
                        </p>
                        {linkedRooms.length > 0 && (
                          <div className="p-3 rounded border bg-muted/40">
                            <p className="text-sm font-medium mb-2">
                              {linkedRooms.length} room(s) already linked to Previo via <code>rooms.pms_metadata</code>:
                            </p>
                            <div className="max-h-56 overflow-y-auto space-y-1">
                              {linkedRooms.map(r => (
                                <div key={r.id} className="text-xs flex items-center gap-2">
                                  <span className="font-medium">Room {r.room_number}</span>
                                  <span className="text-muted-foreground">→ Previo ID {r.pms_room_id}</span>
                                  {r.pms_room_name && <span className="text-muted-foreground">({r.pms_room_name})</span>}
                                </div>
                              ))}
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                              Click <strong>Backfill from metadata</strong> above to persist these into the mapping table.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      roomMappings.map(mapping => (
                        <div key={mapping.id} className="flex items-center justify-between p-2 border rounded">
                          <div className="flex-1">
                            <span className="font-medium">Room {mapping.hotelcare_room_number}</span>
                            <span className="mx-2">→</span>
                            <span className="text-muted-foreground">
                              Previo ID: {mapping.pms_room_id}
                            </span>
                            {mapping.pms_room_name && (
                              <span className="ml-2 text-sm text-muted-foreground">
                                ({mapping.pms_room_name})
                              </span>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteRoomMapping(mapping.id)}
                            disabled={loading}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>


                  <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                    <p className="text-sm font-medium mb-1">Previo Room Type IDs:</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• 984673 - Egyágyas szoba Deluxe</li>
                      <li>• 984677 - Háromágyas szoba Deluxe</li>
                      <li>• 984675 - Kétágyas szoba Deluxe</li>
                      <li>• 984679 - Queen Deluxe</li>
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
      <AIRoomImportDialog
        hotelId={selectedHotelId}
        open={aiImportOpen}
        onOpenChange={setAiImportOpen}
        onApplied={fetchPMSConfig}
      />
    </>
  );
}
