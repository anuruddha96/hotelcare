import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read=(name:string)=>readFileSync(resolve(process.cwd(),name),'utf8');

describe('Hotel Ottofiori-only cross-property maintenance assignment',()=>{
  const sql = read('supabase/migrations/20261015115000_ottofiori_cross_property_maintenance.sql');
  it('only lets this property managers and top management assign RD Hotels maintenance users',()=>{
    expect(sql).toContain("p.organization_slug = 'rdhotels'");
    expect(sql).toContain("p.role::text IN ('manager','top_management_manager')");
    expect(sql).toContain("public.get_hotel_name_from_id(p.assigned_hotel) = 'Hotel Ottofiori'");
    expect(sql).toContain("p.role::text = 'top_management'");
    expect(sql).toContain("p.role::text IN ('maintenance','maintenance_manager')");
    expect(sql).toContain("AND deleted_at IS NULL");
    expect(sql).toContain("p_expected_updated_at");
    expect(sql).toContain("assignment_method='manual'");
    expect(sql).toContain("[Maintenance assignment]");
  });
  it('grants only explicitly assigned Ottofiori tickets, photos, comments, and safe room checks',()=>{
    expect(sql).toContain('Explicit Ottofiori maintenance assignee can read their issue');
    expect(sql).toContain('assigned_to=auth.uid()');
    expect(sql).toContain("t.assigned_to = p.id");
    expect(sql).toContain("v_ticket.assigned_to = v_user.id");
    expect(sql).toContain("v_ticket.organization_slug = 'rdhotels'");
    expect(sql).toContain("v_ticket.hotel");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.work_maintenance_ticket');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_maintenance_room_access');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.user_can_view_ticket');
    expect(sql).not.toContain('DROP POLICY "Users can view tickets based on access config"');
  });
  it('shows off-property assignments in technician task feed and highlights the destination',()=>{
    const src=read('src/components/dashboard/MaintenanceStaffView.tsx');
    expect(src).toContain(".eq('assigned_to', user.id)");
    expect(src).toContain(".in('hotel', ['ottofiori', 'Hotel Ottofiori'])");
    expect(src).toContain("Other property assignment · Go to Hotel Ottofiori");
    expect(src).toContain('ring-2 ring-sky-200');
    const dashboard=read('src/components/dashboard/Dashboard.tsx');
    expect(dashboard).toContain('foreignActiveQuery');
    expect(dashboard).toContain('foreignDoneQuery');
    expect(dashboard).toContain("profile.role === 'maintenance'");
    expect(read('src/components/dashboard/TicketCard.tsx')).toContain('HOTEL OTTOFIORI');
  });
  it('uses a dedicated permission-checked assignment action instead of global update',()=>{
    const detail=read('src/components/dashboard/TicketDetailDialog.tsx');
    const component=read('src/components/dashboard/OttofioriMaintenanceAssignment.tsx');
    expect(detail).toContain('<OttofioriMaintenanceAssignment ticket={ticket}');
    expect(detail).toContain("!(ticket.department === 'maintenance' && isOttofiori(ticket.hotel))");
    expect(component).toContain("rpc('assign_ottofiori_maintenance_ticket'");
    expect(component).toContain("rpc('get_ottofiori_maintenance_candidates'");
    expect(component).toContain('p_expected_updated_at: ticket.updated_at');
    expect(component).toContain('Hotel Ottofiori');
    expect(read('src/components/dashboard/AutoAssignmentService.tsx')).toContain('Assigned at another hotel: HOTEL OTTOFIORI');
  });
});
