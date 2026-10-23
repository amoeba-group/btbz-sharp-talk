import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Request DTOs — snake_case (amoeba_code_convention). PLN-261024. */

/** Same shape the stored code takes after `canonicalRegion` folding (spaces/hyphens become `_`). */
export const ROUTING_CATEGORY_CODE_INPUT = /^[A-Za-z0-9_\- ]{1,64}$/;

export class CreateRoutingCategoryRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(ROUTING_CATEGORY_CODE_INPUT)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class RoutingCategoryPatchItem {
  @IsString()
  @Matches(/^\d+$/)
  id: string;

  /** '' clears the name (back to the built-in / code display). Omitted = unchanged. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sort_order?: number;
}

/** PATCH /routing-categories — rename and reorder in one save. */
export class UpdateRoutingCategoriesRequest {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RoutingCategoryPatchItem)
  items: RoutingCategoryPatchItem[];
}
