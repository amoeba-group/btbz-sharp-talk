import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { REGION_CODES } from '@sharptalk/types';

/** GET /companies query — snake_case (amoeba_code_convention). PLN-261022 stage 2. */
export class ListCompaniesQuery {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  size?: string;

  /** Substring of the company name. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(REGION_CODES as unknown as string[])
  region?: string;
}
