import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail, trim } from '../../common/transforms.js';

/** Creates a new business together with its first user, who becomes its admin. */
export class RegisterDto {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  businessName: string;

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
}
