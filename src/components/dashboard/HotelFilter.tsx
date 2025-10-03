import React, { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTenant } from '@/contexts/TenantContext';

interface HotelFilterProps {
  value: string;
  onValueChange: (value: string) => void;
}

export const HotelFilter: React.FC<HotelFilterProps> = ({ value, onValueChange }) => {
  const { hotels: tenantHotels, loading } = useTenant();
  
  // Build hotels list with "All Hotels" option
  const hotels = [
    { id: 'all', name: 'All Hotels' },
    ...tenantHotels.map(h => ({ id: h.hotel_id, name: h.hotel_name }))
  ];

  if (loading) {
    return (
      <Select disabled>
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Loading hotels..." />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Select Hotel" />
      </SelectTrigger>
      <SelectContent>
        {hotels.map((hotel) => (
          <SelectItem key={hotel.id} value={hotel.id}>
            {hotel.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// Export for backward compatibility - will be dynamically loaded
export const hotels = [
  { id: 'all', name: 'All Hotels' },
  { id: 'memories-budapest', name: 'Hotel Memories Budapest' },
  { id: 'mika-downtown', name: 'Hotel Mika Downtown' },
  { id: 'ottofiori', name: 'Hotel Ottofiori' },
  { id: 'gozsdu-court', name: 'Gozsdu Court Budapest' },
];