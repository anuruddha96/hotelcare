#!/usr/bin/env python3
"""One-shot source patch; fails if upstream anchors drift. GitHub Actions removes this script."""
from pathlib import Path


def patch(path: str, old: str, new: str, count: int = 1):
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f'{path}: expected {count} occurrences, found {actual}: {old[:115]!r}')
    file.write_text(text.replace(old, new))


settings = 'src/components/dashboard/HousekeepingRoomSettings.tsx'
patch(settings,
      "import { CHECKOUT_DURATION_EXAMPLES, HOUSEKEEPING_ROOM_SIZES, ROOM_SIZE_LABELS, type HousekeepingRoomSize } from '@/lib/housekeepingRoomSizing';",
      "import { CHECKOUT_DURATION_EXAMPLES, HOUSEKEEPING_ROOM_SIZES, ROOM_SIZE_LABELS, type HousekeepingRoomSize } from '@/lib/housekeepingRoomSizing';\nimport { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';\nimport { buildGozsduRoomRegistryIndex, type GozsduRoomRegistryEntry } from '@/lib/gozsduRoomRegistryDisplay';")
patch(settings,
      'type Room = { id: string; room_number: string; cleaning_size: HousekeepingRoomSize | null; verified_bed_count: number | null };',
      'type Room = { id: string; room_number: string; cleaning_size: HousekeepingRoomSize | null; verified_bed_count: number | null; service_status?: string | null };')
patch(settings,
      "  const selected = choices.find(h => h.id === hotelId) || null;",
      "  const selected = choices.find(h => h.id === hotelId) || null;\n  const isGozsdu = !!selected && (isGozsduCourtHotel(selected.hotel_id) || isGozsduCourtHotel(selected.hotel_name));")
patch(settings,
      "      const [roomsResult, targetsResult] = await Promise.all([",
      "      const [roomsResult, targetsResult, registryResult] = await Promise.all([")
patch(settings,
      "        (supabase as any).from('hotel_cleaning_time_targets').select('cleaning_size,assignment_type,duration_minutes')\n          .eq('hotel_configuration_id', selected.id),\n      ]);",
      "        (supabase as any).from('hotel_cleaning_time_targets').select('cleaning_size,assignment_type,duration_minutes')\n          .eq('hotel_configuration_id', selected.id),\n        isGozsdu ? (supabase as any).from('gozsdu_housekeeping_room_registry')\n          .select('room_id,pms_room_name,service_status')\n          : Promise.resolve({ data: [], error: null }),\n      ]);")
patch(settings,
      "      if (roomsResult.error || targetsResult.error) {\n        toast.error('Could not load hotel room settings');\n        setRooms([]); setTargets([]);\n      } else {\n        setRooms(roomsResult.data || []);\n        setTargets(targetsResult.data || []);\n      }",
      "      if (roomsResult.error || targetsResult.error || registryResult.error) {\n        toast.error('Could not load hotel room settings or verify Gozsdu PMS names');\n        setRooms([]); setTargets([]);\n      } else {\n        try {\n          const sourceRooms = (roomsResult.data || []) as Room[];\n          if (isGozsdu) {\n            const registry = buildGozsduRoomRegistryIndex(sourceRooms, (registryResult.data || []) as GozsduRoomRegistryEntry[]);\n            // Display-only projection: keep real DB room numbers and all stable room IDs unchanged.\n            setRooms(sourceRooms.map(room => ({ ...room,\n              room_number: registry.get(room.id)!.pms_room_name,\n              service_status: registry.get(room.id)!.service_status,\n            })).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })));\n          } else setRooms(sourceRooms);\n          setTargets(targetsResult.data || []);\n        } catch (error) {\n          console.error('[HousekeepingRoomSettings] Gozsdu room registry not verified', error);\n          toast.error('Gozsdu room names are not fully verified. Mapping is blocked until the PMS registry is complete.');\n          setRooms([]); setTargets([]);\n        }\n      }")
patch(settings,
      "  }, [open, selected?.id, organizationSlug]);",
      "  }, [open, selected?.id, organizationSlug, isGozsdu]);")
patch(settings,
      "      <p className=\"text-xs text-muted-foreground\">Manager-only settings for one hotel. Confirm actual beds; guest capacity is not bed count. Existing jobs stay unchanged.</p>",
      "      <p className=\"text-xs text-muted-foreground\">Manager-only settings for one hotel. Confirm actual beds; guest capacity is not bed count. Existing jobs stay unchanged.{isGozsdu ? ' Gozsdu displays full verified Previo apartment names. Unavailable units remain visible for reference but never enter Auto Assign.' : ''}</p>")
patch(settings,
      "          <strong className=\"text-sm w-28 break-all\">{room.room_number}</strong>",
      "          <strong className=\"text-sm w-28 break-all\">{room.room_number}</strong>\n          {isGozsdu && room.service_status !== 'operating' && <span className=\"rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800\">{room.service_status === 'non_guest' ? 'Private apartment' : 'Not available'}</span>}")

picker = 'src/components/dashboard/GozsduLaundryDutyPicker.tsx'
patch(picker,
      "  const [busyId, setBusyId] = useState<string | null>(null);",
      "  const [busyId, setBusyId] = useState<string | null>(null);\n  const [hasEdits, setHasEdits] = useState(false);")
patch(picker,
      "  useEffect(() => { if (!open) setShow(false); }, [open, workDate]);",
      "  useEffect(() => { if (!open) { setShow(false); setHasEdits(false); } }, [open, workDate]);")
patch(picker,
      "      try { localStorage.removeItem(`auto_assignment_v2_${profile?.assigned_hotel}_${workDate}`); }\n      catch { /* optional browser draft */ }\n      if (!await refresh()) return;\n      onChanged(); // Discards previews/drafts and remounts the board safely.\n      toast.success(enabled ? 'Laundryner assigned. Regenerate the room preview.'\n        : 'Laundryner duty removed. Regenerate the room preview.');",
      "      // The RPC is authoritative, but selecting a checkbox must never unmount\n      // the whole allocation dialog. Revalidate and invalidate previews on Done.\n      const next = enabled ? [...new Set([...dutyIds, userId])] : dutyIds.filter(id => id !== userId);\n      setDutyIds(next);\n      onReady(next);\n      setHasEdits(true);\n      toast.success(enabled ? 'Laundryner duty saved. Tap Done to update the room plan.'\n        : 'Laundryner duty removed. Tap Done to update the room plan.');")
patch(picker,
      "  if (!open || !allowed) return null;",
      "  const finish = async () => {\n    if (busyId) return;\n    setShow(false);\n    if (!hasEdits) return;\n    // Refresh only the duty list in the background; the room-assignment dialog\n    // stays mounted. The parent clears any stale preview in place on success.\n    if (await refresh()) {\n      try { localStorage.removeItem(`auto_assignment_v2_${profile?.assigned_hotel}_${workDate}`); }\n      catch { /* browser storage is optional */ }\n      setHasEdits(false);\n      onChanged();\n    } else {\n      setShow(true);\n      toast.error('Could not verify Laundryner changes. Please retry Done.');\n    }\n  };\n\n  if (!open || !allowed) return null;")
patch(picker,
      "        onClick={() => setShow(current => !current)} aria-expanded={show}",
      "        onClick={() => { if (show) void finish(); else setShow(true); }} aria-expanded={show}")
patch(picker,
      "onClick={() => setShow(false)} aria-label=\"Close Laundryner staff list\"",
      "onClick={() => void finish()} aria-label=\"Close Laundryner staff list\"")
patch(picker,
      "<Button type=\"button\" size=\"sm\" onClick={() => setShow(false)} disabled={!!busyId}>Done</Button>",
      "<Button type=\"button\" size=\"sm\" onClick={() => void finish()} disabled={!!busyId}>Done</Button>")

impl = 'src/components/dashboard/AutoRoomAssignmentImpl.tsx'
patch(impl,
      "  pmsSyncedAt?: string | null;\n}",
      "  pmsSyncedAt?: string | null;\n  laundryDutyIds?: readonly string[];\n  laundryDutyCommitRevision?: number;\n}")
patch(impl,
      "type Step = 'select-staff' | 'preview' | 'confirm' | 'public-areas';",
      "const EMPTY_LAUNDRY_DUTY: readonly string[] = [];\ntype Step = 'select-staff' | 'preview' | 'confirm' | 'public-areas';")
patch(impl,
      "  planningMode = 'live',\n  pmsSyncedAt = null,\n}: AutoRoomAssignmentProps) {",
      "  planningMode = 'live',\n  pmsSyncedAt = null,\n  laundryDutyIds = EMPTY_LAUNDRY_DUTY,\n  laundryDutyCommitRevision = 0,\n}: AutoRoomAssignmentProps) {")
patch(impl,
      "  const isLaundryner = (staffId: string) => isGozsdu && isActiveGozsduLaundryner(staffId);",
      "  const isLaundryner = (staffId: string) => isGozsdu\n    && (laundryDutyIds.includes(staffId) || isActiveGozsduLaundryner(staffId));")
patch(impl,
      "  const draftRestoredRef = useRef(false);",
      "  const draftRestoredRef = useRef(false);\n  const laundryCommitRef = useRef(laundryDutyCommitRevision);")
patch(impl,
      "    [selectedStaffIds, isGozsdu],",
      "    [selectedStaffIds, isGozsdu, laundryDutyIds],")
patch(impl,
      "  useEffect(() => {\n    if (!open || isGozsdu) return;\n    if (selectedStaffIds.size === 0 && assignmentPreviews.length === 0) return;",
      "  // Done in the Laundryner picker invalidates only this board's unconfirmed\n  // suggestion. Do not change its React key, unmount the modal or refetch PMS.\n  useEffect(() => {\n    if (!open || !isGozsdu || laundryCommitRef.current === laundryDutyCommitRevision) return;\n    laundryCommitRef.current = laundryDutyCommitRevision;\n    setSelectedStaffIds(previous => new Set([...previous].filter(id => !isLaundryner(id))));\n    setAssignmentPreviews([]);\n    setFairnessMetrics(null);\n    setPreviewHistory([]);\n    setSectionTaskOwners(new Map());\n    setSharedByRoom(new Map());\n    setSuggestedByRoom(new Map());\n    setSelectedRoomForMove(null);\n    setStep('select-staff');\n  }, [open, isGozsdu, laundryDutyCommitRevision, laundryDutyIds]);\n\n  useEffect(() => {\n    if (!open || isGozsdu) return;\n    if (selectedStaffIds.size === 0 && assignmentPreviews.length === 0) return;")
patch(impl,
      "  const groupByFloor = (rooms: RoomForAssignment[]) => {\n    const map = new Map<number, RoomForAssignment[]>();",
      "  const roomDisplayName = (room: RoomForAssignment): string =>\n    isGozsdu ? (room.pms_metadata?.gozsduAvailability?.pmsRoomName || room.room_number) : room.room_number;\n\n  const groupByFloor = (rooms: RoomForAssignment[]) => {\n    if (isGozsdu) {\n      const mapped = new Map<string, RoomForAssignment[]>();\n      for (const room of rooms) {\n        const building = room.housekeeping_section_name || 'Unmapped building';\n        if (!mapped.has(building)) mapped.set(building, []);\n        mapped.get(building)!.push(room);\n      }\n      return Array.from(mapped.entries()).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))\n        .map(([floor, group]) => ({ floor, rooms: sortPreviewRooms(group) }));\n    }\n    const map = new Map<number, RoomForAssignment[]>();")
patch(impl,
      "      .map(([floor, floorRooms]) => ({ floor, rooms: sortPreviewRooms(floorRooms) }));",
      "      .map(([floor, floorRooms]) => ({ floor: String(floor), rooms: sortPreviewRooms(floorRooms) }));")
patch(impl,
      "        title={`Room ${room.room_number}${rtc ? ' · Ready to clean' : ''}${held ? ' · Maintenance hold' : ''}`}",
      "        title={`Room ${roomDisplayName(room)}${rtc ? ' · Ready to clean' : ''}${held ? ' · Maintenance hold' : ''}`}")
patch(impl,
      "        <span className=\"font-semibold\">{room.room_number}</span>",
      "        <span className=\"font-semibold\">{roomDisplayName(room)}</span>")
patch(impl,
      "<span>F↔{fairnessMetrics.splitFloorCount}</span>",
      "<span>{isGozsdu ? 'Building' : 'F'}↔{fairnessMetrics.splitFloorCount}</span>")
patch(impl,
      "<span className=\"mt-0.5 rounded bg-muted px-0.5 text-[8px] text-muted-foreground\">F{group.floor}</span>",
      "<span className=\"mt-0.5 rounded bg-muted px-0.5 text-[8px] text-muted-foreground\">{isGozsdu ? group.floor : `F${group.floor}`}</span>", 2)
patch(impl,
      "{room.room_number}{excluded ? ' ✕' : ''}",
      "{roomDisplayName(room)}{excluded ? ' ✕' : ''}")
patch(impl,
      "<span>{t('autoAssign.checkoutRooms')}: <b>{CHECKOUT_MINUTES} min</b> · {t('autoAssign.dailyRooms')}: <b>{DAILY_MINUTES} min</b> · {t('autoAssign.break')}: <b>{BREAK_TIME_MINUTES} min</b></span>",
      "<span>{isGozsdu ? 'Cleaning times use each room’s configured size and verified beds; Laundryners receive no rooms.' : <>{t('autoAssign.checkoutRooms')}: <b>{CHECKOUT_MINUTES} min</b> · {t('autoAssign.dailyRooms')}: <b>{DAILY_MINUTES} min</b> · {t('autoAssign.break')}: <b>{BREAK_TIME_MINUTES} min</b></>}</span>")
patch(impl,
      "<th style=\"border:1px solid #ddd;padding:6px\">Floor</th>",
      "<th style=\"border:1px solid #ddd;padding:6px\">${isGozsdu ? 'Building' : 'Floor'}</th>")
patch(impl,
      "<b>${room.room_number}</b></td><td style=\"border:1px solid #ddd;padding:6px\">${isCheckoutLike(room) ? 'Checkout' : 'Daily'}</td><td style=\"border:1px solid #ddd;padding:6px\">F${room.floor_number ?? getFloorFromRoomNumber(room.room_number)}</td>",
      "<b>${roomDisplayName(room)}</b></td><td style=\"border:1px solid #ddd;padding:6px\">${isCheckoutLike(room) ? 'Checkout' : 'Daily'}</td><td style=\"border:1px solid #ddd;padding:6px\">${isGozsdu ? room.housekeeping_section_name || 'Unmapped building' : `F${room.floor_number ?? getFloorFromRoomNumber(room.room_number)}`}</td>")

floor = 'src/components/dashboard/HotelFloorMap.tsx'
patch(floor,
      "import { parseRoomFlags } from '@/lib/room-service-flags';",
      "import { parseRoomFlags } from '@/lib/room-service-flags';\nimport { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';\nimport { buildGozsduRoomRegistryIndex, type GozsduRoomRegistryEntry } from '@/lib/gozsduRoomRegistryDisplay';")
patch(floor,
      "  room_number: string;\n  floor_number: number | null;",
      "  room_number: string;\n  display_room_number?: string;\n  floor_number: number | null;")
patch(floor,
      "`Room ${room.room_number}`,",
      "`Room ${room.display_room_number || room.room_number}`,")
patch(floor,
      "      <span>{room.room_number}</span>",
      "      <span>{room.display_room_number || room.room_number}</span>")
patch(floor,
      "  const { user } = useAuth();\n  const [loading, setLoading] = useState(true);",
      "  const { user } = useAuth();\n  const isGozsdu = isGozsduCourtHotel(hotelName);\n  const roomIdsKey = rooms.map(room => room.id).sort().join('|');\n  const [roomRegistry, setRoomRegistry] = useState<Map<string, GozsduRoomRegistryEntry>>(new Map());\n  const [mapError, setMapError] = useState<string | null>(null);\n  const [loading, setLoading] = useState(true);")
patch(floor,
      "    setLoading(true);\n    try {\n      const { data: sectionRows, error: sectionError } = await (supabase as any)",
      "    setLoading(true);\n    try {\n      if (isGozsdu) {\n        const scopedRoomIds = roomIdsKey ? roomIdsKey.split('|') : [];\n        const result = scopedRoomIds.length ? await (supabase as any)\n          .from('gozsdu_housekeeping_room_registry')\n          .select('room_id,pms_room_name,service_status')\n          .in('room_id', scopedRoomIds) : { data: [], error: null };\n        if (result.error) throw result.error;\n        setRoomRegistry(buildGozsduRoomRegistryIndex(scopedRoomIds.map(id => ({ id })),\n          (result.data || []) as GozsduRoomRegistryEntry[]));\n      } else setRoomRegistry(new Map());\n      setMapError(null);\n      const { data: sectionRows, error: sectionError } = await (supabase as any)")
patch(floor,
      "      console.error('[HotelFloorMap] failed to load section map', error);\n      toast.error('The housekeeping section map could not be loaded');",
      "      console.error('[HotelFloorMap] failed to load section map', error);\n      if (isGozsdu) setMapError('Gozsdu room names or building assignments could not be verified. Nothing can be remapped until the authoritative registry loads.');\n      toast.error('The housekeeping section map could not be loaded');")
patch(floor,
      "  }, [hotelName]);",
      "  }, [hotelName, isGozsdu, roomIdsKey]);")
patch(floor,
      "  const mappingByRoom = useMemo(",
      "  const displayRooms = useMemo(() => isGozsdu ? rooms.map(room => ({ ...room,\n    display_room_number: roomRegistry.get(room.id)?.pms_room_name || 'Unverified PMS room',\n  })) : rooms, [rooms, isGozsdu, roomRegistry]);\n\n  const mappingByRoom = useMemo(")
patch(floor,
      "    rooms.forEach(room => {\n      const sectionId = mappingByRoom.get(room.id);",
      "    displayRooms.forEach(room => {\n      const sectionId = mappingByRoom.get(room.id);")
patch(floor,
      "  }, [mappingByRoom, rooms, sections]);",
      "  }, [mappingByRoom, displayRooms, sections]);")
patch(floor,
      "    () => rooms.filter(room => !mappingByRoom.has(room.id)).sort(sortRooms),\n    [mappingByRoom, rooms],",
      "    () => displayRooms.filter(room => !mappingByRoom.has(room.id)).sort(sortRooms),\n    [mappingByRoom, displayRooms],")
patch(floor,
      "    if (sections.length > 0 || editMode) return [];",
      "    if (isGozsdu || sections.length > 0 || editMode) return [];")
patch(floor,
      "  }, [editMode, hotelName, rooms, sections.length]);",
      "  }, [editMode, hotelName, rooms, sections.length, isGozsdu]);")
patch(floor,
      "  const floorOrder = useMemo(() => {\n    const floors = new Set<number>();",
      "  const floorOrder = useMemo(() => {\n    if (isGozsdu) return displaySections.length ? [0] : [];\n    const floors = new Set<number>();")
patch(floor,
      "  }, [displaySections, editMode, rooms]);",
      "  }, [displaySections, editMode, rooms, isGozsdu]);")
patch(floor,
      "    setSectionName(floor === 0 ? 'Ground Floor' : `${floor * 100} Side`);",
      "    setSectionName(isGozsdu ? '' : floor === 0 ? 'Ground Floor' : `${floor * 100} Side`);")
patch(floor,
      "            floor_number: sectionFloor,",
      "            floor_number: isGozsdu ? 0 : sectionFloor,", 2)
patch(floor,
      "    const room = rooms.find(candidate => candidate.id === roomId);",
      "    const room = displayRooms.find(candidate => candidate.id === roomId);")
patch(floor,
      "  const selectedRoom = selectedRoomId ? rooms.find(room => room.id === selectedRoomId) : null;",
      "  const selectedRoom = selectedRoomId ? displayRooms.find(room => room.id === selectedRoomId) : null;")
patch(floor,
      "  if (loading) {\n    return <div className=\"flex items-center justify-center py-12\"><Loader2 className=\"h-7 w-7 animate-spin text-muted-foreground\" /></div>;\n  }",
      "  if (loading) {\n    return <div className=\"flex items-center justify-center py-12\"><Loader2 className=\"h-7 w-7 animate-spin text-muted-foreground\" /></div>;\n  }\n  if (mapError) return <div role=\"alert\" className=\"rounded-lg border border-amber-400 p-3 text-sm\">\n    {mapError} <Button size=\"sm\" variant=\"outline\" onClick={() => void loadMap()}>Retry</Button>\n  </div>;")
patch(floor,
      "<h3 className=\"text-sm font-semibold\">Operational room sections</h3>",
      "<h3 className=\"text-sm font-semibold\">{isGozsdu ? 'Gozsdu buildings & apartments' : 'Operational room sections'}</h3>")
patch(floor,
      "              Floors show the physical level. Sections keep nearby rooms and their shared-area cleaning together.",
      "              {isGozsdu ? 'Uses the existing Gozsdu building / apartment mapping and full verified Previo room names. PMS prefixes are not physical-building identifiers.' : 'Floors show the physical level. Sections keep nearby rooms and their shared-area cleaning together.'}")
patch(floor,
      "                  <Button size=\"sm\" variant=\"outline\" onClick={autoMapFloors} disabled={busy || unmappedRooms.length === 0}>\n                    <Sparkles className=\"mr-1 h-3.5 w-3.5\" />Auto-map floors\n                  </Button>",
      "                  {!isGozsdu && <Button size=\"sm\" variant=\"outline\" onClick={autoMapFloors} disabled={busy || unmappedRooms.length === 0}>\n                    <Sparkles className=\"mr-1 h-3.5 w-3.5\" />Auto-map floors\n                  </Button>}")
patch(floor,
      "        const floorSections = displaySections.filter(section => section.floor_number === floor);",
      "        const floorSections = displaySections.filter(section => section.floor_number === floor\n          && (!isGozsdu || editMode || (roomsBySection.get(section.id)?.length || 0) > 0 || (tasksBySection.get(section.id)?.length || 0) > 0));")
patch(floor,
      "<Badge variant=\"outline\" className=\"font-semibold\">{floorLabel(floor)}</Badge>",
      "<Badge variant=\"outline\" className=\"font-semibold\">{isGozsdu ? 'Buildings & apartments' : floorLabel(floor)}</Badge>")
patch(floor,
      "                const mismatchedFloors = sectionRooms.filter(room => inferFloor(room) !== section.floor_number).length;",
      "                const mismatchedFloors = isGozsdu ? 0 : sectionRooms.filter(room => inferFloor(room) !== section.floor_number).length;")
patch(floor,
      "<Plus className=\"mr-2 h-4 w-4\" />Create a section on {floorLabel(floor)}",
      "<Plus className=\"mr-2 h-4 w-4\" />{isGozsdu ? 'Create a building or apartment group' : `Create a section on ${floorLabel(floor)}`}")
patch(floor,
      "value={sectionName} onChange={event => setSectionName(event.target.value)} placeholder=\"e.g. 200 Side\"",
      "value={sectionName} onChange={event => setSectionName(event.target.value)} placeholder={isGozsdu ? 'e.g. Kazinczy A' : 'e.g. 200 Side'}")
patch(floor,
      "              <div className=\"space-y-1.5\">\n                <label className=\"text-sm font-medium\" htmlFor=\"section-floor\">Floor number</label>\n                <input id=\"section-floor\" type=\"number\" min={-5} max={99} className=\"w-full rounded-md border border-input bg-background px-3 py-2 text-sm\" value={sectionFloor} onChange={event => setSectionFloor(Number(event.target.value))} />\n              </div>",
      "              {!isGozsdu && <div className=\"space-y-1.5\">\n                <label className=\"text-sm font-medium\" htmlFor=\"section-floor\">Floor number</label>\n                <input id=\"section-floor\" type=\"number\" min={-5} max={99} className=\"w-full rounded-md border border-input bg-background px-3 py-2 text-sm\" value={sectionFloor} onChange={event => setSectionFloor(Number(event.target.value))} />\n              </div>}")

verified = 'src/lib/gozsduVerifiedAutoAssign.ts'
patch(verified,
      "  const { byRoom } = reconcileGozsduPmsRoster(rooms, registry, snapshots, selectedDate);\n  return rooms.map(room => {",
      "  const { byRoom } = reconcileGozsduPmsRoster(rooms, registry, snapshots, selectedDate);\n  const fullNames = new Map(registry.map(entry => [entry.room_id, entry.pms_room_name]));\n  return rooms.map(room => {")
patch(verified,
      "        ...(room.pms_metadata || {}),\n        // These flags are projected for today's Auto Assign only, never saved.",
      "        ...(room.pms_metadata || {}),\n        gozsduAvailability: { ...(room.pms_metadata?.gozsduAvailability || {}),\n          pmsRoomName: fullNames.get(room.id) },\n        // These flags are projected for today's Auto Assign only, never saved.")

print('Applied scoped Gozsdu room UI patch with all exact anchors verified.')
