"use server"

import { redirect } from "next/navigation"

import { ApiError, apiFetch } from "@/lib/api"
import type { AuthResponse } from "@/lib/auth-types"
import { clearSession, setSession } from "@/lib/session"

export interface AuthFormState {
  error?: string
  /** Echoed back so the form keeps what the user typed (never the password) */
  values?: Record<string, string>
}

/** Only follow same-origin relative paths, so ?next= can't redirect off-site. */
function safeRedirectPath(next: FormDataEntryValue | null): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = field(formData, "email")
  try {
    const res = await apiFetch<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: field(formData, "password") }),
    })
    await setSession(res.accessToken, res.expiresIn)
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      return { error: error.message, values: { email } }
    }
    throw error
  }
  // redirect() throws, so it must stay outside the try/catch
  redirect(safeRedirectPath(formData.get("next")))
}

export async function register(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const values = {
    businessName: field(formData, "businessName"),
    name: field(formData, "name"),
    email: field(formData, "email"),
  }
  try {
    const res = await apiFetch<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ ...values, password: field(formData, "password") }),
    })
    await setSession(res.accessToken, res.expiresIn)
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      return { error: error.message, values }
    }
    throw error
  }
  redirect("/dashboard")
}

export async function logout() {
  await clearSession()
  redirect("/login")
}
