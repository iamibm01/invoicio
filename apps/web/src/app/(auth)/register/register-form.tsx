"use client"

import { useActionState } from "react"
import Link from "next/link"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { register, type AuthFormState } from "../actions"

export function RegisterForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(register, {})

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a business account</CardTitle>
        <CardDescription>You&apos;ll be the admin and can invite your team afterwards.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction}>
          <FieldGroup>
            {state.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="businessName">Business name</FieldLabel>
              <Input
                id="businessName"
                name="businessName"
                autoComplete="organization"
                required
                maxLength={120}
                defaultValue={state.values?.businessName}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="name">Your name</FieldLabel>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                required
                maxLength={120}
                defaultValue={state.values?.name}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Work email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                defaultValue={state.values?.email}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
              />
              <FieldDescription>At least 8 characters.</FieldDescription>
            </Field>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Creating account…" : "Create account"}
            </Button>
            <p className="text-center text-caption text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-foreground underline underline-offset-4">
                Sign in
              </Link>
            </p>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
