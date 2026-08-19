import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { ROLES_KEY, type AuthenticatedUser } from '../decorators';

/** Role hierarchy: a higher role satisfies any requirement below it. */
const RANK: Record<UserRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  TECHNICIAN: 2,
  VIEWER: 1,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Authentication required');

    const minimum = Math.min(...required.map((role) => RANK[role]));
    if (RANK[user.role] < minimum) {
      throw new ForbiddenException(`Requires ${required.join(' or ')} role`);
    }
    return true;
  }
}
