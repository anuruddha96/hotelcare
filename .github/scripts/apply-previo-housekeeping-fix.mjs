import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, search, replacement, label) {
  const first = content.indexOf(search);
  if (first < 0) throw new Error(`Patch target not found: ${label}`);
  if (content.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Patch target is not unique: ${label}`);
  }
  return content.slice(0, first) + replacement + content.slice(first + search.length);
}

function replaceAllRequired(content, search, replacement, label) {
  if (!content.includes(search)) throw new Error(`Patch target not found: ${label}`);
  return content.split(search).join(replacement);
}

// 1) PMS refresh: use strict housekeeping-note selection instead of accepting
// reception/kitchen/internal notes as housekeeper instructions.
{
  const path = "src/lib/pmsRefresh.ts";
  let s = read(path);

  s = replaceOnce(
    s,
    'import { buildRoomNotes, parseRoomFlags } from "@/lib/room-service-flags";\n',
    'import { buildRoomNotes, parseRoomFlags } from "@/lib/room-service-flags";\nimport { extractHousekeepingSectionsFromRawNote, pickPrevioHousekeepingNote } from "@/lib/previoHousekeepingNote";\n',
    "pmsRefresh housekeeping helper import",
  );

  const parserStart = s.indexOf("// Previo concatenates all department-tab notes into a single `note` field,");
  const parserEnd = s.indexOf("const getDateOnly =", parserStart);
  if (parserStart < 0 || parserEnd < 0 || parserEnd <= parserStart) {
    throw new Error("Patch target not found: pmsRefresh legacy note parser block");
  }
  s = s.slice(0, parserStart) + s.slice(parserEnd);

  const cleanStart = s.indexOf("const cleanSyncedHousekeepingNote = (row: any): string | null => {");
  const cleanEnd = s.indexOf("export type PmsSyncStatus", cleanStart);
  if (cleanStart < 0 || cleanEnd < 0 || cleanEnd <= cleanStart) {
    throw new Error("Patch target not found: cleanSyncedHousekeepingNote");
  }
  s =
    s.slice(0, cleanStart) +
    "const cleanSyncedHousekeepingNote = (row: any): string | null =>\n  pickPrevioHousekeepingNote(row);\n\n" +
    s.slice(cleanEnd);

  write(path, s);
}

// 2) Bed inference: recognize sofa-bed setup instructions from the actual
// housekeeping note. This is a real operational configuration, not an OTA
// room-category guess.
{
  const path = "src/lib/bedConfigInference.ts";
  let s = read(path);

  s = replaceOnce(
    s,
    '    | "Single Bed"\n    | "Baby Bed"\n    | "Extra Cot Added";\n',
    '    | "Single Bed"\n    | "Baby Bed"\n    | "Sofa Bed"\n    | "Extra Cot Added";\n',
    "bed inference union",
  );

  const marker = '  {\n    value: "Extra Cot Added",\n';
  const sofaRule = `  {\n    value: "Sofa Bed",\n    keywords: [\n      "sofa bed",\n      "sofabed",\n      "sofa-bed",\n      "open sofa bed",\n      "prepare sofa bed",\n      "kanapéágy",\n      "kanapeagy",\n    ],\n  },\n`;
  const idx = s.indexOf(marker);
  if (idx < 0) throw new Error("Patch target not found: Extra Cot Added rule");
  s = s.slice(0, idx) + sofaRule + s.slice(idx);

  write(path, s);
}

// 3) Add regression coverage for the exact SofaBed-style instruction shown in
// Previo Cleaning.
{
  const path = "src/lib/bedConfigInference.test.ts";
  let s = read(path);
  const marker = '  it("detects separated twin bed requests", () => {\n';
  const test = `  it("detects sofa bed housekeeping instructions", () => {\n    expect(inferBedConfigFromNote("SofaBed we stay 3")?.value).toBe("Sofa Bed");\n    expect(inferBedConfigFromNote("please prepare sofa bed")?.value).toBe("Sofa Bed");\n  });\n\n`;
  const idx = s.indexOf(marker);
  if (idx < 0) throw new Error("Patch target not found: bed inference test insertion");
  s = s.slice(0, idx) + test + s.slice(idx);
  write(path, s);
}

// 4) Manager room modal: actually fetch the persisted bed_configuration,
// label the note surface correctly, and expose Sofa Bed as an editable value.
{
  const path = "src/components/dashboard/HotelRoomOverview.tsx";
  let s = read(path);

  s = replaceOnce(
    s,
    "  bed_type: string | null;\n  room_name: string | null;\n",
    "  bed_type: string | null;\n  bed_configuration?: string | null;\n  room_name: string | null;\n",
    "RoomData bed_configuration field",
  );

  s = replaceOnce(
    s,
    "room_type, bed_type, room_name, guest_nights_stayed",
    "room_type, bed_type, bed_configuration, room_name, guest_nights_stayed",
    "HotelRoomOverview rooms select bed_configuration",
  );

  s = replaceOnce(
    s,
    "{/* Manager Notes Section - only for managers/admins */}",
    "{/* Housekeeping Notes Section - only for managers/admins */}",
    "room note section comment",
  );

  s = replaceOnce(
    s,
    '>📝 Manager Notes</label>',
    '>📝 Housekeeping Notes</label>',
    "room note section label",
  );

  s = replaceOnce(
    s,
    '                      <SelectItem value="Single Bed">{t(\'bed.singleBed\')}</SelectItem>\n                      <SelectItem value="Extra Cot Added">{t(\'bed.extraCotAdded\')}</SelectItem>\n',
    '                      <SelectItem value="Single Bed">{t(\'bed.singleBed\')}</SelectItem>\n                      <SelectItem value="Sofa Bed">Sofa Bed</SelectItem>\n                      <SelectItem value="Extra Cot Added">{t(\'bed.extraCotAdded\')}</SelectItem>\n',
    "bed configuration Sofa Bed option",
  );

  s = replaceAllRequired(
    s,
    "                if (bc.includes('Baby')) return '👶BB';\n                if (bc.includes('Extra') || bc.includes('Cot')) return '+COT';\n",
    "                if (bc.includes('Baby')) return '👶BB';\n                if (bc.includes('Sofa')) return 'SOFA';\n                if (bc.includes('Extra') || bc.includes('Cot')) return '+COT';\n",
    "bed chip Sofa Bed abbreviation",
  );

  write(path, s);
}

console.log("Applied Previo housekeeping-note and bed-configuration fix.");
