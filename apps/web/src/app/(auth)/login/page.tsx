import type { Metadata } from "next"

import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Sign in · Invoicio" }

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams
  return <LoginForm next={typeof next === "string" ? next : undefined} />
}
