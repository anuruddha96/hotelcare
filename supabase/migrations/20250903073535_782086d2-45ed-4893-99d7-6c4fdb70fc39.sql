-- Add missing foreign key constraints to room_assignments table
ALTER TABLE public.room_assignments 
ADD CONSTRAINT fk_room_assignments_room_id 
FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE public.room_assignments 
ADD CONSTRAINT fk_room_assignments_assigned_to 
FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.room_assignments 
ADD CONSTRAINT fk_room_assignments_assigned_by 
FOREIGN KEY (assigned_by) REFERENCES public.profiles(id) ON DELETE CASCADE;