import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Industry best practices for hotel service requests by department
interface CategoryDefinition {
  name: string;
  subCategories?: Record<string, {
    name: string;
    subSubCategories?: Record<string, string>;
  }>;
}

const categoryData: Record<string, { categories: Record<string, CategoryDefinition> }> = {
  maintenance: {
    categories: {
      'paint-request': {
        name: 'Paint Request',
        subCategories: {
          'interior-paint': { name: 'Interior Paint', subSubCategories: { 'wall-paint': 'Wall Paint', 'ceiling-paint': 'Ceiling Paint', 'trim-paint': 'Trim Paint' } },
          'exterior-paint': { name: 'Exterior Paint', subSubCategories: { 'facade-paint': 'Facade Paint', 'balcony-paint': 'Balcony Paint' } }
        }
      },
      'room-issues': {
        name: 'Room Issues',
        subCategories: {
          'room-equipment': { name: 'Room Equipment', subSubCategories: { 'tv-issues': 'TV Issues', 'ac-issues': 'A/C Issues', 'lighting': 'Lighting Issues', 'furniture': 'Furniture Issues' } },
          'bathroom-issues': { name: 'Bathroom Issues', subSubCategories: { 'plumbing': 'Plumbing', 'fixtures': 'Fixtures', 'ventilation': 'Ventilation' } },
          'fire-alarm': { name: 'Fire Alarm', subSubCategories: { 'detector-issues': 'Detector Issues', 'false-alarms': 'False Alarms' } }
        }
      },
      'gym-issues': { name: 'Gym Issues', subCategories: { 'equipment': { name: 'Equipment', subSubCategories: { 'cardio': 'Cardio Equipment', 'weights': 'Weight Equipment' } } } },
      'restaurant-issues': { name: 'Restaurant Issues', subCategories: { 'kitchen': { name: 'Kitchen Equipment', subSubCategories: { 'appliances': 'Appliances', 'hvac': 'HVAC' } } } }
    }
  },
  housekeeping: {
    categories: {
      'cleaning-supplies': { name: 'Cleaning Supplies', subCategories: { 'chemicals': { name: 'Chemicals', subSubCategories: { 'sanitizers': 'Sanitizers', 'detergents': 'Detergents' } } } },
      'linen-laundry': { name: 'Linen & Laundry', subCategories: { 'bed-linen': { name: 'Bed Linen', subSubCategories: { 'sheets': 'Sheets', 'pillows': 'Pillows' } } } },
      'room-service': { name: 'Room Service', subCategories: { 'amenities': { name: 'Amenities', subSubCategories: { 'toiletries': 'Toiletries', 'minibar': 'Minibar' } } } }
    }
  },
  reception: {
    categories: {
      'guest-requests': { name: 'Guest Requests', subCategories: { 'concierge': { name: 'Concierge', subSubCategories: { 'transportation': 'Transportation', 'reservations': 'Reservations' } } } },
      'check-in-out': { name: 'Check-in/Check-out', subCategories: { 'system-issues': { name: 'System Issues', subSubCategories: { 'pms': 'PMS Issues', 'key-cards': 'Key Card Issues' } } } }
    }
  },
  marketing: {
    categories: {
      'promotions': { name: 'Promotions', subCategories: { 'campaigns': { name: 'Campaigns', subSubCategories: { 'digital': 'Digital Marketing', 'print': 'Print Materials' } } } },
      'events': { name: 'Events', subCategories: { 'planning': { name: 'Event Planning', subSubCategories: { 'weddings': 'Weddings', 'conferences': 'Conferences' } } } }
    }
  },
  control_finance: {
    categories: {
      'accounting': { name: 'Accounting', subCategories: { 'billing': { name: 'Billing', subSubCategories: { 'invoices': 'Invoices', 'payments': 'Payments' } } } },
      'budgeting': { name: 'Budgeting', subCategories: { 'forecasting': { name: 'Forecasting', subSubCategories: { 'revenue': 'Revenue Forecast', 'expenses': 'Expense Planning' } } } }
    }
  },
  hr: {
    categories: {
      'recruitment': { name: 'Recruitment', subCategories: { 'hiring': { name: 'Hiring', subSubCategories: { 'interviews': 'Interviews', 'onboarding': 'Onboarding' } } } },
      'training': { name: 'Training', subCategories: { 'staff-dev': { name: 'Staff Development', subSubCategories: { 'skills': 'Skills Training', 'compliance': 'Compliance Training' } } } }
    }
  },
  front_office: {
    categories: {
      'reservations': { name: 'Reservations', subCategories: { 'booking': { name: 'Booking', subSubCategories: { 'modifications': 'Modifications', 'cancellations': 'Cancellations' } } } },
      'guest-services': { name: 'Guest Services', subCategories: { 'complaints': { name: 'Complaints', subSubCategories: { 'service': 'Service Issues', 'facilities': 'Facility Issues' } } } }
    }
  }
};

interface CategorySelectorProps {
  userRole: string;
  onSelectionChange: (category: string, subCategory: string, subSubCategory: string) => void;
}

export const CategorySelector: React.FC<CategorySelectorProps> = ({
  userRole,
  onSelectionChange,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('');
  const [selectedSubSubCategory, setSelectedSubSubCategory] = useState<string>('');

  const categories = categoryData[userRole as keyof typeof categoryData]?.categories || {};

  const handleCategoryChange = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setSelectedSubCategory('');
    setSelectedSubSubCategory('');
    onSelectionChange(categoryId, '', '');
  };

  const handleSubCategoryChange = (subCategoryId: string) => {
    setSelectedSubCategory(subCategoryId);
    setSelectedSubSubCategory('');
    onSelectionChange(selectedCategory, subCategoryId, '');
  };

  const handleSubSubCategoryChange = (subSubCategoryId: string) => {
    setSelectedSubSubCategory(subSubCategoryId);
    onSelectionChange(selectedCategory, selectedSubCategory, subSubCategoryId);
  };

  const currentCategory = categories[selectedCategory];
  const currentSubCategories = currentCategory?.subCategories || {};
  const currentSubSubCategories = currentSubCategories[selectedSubCategory]?.subSubCategories || {};

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2">Issue Category</label>
        <Select value={selectedCategory} onValueChange={handleCategoryChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(categories).map(([key, category]) => (
              <SelectItem key={key} value={key}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {Object.keys(currentSubCategories).length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-2">Sub Category</label>
          <Select value={selectedSubCategory} onValueChange={handleSubCategoryChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select sub-category" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(currentSubCategories).map(([key, subCategory]) => (
                <SelectItem key={key} value={key}>
                  {subCategory.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {Object.keys(currentSubSubCategories).length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-2">Specific Issue</label>
          <Select value={selectedSubSubCategory} onValueChange={handleSubSubCategoryChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select specific issue" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(currentSubSubCategories).map(([key, subSubCategory]) => (
                <SelectItem key={key} value={key}>
                  {subSubCategory}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
};