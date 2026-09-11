// Entry point wrapper. The existing implementation lives in core.ts so the
// shared Previo guards can normalize the reservation search and stale
// extension/checkout races before the poll consumes reservation data.
import { installPrevioOverlapSearchGuard } from "../_shared/previoOverlapSearchGuard.ts";
import { installPrevioRoomStateGuard } from "../_shared/previoRoomStateGuard.ts";

installPrevioOverlapSearchGuard();
installPrevioRoomStateGuard();
await import("./core.ts");
