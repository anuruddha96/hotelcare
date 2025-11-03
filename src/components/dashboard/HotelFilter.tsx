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

// Removed static hotels export - now dynamically loaded from tenant context