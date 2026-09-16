import { IsBoolean, IsIn, IsOptional, IsString, IsArray, ArrayMaxSize } from 'class-validator';

/** Channels notifications can be delivered on. in_app is always-on/transactional. */
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'web_push'] as const;

export class ReadNotificationRequest {
  @IsString() session_token: string;
}

/** Widget bulk delete (PLN-260916 P3): explicit ids, or everything the shopper has. */
export class DeleteNotificationsRequest {
  @IsString() session_token: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) ids?: number[];
  @IsOptional() @IsBoolean() all?: boolean;
}

export class UpdatePrefRequest {
  @IsString() session_token: string;
  @IsString() @IsIn(NOTIFICATION_CHANNELS as unknown as string[]) channel: string;
  @IsString() category: string;
  @IsBoolean() enabled: boolean;
}

/**
 * Not currently bound to the controller (it reads the params individually), but
 * kept consistent with the other widget list queries: `session_token` must stay
 * optional because `@SessionToken()` takes it from the `X-Session-Token` header
 * (PRV-M7/FE-M3). Requiring it here would 400 every widget GET if wired up.
 */
export class ListNotificationsQuery {
  @IsOptional() @IsString() session_token?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
}

/**
 * Marketing refusal (PLN-260817-Widget-Header-Prefs-Cleanup). One boolean, not
 * a grid: the server owns which categories count as marketing so the widget and
 * the delivery rules cannot disagree about it.
 */
export class SetMarketingOptOutRequest {
  // Carried in the body like the sibling PUT /prefs: @SessionToken() only reads
  // the header, query and path, so a body-only token would 401 here.
  @IsString()
  session_token: string;

  @IsBoolean()
  opt_out: boolean;
}
