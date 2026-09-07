import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { headroom, uniformDateStep } from "./priceBounds.ts";
import { effectiveDateColumnBounds } from "./engineV2DateColumnLockstep.ts";

function stepFor(params: {
  lockstep: boolean;
  direction: 1 | -1;
  wanted: number;
  minimumMove: number;
  globalMin: number;
  globalMax: number;
  cells: Array<{ name: string; old: number; min: number; max: number }>;
}) {
  const prepared = params.cells.map((cell) => {
    const bounds = effectiveDateColumnBounds({
      lockstep: params.lockstep,
      cellMin: cell.min,
      cellMax: cell.max,
      globalMin: params.globalMin,
      globalMax: params.globalMax,
    });
    return {
      ...cell,
      bounds,
      allowed: headroom(bounds, cell.old, params.direction),
    };
  });
  const uniform = uniformDateStep(
    prepared.map((cell) => ({ room_type_name: cell.name, allowed: cell.allowed })),
    params.wanted,
    params.minimumMove,
  );
  return {
    uniform,
    prices: prepared.map((cell) => cell.old + params.direction * uniform.step),
  };
}

Deno.test("lockstep increase ignores a room-type ceiling and moves every cell equally", () => {
  const result = stepFor({
    lockstep: true,
    direction: 1,
    wanted: 5,
    minimumMove: 2,
    globalMin: 80,
    globalMax: 500,
    cells: [
      { name: "Economy", old: 150, min: 100, max: 150 },
      { name: "Deluxe", old: 220, min: 140, max: 300 },
    ],
  });
  assertEquals(result.uniform, { step: 5, limitedBy: null, held: false });
  assertEquals(result.prices, [155, 225]);
});

Deno.test("lockstep markdown ignores a room-type floor and moves every cell equally", () => {
  const result = stepFor({
    lockstep: true,
    direction: -1,
    wanted: 5,
    minimumMove: 2,
    globalMin: 80,
    globalMax: 500,
    cells: [
      { name: "Economy", old: 120, min: 120, max: 200 },
      { name: "Deluxe", old: 180, min: 150, max: 320 },
    ],
  });
  assertEquals(result.uniform, { step: 5, limitedBy: null, held: false });
  assertEquals(result.prices, [115, 175]);
});

Deno.test("hotel safety boundary caps or holds the entire lockstep column uniformly", () => {
  const capped = stepFor({
    lockstep: true,
    direction: 1,
    wanted: 5,
    minimumMove: 1,
    globalMin: 80,
    globalMax: 500,
    cells: [
      { name: "Economy", old: 498, min: 100, max: 499 },
      { name: "Deluxe", old: 450, min: 140, max: 470 },
    ],
  });
  assertEquals(capped.uniform, { step: 2, limitedBy: "Economy", held: false });
  assertEquals(capped.prices, [500, 452]);

  const held = stepFor({
    lockstep: true,
    direction: -1,
    wanted: 5,
    minimumMove: 3,
    globalMin: 80,
    globalMax: 500,
    cells: [
      { name: "Economy", old: 82, min: 120, max: 200 },
      { name: "Deluxe", old: 160, min: 150, max: 320 },
    ],
  });
  assertEquals(held.uniform, { step: 0, limitedBy: "Economy", held: true });
});

Deno.test("legacy mode still lets a child room bound freeze the date", () => {
  const result = stepFor({
    lockstep: false,
    direction: 1,
    wanted: 5,
    minimumMove: 2,
    globalMin: 80,
    globalMax: 500,
    cells: [
      { name: "Economy", old: 150, min: 100, max: 150 },
      { name: "Deluxe", old: 220, min: 140, max: 300 },
    ],
  });
  assertEquals(result.uniform, { step: 0, limitedBy: "Economy", held: true });
});
