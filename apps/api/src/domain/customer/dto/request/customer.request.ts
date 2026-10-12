import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Request DTOs — snake_case (amoeba_code_convention). */
export class ListCustomersQuery {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  email?: string;

  /** Partner-hotel filter (REQ-261006 H5): exact hotelSn or a hotel-name fragment. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  hotel?: string;
}

/**
 * The same list query, carried in a body (PLN-260920 P3).
 *
 * A shopper's address in a query string ends up in every proxy access log and
 * in the operator's browser history, neither of which the retention window
 * reaches. The GET route stays for bookmarkable, address-free listing.
 */
export class SearchCustomersRequest {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  /** Partner-hotel filter (REQ-261006 H5). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  hotel?: string;
}

export class UpdateCustomerRequest {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  tier?: string;
}
