import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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

  /** b2c | b2b_contact (PLN-261022 stage 2); omitted = both. */
  @IsOptional()
  @IsIn(['b2c', 'b2b_contact'])
  customer_type?: string;
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

  /** b2c | b2b_contact (PLN-261022 stage 2); omitted = both. */
  @IsOptional()
  @IsIn(['b2c', 'b2b_contact'])
  customer_type?: string;
}

export class UpdateCustomerRequest {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  tier?: string;
}
