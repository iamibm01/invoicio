import { getSessionToken } from "@/lib/session"

/**
 * Same-origin upload endpoint for the browser. Streams the multipart body
 * straight through to the API with the session token attached, so the browser
 * gets real upload progress without ever holding the token or calling the API.
 * (Excluded from proxy.ts, which would otherwise buffer the body in memory.)
 */
export async function POST(request: Request) {
  const token = await getSessionToken()
  if (!token) return Response.json({ message: "Not signed in" }, { status: 401 })

  const res = await fetch(`${process.env.API_URL}/documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": request.headers.get("content-type") ?? "",
    },
    body: request.body,
    // Required by Node's fetch to send a streaming request body
    duplex: "half",
  } as RequestInit & { duplex: "half" })

  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  })
}
