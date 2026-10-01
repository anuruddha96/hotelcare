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

export interface LiveSectionTaskSnapshotRow {
  taskId: string;
  assignedTo: string;
}

/**
 * Null means Auto Assign is creating a new plan and should use the configured
 * recurring-area rules. A Map means some public-area work already has persisted
 * ownership for the selected date. Persisted owners must be preserved, but the
 * snapshot must never suppress other active mapped recurring work.
 *
 * Room assignments and public-area assignments are released independently. A
 * hotel can therefore have live room owners while zero (or only some) public
 * areas have been persisted. Treating an empty/partial snapshot as the complete
 * task catalogue made mapped public areas disappear from Auto Assign.
 *
 * This is deliberately module-local and short-lived. AutoRoomAssignment.tsx
 * primes it before mounting the assignment board and clears it when the modal
 * closes or a fresh, not-yet-assigned date is opened.
 */
let liveSectionTaskSnapshot: Map<string, string> | null = null;

export function setLiveSectionTaskSnapshot(rows: LiveSectionTaskSnapshotRow[]): void {
  liveSectionTaskSnapshot = new Map(
    rows
      .filter(row => !!row.taskId && !!row.assignedTo)
      .map(row => [row.taskId, row.assignedTo]),
  );
}

export function clearLiveSectionTaskSnapshot(): void {
  liveSectionTaskSnapshot = null;
}

/**
 * Give each mapped area's recurring work to the cleaner who owns most of that
 * section's room workload. If a section has no dirty room that day, the least
 * loaded selected cleaner receives it so shared areas are never forgotten.
 *
 * When an existing-date snapshot is present, preserve the owner of every task
 * that is already persisted, then intelligently assign every other active,
 * auto-assigned mapped task using the same section/locality rules as a new plan.
 * Managers may still drag a task afterwards; AutoRoomAssignmentImpl layers that
 * manual move on top of this baseline and persists it only on confirmation.
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
  // Existing public-area ownership is authoritative for that task only. Keep it
  // fixed while filling any mapped recurring work that has not yet been released.
  const persistedTaskIds = new Set<string>();
  if (liveSectionTaskSnapshot !== null) {
    for (const template of activeTemplates) {
      const ownerId = liveSectionTaskSnapshot.get(template.id);
      if (!ownerId) continue;
      const owner = previews.find(preview => preview.staffId === ownerId);
      assignments.push({
        ...template,
        staff_id: ownerId,
        staff_name: owner?.staffName || `Staff ${ownerId.slice(0, 6)}`,
      });
      persistedTaskIds.add(template.id);
      extraMinutes.set(
        ownerId,
        (extraMinutes.get(ownerId) || 0) + Number(template.estimated_duration || 0),
      );
    }
  }

  for (const [sectionId, sectionTasks] of tasksBySection) {
    const unassignedSectionTasks = sectionTasks.filter(task => !persistedTaskIds.has(task.id));
    if (unassignedSectionTasks.length === 0) continue;
    const representative = unassignedSectionTasks[0];

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

    const sectionMinutes = unassignedSectionTasks.reduce(
      (sum, template) => sum + template.estimated_duration,
      0,
    );
    extraMinutes.set(
      owner.staffId,
      (extraMinutes.get(owner.staffId) || 0) + sectionMinutes,
    );

    assignments.push(...unassignedSectionTasks.map(template => ({
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
