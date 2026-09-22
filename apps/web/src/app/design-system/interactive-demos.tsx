"use client"

import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

const categories = [
  { value: "travel", label: "Travel" },
  { value: "software", label: "Software & subscriptions" },
  { value: "meals", label: "Meals" },
  { value: "office", label: "Office supplies" },
]

export function FormDemo() {
  return (
    <FieldGroup className="max-w-form">
      <Field>
        <FieldLabel htmlFor="vendor">Vendor</FieldLabel>
        <Input id="vendor" defaultValue="Careem" />
      </Field>
      <Field data-invalid>
        <FieldLabel htmlFor="total">Total</FieldLabel>
        <Input id="total" defaultValue="1,240.00" aria-invalid className="tabular" />
        <FieldError>Line items add up to 1,204.00 — check the total.</FieldError>
      </Field>
      <Field>
        <FieldLabel>Category</FieldLabel>
        <Select items={categories}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="note">Note</FieldLabel>
        <Textarea id="note" placeholder="Optional context for the approver" />
        <FieldDescription>Visible to approvers on this document.</FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <Checkbox id="billable" />
        <FieldLabel htmlFor="billable">Billable to client</FieldLabel>
      </Field>
    </FieldGroup>
  )
}

export function OverlayDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger render={<Button variant="outline" />}>Reject document</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this receipt?</DialogTitle>
            <DialogDescription>
              The submitter will be notified. The extraction and any corrections are kept in the audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button variant="destructive">Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button variant="outline" onClick={() => toast.success("Receipt approved")}>
        Success toast
      </Button>
      <Button variant="outline" onClick={() => toast.error("Extraction failed — retrying (2/3)")}>
        Error toast
      </Button>
    </div>
  )
}
