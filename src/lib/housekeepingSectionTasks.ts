import {
  calculateRoomWeight,
  type AssignmentPreview,
} from './roomAssignmentAlgorithm';

export interface HousekeepingSectionTaskTemplate {
  id: string;
  section_id: string;
  section_name: string;
  floor_number: number;
  task_name: string;
  icon: string;
  estimated_duration: number;
  auto_assign: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface AutoAssignedSectionTask extends HousekeepingSectionTaskTemplate {
  staff_id: string;
  staff_name: string;
}

/**
 * Give each mapped area's recurring work to the cleaner who owns most of that
 * section's room workload. If a section has no dirty room that day, the least
 * loaded selected cleaner receives it so shared areas are never forgotten.
 */
export function assignSectionTasksToStaff(
  previews: AssignmentPreview[],
  templates: HousekeepingSectionTaskTemplate[],
): AutoAssignedSectionTask[] {
  if (previews.length === 0) return [];

  const extraMinutes = new Map(previews.map(preview => [preview.staffId, 0]));
  const activeTemplates = templates
    .filter(template => template.is_active && template.auto_assign)
    .sort((a, b) =>
      a.floor_number - b.floor_number
      || a.section_name.localeCompare(b.section_name)
      || a.sort_order - b.sort_order
      || a.task_name.localeCompare(b.task_name)
    );

  const tasksBySection = new Map<string, HousekeepingSectionTaskTemplate[]>();
  for (const template of activeTemplates) {
    const sectionTasks = tasksBySection.get(template.section_id) || [];
    sectionTasks.push(template);
    tasksBySection.set(template.section_id, sectionTasks);
  }

  const assignments: AutoAssignedSectionTask[] = [];
  for (const [sectionId, sectionTasks] of tasksBySection) {
    const representative = sectionTasks[0];

    const localCandidates = previews
      .map(preview => {
        const localRooms = preview.rooms.filter(
          room => room.housekeeping_section_id === sectionId,
        );
        return {
          preview,
          roomCount: localRooms.length,
          roomWeight: localRooms.reduce((sum, room) => sum + calculateRoomWeight(room), 0),
        };
      })
      .filter(candidate => candidate.roomCount > 0)
      .sort((a, b) =>
        b.roomWeight - a.roomWeight
        || b.roomCount - a.roomCount
        || a.preview.totalWithBreak - b.preview.totalWithBreak
        || a.preview.staffName.localeCompare(b.preview.staffName)
      );

    const owner = localCandidates[0]?.preview
      || [...previews].sort((a, b) =>
        (a.totalWithBreak + (extraMinutes.get(a.staffId) || 0))
          - (b.totalWithBreak + (extraMinutes.get(b.staffId) || 0))
        || a.staffName.localeCompare(b.staffName)
      )[0];

    const sectionMinutes = sectionTasks.reduce(
      (sum, template) => sum + template.estimated_duration,
      0,
    );
    extraMinutes.set(
      owner.staffId,
      (extraMinutes.get(owner.staffId) || 0) + sectionMinutes,
    );

    assignments.push(...sectionTasks.map(template => ({
      ...template,
      section_name: representative.section_name,
      staff_id: owner.staffId,
      staff_name: owner.staffName,
    })));
  }

  return assignments;
}

export function sectionTaskMinutesForStaff(
  assignments: AutoAssignedSectionTask[],
  staffId: string,
): number {
  return assignments
    .filter(assignment => assignment.staff_id === staffId)
    .reduce((sum, assignment) => sum + assignment.estimated_duration, 0);
}
