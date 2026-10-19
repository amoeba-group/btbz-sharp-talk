import { HttpStatus } from '@nestjs/common';
import { classifySyncError } from './sync-error.util';
import { NotionAuthError, NotionRequestError } from './notion.client';
import { DriveAuthError, DriveRequestError } from './gdrive.client';
import { SourceCredentialError, SourceTargetError } from './source-adapter.interface';

/**
 * PLN-261019: a sync failure the operator can fix must not be a 500. The
 * go2joy FAQ page was simply not shared with the integration, and the console
 * said "Internal server error" while the fix lived in Notion's share menu.
 */
describe('classifySyncError', () => {
  const notion404 = new NotionRequestError(
    'Could not find page with ID: f0373763. Make sure the relevant pages and databases are shared with your integration "HA-UserGuide".',
    404,
    'object_not_found',
  );

  it('maps a Notion 404 / object_not_found to E5095 (422) and carries the reason', () => {
    const biz = classifySyncError(notion404)!;
    expect(biz.errorCode).toBe('E5095');
    expect(biz.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(biz.details?.reason[0]).toContain('HA-UserGuide');
  });

  it('maps object_not_found with another status the same way', () => {
    expect(classifySyncError(new NotionRequestError('gone', 400, 'object_not_found'))!.errorCode).toBe('E5095');
  });

  it('maps any other Notion refusal to E5097 (502) — nothing for the operator to fix', () => {
    const biz = classifySyncError(new NotionRequestError('is a page, not a database', 400, 'validation_error'))!;
    expect(biz.errorCode).toBe('E5097');
    expect(biz.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
  });

  it('maps rejected tokens (Notion and Drive) and missing credentials to E5096', () => {
    expect(classifySyncError(new NotionAuthError('the token was rejected'))!.errorCode).toBe('E5096');
    expect(classifySyncError(new DriveAuthError('token request failed (401)'))!.errorCode).toBe('E5096');
    expect(classifySyncError(new SourceCredentialError('no Notion integration token is registered'))!.errorCode).toBe('E5096');
  });

  it('maps adapter target errors (trash, missing id) to E5095', () => {
    expect(classifySyncError(new SourceTargetError('the Notion target "FAQ" is in the trash'))!.errorCode).toBe('E5095');
  });

  it('splits Drive request errors on the folded status: 404 is the target, the rest the provider', () => {
    expect(classifySyncError(new DriveRequestError('drive request failed (404): notFound'))!.errorCode).toBe('E5095');
    expect(classifySyncError(new DriveRequestError('drive request failed (503): backend'))!.errorCode).toBe('E5097');
  });

  it('clamps the reason to 200 characters, like the source row', () => {
    const biz = classifySyncError(new SourceTargetError('x'.repeat(500)))!;
    expect(biz.details?.reason[0]).toHaveLength(200);
  });

  it('leaves an unknown Error alone — that one really is ours', () => {
    expect(classifySyncError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBeNull();
    expect(classifySyncError('string')).toBeNull();
  });
});
