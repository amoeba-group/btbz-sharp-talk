import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { BaseSingleResponse } from '@sharptalk/types';
import { BusinessException } from '../exception/business.exception';
import { ERROR_CODE } from '../constant/error-code.constant';
import { getRequestContext } from '../middleware/request-context.middleware';

/** What the filter needs from an error reporter (PLN-261012 SG-83) — kept structural so the filter stays infrastructure-free. */
export interface ServerErrorReporter {
  report(
    err: unknown,
    ctx?: { method?: string; path?: string; status?: number; requestId?: string; source?: 'http' | 'process' },
  ): void;
}

/**
 * Global exception filter → standard error envelope (amoeba_code_convention).
 * BusinessException carries an Exxxx code; HttpException maps to generic codes;
 * everything else is E9001 (and logged).
 */
@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionFilter.name);

  /** Optional so specs and any bare `new AllExceptionFilter()` keep working. */
  constructor(private readonly reporter?: ServerErrorReporter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODE.INTERNAL_ERROR.code;
    let message: string = ERROR_CODE.INTERNAL_ERROR.message;
    let details: Record<string, string[]> | undefined;

    if (exception instanceof BusinessException) {
      status = exception.getStatus();
      code = exception.errorCode;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : ((body as any).message ?? message);
      if (Array.isArray(message)) {
        details = { _: message as string[] };
        message = ERROR_CODE.VALIDATION_FAILED.message;
        code = ERROR_CODE.VALIDATION_FAILED.code;
      } else if (status === HttpStatus.UNAUTHORIZED) {
        code = ERROR_CODE.UNAUTHORIZED.code;
      } else if (status === HttpStatus.FORBIDDEN) {
        code = ERROR_CODE.FORBIDDEN.code;
      } else {
        code = ERROR_CODE.RESOURCE_NOT_FOUND.code;
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    // Server-side failures only (PLN-261012 SG-83): a 4xx is the caller's mistake and would bury the
    // signal. Handled 5xx (a BusinessException/HttpException with a 5xx status) used to leave NO trace
    // at all — "no error in logs ≠ request succeeded" — so they are logged here and reported too.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      try {
        const req = host.switchToHttp().getRequest<{ method?: string; path?: string }>();
        if (exception instanceof HttpException) {
          this.logger.error(`${req?.method ?? ''} ${req?.path ?? ''} -> ${status} ${code}`);
        }
        this.reporter?.report(exception, {
          method: req?.method,
          path: req?.path,
          status,
          requestId: getRequestContext()?.requestId,
          source: 'http',
        });
      } catch {
        /* reporting must never change the response */
      }
    }

    const payload: BaseSingleResponse<null> = {
      success: false,
      data: null,
      error: { code, message, details },
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(payload);
  }
}
