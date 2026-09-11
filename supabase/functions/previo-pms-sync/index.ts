// Entry point wrapper. The existing implementation lives in core.ts so the
// shared Previo room-state guard can normalize stale extension/checkout races
// before the PMS snapshot consumes reservation data.
import { installPrevioRoomStateGuard } from "../_shared/previoRoomStateGuard.ts";

installPrevioRoomStateGuard();
await import("./core.ts");
