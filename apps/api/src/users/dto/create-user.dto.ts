import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '../../generated/prisma/client.js';
import { normalizeEmail, trim } from '../../common/transforms.js';

export class CreateUserDto {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @Transform(normalizeEmail)
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;
}
