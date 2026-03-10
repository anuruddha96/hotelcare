/**
 * Centralized UI hint strings for contextual tooltips.
 * Keys are dot-separated paths by section.
 */
export const UI_HINTS: Record<string, string> = {
  // ── Dashboard main tabs ──
  "tab.tickets": "View and manage maintenance & service requests",
  "tab.rooms": "See all hotel rooms and their current cleaning status",
  "tab.housekeeping": "Manage cleaning staff, room assignments, and approvals",
  "tab.attendance": "Check in/out for your shift and manage breaks",
  "tab.admin": "System-wide settings, hotels, users, and translations",
  "tab.minibar": "View and manage minibar inventory per room",
  "tab.lostFound": "Track lost and found items reported by staff",

  // ── Housekeeping sub-tabs ──
  "hk.staffManagement": "Add, edit, or remove housekeeping staff members",
  "hk.pendingApprovals": "Review and approve completed room cleanings",
  "hk.teamView": "See live progress of all staff and their assigned rooms",
  "hk.performance": "Staff speed, quality rankings, and productivity metrics",
  "hk.pmsUpload": "Import today's room list from your Property Management System",
  "hk.roomPhotos": "View before/after photos taken when rooms are completed",
  "hk.dndPhotos": "Photos taken as proof when a room is marked Do Not Disturb",
  "hk.maintenance": "Photos and reports of maintenance issues found during cleaning",
  "hk.lostFound": "Items found in rooms and reported by housekeeping staff",
  "hk.dirtyLinen": "Track dirty linen counts collected from each room",
  "hk.hrManagement": "View attendance records, check-ins, and working hours",
  "hk.minibar": "Track minibar item placements and expirations per room",
  "hk.tabSettings": "Reorder or hide tabs to customize this view",
  "hk.myTasks": "Your personally assigned rooms and tasks for today",

  // ── Supervisor / Approval view ──
  "approval.rooms": "Room cleanings waiting for your quality check",
  "approval.maintenance": "Maintenance tickets marked as done, pending your review",
  "approval.flagged": "Items with unusually fast or slow completion times",
  "approval.oldest": "How long the oldest item has been waiting for approval",
  "approval.approve": "Confirm cleaning quality is acceptable",
  "approval.reassign": "Send this room back to a different housekeeper",
  "approval.bulkApprove": "Approve all pending rooms for this hotel at once",
  "approval.speedFast": "Completed faster than the realistic minimum — may need inspection",
  "approval.speedNormal": "Completed within the expected time range",
  "approval.speedSlow": "Took significantly longer than expected",
  "approval.duration": "Total time from start to completion (breaks excluded)",
  "approval.waiting": "Minutes since this task was completed and submitted",

  // ── Room overview ──
  "room.act": "Average Cleaning Time — mean duration of all completed cleanings today",
  "room.refresh": "Reload the latest room statuses from the system",
  "room.noShow": "Guest did not arrive — room may not need full cleaning",
  "room.earlyCheckout": "Guest checked out earlier than expected",
  "room.dnd": "Do Not Disturb — guest requested no housekeeping service",
  "room.towelChange": "Towel Change Required — based on guest stay duration",
  "room.linenChange": "Bed Linen Change (LC) — bed linen only, not full room clean",
  "room.rtc": "Ready to Clean — guest has checked out, room is available",
  "room.shabath": "Shabath room — special configuration for religious observance",
  "room.pendingApproval": "Cleaning finished, waiting for supervisor to approve",
  "room.overdue": "Room has been in-progress for over 2 hours — check with staff",
  "room.mapView": "Switch to a visual floor map layout",
  "room.listView": "Switch to the standard list layout",

  // ── Performance ──
  "perf.speed": "How fast rooms are cleaned vs. benchmarks (30 pts)",
  "perf.productivity": "Rooms cleaned per hour of work (25 pts)",
  "perf.punctuality": "How often staff arrive on time (20 pts)",
  "perf.consistency": "Low variance in cleaning times = reliable (15 pts)",
  "perf.quality": "Manager quality ratings given after inspections (10 pts)",
  "perf.timeframe7": "Show data from the last 7 days",
  "perf.timeframe30": "Show data from the last 30 days",
  "perf.timeframe90": "Show data from the last 90 days",

  // ── Attendance ──
  "attendance.checkIn": "Record your shift start time and location",
  "attendance.startBreak": "Begin a timed break — select type first",
  "attendance.endShift": "End your shift and record checkout time",
  "attendance.breakType": "Choose the type of break (lunch, short, etc.)",
  "attendance.breakRequest": "Request a special break from your manager",
};
