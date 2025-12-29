import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AttachmentUpload, AttachmentUploadRef } from './AttachmentUpload';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { Lightbulb, Star, Zap, AlertTriangle, Wrench, Droplet, Thermometer, Bed, Wifi, Utensils } from 'lucide-react';
import { hungarianCommonIssues } from '@/lib/maintenance-translations';

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketCreated: () => void;
}

// Common hotel issues with icons and categories - English
const commonIssuesEn = [
  { category: 'Room Issues', icon: Bed, issues: [
    'Air conditioning not working',
    'TV not functioning', 
    'Remote control missing/broken',
    'Light bulbs burned out',
    'WiFi connection problems',
    'Safe not working',
    'Door lock issues',
    'Window won\'t open/close',
    'Curtains/blinds stuck',
    'Room temperature too hot/cold',
    'Noise from neighboring rooms',
    'Room key not working',
    'Balcony door stuck',
    'Phone not working',
    'Alarm clock issues',
    'Mini bar not cooling',
    'In-room coffee machine broken'
  ]},
  { category: 'Plumbing', icon: Droplet, issues: [
    'Leaky faucet',
    'Toilet not flushing',
    'Low water pressure',
    'Shower drain clogged',
    'Hot water not working',
    'Bathroom flooding',
    'Shower head broken',
    'Toilet seat loose',
    'Sink drain slow/clogged',
    'Towel rack loose',
    'Shower door won\'t close',
    'Water temperature inconsistent',
    'Bathtub drain clogged',
    'Water leak under sink',
    'Toilet running continuously'
  ]},
  { category: 'Electrical', icon: Zap, issues: [
    'Power outlet not working',
    'Lights flickering',
    'Circuit breaker tripped',
    'Electrical sparks',
    'Fan not working',
    'Bathroom lights not working',
    'Bedside lamps not working',
    'Hair dryer not working',
    'USB charging ports not working',
    'Light switches not responding',
    'Ceiling fan making noise',
    'Power surge damage'
  ]},
  { category: 'HVAC', icon: Thermometer, issues: [
    'Room too hot/cold',
    'Heating not working',
    'Strange noises from AC',
    'Air vents blocked',
    'Thermostat malfunction',
    'AC not turning on',
    'AC blowing warm air',
    'Ventilation fan not working',
    'Musty smell from AC',
    'AC remote not working',
    'Temperature not adjusting'
  ]},
  { category: 'Maintenance', icon: Wrench, issues: [
    'Furniture damage',
    'Paint peeling',
    'Carpet stains',
    'Ceiling leak',
    'Wall cracks',
    'Mirror broken',
    'Drawer stuck/broken',
    'Closet door off track',
    'Bed frame loose/squeaky',
    'Chair/table wobbly',
    'Picture frame crooked/fallen',
    'Wallpaper peeling',
    'Floor tiles loose',
    'Bathroom tiles cracked'
  ]},
  { category: 'Kitchen/Restaurant', icon: Utensils, issues: [
    'Refrigerator not cooling',
    'Stove not working',
    'Dishwasher malfunction',
    'Freezer temperature issues',
    'Exhaust fan broken',
    'Microwave not working',
    'Coffee machine malfunction',
    'Ice machine not working',
    'Kitchen sink clogged',
    'Oven temperature incorrect',
    'Range hood not working'
  ]},
  { category: 'Housekeeping', icon: AlertTriangle, issues: [
    'Room not cleaned properly',
    'Towels not replaced',
    'Bed sheets dirty/stained',
    'Bathroom not cleaned',
    'Trash not emptied',
    'Missing toiletries',
    'Pillows need replacement',
    'Vacuum needed urgently',
    'Window cleaning required',
    'Deep cleaning needed',
    'Carpet cleaning required',
    'Extra towels needed',
    'Missing amenities',
    'Room service cleanup'
  ]}
];

// Map icon names to components for Hungarian issues
const iconMap: { [key: string]: any } = {
  'Bed': Bed,
  'Droplet': Droplet,
  'Zap': Zap,
  'Thermometer': Thermometer,
  'Wrench': Wrench,
  'Utensils': Utensils,
  'AlertTriangle': AlertTriangle,
};

const priorityConfig = {
  low: { color: 'bg-green-500', label: 'Low', labelHu: 'Alacsony', description: 'Non-urgent, can wait' },
  medium: { color: 'bg-yellow-500', label: 'Medium', labelHu: 'Közepes', description: 'Standard priority' },
  high: { color: 'bg-orange-500', label: 'High', labelHu: 'Magas', description: 'Needs attention soon' },
  urgent: { color: 'bg-red-500', label: 'Urgent', labelHu: 'Sürgős', description: 'Immediate attention required' }
};

export function CreateTicketDialog({ open, onOpenChange, onTicketCreated }: CreateTicketDialogProps) {
  const { profile } = useAuth();
  const { hotels: tenantHotels } = useTenant();
  const { t, language } = useTranslation();
  
  // Build hotels list from tenant context
  const hotels = tenantHotels.map(h => ({ 
    id: h.hotel_id, 
    name: h.hotel_name 
  }));
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [canCreateTickets, setCanCreateTickets] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [maintenanceStaff, setMaintenanceStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [selectedMaintenancePerson, setSelectedMaintenancePerson] = useState('');
  const [rooms, setRooms] = useState<{ room_number: string; hotel: string }[]>([]);
  const [showRoomSuggestions, setShowRoomSuggestions] = useState(false);
  const attachmentRef = useRef<AttachmentUploadRef>(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    room_number: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    department: '',
    hotel: '',
  });

  // Get language-specific common issues
  const getCommonIssues = () => {
    if (language === 'hu') {
      return hungarianCommonIssues.map(cat => ({
        ...cat,
        icon: iconMap[cat.icon] || Wrench
      }));
    }
    return commonIssuesEn;
  };
  
  const commonIssues = getCommonIssues();

  // Get translated labels
  const getTranslatedLabels = () => ({
    title: language === 'hu' ? 'Cím' : 'Title',
    roomNumber: language === 'hu' ? 'Szobaszám' : 'Room Number',
    priority: language === 'hu' ? 'Prioritási szint' : 'Priority Level',
    department: language === 'hu' ? 'Részleg' : 'Department',
    hotel: language === 'hu' ? 'Hotel' : 'Hotel',
    description: language === 'hu' ? 'Leírás' : 'Description',
    cancel: language === 'hu' ? 'Mégse' : 'Cancel',
    create: language === 'hu' ? 'Jegy létrehozása' : 'Create Ticket',
    creating: language === 'hu' ? 'Létrehozás...' : 'Creating...',
    selectDepartment: language === 'hu' ? 'Részleg kiválasztása' : 'Select Department',
    selectHotel: language === 'hu' ? 'Hotel kiválasztása' : 'Select Hotel',
    assignTo: language === 'hu' ? 'Hozzárendelés karbantartóhoz' : 'Assign to Maintenance Person',
    optional: language === 'hu' ? 'Opcionális' : 'Optional',
    selectMaintenance: language === 'hu' ? 'Karbantartó kiválasztása...' : 'Select maintenance person...',
    noMaintenanceStaff: language === 'hu' ? 'Nincs elérhető karbantartó' : 'No maintenance staff available',
    commonIssues: language === 'hu' ? 'Gyakori problémák - Kattintson a kiválasztáshoz' : 'Common Issues - Click to Select',
    smartSuggestions: language === 'hu' ? 'Kezdje el gépelni a javaslatok megtekintéséhez...' : 'Start typing to see suggestions...',
    noPermission: language === 'hu' ? 'Nincs jogosultsága jegyek létrehozásához.' : 'You do not have permission to create tickets.',
    createNewTicket: language === 'hu' ? 'Új jegy létrehozása' : 'Create New Ticket',
    submitRequest: language === 'hu' ? 'Küldjön be új karbantartási kérést a szálloda személyzete számára.' : 'Submit a new maintenance request for hotel staff to review and address.',
  });

  const labels = getTranslatedLabels();

  // Get translated departments
  const getDepartments = () => [
    { value: 'maintenance', label: language === 'hu' ? 'Karbantartás' : 'Maintenance' },
    { value: 'housekeeping', label: language === 'hu' ? 'Takarítás' : 'Housekeeping' },
    { value: 'reception', label: language === 'hu' ? 'Recepció' : 'Reception' },
    { value: 'marketing', label: language === 'hu' ? 'Marketing' : 'Marketing' },
    { value: 'back_office', label: language === 'hu' ? 'Back Office' : 'Back Office' },
    { value: 'control', label: language === 'hu' ? 'Ellenőrzés' : 'Control' },
    { value: 'finance', label: language === 'hu' ? 'Pénzügy' : 'Finance' },
    { value: 'top_management', label: language === 'hu' ? 'Vezetőség' : 'Top Management' },
  ];

  const departments = getDepartments();

  // Set hotel from profile when dialog opens - wait for hotels to load
  useEffect(() => {
    if (open && profile?.assigned_hotel && hotels.length > 0) {
      // Find matching hotel from the available hotels list
      const matchingHotel = hotels.find(
        h => h.name === profile.assigned_hotel || 
             h.name.toLowerCase().includes(profile.assigned_hotel?.toLowerCase() || '') ||
             h.id === profile.assigned_hotel
      );
      if (matchingHotel) {
        setFormData(prev => ({ ...prev, hotel: matchingHotel.name }));
      } else {
        // Fallback: use profile's assigned_hotel directly
        setFormData(prev => ({ ...prev, hotel: profile.assigned_hotel || '' }));
      }
    }
  }, [open, profile?.assigned_hotel, hotels]);

  // Fetch maintenance staff when department is maintenance
  useEffect(() => {
    const fetchMaintenanceStaff = async () => {
      if (formData.department !== 'maintenance') {
        setMaintenanceStaff([]);
        return;
      }
      
      try {
        console.log('Fetching maintenance staff for hotel:', formData.hotel);
        
        // Direct query to profiles - more reliable
        let query = supabase
          .from('profiles')
          .select('id, full_name, role, assigned_hotel')
          .eq('role', 'maintenance');
        
        // Add hotel filter if hotel is selected
        if (formData.hotel) {
          // Match hotel name variations
          query = query.or(`assigned_hotel.eq.${formData.hotel},assigned_hotel.ilike.%${formData.hotel}%`);
        }
        
        const { data, error } = await query;
        
        if (error) {
          console.error('Error fetching maintenance staff:', error);
          
          // Fallback: try RPC
          const { data: rpcData, error: rpcError } = await supabase.rpc('get_assignable_staff', {
            hotel_filter: formData.hotel || null
          });
          
          if (!rpcError && rpcData) {
            const maintenanceOnly = (rpcData || []).filter((s: any) => s.role === 'maintenance');
            console.log('RPC maintenance staff:', maintenanceOnly);
            setMaintenanceStaff(maintenanceOnly);
          }
          return;
        }
        
        console.log('Direct query maintenance staff:', data);
        setMaintenanceStaff(data || []);
      } catch (error) {
        console.error('Error fetching maintenance staff:', error);
      }
    };

    fetchMaintenanceStaff();
  }, [formData.department, formData.hotel]);

  // Fetch rooms for autocomplete - fixed query
  useEffect(() => {
    const fetchRooms = async () => {
      if (!formData.hotel) {
        setRooms([]);
        return;
      }
      
      try {
        // Use simple eq filter instead of complex or
        const { data, error } = await supabase
          .from('rooms')
          .select('room_number, hotel')
          .eq('hotel', formData.hotel)
          .order('room_number');
        
        if (error) {
          // Fallback: try ilike
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('rooms')
            .select('room_number, hotel')
            .ilike('hotel', `%${formData.hotel}%`)
            .order('room_number');
          
          if (!fallbackError) {
            setRooms(fallbackData || []);
          }
          return;
        }
        
        setRooms(data || []);
      } catch (error) {
        console.error('Error fetching rooms:', error);
      }
    };

    fetchRooms();
  }, [formData.hotel]);

  // Check ticket creation permission
  useEffect(() => {
    const checkPermission = async () => {
      if (!profile?.id) return;
      
      try {
        const { data, error } = await supabase
          .rpc('has_ticket_creation_permission', { _user_id: profile.id });
        
        if (error) throw error;
        setCanCreateTickets(data);
      } catch (error) {
        console.error('Error checking ticket creation permission:', error);
        // Default to true if check fails
        setCanCreateTickets(true);
      }
    };

    if (open && profile?.id) {
      checkPermission();
    }
  }, [open, profile?.id]);

  // Check if user can select any hotel or only their assigned one
  const canSelectAnyHotel = profile?.role === 'admin' || profile?.role === 'top_management';
  
  // Available hotels based on user permissions
  const availableHotels = canSelectAnyHotel 
    ? hotels.filter(h => h.id !== 'all')
    : hotels.filter(h => h.id !== 'all' && (profile?.assigned_hotel ? h.name === profile.assigned_hotel : true));

  // Filter issues based on search term
  const filteredIssues = commonIssues.map(category => ({
    ...category,
    issues: category.issues.filter(issue => 
      issue.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })).filter(category => category.issues.length > 0);

  // Filter rooms based on input
  const filteredRooms = rooms.filter(r => 
    r.room_number.toLowerCase().startsWith(formData.room_number.toLowerCase()) ||
    r.room_number.toLowerCase().includes(formData.room_number.toLowerCase())
  ).slice(0, 10);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    // Validate required fields
    if (!formData.hotel) {
      toast({
        title: language === 'hu' ? 'Hiba' : 'Error',
        description: language === 'hu' ? 'Kérjük válasszon hotelt' : 'Please select a hotel',
        variant: 'destructive',
      });
      return;
    }
    if (!formData.department) {
      toast({
        title: language === 'hu' ? 'Hiba' : 'Error',
        description: language === 'hu' ? 'Kérjük válasszon részleget' : 'Please select a department',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      console.log('Creating ticket with data:', { ...formData, assigned_to: selectedMaintenancePerson });
      
      // First, create the ticket (without attachments initially)
      const { data: ticketData, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          title: formData.title,
          description: formData.description,
          room_number: formData.room_number,
          priority: formData.priority,
          department: formData.department,
          hotel: formData.hotel,
          created_by: profile.id,
          ticket_number: `TKT-${Date.now()}`,
          attachment_urls: null, // Will update after upload
          assigned_to: selectedMaintenancePerson || null,
          organization_slug: profile.organization_slug
        })
        .select()
        .single();

      if (ticketError) throw ticketError;

      // Upload attachments with the new ticket ID
      if (attachmentRef.current?.hasAttachments()) {
        try {
          const uploadedPaths = await attachmentRef.current.uploadWithTicketId(ticketData.id);
          if (uploadedPaths.length > 0) {
            await supabase
              .from('tickets')
              .update({ attachment_urls: uploadedPaths })
              .eq('id', ticketData.id);
          }
        } catch (uploadError) {
          console.error('Attachment upload error:', uploadError);
          // Don't fail ticket creation if attachment upload fails
        }
      }

      // Send notification to assigned maintenance person if selected
      if (selectedMaintenancePerson) {
        try {
          await supabase.functions.invoke('send-work-assignment-notification', {
            body: {
              staff_id: selectedMaintenancePerson,
              assignment_type: 'ticket',
              assignment_details: {
                id: ticketData.id,
                title: formData.title,
                room_number: formData.room_number,
                priority: formData.priority
              },
              hotel_name: formData.hotel
            }
          });
        } catch (notificationError) {
          console.log('Failed to send notification:', notificationError);
        }
      }

      toast({
        title: language === 'hu' ? 'Siker' : 'Success',
        description: language === 'hu' ? 'Jegy sikeresen létrehozva' : 'Ticket created successfully',
      });

      // Reset form
      setFormData({
        title: '',
        description: '',
        room_number: '',
        priority: 'medium',
        department: '',
        hotel: profile?.assigned_hotel || '',
      });
      setAttachments([]);
      setSearchTerm('');
      setShowSuggestions(false);
      setSelectedMaintenancePerson('');
      
      onTicketCreated();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Ticket creation error:', error);
      toast({
        title: language === 'hu' ? 'Hiba' : 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAttachmentsChange = (newAttachments: string[]) => {
    setAttachments(newAttachments);
  };

  const handleTitleChange = (value: string) => {
    setFormData({ ...formData, title: value });
    setSearchTerm(value);
    setShowSuggestions(value.length > 0);
  };

  const selectSuggestion = (suggestion: string) => {
    setFormData({ ...formData, title: suggestion });
    setSearchTerm('');
    setShowSuggestions(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Star className="h-5 w-5 text-primary" />
            {labels.createNewTicket}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {labels.submitRequest}
          </DialogDescription>
        </DialogHeader>
        
        {!canCreateTickets ? (
          <div className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {labels.noPermission}
            </p>
            <Button 
              onClick={() => onOpenChange(false)} 
              className="mt-4"
              variant="outline"
            >
              {language === 'hu' ? 'Bezárás' : 'Close'}
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <form onSubmit={handleSubmit} className="space-y-6 p-1">
              {/* Title with Smart Suggestions */}
              <div className="space-y-2 relative">
                <Label htmlFor="title" className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4" />
                  {labels.title}
                </Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder={labels.smartSuggestions}
                  required
                  className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                />
                
                {/* Smart Suggestions */}
                {showSuggestions && filteredIssues.length > 0 && (
                  <Card className="absolute top-full left-0 right-0 z-50 mt-1 shadow-lg border-2 border-primary/20">
                    <CardContent className="p-0 max-h-64 overflow-y-auto">
                      <div className="p-3 bg-primary/5 border-b">
                        <p className="text-xs font-medium text-primary flex items-center gap-1">
                          <Star className="h-3 w-3" />
                          {labels.commonIssues}
                        </p>
                      </div>
                      {filteredIssues.map((category) => (
                        <div key={category.category} className="p-2">
                          <div className="flex items-center gap-2 mb-2">
                            <category.icon className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium text-primary">{category.category}</span>
                          </div>
                          <div className="space-y-1">
                            {category.issues.map((issue) => (
                              <button
                                key={issue}
                                type="button"
                                onClick={() => selectSuggestion(issue)}
                                className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors duration-150 border border-transparent hover:border-primary/20"
                              >
                                {issue}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 relative">
                  <Label htmlFor="room_number">{labels.roomNumber}</Label>
                  <Input
                    id="room_number"
                    value={formData.room_number}
                    onChange={(e) => {
                      setFormData({ ...formData, room_number: e.target.value });
                      setShowRoomSuggestions(e.target.value.length > 0);
                    }}
                    onFocus={() => formData.room_number && setShowRoomSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowRoomSuggestions(false), 200)}
                    placeholder={language === 'hu' ? 'pl. 101, Előcsarnok' : 'e.g. 101, Lobby, Kitchen'}
                    required
                    className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                  />
                  {/* Room suggestions dropdown */}
                  {showRoomSuggestions && filteredRooms.length > 0 && (
                    <Card className="absolute top-full left-0 right-0 z-50 mt-1 shadow-lg border max-h-48 overflow-y-auto">
                      <CardContent className="p-2">
                        {filteredRooms.map((room) => (
                          <button
                            key={room.room_number}
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, room_number: room.room_number });
                              setShowRoomSuggestions(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent hover:text-accent-foreground"
                          >
                            {language === 'hu' ? 'Szoba' : 'Room'} {room.room_number}
                          </button>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="priority">{labels.priority}</Label>
                  <Select 
                    value={formData.priority} 
                    onValueChange={(value: 'low' | 'medium' | 'high' | 'urgent') => 
                      setFormData({ ...formData, priority: value })
                    }
                  >
                    <SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-primary/20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(priorityConfig).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full shrink-0 ${config.color}`} />
                            <span className="font-medium">
                              {language === 'hu' ? config.labelHu : config.label}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="department">{labels.department}</Label>
                  <Select 
                    value={formData.department} 
                    onValueChange={(value) => setFormData({ ...formData, department: value })}
                  >
                    <SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-primary/20">
                      <SelectValue placeholder={labels.selectDepartment} />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((dept) => (
                        <SelectItem key={dept.value} value={dept.value}>
                          {dept.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
              </div>

              {/* Maintenance Person Selection - Always show when department is maintenance */}
              {formData.department === 'maintenance' && (
                <div className="space-y-2">
                  <Label htmlFor="maintenance_person">
                    {labels.assignTo}
                    <Badge variant="outline" className="ml-2 text-xs">
                      {labels.optional}
                    </Badge>
                  </Label>
                  <Select 
                    value={selectedMaintenancePerson} 
                    onValueChange={setSelectedMaintenancePerson}
                  >
                    <SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-primary/20">
                      <SelectValue placeholder={maintenanceStaff.length === 0 ? labels.noMaintenanceStaff : labels.selectMaintenance} />
                    </SelectTrigger>
                    <SelectContent>
                      {maintenanceStaff.length === 0 ? (
                        <SelectItem value="none" disabled>
                          {labels.noMaintenanceStaff}
                        </SelectItem>
                      ) : (
                        maintenanceStaff.map((staff) => (
                          <SelectItem key={staff.id} value={staff.id}>
                            {staff.full_name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {language === 'hu' 
                      ? `Válasszon karbantartót innen: ${formData.hotel || 'a hotel'}`
                      : `Select a maintenance person from ${formData.hotel || 'the hotel'}`}
                  </p>
                </div>
              )}

                <div className="space-y-2">
                  <Label htmlFor="hotel">
                    {labels.hotel}
                    {profile?.assigned_hotel && !canSelectAnyHotel && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        {language === 'hu' ? 'Hozzárendelt' : 'Assigned'}: {profile.assigned_hotel}
                      </Badge>
                    )}
                  </Label>
                  <Select 
                    value={formData.hotel} 
                    onValueChange={(value) => setFormData({ ...formData, hotel: value })}
                    disabled={!canSelectAnyHotel && !!profile?.assigned_hotel}
                  >
                    <SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-primary/20">
                      <SelectValue placeholder={labels.selectHotel} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableHotels.map((hotel) => (
                        <SelectItem key={hotel.id} value={hotel.name}>
                          {hotel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">{labels.description}</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={language === 'hu' 
                    ? 'Kérjük, adjon részletes információkat a problémáról...'
                    : 'Please provide detailed information about the issue...'}
                  rows={4}
                  required
                  className="transition-all duration-200 focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              {/* Attachment Upload */}
              <AttachmentUpload
                ref={attachmentRef}
                onAttachmentsChange={handleAttachmentsChange}
                maxFiles={5}
              />

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={loading}
                  className="transition-all duration-200"
                >
                  {labels.cancel}
                </Button>
                <Button 
                  type="submit" 
                  disabled={loading}
                  className="transition-all duration-200 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      {labels.creating}
                    </>
                  ) : (
                    <>
                      <Star className="h-4 w-4 mr-2" />
                      {labels.create}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
