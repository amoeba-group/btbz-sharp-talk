import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** PATCH /admin/products/:handle/room-count — snake_case (PLN-261023). null clears. */
export class UpdateRoomCountRequest {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  room_count?: number | null;
}
