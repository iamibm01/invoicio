import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../generated/prisma/enums.js';
import { RolesGuard } from './roles.guard.js';

function contextFor(role: UserRole | undefined): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const requireRoles = (roles: UserRole[] | undefined) =>
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  afterEach(() => vi.restoreAllMocks());

  it('allows any signed-in user when the route declares no roles', () => {
    requireRoles(undefined);
    expect(guard.canActivate(contextFor(UserRole.SUBMITTER))).toBe(true);
  });

  it('allows a user whose role is listed', () => {
    requireRoles([UserRole.ADMIN, UserRole.APPROVER]);
    expect(guard.canActivate(contextFor(UserRole.APPROVER))).toBe(true);
  });

  it('forbids a user whose role is not listed', () => {
    requireRoles([UserRole.ADMIN]);
    expect(() => guard.canActivate(contextFor(UserRole.SUBMITTER))).toThrow(ForbiddenException);
  });

  it('forbids when no user is attached', () => {
    requireRoles([UserRole.ADMIN]);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });
});
