import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

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
      mobileOffset="16px"
      // Dialogs use z-50 and lock outside pointer events. Keep toasts below
      // their overlay instead of showing an apparently unclickable close icon.
      style={{ zIndex: 40 }}
      // Auto-dismiss after 6s, always dismissible (close
      // button + swipe), never more than one notification on screen.
      duration={6000}
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
