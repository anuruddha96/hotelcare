import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, onMouseEnter, onMouseLeave, onOpenAutoFocus, ...props }, ref) => {
  // Compatibility guard for the old Hotel Room Overview hover menu.
  //
  // The live room board still contains a legacy controlled Popover that opens
  // from onMouseEnter and has no onOpenChange handler. That combination makes
  // it appear while users simply move across room chips and also means an
  // outside click cannot reliably dismiss it. Room operations are now owned by
  // RoomOperationsWrapper (click-driven, centered dialog), so do not render
  // this one legacy hover surface at all. Keep every other app popover intact.
  const isLegacyRoomOverviewHover =
    typeof className === "string" &&
    className.includes("w-80") &&
    className.includes("max-w-[calc(100vw-1rem)]") &&
    className.includes("p-0") &&
    className.includes("shadow-lg") &&
    Boolean(onMouseEnter) &&
    Boolean(onMouseLeave) &&
    Boolean(onOpenAutoFocus)

  if (isLegacyRoomOverviewHover) return null

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onOpenAutoFocus={onOpenAutoFocus}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent }
