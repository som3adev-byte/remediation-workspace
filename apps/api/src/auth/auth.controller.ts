import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { loginSchema, type LoginInput } from '@rw/shared';
import type { Request, Response } from 'express';
import { AUTH } from '../config/env';
import { ZodValidationPipe } from '../common/zod.pipe';
import type { Actor } from '../common/request-context';
import { CurrentActor } from './actor.decorator';
import { AuthService } from './auth.service';
import { clearSessionCookie, setSessionCookie } from './cookies';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(204)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token } = await this.auth.login(body, req.ip ?? 'unknown');
    setSessionCookie(res, token);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[AUTH.cookieName]);
    clearSessionCookie(res);
  }

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.auth.me(actor);
  }
}
