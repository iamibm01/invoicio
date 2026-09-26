import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class FieldCorrectionDto {
  @IsUUID()
  fieldId: string;

  /** Raw input; null or "" means "not on the document". Normalised per value type by the service. */
  @ValidateIf((o: FieldCorrectionDto) => o.value !== null)
  @IsString()
  @MaxLength(1000)
  value: string | null;
}

export class SubmitReviewDto {
  /** Only changed fields need to be sent; unchanged values are skipped anyway. */
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => FieldCorrectionDto)
  corrections: FieldCorrectionDto[];
}
