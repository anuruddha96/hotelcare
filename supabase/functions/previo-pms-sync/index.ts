// Entry point wrapper. The core sync now resolves every same-room reservation
// candidate into a contiguous same-guest stay before it classifies checkout vs
// daily work. Keep historical checkout rows visible here: deleting them at the
// HTTP boundary would lose the nights needed to carry service history into an
// extension reservation.
await import("./core.ts");
