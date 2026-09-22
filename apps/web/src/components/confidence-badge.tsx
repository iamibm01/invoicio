import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { getConfidenceLevel, type ConfidenceLevel } from "@/lib/confidence"

const levelStyles: Record<ConfidenceLevel, { variant: "success" | "warning" | "destructive"; label: string }> = {
  high: { variant: "success", label: "High" },
  medium: { variant: "warning", label: "Medium" },
  low: { variant: "destructive", label: "Low" },
}

interface ConfidenceBadgeProps {
  /** Confidence score between 0 and 1 */
  score: number
  /** Show the level name next to the percentage */
  showLabel?: boolean
  className?: string
}

export function ConfidenceBadge({ score, showLabel = false, className }: ConfidenceBadgeProps) {
  const level = getConfidenceLevel(score)
  const { variant, label } = levelStyles[level]
  const percent = Math.round(score * 100)

  return (
    <Badge
      variant={variant}
      className={cn("tabular", className)}
      aria-label={`${label} confidence, ${percent}%`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {percent}%{showLabel && <span className="font-normal opacity-80">· {label}</span>}
    </Badge>
  )
}
