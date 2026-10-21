import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { LoginInput } from '@rw/shared';
import { AUTH } from '../config/env';
import { PrismaService } from '../db/prisma.service';
import { Errors } from '../common/errors';
import type { Actor } from '../common/request-context';
import { ThrottleService } from './throttle.service';
import { signAccessToken, verifyAccessToken } from './tokens';

export interface AuthenticatedRequest {
  actor: Actor;
  /** Set when the token is older than the reissue threshold; the guard writes it as a new cookie. */
  reissuedToken?: string;
}

@Injectable()
export class AuthService {
  // A real argon2id hash of random bytes. Verifying against it for unknown emails makes
  // "no such user" take as long as "wrong password".
  private readonly dummyHash = argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ThrottleService) private readonly throttle: ThrottleService,
  ) {}

  /**
   * Every failure path returns the same 401 body: unknown email, wrong password and
   * disabled account are indistinguishable. Throttled attempts return 429 for every email.
   */
  async login(input: LoginInput, ip: string): Promise<{ token: string }> {
    const emailKey = input.email; // already trimmed + lowercased by loginSchema
    if (await this.throttle.isBlocked(emailKey, ip)) throw Errors.rateLimited();

    const user = await this.prisma.user.findUnique({ where: { email: emailKey } });
    const valid = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), input.password);
    if (!user || !valid || user.disabledAt) {
      await this.throttle.recordFailure(emailKey, ip);
      throw Errors.invalidCredentials();
    }

    await this.throttle.clearEmail(emailKey);
    const session = await this.prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + AUTH.sessionTtlSeconds * 1000) },
    });
    return { token: await signAccessToken(user.id, session.id, session.expiresAt) };
  }

  /**
   * Validates a cookie token on every request:
   *   1. JWT signature, algorithm, issuer, audience, expiry (tokens.ts)
   *   2. the session row exists, is not revoked and is within its 8h cap
   *   3. the user exists and is not disabled
   * Identity, org and role come from the database rows, never from the token or the client.
   */
  async authenticate(token: string | undefined): Promise<AuthenticatedRequest> {
    if (!token) throw Errors.unauthenticated();
    const result = await verifyAccessToken(token);
    if (!result.ok) throw result.reason === 'expired' ? Errors.sessionExpired() : Errors.unauthenticated();

    const session = await this.prisma.session.findUnique({
      where: { id: result.claims.sid },
      include: { user: true },
    });
    if (
      !session ||
      session.userId !== result.claims.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.disabledAt
    ) {
      throw Errors.sessionExpired();
    }

    const actor: Actor = {
      userId: session.user.id,
      orgId: session.user.orgId,
      role: session.user.role,
      sessionId: session.id,
    };
    const age = Math.floor(Date.now() / 1000) - result.claims.iat;
    const reissuedToken =
      age >= AUTH.reissueAfterSeconds ? await signAccessToken(actor.userId, session.id, session.expiresAt) : undefined;
    return { actor, reissuedToken };
  }

  /** Revokes the session: every token issued for it stops working on the next request. */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const result = await verifyAccessToken(token);
    if (!result.ok) return;
    await this.prisma.session.updateMany({
      where: { id: result.claims.sid, userId: result.claims.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { id: true, name: true, email: true, role: true, org: { select: { id: true, name: true } } },
    });
    return user;
  }
}
