import { effectiveAccessRole, type AccessSubject } from '@/lib/accessPolicy';
import type { TrainingCurriculum, RoleKey } from '../types';
import { housekeeperCurriculum as baseHousekeeperCurriculum } from './housekeeper';
import { applyHousekeeperUiFixes } from './housekeeperUiFixes';
import { housekeeperAtTheDoorCurriculum } from './housekeeper-at-the-door';
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
import { slntManagerTraining, slntTeamACleanerTraining, slntTeamBCleanerTraining } from './slnt-simplified';

import { visualTopics } from './visualTopics';

const housekeeperCurriculum = applyHousekeeperUiFixes(baseHousekeeperCurriculum);

export const ALL_CURRICULA: TrainingCurriculum[] = [
  slntManagerTraining, slntTeamACleanerTraining, slntTeamBCleanerTraining,
  housekeeperCurriculum,
  housekeeperAtTheDoorCurriculum,
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
  ...visualTopics,
];

export function curriculaForRole(role: RoleKey | string): TrainingCurriculum[] {
  return ALL_CURRICULA
    .filter((c) => c.roles.includes(role as RoleKey))
    .sort((a, b) => a.priority - b.priority);
}

export function findCurriculum(slug: string): TrainingCurriculum | undefined {
  return ALL_CURRICULA.find((c) => c.slug === slug);
}

/** Apply the operational role to the library without granting any feature access. */
export function trainingRoleFor(profile: AccessSubject): string | null {
  const role = profile?.role;
  const access = effectiveAccessRole(profile);
  if (role === 'manager' && access === 'reception') return 'reception_manager';
  if (role === 'manager' && access === 'housekeeping_manager') return 'housekeeping_manager';
  if (access === 'hr') return 'hr';
  if (access === 'controlling') return 'control_finance';
  return role || null;
}
