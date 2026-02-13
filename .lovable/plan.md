

## Plan: Enhanced Drag-and-Drop with Visual Room Ghost

### What Changes

Upgrade the current basic HTML5 drag-and-drop to show a visible "floating room chip" that follows the mouse cursor as you drag, with smooth animations and clear visual feedback.

### Change 1: Custom Drag Ghost + Visual Feedback

**File:** `src/components/dashboard/AutoRoomAssignment.tsx`

**A. Custom drag image (ghost):**
- On `onDragStart`, create a custom drag image element that looks like the room chip (colored, with room number) instead of the browser's default translucent clone
- Use `e.dataTransfer.setDragImage(element, offsetX, offsetY)` with a styled clone
- Add a subtle scale-up animation on the source chip when dragging starts (opacity reduction to show it's "picked up")

**B. Enhanced source chip styling during drag:**
- Track `draggingRoomId` in state
- The source chip gets `opacity-30 scale-95` while being dragged (ghost effect -- "it's been picked up")
- On `onDragEnd`, clear the dragging state and restore the chip

**C. Improved drop zone feedback:**
- When dragging over a staff card, show a pulsing blue dashed border and a subtle background glow
- The "Drop room here" indicator appears immediately with a smooth fade-in animation
- Staff cards that are NOT the source get a subtle "ready to receive" state (light border highlight)

**D. Drop animation:**
- On successful drop, briefly flash the target card green to confirm the move
- The moved room chip in its new location gets a brief `animate-scale-in` effect

### Change 2: Touch Support for Mobile

**File:** `src/components/dashboard/AutoRoomAssignment.tsx`

- Keep the existing click-to-select fallback for touch devices
- Add a small hint text that adapts: "Drag rooms to reassign" on desktop, "Tap a room, then tap a housekeeper" on mobile
- Use `use-mobile` hook to detect

### Summary of Visual States

| State | Visual |
|-------|--------|
| Idle room chip | Normal colored chip with cursor-grab |
| Room being dragged (source) | Faded out (opacity-30), slightly shrunk |
| Custom drag ghost | Styled chip clone following cursor |
| Staff card (potential drop target) | Subtle blue border glow |
| Staff card (drag hovering over) | Blue dashed border, pulsing, "Drop here" text with fade-in |
| Just-dropped room | Brief green flash on target card, scale-in animation on chip |

### Technical Details

**Drag ghost creation (in onDragStart):**
```text
const ghost = document.createElement('div');
ghost.textContent = room.room_number;
ghost.className = 'fixed px-3 py-1.5 rounded-md text-sm font-bold shadow-lg ...';
// Color based on checkout vs daily
ghost.style.backgroundColor = room.is_checkout_room ? '#fef3c7' : '#dbeafe';
document.body.appendChild(ghost);
e.dataTransfer.setDragImage(ghost, 20, 15);
// Remove ghost after frame
requestAnimationFrame(() => document.body.removeChild(ghost));
```

**New state variables:**
```text
const [draggingRoomId, setDraggingRoomId] = useState<string | null>(null);
const [justDroppedStaffId, setJustDroppedStaffId] = useState<string | null>(null);
const [justDroppedRoomId, setJustDroppedRoomId] = useState<string | null>(null);
```

**Source chip during drag:**
```text
className={`... ${draggingRoomId === room.id ? 'opacity-30 scale-95' : ''}`}
```

**Drop success flash:**
```text
// In onDrop handler:
setJustDroppedStaffId(preview.staffId);
setJustDroppedRoomId(roomId);
setTimeout(() => { setJustDroppedStaffId(null); setJustDroppedRoomId(null); }, 600);

// On card:
className={`... ${justDroppedStaffId === preview.staffId ? 'ring-2 ring-green-500 transition-all' : ''}`}

// On chip:
className={`... ${justDroppedRoomId === room.id ? 'animate-scale-in' : ''}`}
```

**Mobile detection for hint text:**
```text
import { useIsMobile } from '@/hooks/use-mobile';
const isMobile = useIsMobile();
// In hint:
{isMobile ? 'Tap a room, then tap a housekeeper to reassign' : 'Drag rooms between housekeepers to reassign'}
```

### Files Modified

| File | Change |
|------|--------|
| `AutoRoomAssignment.tsx` | Custom drag ghost, dragging/dropped state tracking, enhanced visual feedback, mobile-aware hint text |

