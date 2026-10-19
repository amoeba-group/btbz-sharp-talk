import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { NotionAuthError, NotionRequestError, NOT_FOUND_CODE } from './notion.client';
import { DriveAuthError, DriveRequestError } from './gdrive.client';
import { SourceCredentialError, SourceTargetError } from './source-adapter.interface';

/** Same clamp as the reason stored on the source row, so the two never differ. */
export const SYNC_REASON_MAX = 200;

export function syncReasonOf(e: unknown): string {
  return ((e as Error)?.message || String(e)).slice(0, SYNC_REASON_MAX);
}

/**
 * Turn a sync failure into the error the API should answer with (PLN-261019).
 *
 * Three kinds are worth telling apart, because each sends the operator to a
 * different place: the target (share it, un-trash it, fix the id — 422), the
 * credential (register or replace the token — 422), and the provider itself
 * (rate limit, timeout, outage — 502, nothing to fix on our side). Anything
 * else is a plain Error from our own code and stays a 500 with its stack.
 *
 * Decided on classes, never on message text: Notion's wording is theirs to
 * change, and a regex on it is the kind of fallback that silently stops
 * matching (FIX-260828).
 */
export function classifySyncError(e: unknown): BusinessException | null {
  const details = { reason: [syncReasonOf(e)] };
  if (e instanceof SourceTargetError) {
    return new BusinessException(ERROR_CODE.KB_SOURCE_TARGET_UNREACHABLE, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
  if (e instanceof SourceCredentialError || e instanceof NotionAuthError || e instanceof DriveAuthError) {
    return new BusinessException(ERROR_CODE.KB_SOURCE_CREDENTIAL_INVALID, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
  if (e instanceof NotionRequestError) {
    // 404 is both "no such object" and "not shared with this integration";
    // the operator's fix is the same either way.
    if (e.status === 404 || e.code === NOT_FOUND_CODE) {
      return new BusinessException(ERROR_CODE.KB_SOURCE_TARGET_UNREACHABLE, HttpStatus.UNPROCESSABLE_ENTITY, details);
    }
    return new BusinessException(ERROR_CODE.KB_SOURCE_UPSTREAM_FAILED, HttpStatus.BAD_GATEWAY, details);
  }
  if (e instanceof DriveRequestError) {
    // The Drive client folds the status into the message; 404 is the only
    // status it reports that the operator can fix (share the folder).
    if (/\(404\)/.test(e.message)) {
      return new BusinessException(ERROR_CODE.KB_SOURCE_TARGET_UNREACHABLE, HttpStatus.UNPROCESSABLE_ENTITY, details);
    }
    return new BusinessException(ERROR_CODE.KB_SOURCE_UPSTREAM_FAILED, HttpStatus.BAD_GATEWAY, details);
  }
  return null;
}
