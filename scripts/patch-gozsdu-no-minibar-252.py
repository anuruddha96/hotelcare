#!/usr/bin/env python3
"""One-time guarded patch on an isolated branch; never runs in production."""
from pathlib import Path


def change(path: str, original: str, replacement: str) -> None:
    file = Path(path)
    content = file.read_text()
    count = content.count(original)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one patch anchor, found {count}: {original[:90]!r}')
    file.write_text(content.replace(original, replacement, 1))


policy = '''import { isGozsduCourtHotel } from './gozsdu-housekeeping';

/** Both the selected property AND the actual room must be Gozsdu.
 * Never suppress another hotel's controls based only on a stale room card. */
export function isGozsduNoMinibarRoom(
  selectedHotel: string | null | undefined,
  roomHotel: string | null | undefined,
): boolean {
  return isGozsduCourtHotel(selectedHotel) && isGozsduCourtHotel(roomHotel);
}

const STANDARD_DAILY_PHOTOS = ['trash_bin', 'bathroom', 'bed', 'minibar', 'tea_coffee_table'] as const;

export function requiredDailyPhotoCategories(
  selectedHotel: string | null | undefined,
  roomHotel: string | null | undefined,
): readonly string[] {
  return isGozsduNoMinibarRoom(selectedHotel, roomHotel)
    ? STANDARD_DAILY_PHOTOS.filter(category => category !== 'minibar')
    : STANDARD_DAILY_PHOTOS;
}
'''
Path('src/lib/gozsduNoMinibar.ts').write_text(policy)
Path('src/lib/gozsduNoMinibar.test.ts').write_text('''import { describe, expect, it } from 'vitest';
import { isGozsduNoMinibarRoom, requiredDailyPhotoCategories } from './gozsduNoMinibar';

describe('Gozsdu-only minibar policy', () => {
  it('matches exact property ID and display name aliases', () => {
    expect(isGozsduNoMinibarRoom('gozsdu-court', 'Gozsdu Court Budapest')).toBe(true);
    expect(isGozsduNoMinibarRoom('Gozsdu Court Budapest', 'gozsdu-court')).toBe(true);
    expect(isGozsduNoMinibarRoom('gozsdu-court', 'Hotel Mika Downtown')).toBe(false);
    expect(isGozsduNoMinibarRoom('Hotel Memories Budapest', 'gozsdu-court')).toBe(false);
    expect(isGozsduNoMinibarRoom(null, 'gozsdu-court')).toBe(false);
    expect(isGozsduNoMinibarRoom('gozsdu-court-other', 'gozsdu-court')).toBe(false);
  });

  it('keeps four non-minibar photos for Gozsdu and five for all other hotels', () => {
    expect(requiredDailyPhotoCategories('gozsdu-court', 'Gozsdu Court Budapest'))
      .toEqual(['trash_bin', 'bathroom', 'bed', 'tea_coffee_table']);
    expect(requiredDailyPhotoCategories('memories-budapest', 'Hotel Memories Budapest'))
      .toEqual(['trash_bin', 'bathroom', 'bed', 'minibar', 'tea_coffee_table']);
    expect(requiredDailyPhotoCategories('gozsdu-court', 'Hotel Ottofiori')).toContain('minibar');
  });
});
''')

card = 'src/components/dashboard/AssignedRoomCardLegacy.tsx'
change(card, "import React, { useState, useEffect } from 'react';", "import React, { useState, useEffect, useRef } from 'react';")
change(card, "import { todayBudapest } from '@/lib/budapestTime';", "import { todayBudapest } from '@/lib/budapestTime';\nimport { isGozsduNoMinibarRoom, requiredDailyPhotoCategories } from '@/lib/gozsduNoMinibar';")
change(card, "  const { toast: showToast } = useToast();", "  const { toast: showToast } = useToast();\n  const noMinibar = isGozsduNoMinibarRoom(profile?.assigned_hotel, assignment.rooms?.hotel);\n  const completionInFlight = useRef(false);")
change(card, "      const requiredCategories = ['trash_bin', 'bathroom', 'bed', 'minibar', 'tea_coffee_table'];", "      const requiredCategories = requiredDailyPhotoCategories(profile?.assigned_hotel, assignment.rooms?.hotel);")
change(card, "  const handleRetrieveDNDRoom = async () => {", "  // At Gozsdu a staff member finishes through the normal completion/status path\n  // without the shared linen/minibar confirmation. HoldButton can fire click\n  // and hold callbacks; this synchronous guard prevents duplicate submission.\n  const handleCompleteRequest = () => {\n    if (loading || completionInFlight.current || assignment.status !== 'in_progress') return;\n    if (!noMinibar) { setPreCompleteOpen(true); return; }\n    completionInFlight.current = true;\n    void updateAssignmentStatus('completed').finally(() => { completionInFlight.current = false; });\n  };\n\n  const handleRetrieveDNDRoom = async () => {")
change(card, "                  <button\n                    type=\"button\"\n                    onClick={() => setRoomDetailOpen(true)}\n                    className={`${tileBase} border-border`}\n                  >", "                  {!noMinibar && <button\n                    type=\"button\"\n                    onClick={() => setRoomDetailOpen(true)}\n                    className={`${tileBase} border-border`}\n                  >")
change(card, "                    <span className={label}>{t('actions.minibar')}</span>\n                  </button>", "                    <span className={label}>{t('actions.minibar')}</span>\n                  </button>}")
change(card, "                  onClick={() => setPreCompleteOpen(true)}\n                  onHoldComplete={() => setPreCompleteOpen(true)}", "                  onClick={handleCompleteRequest}\n                  onHoldComplete={handleCompleteRequest}")
change(card, "        assignmentId={assignment.id}\n        onPhotoCaptured={handlePhotoCaptured}\n      />", "        assignmentId={assignment.id}\n        hotel={assignment.rooms?.hotel}\n        onPhotoCaptured={handlePhotoCaptured}\n      />")
change(card, "      <PreCompleteChecklistDialog\n        open={preCompleteOpen}", "      {!noMinibar && <PreCompleteChecklistDialog\n        open={preCompleteOpen}")
change(card, "          await updateAssignmentStatus('completed');\n        }}\n      />", "          await updateAssignmentStatus('completed');\n        }}\n      />}")

photos = 'src/components/dashboard/GuidedRoomPhotoCapture.tsx'
change(photos, "import { cn } from '@/lib/utils';", "import { cn } from '@/lib/utils';\nimport { isGozsduNoMinibarRoom } from '@/lib/gozsduNoMinibar';")
change(photos, "  roomNumber: string;\n  assignmentId?: string;", "  roomNumber: string;\n  hotel?: string;\n  assignmentId?: string;")
change(photos, "const STEPS = [", "const ALL_STEPS = [")
# Locate original component signature defensively without altering unrelated exports.
photo_text = Path(photos).read_text()
import re
match = re.search(r'export function GuidedRoomPhotoCapture\(([^\n]*)\) \{', photo_text)
if not match:
    raise RuntimeError('GuidedRoomPhotoCapture signature not found')
old_signature = match.group(0)
if 'roomNumber' not in old_signature:
    raise RuntimeError(f'Unexpected photo signature: {old_signature}')
new_signature = old_signature.replace('roomNumber,', 'roomNumber, hotel,')
change(photos, old_signature, new_signature)
change(photos, "  const { user } = useAuth();", "  const { user, profile } = useAuth();\n  const noMinibar = isGozsduNoMinibarRoom(profile?.assigned_hotel, hotel);\n  // The guest-facing minibar category does not exist at Gozsdu. Historical\n  // minibar evidence is preserved; it is not a current step or a completion gate.\n  const STEPS = useMemo(() => noMinibar\n    ? ALL_STEPS.filter(step => step.key !== 'minibar')\n    : ALL_STEPS, [noMinibar]);")
change(photos, "  const current = STEPS[index];", "  const current = STEPS[Math.min(index, STEPS.length - 1)];")
change(photos, "[photos]);\n  const resolved = STEPS.filter", "[photos, STEPS]);\n  const resolved = STEPS.filter")
change(photos, "  }, [open, assignmentId, copy.error, stopCamera]);", "  }, [open, assignmentId, noMinibar, copy.error, stopCamera]);")
# Ensure visible copy does not incorrectly demand five steps from Gozsdu.
change(photos, "  const skipAllowed = assignmentType === 'daily_cleaning';", "  const skipAllowed = assignmentType === 'daily_cleaning';\n  const incompleteCopy = noMinibar ? ({\n    en: 'Complete all four applicable sections with a photo or a justified skip.',\n    hu: 'Mind a négy alkalmazható részhez fotó vagy indokolt kihagyás szükséges.',\n    vi: 'Bốn mục áp dụng cần ảnh hoặc lý do bỏ qua.',\n    mn: 'Хамаарах дөрвөн хэсэг бүрд зураг эсвэл алгасах шалтгаан шаардлагатай.',\n    es: 'Las cuatro secciones aplicables necesitan foto o motivo de omisión.',\n  } as const)[locale] : copy.incomplete;")
change(photos, "toast.error(copy.incomplete); return;", "toast.error(incompleteCopy); return;")
change(photos, "<p className=\"text-xs text-muted-foreground\">{copy.incomplete}</p>", "<p className=\"text-xs text-muted-foreground\">{incompleteCopy}</p>")

room = 'src/components/dashboard/RoomDetailDialog.tsx'
change(room, "import { DNDPhotosViewer } from './DNDPhotosViewer';", "import { DNDPhotosViewer } from './DNDPhotosViewer';\nimport { isGozsduNoMinibarRoom } from '@/lib/gozsduNoMinibar';")
change(room, "  const { profile } = useAuth();", "  const { profile } = useAuth();\n  const noMinibar = isGozsduNoMinibarRoom(profile?.assigned_hotel, room?.hotel);")
change(room, "      fetchMinibarItems();\n      fetchMinibarUsage();\n      fetchRecentTickets();\n      fetchGuestReportedItems();\n      fetchPerishableAlerts();", "      if (!isGozsduNoMinibarRoom(profile?.assigned_hotel, room.hotel)) {\n        fetchMinibarItems();\n        fetchMinibarUsage();\n        fetchGuestReportedItems();\n        fetchPerishableAlerts();\n      } else {\n        // Drop any cached minibar details on a property switch.\n        setMinibarItems([]);\n        setMinibarUsage([]);\n        setGuestReportedItems(new Set());\n        setPerishableAlerts([]);\n      }\n      fetchRecentTickets();")
change(room, "  }, [open, room, fetchRoomNoteHistory]);", "  }, [open, room, profile?.assigned_hotel, fetchRoomNoteHistory]);")
change(room, "    if (!room) return;\n\n    const currentUsage = getCurrentUsage(itemId);", "    if (!room || noMinibar) return;\n\n    const currentUsage = getCurrentUsage(itemId);")
change(room, "  const clearMinibarUsage = async () => {\n    if (!room) return;", "  const clearMinibarUsage = async () => {\n    if (!room || noMinibar) return;")
change(room, "  const handleCollectPerishable = async (placementId: string) => {\n    try {", "  const handleCollectPerishable = async (placementId: string) => {\n    if (noMinibar) return;\n    try {")
change(room, "          {/* Minibar Section */}\n          <Card>", "          {/* Gozsdu has no minibar; all other properties retain existing usage tools. */}\n          {!noMinibar && <Card>")
change(room, "          </Card>\n\n\n          {/* Recent Tickets Section */}", "          </Card>}\n\n\n          {/* Recent Tickets Section */}")

hk = 'src/components/dashboard/HousekeepingTabLegacy.tsx'
change(hk, "import { resolveHotelKeys } from '@/lib/hotelKeys';", "import { resolveHotelKeys } from '@/lib/hotelKeys';\nimport { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';")
change(hk, "  const isAdmin = userRole === 'admin';", "  const isAdmin = userRole === 'admin';\n  const noMinibar = isGozsduCourtHotel(profile?.assigned_hotel || assignedHotel);")
change(hk, "    if (hidePmsUploadTab) order = order.filter((id) => id !== 'pms-upload');", "    if (hidePmsUploadTab) order = order.filter((id) => id !== 'pms-upload');\n    if (noMinibar) order = order.filter((id) => id !== 'minibar');")
change(hk, "      <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); onActiveSubTabChange?.(val); }} className=\"w-full\">", "      <Tabs value={noMinibar && activeTab === 'minibar' ? 'manage' : activeTab} onValueChange={(val) => { setActiveTab(val); onActiveSubTabChange?.(val); }} className=\"w-full\">")
change(hk, "                  lateMinibarCount={lateMinibarCount}", "                  lateMinibarCount={noMinibar ? 0 : lateMinibarCount}")
change(hk, "        {hasManagerAccess && (\n          <TabsContent value=\"minibar\"", "        {hasManagerAccess && !noMinibar && (\n          <TabsContent value=\"minibar\"")

dash = 'src/components/dashboard/Dashboard.tsx'
change(dash, "import { NotificationPermissionBanner } from './NotificationPermissionBanner';", "import { NotificationPermissionBanner } from './NotificationPermissionBanner';\nimport { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';")
change(dash, "  const { profile } = useAuth();", "  const { profile } = useAuth();\n  const noMinibar = isGozsduCourtHotel(profile?.assigned_hotel);")
change(dash, "      case 'front_office':\n        return \"minibar\";", "      case 'front_office':\n        return noMinibar ? \"rooms\" : \"minibar\";")
change(dash, "  }, [profile?.role, attendanceStatus]);", "  }, [profile?.role, attendanceStatus, noMinibar]);")
change(dash, "      setActiveTab(urlTab);\n      // Consume the param", "      setActiveTab(urlTab === 'minibar' && noMinibar ? 'rooms' : urlTab);\n      // Consume the param")
change(dash, "      if (mainTab) setActiveTab(mainTab);", "      if (mainTab) setActiveTab(mainTab === 'minibar' && noMinibar ? 'rooms' : mainTab);")
change(dash, "  }, []);\n\n  return (\n    <div className=\"min-h-screen bg-background\">", "  }, [noMinibar]);\n\n  return (\n    <div className=\"min-h-screen bg-background\">")
change(dash, "        <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val);", "        <Tabs value={noMinibar && activeTab === 'minibar' ? 'rooms' : activeTab} onValueChange={(val) => { setActiveTab(val);")
change(dash, "                <TabsTrigger value=\"minibar\" className=\"flex-1 flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm\">", "                {!noMinibar && <TabsTrigger value=\"minibar\" className=\"flex-1 flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm\">")
change(dash, "                  <span>Minibar</span>\n                </TabsTrigger>", "                  <span>Minibar</span>\n                </TabsTrigger>}")
change(dash, "              <TabsContent value=\"minibar\" className=\"space-y-6\">\n                <MinibarTrackingView />\n              </TabsContent>", "              {!noMinibar && <TabsContent value=\"minibar\" className=\"space-y-6\">\n                <MinibarTrackingView />\n              </TabsContent>}")

print('Applied guarded property-only changes: completion flow, photos, room detail, navigation and regression policy tests.')
