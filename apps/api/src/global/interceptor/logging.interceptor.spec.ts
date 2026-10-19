import { BadRequestException, HttpStatus } from '@nestjs/common';
import { statusOf } from './logging.interceptor';
import { BusinessException } from '../exception/business.exception';
import { ERROR_CODE } from '../constant/error-code.constant';

/**
 * The access log must say what the client got. An upstream client error that
 * carries its own `status` is still a 500 to the caller (PLN-261019 G3).
 */
describe('LoggingInterceptor statusOf', () => {
  it('reads the status from HttpException subclasses', () => {
    expect(statusOf(new BadRequestException())).toBe(400);
    expect(
      statusOf(new BusinessException(ERROR_CODE.KB_SOURCE_TARGET_UNREACHABLE, HttpStatus.UNPROCESSABLE_ENTITY)),
    ).toBe(422);
  });

  it('logs 500 for a plain error even when it carries a status field of its own', () => {
    const upstream = Object.assign(new Error('Could not find page'), { status: 404 });
    expect(statusOf(upstream)).toBe(500);
    expect(statusOf('boom')).toBe(500);
  });
});
