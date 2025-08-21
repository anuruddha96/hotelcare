import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const hotels = [
  { id: 'all', name: 'All Hotels' },
  { id: 'memories-budapest', name: 'Hotel Memories Budapest' },
  { id: 'mika-downtown', name: 'Hotel Mika Downtown' },
  { id: 'ottofiori', name: 'Hotel Ottofiori' },
  { id: 'gozsdu-court', name: 'Gozsdu Court Budapest' },
];

interface HotelFilterProps {
  value: string;
  onValueChange: (value: string) => void;
}

export const HotelFilter: React.FC<HotelFilterProps> = ({ value, onValueChange }) => {
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

export { hotels };