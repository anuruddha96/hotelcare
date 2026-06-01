import type { TrainingCurriculum, RoleKey } from '../types';
import { housekeeperCurriculum } from './housekeeper';
import { managerCurriculum } from './manager';
import { autoAssignPromo } from './autoAssignPromo';

export const ALL_CURRICULA: TrainingCurriculum[] = [
  housekeeperCurriculum,
  managerCurriculum,
  autoAssignPromo,
];

export function curriculaForRole(role: RoleKey | string): TrainingCurriculum[] {
  return ALL_CURRICULA
    .filter((c) => c.roles.includes(role as RoleKey))
    .sort((a, b) => a.priority - b.priority);
}

export function findCurriculum(slug: string): TrainingCurriculum | undefined {
  return ALL_CURRICULA.find((c) => c.slug === slug);
}
