import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../generated/prisma/client.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { authUserSelect } from './auth.select.js';
import { ACCESS_TOKEN_TTL_SECONDS, type AuthUser, type JwtPayload } from './auth.types.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { hashPassword, verifyPassword } from './password.js';

export interface AuthResponse {
  accessToken: string;
  /** Seconds until the token expires — the web app uses it for the cookie lifetime */
  expiresIn: number;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const passwordHash = await hashPassword(dto.password);

    try {
      // Nested create: business and admin are inserted in one transaction.
      const business = await this.prisma.business.create({
        data: {
          name: dto.businessName,
          users: {
            create: { email: dto.email, name: dto.name, passwordHash, role: UserRole.ADMIN },
          },
        },
        select: { users: { select: authUserSelect } },
      });
      return this.issueToken(business.users[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { ...authUserSelect, passwordHash: true },
    });

    // Always run the hash comparison, even for unknown emails (see verifyPassword).
    const valid = await verifyPassword(dto.password, user?.passwordHash);
    if (!user || !valid) throw new UnauthorizedException('Invalid email or password');

    const { passwordHash: _, ...authUser } = user;
    return this.issueToken(authUser);
  }

  /** The caller plus their business name, for the app shell. */
  async me(user: AuthUser) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: user.businessId },
      select: { id: true, name: true },
    });
    return { ...user, business };
  }

  private async issueToken(user: AuthUser): Promise<AuthResponse> {
    const payload: JwtPayload = { sub: user.id };
    return {
      accessToken: await this.jwt.signAsync(payload),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user,
    };
  }
}
