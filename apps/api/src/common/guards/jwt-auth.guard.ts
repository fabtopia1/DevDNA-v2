import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { BRIDGE_KEY, IS_PUBLIC_KEY, type AuthenticatedUser } from '../decorators';
import { DEV_PRINCIPAL } from '../dev-auth';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    // Bridge routes authenticate with an HMAC signature instead of a JWT.
    if (this.reflector.getAllAndOverride<boolean>(BRIDGE_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest();

    // Development bypass: inject the fake principal and skip verification
    // entirely. Deliberately placed after the @Public and @BridgeAuth checks so
    // that those routes keep behaving identically in both modes, and before any
    // header parsing so no token is required. Refused in production by the
    // config loader, which throws rather than boot.
    if (this.config.devAuthBypass) {
      request.user = { ...DEV_PRINCIPAL } satisfies AuthenticatedUser;
      return true;
    }

    const header = request.headers['authorization'] as string | undefined;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        org: string;
        email: string;
        role: AuthenticatedUser['role'];
        typ?: string;
      }>(header.slice(7), { secret: this.config.jwt.accessSecret });

      // A refresh token must never be accepted as an access token.
      if (payload.typ !== 'access') throw new Error('wrong token type');

      request.user = {
        userId: payload.sub,
        organizationId: payload.org,
        email: payload.email,
        role: payload.role,
      } satisfies AuthenticatedUser;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
