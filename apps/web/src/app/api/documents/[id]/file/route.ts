import { getSessionToken } from "@/lib/session"

/** Streams an original document from the API (tenant check happens there). */
export async function GET(_request: Request, { params }: RouteContext<"/api/documents/[id]/file">) {
  const token = await getSessionToken()
  if (!token) return new Response(null, { status: 401 })

  const { id } = await params
  const res = await fetch(`${process.env.API_URL}/documents/${encodeURIComponent(id)}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return new Response(null, { status: res.status })

  const headers = new Headers({ "Cache-Control": "private, no-store" })
  for (const name of ["content-type", "content-disposition", "content-length"]) {
    const value = res.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(res.body, { headers })
}
