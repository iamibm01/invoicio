import type { LucideIcon } from "lucide-react"
import { cn } from "cn"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center",
        className
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-heading">{title}</p>
        {description && <p className="text-body text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
