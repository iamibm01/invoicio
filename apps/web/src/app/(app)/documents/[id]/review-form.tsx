"use client"

import { useActionState, useState } from "react"
import { cn } from "cn"

import { ConfidenceBadge } from "@/components/confidence-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { needsReview } from "@/lib/confidence"
import { fieldLabel, formatFieldValue, type ApiDocumentStatus, type ExtractionField } from "@/lib/documents"

import { submitReview, type ReviewFormState } from "./actions"

const LINE_ITEM_COLUMNS = ["description", "quantity", "amount"] as const
type LineItemColumn = (typeof LINE_ITEM_COLUMNS)[number]

/** Groups flattened "lineItems.N.key" fields back into one row per item. */
function groupLineItems(fields: ExtractionField[]) {
  const items = new Map<number, Partial<Record<LineItemColumn, ExtractionField>>>()
  for (const field of fields) {
    const match = /^lineItems\.(\d+)\.(\w+)$/.exec(field.path)
    if (!match) continue
    const item = items.get(Number(match[1])) ?? {}
    item[match[2] as LineItemColumn] = field
    items.set(Number(match[1]), item)
  }
  return [...items.entries()].sort(([a], [b]) => a - b)
}

interface ReviewFormProps {
  documentId: string
  status: ApiDocumentStatus
  fields: ExtractionField[]
}

/**
 * The review screen's editable half. Inputs start from each field's current
 * value; edits live in local state until submitted, and only changed fields
 * are sent. After a successful save the page re-renders with the stored
 * values, and the parent's `key` remounts this form, clearing the edits.
 */
export function ReviewForm({ documentId, status, fields }: ReviewFormProps) {
  const [edits, setEdits] = useState<Record<string, string>>({})
  // Values as of the last submit, so a field's error disappears as soon as
  // the reviewer changes the value it was about.
  const [submitted, setSubmitted] = useState<Record<string, string>>({})
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(
    submitReview.bind(null, documentId),
    {},
  )

  const initial = (field: ExtractionField) => field.value ?? ""
  const current = (field: ExtractionField) => edits[field.id] ?? initial(field)
  const isDirty = (field: ExtractionField) => current(field) !== initial(field)

  const changed = fields.filter(isDirty)
  const corrections = changed.map((field) => ({ fieldId: field.id, value: current(field) }))
  const reviewed = status === "DONE"

  const summary = fields.filter((f) => !f.path.startsWith("lineItems."))
  const lineItems = groupLineItems(fields)

  const input = (field: ExtractionField, className?: string) => (
    <FieldInput
      field={field}
      value={current(field)}
      dirty={isDirty(field)}
      error={current(field) === submitted[field.id] ? state.fieldErrors?.[field.path] : undefined}
      onChange={(value) => setEdits((prev) => ({ ...prev, [field.id]: value }))}
      className={className}
    />
  )

  return (
    <form
      action={formAction}
      onSubmit={() => setSubmitted(Object.fromEntries(fields.map((f) => [f.id, current(f)])))}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="corrections" value={JSON.stringify(corrections)} />

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

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
            <TableRow key={field.id} className={cn(flagged(field, reviewed) && "bg-warning/5")}>
              <TableCell className="align-top pt-3.5 text-muted-foreground">
                <label htmlFor={field.id}>{fieldLabel(field.path)}</label>
              </TableCell>
              <TableCell className="w-full">{input(field)}</TableCell>
              <TableCell className="align-top pt-3 text-right">
                <FieldBadge field={field} />
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
                <TableHead className="w-16">Qty</TableHead>
                <TableHead className="w-28">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map(([index, item]) => (
                <TableRow
                  key={index}
                  className={cn(LINE_ITEM_COLUMNS.some((c) => item[c] && flagged(item[c], reviewed)) && "bg-warning/5")}
                >
                  {LINE_ITEM_COLUMNS.map((column) => {
                    const field = item[column]
                    return (
                      <TableCell key={column} className="align-top">
                        {field && (
                          <div className="flex flex-col gap-1">
                            {input(field, column === "description" ? undefined : "text-right")}
                            {/* Only flag the cells that need attention; ten "High" badges per row would bury the one that matters. */}
                            {(field.correction || needsReview(field.confidence)) && <FieldBadge field={field} />}
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

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {changed.length > 0 && (
          <Button type="button" variant="ghost" onClick={() => setEdits({})} disabled={pending}>
            Discard changes
          </Button>
        )}
        {/* Confirming with no edits is meaningful: the reviewer is saying the values are right. */}
        <Button type="submit" disabled={pending || (reviewed && changed.length === 0)}>
          {pending ? "Saving…" : reviewed ? "Save changes" : "Confirm review"}
          {changed.length > 0 && !pending && ` (${changed.length})`}
        </Button>
      </div>
    </form>
  )
}

/** Low-confidence fields stay highlighted until a person has confirmed or corrected them. */
function flagged(field: ExtractionField, reviewed: boolean): boolean {
  return !reviewed && !field.correction && needsReview(field.confidence)
}

/**
 * A corrected field shows who corrected it instead of the model's confidence.
 * That score was about the model's answer, not about the value now shown.
 */
function FieldBadge({ field }: { field: ExtractionField }) {
  if (field.correction) return <Badge variant="info">Corrected</Badge>
  return <ConfidenceBadge score={field.confidence} />
}

interface FieldInputProps {
  field: ExtractionField
  value: string
  dirty: boolean
  error?: string
  onChange: (value: string) => void
  className?: string
}

function FieldInput({ field, value, dirty, error, onChange, className }: FieldInputProps) {
  // Native inputs per type: a date picker for dates (value is already ISO),
  // the decimal keypad on phones for amounts. Amounts use type="text" rather
  // than type="number" so "1,234.50" can be typed; the API normalises it.
  const typeProps =
    field.valueType === "DATE"
      ? { type: "date" }
      : field.valueType === "MONEY" || field.valueType === "NUMBER"
        ? { type: "text", inputMode: "decimal" as const, className: "tabular" }
        : field.valueType === "CURRENCY_CODE"
          ? { type: "text", maxLength: 3, className: "uppercase", autoCapitalize: "characters" }
          : { type: "text" }

  const errorId = `${field.id}-error`
  const showOriginal = field.correction && field.aiValue !== field.value

  return (
    <div className="flex flex-col gap-1">
      <Input
        id={field.id}
        {...typeProps}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Not on document"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(typeProps.className, dirty && !error && "border-info", className)}
      />
      {error && (
        <p id={errorId} className="text-caption text-destructive">
          {error}
        </p>
      )}
      {showOriginal && field.correction && (
        <p className="text-caption text-muted-foreground">
          Model read “{formatFieldValue({ valueType: field.valueType, value: field.aiValue })}” · corrected by{" "}
          {field.correction.by}
        </p>
      )}
    </div>
  )
}
