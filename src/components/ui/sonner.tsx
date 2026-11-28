import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

// The bundle carries two copies of sonner: the app's own (1.5) and a newer one that a
// dependency pulls in. The newer copy's stylesheet places the toast list with
// --offset-bottom / --offset-left (and --mobile-offset-* on phones), which the 1.5
// Toaster never sets. Without them the list fell back to the top edge and every toast
// slid in above the screen, so nobody saw it. Setting the per-side values keeps toasts
// at the bottom-left whichever stylesheet wins.
const PLACEMENT_VARS = {
  "--offset-top": "20px",
  "--offset-right": "20px",
  "--offset-bottom": "20px",
  "--offset-left": "20px",
  "--mobile-offset-top": "16px",
  "--mobile-offset-right": "16px",
  "--mobile-offset-bottom": "16px",
  "--mobile-offset-left": "16px",
} as React.CSSProperties

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Keep global messages below the workspace header and away from
      // the Mira launcher, which sits in the bottom-right on desktop.
      position="bottom-left"
      offset="20px"
      {...{ mobileOffset: "16px" }}
      // Dialogs use z-50 and lock outside pointer events. Keep toasts below
      // their overlay instead of showing an apparently unclickable close icon.
      style={{ zIndex: 40, ...PLACEMENT_VARS }}
      // Auto-dismiss after 4s, always dismissible (close
      // button + swipe), never more than one notification on screen.
      duration={4000}
      closeButton
      visibleToasts={1}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:max-w-[90vw] group-[.toaster]:text-sm !pr-12",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground !min-h-8",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:border-border !left-auto !right-2 !top-2 !h-8 !w-8 !translate-x-0 !translate-y-0 !transform-none !rounded-full",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
