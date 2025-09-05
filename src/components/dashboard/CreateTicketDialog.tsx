import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
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
import { AttachmentUpload } from './AttachmentUpload';
import { toast } from '@/hooks/use-toast';
import { hotels } from './HotelFilter';
import { Lightbulb, Star, Zap, AlertTriangle, Wrench, Droplet, Thermometer, Bed, Wifi, Utensils } from 'lucide-react';

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketCreated: () => void;
}

// Common hotel issues with icons and categories
const commonIssues = [
  { category: 'Room Issues', icon: Bed, issues: [
    'Air conditioning not working',
    'TV not functioning',
    'Light bulbs burned out',
    'WiFi connection problems',
    'Safe not working',
    'Door lock issues',
    'Window won\'t open/close'
  ]},
  { category: 'Plumbing', icon: Droplet, issues: [
    'Leaky faucet',
    'Toilet not flushing',
    'Low water pressure',
    'Shower drain clogged',
    'Hot water not working',
    'Bathroom flooding'
  ]},
  { category: 'Electrical', icon: Zap, issues: [
    'Power outlet not working',
    'Lights flickering',
    'Circuit breaker tripped',
    'Electrical sparks',
    'Fan not working'
  ]},
  { category: 'HVAC', icon: Thermometer, issues: [
    'Room too hot/cold',
    'Heating not working',
    'Strange noises from AC',
    'Air vents blocked',
    'Thermostat malfunction'
  ]},
  { category: 'Maintenance', icon: Wrench, issues: [
    'Furniture damage',
    'Paint peeling',
    'Carpet stains',
    'Ceiling leak',
    'Wall cracks',
    'Mirror broken'
  ]},
  { category: 'Kitchen/Restaurant', icon: Utensils, issues: [
    'Refrigerator not cooling',
    'Stove not working',
    'Dishwasher malfunction',
    'Freezer temperature issues',
    'Exhaust fan broken'
  ]}
];

const priorityConfig = {
  low: { color: 'bg-green-500', label: 'Low', description: 'Non-urgent, can wait' },
  medium: { color: 'bg-yellow-500', label: 'Medium', description: 'Standard priority' },
  high: { color: 'bg-orange-500', label: 'High', description: 'Needs attention soon' },
  urgent: { color: 'bg-red-500', label: 'Urgent', description: 'Immediate attention required' }
};

export function CreateTicketDialog({ open, onOpenChange, onTicketCreated }: CreateTicketDialogProps) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [canCreateTickets, setCanCreateTickets] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    room_number: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    department: '',
    hotel: profile?.assigned_hotel || '',
  });

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
        setCanCreateTickets(false);
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

  const departments = [
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'housekeeping', label: 'Housekeeping' },
    { value: 'reception', label: 'Reception' },
    { value: 'marketing', label: 'Marketing' },
    { value: 'back_office', label: 'Back Office' },
    { value: 'control', label: 'Control' },
    { value: 'finance', label: 'Finance' },
    { value: 'top_management', label: 'Top Management' },
  ];

  // Filter issues based on search term
  const filteredIssues = commonIssues.map(category => ({
    ...category,
    issues: category.issues.filter(issue => 
      issue.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })).filter(category => category.issues.length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setLoading(true);
    try {
      // First, create the ticket
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
          ticket_number: '', // Will be auto-generated by trigger
          attachment_urls: attachments.length > 0 ? attachments : null,
        })
        .select()
        .single();

      if (ticketError) throw ticketError;

      toast({
        title: 'Success',
        description: 'Ticket created successfully',
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
      
      onTicketCreated();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Error',
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
            Create New Ticket
          </DialogTitle>
          <DialogDescription className="text-sm">
            Submit a new maintenance request for hotel staff to review and address.
          </DialogDescription>
        </DialogHeader>
        
        {!canCreateTickets ? (
          <div className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              You do not have permission to create tickets. Please contact your administrator.
            </p>
            <Button 
              onClick={() => onOpenChange(false)} 
              className="mt-4"
              variant="outline"
            >
              Close
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <form onSubmit={handleSubmit} className="space-y-6 p-1">
              {/* Title with Smart Suggestions */}
              <div className="space-y-2 relative">
                <Label htmlFor="title" className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4" />
                  Title
                </Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="Start typing to see suggestions..."
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
                          Common Issues - Click to Select
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
                <div className="space-y-2">
                  <Label htmlFor="room_number">Room Number</Label>
                  <Input
                    id="room_number"
                    value={formData.room_number}
                    onChange={(e) => setFormData({ ...formData, room_number: e.target.value })}
                    placeholder="e.g. 101, Lobby, Kitchen"
                    required
                    className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="priority">Priority Level</Label>
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
                            <div className={`w-3 h-3 rounded-full ${config.color}`} />
                            <div>
                              <div className="font-medium">{config.label}</div>
                              <div className="text-xs text-muted-foreground">{config.description}</div>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <Select 
                    value={formData.department} 
                    onValueChange={(value) => setFormData({ ...formData, department: value })}
                  >
                    <SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-primary/20">
                      <SelectValue placeholder="Select Department" />
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

                <div className="space-y-2">
                  <Label htmlFor="hotel">
                    Hotel
                    {profile?.assigned_hotel && !canSelectAnyHotel && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        Assigned: {profile.assigned_hotel}
                      </Badge>
                    )}
                  </Label>
                  <Select 
                    value={formData.hotel} 
                    onValueChange={(value) => setFormData({ ...formData, hotel: value })}
                    disabled={!canSelectAnyHotel && !!profile?.assigned_hotel}
                  >
                    <SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-primary/20">
                      <SelectValue placeholder="Select Hotel" />
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
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Please provide detailed information about the issue, including any relevant details that will help our maintenance team resolve it quickly..."
                  rows={4}
                  required
                  className="transition-all duration-200 focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              {/* Attachment Upload */}
              <AttachmentUpload
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
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={loading}
                  className="transition-all duration-200 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Star className="h-4 w-4 mr-2" />
                      Create Ticket
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