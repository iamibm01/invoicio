"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CameraIcon, CheckIcon, FileTextIcon, ImageIcon, UploadIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { UploadResult } from "@/lib/documents"
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES, formatBytes, validateUpload } from "@/lib/upload-rules"

type UploadStatus = "waiting" | "uploading" | "done" | "duplicate" | "error"

interface UploadItem {
  id: string
  file: File
  /** Object URL for JPG/PNG thumbnails; PDFs and HEIC (unsupported by most browsers) get an icon */
  previewUrl?: string
  status: UploadStatus
  progress: number
  error?: string
}

const MAX_PARALLEL_UPLOADS = 3

export function UploadDropzone() {
  const router = useRouter()
  const [items, setItems] = useState<UploadItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const queueRef = useRef<UploadItem[]>([])
  const activeRef = useRef(0)
  // Thumbnail object URLs still alive, so they can be released on unmount
  const previewUrlsRef = useRef(new Set<string>())

  useEffect(() => {
    const previewUrls = previewUrlsRef.current
    return () => previewUrls.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function addFiles(files: FileList | File[]) {
    const added: UploadItem[] = Array.from(files).map((file) => {
      const error = validateUpload(file)
      const previewUrl = !error && ["image/jpeg", "image/png"].includes(file.type) ? URL.createObjectURL(file) : undefined
      if (previewUrl) previewUrlsRef.current.add(previewUrl)
      return {
        id: crypto.randomUUID(),
        file,
        previewUrl,
        status: error ? "error" : "waiting",
        progress: 0,
        error: error ?? undefined,
      }
    })
    setItems((current) => [...added, ...current])
    queueRef.current.push(...added.filter((item) => item.status === "waiting"))
    pumpQueue()
  }

  /** Starts uploads until MAX_PARALLEL_UPLOADS are in flight; refreshes the page data once all finish. */
  function pumpQueue() {
    while (activeRef.current < MAX_PARALLEL_UPLOADS && queueRef.current.length > 0) {
      const item = queueRef.current.shift()!
      activeRef.current++
      updateItem(item.id, { status: "uploading" })
      uploadFile(item.file, (progress) => updateItem(item.id, { progress }))
        .then((result) => updateItem(item.id, { status: result.duplicate ? "duplicate" : "done", progress: 100 }))
        .catch((error: Error) => updateItem(item.id, { status: "error", error: error.message }))
        .finally(() => {
          activeRef.current--
          if (activeRef.current === 0 && queueRef.current.length === 0) router.refresh()
          pumpQueue()
        })
    }
  }

  function removeItem(item: UploadItem) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl)
      previewUrlsRef.current.delete(item.previewUrl)
    }
    setItems((current) => current.filter((i) => i.id !== item.id))
  }

  function clearFinished() {
    items.filter((i) => i.status !== "waiting" && i.status !== "uploading").forEach(removeItem)
  }

  const hasFinished = items.some((i) => i.status !== "waiting" && i.status !== "uploading")

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
          isDragging ? "border-foreground/40 bg-muted" : "bg-muted/30"
        )}
      >
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <UploadIcon className="size-5 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-heading">
            <span className="hidden sm:inline">Drop receipts and invoices here</span>
            <span className="sm:hidden">Add receipts and invoices</span>
          </p>
          <p className="text-caption text-muted-foreground">
            PDF, JPG, PNG or HEIC · up to {formatBytes(MAX_UPLOAD_BYTES)} each
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {/* On phones this opens the rear camera directly; desktops fall back to a file picker */}
          <Button className="sm:hidden" onClick={() => cameraInputRef.current?.click()}>
            <CameraIcon data-icon="inline-start" />
            Take photo
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            Choose files
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files)
            e.target.value = "" // allow picking the same file again
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-caption text-muted-foreground">
              {items.filter((i) => i.status === "done" || i.status === "duplicate").length} of {items.length} uploaded
            </p>
            {hasFinished && (
              <Button variant="ghost" size="sm" onClick={clearFinished}>
                Clear finished
              </Button>
            )}
          </div>
          <ul className="flex flex-col divide-y rounded-lg border">
            {items.map((item) => (
              <UploadRow key={item.id} item={item} onRemove={() => removeItem(item)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function UploadRow({ item, onRemove }: { item: UploadItem; onRemove: () => void }) {
  const Icon = item.file.type === "application/pdf" || item.file.name.toLowerCase().endsWith(".pdf") ? FileTextIcon : ImageIcon
  const busy = item.status === "waiting" || item.status === "uploading"

  return (
    <li className="flex items-center gap-3 p-3">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
        {item.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL, nothing to optimize
          <img src={item.previewUrl} alt="" className="size-full object-cover" />
        ) : (
          <Icon className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-body font-medium">{item.file.name}</p>
        {item.status === "uploading" || item.status === "waiting" ? (
          <Progress value={item.progress} aria-label={`Uploading ${item.file.name}`} />
        ) : (
          <p
            className={cn(
              "text-caption tabular",
              item.status === "error" ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {item.status === "error" && item.error}
            {item.status === "duplicate" && "Already uploaded — not added again"}
            {item.status === "done" && `${formatBytes(item.file.size)} · queued for extraction`}
          </p>
        )}
      </div>
      {item.status === "done" && <CheckIcon className="size-4 shrink-0 text-success" aria-label="Uploaded" />}
      {!busy && (
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.file.name} from list`} onClick={onRemove}>
          <XIcon />
        </Button>
      )}
    </li>
  )
}

/** XHR rather than fetch: fetch has no upload progress events. */
function uploadFile(file: File, onProgress: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/documents")
    xhr.responseType = "json"
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response as UploadResult)
      const body = xhr.response as { message?: string | string[] } | null
      const message = Array.isArray(body?.message) ? body.message[0] : body?.message
      reject(
        new Error(xhr.status === 413 ? `Too large — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}` : (message ?? "Upload failed"))
      )
    }
    xhr.onerror = () => reject(new Error("Network error — check your connection"))

    const form = new FormData()
    form.append("file", file)
    xhr.send(form)
  })
}
