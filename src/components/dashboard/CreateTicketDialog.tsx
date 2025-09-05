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
import { AttachmentUpload, AttachmentFile } from './AttachmentUpload';
import { toast } from '@/hooks/use-toast';
import { hotels } from './HotelFilter';
import { useTranslation } from '@/hooks/useTranslation';
import { Lightbulb, Star, Zap, AlertTriangle, Wrench, Droplet, Thermometer, Bed, Wifi, Utensils, Languages } from 'lucide-react';

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
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [canCreateTickets, setCanCreateTickets] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);
  const [originalTitle, setOriginalTitle] = useState('');
  const [originalDescription, setOriginalDescription] = useState('');
  const attachmentUploadRef = useRef<any>(null);
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

  // Auto-translate text
  const translateText = async (text: string, targetLanguage: string) => {
    if (!text.trim() || targetLanguage === 'en') return text;
    
    try {
      // Simple translation mapping for supported languages
      const translations: { [key: string]: { [key: string]: string } } = {
        hu: {
          'air conditioning not working': 'légkondicionáló nem működik',
          'tv not functioning': 'TV nem működik',
          'light bulbs burned out': 'égő kiégett',
          'wifi connection problems': 'WiFi kapcsolati problémák',
          'leaky faucet': 'csöpögő csap',
          'toilet not flushing': 'WC nem húz',
          'hot water not working': 'melegvíz nem működik',
        },
        es: {
          'air conditioning not working': 'aire acondicionado no funciona',
          'tv not functioning': 'TV no funciona',
          'light bulbs burned out': 'bombillas fundidas',
          'wifi connection problems': 'problemas de conexión WiFi',
          'leaky faucet': 'grifo que gotea',
          'toilet not flushing': 'inodoro no descarga',
          'hot water not working': 'agua caliente no funciona',
        },
        vi: {
          'air conditioning not working': 'điều hòa không hoạt động',
          'tv not functioning': 'TV không hoạt động',
          'light bulbs burned out': 'bóng đèn cháy',
          'wifi connection problems': 'vấn đề kết nối WiFi',
          'leaky faucet': 'vòi nước bị rò rỉ',
          'toilet not flushing': 'toilet không xả nước',
          'hot water not working': 'nước nóng không hoạt động',
        }
      };

      const langMap = translations[targetLanguage];
      if (langMap && langMap[text.toLowerCase()]) {
        return langMap[text.toLowerCase()];
      }
      
      return text; // Return original if no translation found
    } catch (error) {
      console.error('Translation error:', error);
      return text;
    }
  };

  // Check if user can select any hotel or only their assigned one
  const canSelectAnyHotel = profile?.role === 'admin' || profile?.role === 'top_management';
  
  // Available hotels based on user permissions
  const availableHotels = canSelectAnyHotel 
    ? hotels.filter(h => h.id !== 'all')
    : hotels.filter(h => h.id !== 'all' && (profile?.assigned_hotel ? h.name === profile.assigned_hotel : true));

  const departments = [
    { value: 'maintenance', label: t('tickets.department.maintenance') },
    { value: 'housekeeping', label: t('tickets.department.housekeeping') },
    { value: 'reception', label: t('tickets.department.reception') },
    { value: 'marketing', label: t('tickets.department.marketing') },
    { value: 'back_office', label: t('tickets.department.backOffice') },
    { value: 'control', label: t('tickets.department.control') },
    { value: 'finance', label: t('tickets.department.finance') },
    { value: 'top_management', label: t('tickets.department.topManagement') },
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
      // Get attachments from the ref
      const attachments = attachmentUploadRef.current?.getAttachments() || [];
      
      // First, create the ticket without attachments
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
          original_title: originalTitle || formData.title,
          original_description: originalDescription || formData.description,
        })
        .select()
        .single();

      if (ticketError) throw ticketError;

      let uploadedAttachmentUrls: string[] = [];

      // If there are attachments, upload them now using the ticket ID
      if (attachments.length > 0 && ticketData) {
        try {
          uploadedAttachmentUrls = await uploadAttachmentsToStorage(ticketData.id, attachments);
          
          // Update the ticket with attachment URLs
          const { error: updateError } = await supabase
            .from('tickets')
            .update({ 
              attachment_urls: uploadedAttachmentUrls.length > 0 ? uploadedAttachmentUrls : null 
            })
            .eq('id', ticketData.id);

          if (updateError) throw updateError;
        } catch (uploadError) {
          console.error('Attachment upload error:', uploadError);
          toast({
            title: t('common.warning'),
            description: t('tickets.attachmentUploadFailed'),
            variant: 'destructive',
          });
        }
      }

      toast({
        title: t('common.success'),
        description: t('tickets.createSuccess'),
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
      setSearchTerm('');
      setShowSuggestions(false);
      setShowTranslation(false);
      setOriginalTitle('');
      setOriginalDescription('');
      
      onTicketCreated();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Helper function to upload attachments to storage
  const uploadAttachmentsToStorage = async (ticketId: string, attachmentFiles: AttachmentFile[]): Promise<string[]> => {
    const uploadedUrls: string[] = [];

    for (const attachment of attachmentFiles) {
      if (attachment.file) {
        try {
          const fileExt = attachment.file.name.split('.').pop();
          const fileName = `${ticketId}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

          const { data, error } = await supabase.storage
            .from('ticket-attachments')
            .upload(fileName, attachment.file, {
              cacheControl: '3600',
              upsert: false
            });

          if (error) throw error;

          const { data: { publicUrl } } = supabase.storage
            .from('ticket-attachments')
            .getPublicUrl(data.path);

          uploadedUrls.push(publicUrl);
        } catch (error) {
          console.error('Individual file upload error:', error);
        }
      }
    }

    return uploadedUrls;
  };

  const handleTitleChange = async (value: string) => {
    setFormData({ ...formData, title: value });
    setSearchTerm(value);
    setShowSuggestions(value.length > 0);
    
    // Auto-translate if enabled and user language is not English
    if (showTranslation && value && !originalTitle) {
      setOriginalTitle(value);
      const translated = await translateText(value, 'en');
      if (translated !== value) {
        setFormData({ ...formData, title: translated });
      }
    }
  };

  const handleDescriptionChange = async (value: string) => {
    setFormData({ ...formData, description: value });
    
    // Auto-translate if enabled and user language is not English
    if (showTranslation && value && !originalDescription) {
      setOriginalDescription(value);
      const translated = await translateText(value, 'en');
      if (translated !== value) {
        setFormData({ ...formData, description: translated });
      }
    }
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
            {t('tickets.createTitle')}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {t('tickets.createDescription')}
          </DialogDescription>
        </DialogHeader>
        
        {!canCreateTickets ? (
          <div className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {t('tickets.noPermission')}
            </p>
            <Button 
              onClick={() => onOpenChange(false)} 
              className="mt-4"
              variant="outline"
            >
              {t('common.close')}
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <form onSubmit={handleSubmit} className="space-y-6 p-1">
              {/* Auto-translate toggle */}
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Languages className="h-4 w-4 text-primary" />
                  <Label className="text-sm font-medium">{t('tickets.autoTranslate')}</Label>
                </div>
                <Button
                  type="button"
                  variant={showTranslation ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowTranslation(!showTranslation)}
                >
                  {showTranslation ? t('common.on') : t('common.off')}
                </Button>
              </div>

              {/* Title with Smart Suggestions */}
              <div className="space-y-2 relative">
                <Label htmlFor="title" className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4" />
                  {t('tickets.title')}
                </Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder={t('tickets.titlePlaceholder')}
                  required
                  className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                />
                
                {/* Show original text if translated */}
                {showTranslation && originalTitle && originalTitle !== formData.title && (
                  <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded">
                    <strong>{t('tickets.original')}:</strong> {originalTitle}
                  </div>
                )}
                
                {/* Smart Suggestions */}
                {showSuggestions && filteredIssues.length > 0 && (
                  <Card className="absolute top-full left-0 right-0 z-50 mt-1 shadow-lg border-2 border-primary/20">
                    <CardContent className="p-0 max-h-64 overflow-y-auto">
                      <div className="p-3 bg-primary/5 border-b">
                        <p className="text-xs font-medium text-primary flex items-center gap-1">
                          <Star className="h-3 w-3" />
                          {t('tickets.commonIssues')}
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
                  <Label htmlFor="room_number">{t('tickets.roomNumber')}</Label>
                  <Input
                    id="room_number"
                    value={formData.room_number}
                    onChange={(e) => setFormData({ ...formData, room_number: e.target.value })}
                    placeholder={t('tickets.roomNumberPlaceholder')}
                    required
                    className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="priority">{t('tickets.priority')}</Label>
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
                              <div className="font-medium">{t(`tickets.priority.${key}`)}</div>
                              <div className="text-xs text-muted-foreground">{t(`tickets.priority.${key}Description`)}</div>
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
                  <Label htmlFor="department">{t('tickets.department.label')}</Label>
                  <Select 
                    value={formData.department} 
                    onValueChange={(value) => setFormData({ ...formData, department: value })}
                  >
                    <SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-primary/20">
                      <SelectValue placeholder={t('tickets.department.placeholder')} />
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
                    {t('tickets.hotel')}
                    {profile?.assigned_hotel && !canSelectAnyHotel && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        {t('tickets.assigned')}: {profile.assigned_hotel}
                      </Badge>
                    )}
                  </Label>
                  <Select 
                    value={formData.hotel} 
                    onValueChange={(value) => setFormData({ ...formData, hotel: value })}
                    disabled={!canSelectAnyHotel && !!profile?.assigned_hotel}
                  >
                    <SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-primary/20">
                      <SelectValue placeholder={t('tickets.hotelPlaceholder')} />
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
                <Label htmlFor="description">{t('tickets.description')}</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  placeholder={t('tickets.descriptionPlaceholder')}
                  rows={4}
                  required
                  className="transition-all duration-200 focus:ring-2 focus:ring-primary/20 resize-none"
                />
                
                {/* Show original description if translated */}
                {showTranslation && originalDescription && originalDescription !== formData.description && (
                  <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded">
                    <strong>{t('tickets.original')}:</strong> {originalDescription}
                  </div>
                )}
              </div>

              {/* Attachment Upload */}
              <AttachmentUpload
                ref={attachmentUploadRef}
                onAttachmentsChange={() => {}}
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
                  {t('common.cancel')}
                </Button>
                <Button 
                  type="submit" 
                  disabled={loading}
                  className="transition-all duration-200 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      {t('tickets.creating')}
                    </>
                  ) : (
                    <>
                      <Star className="h-4 w-4 mr-2" />
                      {t('tickets.create')}
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