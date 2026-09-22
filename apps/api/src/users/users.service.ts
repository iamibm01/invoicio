import { ConflictException, Injectable } from '@nestjs/common';
import { authUserSelect } from '../auth/auth.select.js';
import { hashPassword } from '../auth/password.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUserDto } from './dto/create-user.dto.js';

const userSelect = { ...authUserSelect, createdAt: true };

/** Every method takes the caller's businessId — users never see another tenant. */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(businessId: string) {
    return this.prisma.user.findMany({
      where: { businessId },
      select: userSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(businessId: string, dto: CreateUserDto) {
    const passwordHash = await hashPassword(dto.password);
    try {
      return await this.prisma.user.create({
        data: { businessId, email: dto.email, name: dto.name, role: dto.role, passwordHash },
        select: userSelect,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }
}
