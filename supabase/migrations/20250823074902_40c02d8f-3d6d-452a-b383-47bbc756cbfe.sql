-- Insert category data for all departments
INSERT INTO public.ticket_categories (department, category_key, category_name, sub_category_key, sub_category_name, sub_sub_category_key, sub_sub_category_name) VALUES
-- Maintenance categories
('maintenance', 'paint-request', 'Paint Request', 'interior-paint', 'Interior Paint', 'wall-paint', 'Wall Paint'),
('maintenance', 'paint-request', 'Paint Request', 'interior-paint', 'Interior Paint', 'ceiling-paint', 'Ceiling Paint'),
('maintenance', 'paint-request', 'Paint Request', 'interior-paint', 'Interior Paint', 'trim-paint', 'Trim Paint'),
('maintenance', 'paint-request', 'Paint Request', 'exterior-paint', 'Exterior Paint', 'facade-paint', 'Facade Paint'),
('maintenance', 'paint-request', 'Paint Request', 'exterior-paint', 'Exterior Paint', 'balcony-paint', 'Balcony Paint'),
('maintenance', 'room-issues', 'Room Issues', 'room-equipment', 'Room Equipment', 'tv-issues', 'TV Issues'),
('maintenance', 'room-issues', 'Room Issues', 'room-equipment', 'Room Equipment', 'ac-issues', 'A/C Issues'),
('maintenance', 'room-issues', 'Room Issues', 'room-equipment', 'Room Equipment', 'lighting', 'Lighting Issues'),
('maintenance', 'room-issues', 'Room Issues', 'room-equipment', 'Room Equipment', 'furniture', 'Furniture Issues'),
('maintenance', 'room-issues', 'Room Issues', 'bathroom-issues', 'Bathroom Issues', 'plumbing', 'Plumbing'),
('maintenance', 'room-issues', 'Room Issues', 'bathroom-issues', 'Bathroom Issues', 'fixtures', 'Fixtures'),
('maintenance', 'room-issues', 'Room Issues', 'bathroom-issues', 'Bathroom Issues', 'ventilation', 'Ventilation'),
('maintenance', 'room-issues', 'Room Issues', 'fire-alarm', 'Fire Alarm', 'detector-issues', 'Detector Issues'),
('maintenance', 'room-issues', 'Room Issues', 'fire-alarm', 'Fire Alarm', 'false-alarms', 'False Alarms'),
('maintenance', 'gym-issues', 'Gym Issues', 'equipment', 'Equipment', 'cardio', 'Cardio Equipment'),
('maintenance', 'gym-issues', 'Gym Issues', 'equipment', 'Equipment', 'weights', 'Weight Equipment'),
('maintenance', 'restaurant-issues', 'Restaurant Issues', 'kitchen', 'Kitchen Equipment', 'appliances', 'Appliances'),
('maintenance', 'restaurant-issues', 'Restaurant Issues', 'kitchen', 'Kitchen Equipment', 'hvac', 'HVAC'),

-- Housekeeping categories
('housekeeping', 'cleaning-supplies', 'Cleaning Supplies', 'chemicals', 'Chemicals', 'sanitizers', 'Sanitizers'),
('housekeeping', 'cleaning-supplies', 'Cleaning Supplies', 'chemicals', 'Chemicals', 'detergents', 'Detergents'),
('housekeeping', 'linen-laundry', 'Linen & Laundry', 'bed-linen', 'Bed Linen', 'sheets', 'Sheets'),
('housekeeping', 'linen-laundry', 'Linen & Laundry', 'bed-linen', 'Bed Linen', 'pillows', 'Pillows'),
('housekeeping', 'room-service', 'Room Service', 'amenities', 'Amenities', 'toiletries', 'Toiletries'),
('housekeeping', 'room-service', 'Room Service', 'amenities', 'Amenities', 'minibar', 'Minibar'),

-- Reception categories
('reception', 'guest-requests', 'Guest Requests', 'concierge', 'Concierge', 'transportation', 'Transportation'),
('reception', 'guest-requests', 'Guest Requests', 'concierge', 'Concierge', 'reservations', 'Reservations'),
('reception', 'check-in-out', 'Check-in/Check-out', 'system-issues', 'System Issues', 'pms', 'PMS Issues'),
('reception', 'check-in-out', 'Check-in/Check-out', 'system-issues', 'System Issues', 'key-cards', 'Key Card Issues'),

-- Marketing categories
('marketing', 'promotions', 'Promotions', 'campaigns', 'Campaigns', 'digital', 'Digital Marketing'),
('marketing', 'promotions', 'Promotions', 'campaigns', 'Campaigns', 'print', 'Print Materials'),
('marketing', 'events', 'Events', 'planning', 'Event Planning', 'weddings', 'Weddings'),
('marketing', 'events', 'Events', 'planning', 'Event Planning', 'conferences', 'Conferences'),

-- Control & Finance categories
('control_finance', 'accounting', 'Accounting', 'billing', 'Billing', 'invoices', 'Invoices'),
('control_finance', 'accounting', 'Accounting', 'billing', 'Billing', 'payments', 'Payments'),
('control_finance', 'budgeting', 'Budgeting', 'forecasting', 'Forecasting', 'revenue', 'Revenue Forecast'),
('control_finance', 'budgeting', 'Budgeting', 'forecasting', 'Forecasting', 'expenses', 'Expense Planning'),

-- HR categories
('hr', 'recruitment', 'Recruitment', 'hiring', 'Hiring', 'interviews', 'Interviews'),
('hr', 'recruitment', 'Recruitment', 'hiring', 'Hiring', 'onboarding', 'Onboarding'),
('hr', 'training', 'Training', 'staff-dev', 'Staff Development', 'skills', 'Skills Training'),
('hr', 'training', 'Training', 'staff-dev', 'Staff Development', 'compliance', 'Compliance Training'),

-- Front Office categories
('front_office', 'reservations', 'Reservations', 'booking', 'Booking', 'modifications', 'Modifications'),
('front_office', 'reservations', 'Reservations', 'booking', 'Booking', 'cancellations', 'Cancellations'),
('front_office', 'guest-services', 'Guest Services', 'complaints', 'Complaints', 'service', 'Service Issues'),
('front_office', 'guest-services', 'Guest Services', 'complaints', 'Complaints', 'facilities', 'Facility Issues'),

-- Top Management categories
('top_management', 'strategic-planning', 'Strategic Planning', 'operations', 'Operations', 'efficiency', 'Efficiency Improvements'),
('top_management', 'strategic-planning', 'Strategic Planning', 'operations', 'Operations', 'quality', 'Quality Control'),
('top_management', 'compliance', 'Compliance', 'regulations', 'Regulations', 'health-safety', 'Health & Safety'),
('top_management', 'compliance', 'Compliance', 'regulations', 'Regulations', 'licensing', 'Licensing');