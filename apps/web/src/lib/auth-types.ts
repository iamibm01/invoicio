// Mirrors the API's auth responses (apps/api/src/auth).
export type UserRole = "SUBMITTER" | "APPROVER" | "ADMIN"

export interface SessionUser {
  id: string
  businessId: string
  email: string
  name: string
  role: UserRole
  business: { id: string; name: string }
}

export interface AuthResponse {
  accessToken: string
  expiresIn: number
  user: Omit<SessionUser, "business">
}
