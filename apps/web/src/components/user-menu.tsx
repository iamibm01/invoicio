"use client"

import { LogOutIcon } from "lucide-react"

import { logout } from "@/app/(auth)/actions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SessionUser } from "@/lib/auth-types"

const roleLabels: Record<SessionUser["role"], string> = {
  ADMIN: "Admin",
  APPROVER: "Approver",
  SUBMITTER: "Submitter",
}

export function UserMenu({ user }: { user: SessionUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="max-w-48" />}>
        <span className="truncate">{user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate text-foreground">{user.email}</span>
            <span className="block text-caption font-normal text-muted-foreground">
              {roleLabels[user.role]} · {user.business.name}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout()}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
