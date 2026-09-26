import { cn } from "cn"

import { ConfidenceBadge } from "@/components/confidence-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { needsReview } from "@/lib/confidence"
import { fieldLabel, formatFieldValue, type ExtractionField } from "@/lib/documents"

const LINE_ITEM_COLUMNS = ["description", "quantity", "amount"] as const

/** Groups flattened "lineItems.N.key" rows back into one object per item. */
function groupLineItems(fields: ExtractionField[]) {
  const items = new Map<number, Partial<Record<(typeof LINE_ITEM_COLUMNS)[number], ExtractionField>>>()
  for (const field of fields) {
    const match = /^lineItems\.(\d+)\.(\w+)$/.exec(field.path)
    if (!match) continue
    const index = Number(match[1])
    const item = items.get(index) ?? {}
    item[match[2] as (typeof LINE_ITEM_COLUMNS)[number]] = field
    items.set(index, item)
  }
  return [...items.entries()].sort(([a], [b]) => a - b)
}

function Value({ field, className }: { field: ExtractionField; className?: string }) {
  const numeric = field.valueType === "MONEY" || field.valueType === "NUMBER"
  return (
    <span className={cn(numeric && "tabular", field.value === null && "text-muted-foreground", className)}>
      {formatFieldValue(field)}
    </span>
  )
}

/*
 * Every field keeps its confidence, but the visual weight follows the review
 * rule: rows below the high threshold get a tinted background, so the eye
 * lands on what needs checking. In the line-item table a badge is shown only
 * on those cells; ten "High" badges per row would drown out the one that matters.
 */
export function ExtractedFields({ fields }: { fields: ExtractionField[] }) {
  const summary = fields.filter((f) => !f.path.startsWith("lineItems."))
  const lineItems = groupLineItems(fields)

  return (
    <div className="flex flex-col gap-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Value</TableHead>
            <TableHead className="text-right">Confidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.map((field) => (
            <TableRow key={field.id} className={cn(needsReview(field.confidence) && "bg-warning/5")}>
              <TableCell className="text-muted-foreground">{fieldLabel(field.path)}</TableCell>
              <TableCell className="max-w-0 w-full">
                <Value field={field} className="block truncate font-medium" />
              </TableCell>
              <TableCell className="text-right">
                <ConfidenceBadge score={field.confidence} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <section className="flex flex-col gap-2">
        <h3 className="text-heading">Line items</h3>
        {lineItems.length === 0 ? (
          <p className="text-body text-muted-foreground">No line items on this document.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map(([index, item]) => (
                <TableRow
                  key={index}
                  className={cn(
                    LINE_ITEM_COLUMNS.some((c) => item[c] && needsReview(item[c].confidence)) && "bg-warning/5",
                  )}
                >
                  {LINE_ITEM_COLUMNS.map((column) => {
                    const field = item[column]
                    return (
                      <TableCell
                        key={column}
                        className={cn(column === "description" ? "max-w-0 w-full whitespace-normal" : "text-right")}
                      >
                        {field && (
                          <div
                            className={cn(
                              "flex items-center gap-2",
                              column === "description" ? "justify-between" : "justify-end",
                            )}
                          >
                            <Value field={field} />
                            {needsReview(field.confidence) && <ConfidenceBadge score={field.confidence} />}
                          </div>
                        )}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  )
}
