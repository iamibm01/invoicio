import type { Metadata } from "next"
import { InboxIcon, TriangleAlertIcon, UploadIcon } from "lucide-react"

import { ConfidenceBadge } from "@/components/confidence-badge"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { ThemeToggle } from "@/components/theme-toggle"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { FormDemo, OverlayDemo } from "./interactive-demos"

export const metadata: Metadata = { title: "Design system · Invoicio" }

const typeScale = [
  { className: "text-display", name: "display", sample: "Invoicio" },
  { className: "text-title", name: "title", sample: "Documents awaiting review" },
  { className: "text-heading", name: "heading", sample: "Extracted fields" },
  { className: "text-body", name: "body", sample: "Low-confidence fields are flagged for review." },
  { className: "text-caption text-muted-foreground", name: "caption", sample: "Uploaded 2 minutes ago" },
]

const swatches = [
  "background", "foreground", "primary", "muted", "border",
  "success", "warning", "info", "destructive",
]

const sampleFields = [
  { field: "Vendor", value: "Careem", score: 0.98 },
  { field: "Date", value: "2026-09-18", score: 0.95 },
  { field: "Total", value: "AED 84.50", score: 0.81 },
  { field: "Tax", value: "AED 4.02", score: 0.52 },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-heading">{title}</h2>
      {children}
    </section>
  )
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-10 px-4 py-8 sm:px-6">
      <PageHeader
        title="Design system"
        description="Tokens and components every Invoicio screen is built from."
        actions={<ThemeToggle />}
      />

      <Section title="Type scale">
        <div className="flex flex-col gap-3">
          {typeScale.map((t) => (
            <div key={t.name} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6">
              <code className="w-20 shrink-0 font-mono text-caption text-muted-foreground">{t.name}</code>
              <p className={t.className}>{t.sample}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Color">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
          {swatches.map((name) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className="h-12 rounded-md border" style={{ background: `var(--${name})` }} />
              <code className="font-mono text-caption text-muted-foreground">{name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Approve</Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="outline">
            <UploadIcon data-icon="inline-start" /> Upload
          </Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Reject</Button>
          <Button variant="link">View original</Button>
          <Button disabled>Processing…</Button>
        </div>
      </Section>

      <Section title="Status">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="processing" />
            <StatusBadge status="review" />
            <StatusBadge status="done" />
            <StatusBadge status="failed" />
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="submitted" />
            <StatusBadge status="approved" />
            <StatusBadge status="rejected" />
          </div>
          <div className="flex flex-wrap gap-2">
            <ConfidenceBadge score={0.97} showLabel />
            <ConfidenceBadge score={0.78} showLabel />
            <ConfidenceBadge score={0.41} showLabel />
            <Badge variant="outline">Outline</Badge>
          </div>
        </div>
      </Section>

      <Section title="Data table">
        <Card>
          <CardHeader>
            <CardTitle>Extracted fields</CardTitle>
            <CardDescription>Fields below 90% confidence need a reviewer.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sampleFields.map((f) => (
                  <TableRow key={f.field}>
                    <TableCell className="text-muted-foreground">{f.field}</TableCell>
                    <TableCell className="tabular font-medium">{f.value}</TableCell>
                    <TableCell className="text-right">
                      <ConfidenceBadge score={f.score} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Section>

      <Section title="Form">
        <FormDemo />
      </Section>

      <Section title="Feedback">
        <div className="flex max-w-form flex-col gap-4">
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Possible duplicate</AlertTitle>
            <AlertDescription>A receipt from Careem for AED 84.50 was submitted on 18 Sep.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Validation failed</AlertTitle>
            <AlertDescription>Line items do not add up to the total.</AlertDescription>
          </Alert>
          <Progress value={60}>
            <ProgressLabel>Extracting fields</ProgressLabel>
            <ProgressValue />
          </Progress>
          <OverlayDemo />
        </div>
      </Section>

      <Section title="Loading & empty">
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <EmptyState
            icon={InboxIcon}
            title="No documents yet"
            description="Upload a receipt or invoice to start extraction."
            action={<Button size="sm">Upload</Button>}
          />
        </div>
      </Section>
    </main>
  )
}
