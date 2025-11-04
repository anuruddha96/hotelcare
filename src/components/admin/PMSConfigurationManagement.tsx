import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Plus, Trash2, Save, RefreshCw } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface PMSConfig {
  id: string;
  hotel_id: string;
  pms_type: string;
  pms_hotel_id: string;
  is_active: boolean;
  sync_enabled: boolean;
  last_sync_at: string | null;
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
  const [loading, setLoading] = useState(false);
  
  // Form states
  const [pmsHotelId, setPmsHotelId] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(true);
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
      setPmsConfig(config);
      setPmsHotelId(config.pms_hotel_id);
      setSyncEnabled(config.sync_enabled);
      
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
    } else {
      setPmsConfig(null);
      setRoomMappings([]);
      setPmsHotelId('');
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
          updated_at: new Date().toISOString()
        })
        .eq('id', pmsConfig.id);
      
      if (error) {
        toast.error('Failed to update PMS configuration');
      } else {
        toast.success('PMS configuration updated');
        fetchPMSConfig();
      }
    } else {
      // Create new config
      const { data, error } = await supabase
        .from('pms_configurations')
        .insert({
          hotel_id: selectedHotelId,
          pms_type: 'previo',
          pms_hotel_id: pmsHotelId,
          sync_enabled: syncEnabled
        })
        .select()
        .single();
      
      if (error) {
        toast.error('Failed to create PMS configuration');
      } else {
        toast.success('PMS configuration created');
        setPmsConfig(data);
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
      toast.error('Failed to add room mapping');
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

  const testPrevioConnection = async () => {
    if (!pmsConfig) {
      toast.error('Please save PMS configuration first');
      return;
    }
    
    setLoading(true);
    toast.info('Testing Previo connection...');
    
    const { data, error } = await supabase.functions.invoke('previo-sync-rooms', {
      body: { hotelId: pmsConfig.pms_hotel_id }
    });
    
    setLoading(false);
    
    if (error || !data?.success) {
      toast.error(`Connection failed: ${error?.message || data?.error || 'Unknown error'}`);
    } else {
      toast.success(`Connection successful! Synced ${data.roomsProcessed || 0} rooms`);
      fetchPMSConfig();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>PMS Configuration</CardTitle>
          <CardDescription>
            Configure Previo PMS integration and room mappings for your hotels
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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

                <div className="flex items-center space-x-2">
                  <Switch
                    id="sync-enabled"
                    checked={syncEnabled}
                    onCheckedChange={setSyncEnabled}
                  />
                  <Label htmlFor="sync-enabled">Enable automatic sync</Label>
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
                
                {pmsConfig?.last_sync_at && (
                  <p className="text-sm text-muted-foreground">
                    Last synced: {new Date(pmsConfig.last_sync_at).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Room Mappings */}
              {pmsConfig && (
                <div className="space-y-4 p-4 border rounded-lg">
                  <h3 className="font-semibold">Room Mappings</h3>
                  <p className="text-sm text-muted-foreground">
                    Map HotelCare room numbers to Previo room type IDs
                  </p>

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
                      <p className="text-sm text-muted-foreground">No room mappings configured yet</p>
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
  );
}
