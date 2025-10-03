import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Building, ArrowRight, Check } from 'lucide-react';

interface Organization {
  id: string;
  name: string;
  slug: string;
}

export const HotelOnboarding = () => {
  const [step, setStep] = useState(1);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [hotelName, setHotelName] = useState('');
  const [hotelId, setHotelId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchOrganizations();
  }, []);

  const fetchOrganizations = async () => {
    const { data } = await supabase
      .from('organizations')
      .select('id, name, slug')
      .eq('is_active', true)
      .order('name');
    
    setOrganizations(data || []);
  };

  const handleCreateHotel = async () => {
    if (!selectedOrgId || !hotelName || !hotelId) {
      toast.error('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('hotel_configurations')
        .insert({
          organization_id: selectedOrgId,
          hotel_name: hotelName,
          hotel_id: hotelId.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          is_active: true,
          settings: {}
        });

      if (error) throw error;

      toast.success('Hotel created successfully!');
      
      // Reset form
      setStep(1);
      setSelectedOrgId('');
      setHotelName('');
      setHotelId('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create hotel');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Hotel Onboarding</h1>
        <p className="text-muted-foreground">Add a new hotel to the platform</p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-between mb-8">
        {[1, 2, 3].map((s) => (
          <React.Fragment key={s}>
            <div className="flex items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                step >= s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
                {step > s ? <Check className="w-5 h-5" /> : s}
              </div>
              <span className="ml-2 text-sm font-medium">
                {s === 1 ? 'Organization' : s === 2 ? 'Hotel Details' : 'Review'}
              </span>
            </div>
            {s < 3 && <div className="flex-1 h-px bg-border mx-4" />}
          </React.Fragment>
        ))}
      </div>

      <Card className="p-6">
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Select Organization</Label>
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose organization..." />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name} (/{org.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={() => setStep(2)} 
              disabled={!selectedOrgId}
              className="w-full"
            >
              Next <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <Label>Hotel Name</Label>
              <Input
                placeholder="e.g., Hotel Ottofiori"
                value={hotelName}
                onChange={(e) => {
                  setHotelName(e.target.value);
                  if (!hotelId) {
                    setHotelId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                  }
                }}
              />
            </div>
            <div>
              <Label>Hotel ID (URL-friendly)</Label>
              <Input
                placeholder="e.g., ottofiori"
                value={hotelId}
                onChange={(e) => setHotelId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Used for filtering and identification
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                Back
              </Button>
              <Button 
                onClick={() => setStep(3)} 
                disabled={!hotelName || !hotelId}
                className="flex-1"
              >
                Next <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Organization:</span>
                <span className="font-medium">
                  {organizations.find(o => o.id === selectedOrgId)?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Hotel Name:</span>
                <span className="font-medium">{hotelName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Hotel ID:</span>
                <span className="font-medium">{hotelId}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                Back
              </Button>
              <Button 
                onClick={handleCreateHotel}
                disabled={loading}
                className="flex-1"
              >
                <Building className="w-4 h-4 mr-2" />
                Create Hotel
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};