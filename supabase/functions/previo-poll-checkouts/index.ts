// Entry point wrapper. Preserve the shared reservation and same-room occupancy
// guards; Gozsdu alone also retrieves explicit same-day departure evidence when
// Previo's overlap search omits an already checked-out reservation.
import { installPrevioOverlapSearchGuard } from "../_shared/previoOverlapSearchGuard.ts";
import { installPrevioRoomStateGuard } from "../_shared/previoRoomStateGuard.ts";
import { installGozsduCheckoutPollRecovery } from "../_shared/previoGozsduCheckoutRecovery.ts";

installPrevioOverlapSearchGuard();
installPrevioRoomStateGuard();
installGozsduCheckoutPollRecovery();
await import("./core.ts");
