import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class AiosServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const expected = process.env.AIOS_GATEWAY_SERVICE_TOKEN;
    const authorization = context.switchToHttp().getRequest().headers
      .authorization as string | undefined;
    const provided = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';

    if (!expected || !provided || !constantTimeEqual(expected, provided)) {
      throw new UnauthorizedException('Invalid AIOS gateway credential');
    }

    return true;
  }
}

function constantTimeEqual(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
