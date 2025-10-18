import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toaster]:bg-green-50 dark:group-[.toaster]:bg-green-950 group-[.toaster]:text-green-900 dark:group-[.toaster]:text-green-100 group-[.toaster]:border-green-500 dark:group-[.toaster]:border-green-700",
          error:
            "group-[.toaster]:bg-red-50 dark:group-[.toaster]:bg-red-950 group-[.toaster]:text-red-900 dark:group-[.toaster]:text-red-100 group-[.toaster]:border-red-500 dark:group-[.toaster]:border-red-700",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
