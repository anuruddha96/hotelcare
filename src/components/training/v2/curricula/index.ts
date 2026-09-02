import type { TrainingCurriculum, RoleKey } from '../types';
import { housekeeperCurriculum } from './housekeeper';
import { managerOrientationCurriculum } from './manager';
import { managerCompleteCurriculum } from './manager-complete';
import { managerTeamCurriculum } from './manager-team';
import { managerTicketsCurriculum } from './manager-tickets';
import { managerReceptionCurriculum } from './manager-reception';
import { managerAttendanceCurriculum } from './manager-attendance';
import { managerRevenueCurriculum } from './manager-revenue';
import { managerInvoicesCurriculum } from './manager-invoices';
import { autoAssignPromo } from './autoAssignPromo';
import { adminPmsOverviewCurriculum } from './admin-pms-overview';

export const ALL_CURRICULA: TrainingCurriculum[] = [
  housekeeperCurriculum,
  managerCompleteCurriculum,
  managerOrientationCurriculum,
  managerTeamCurriculum,
  managerTicketsCurriculum,
  managerReceptionCurriculum,
  managerAttendanceCurriculum,
  managerRevenueCurriculum,
  managerInvoicesCurriculum,
  autoAssignPromo,
  adminPmsOverviewCurriculum,
];

export function curriculaForRole(role: RoleKey | string): TrainingCurriculum[] {
  return ALL_CURRICULA
    .filter((c) => c.roles.includes(role as RoleKey))
    .sort((a, b) => a.priority - b.priority);
}

export function findCurriculum(slug: string): TrainingCurriculum | undefined {
  return ALL_CURRICULA.find((c) => c.slug === slug);
}
