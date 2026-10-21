import { Inject, Injectable } from '@nestjs/common';
import { AUTH } from '../config/env';
import { PrismaService } from '../db/prisma.service';

/**
 * Failed-login throttle stored in login_attempts so it survives restarts.
 * - Keyed on the normalized submitted email whether or not the account exists, so an
 *   unknown and a real email reach the limit at the same attempt (no account probing).
 * - Also keyed on client IP. Locally every request reaches the API through the web proxy
 *   as 127.0.0.1, so the IP counter is shared by all local users (documented limitation).
 */
@Injectable()
export class ThrottleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private since() {
    return new Date(Date.now() - AUTH.throttleWindowSeconds * 1000);
  }

  /**
   * Records this attempt first, then counts. Every attempt in a burst writes its row before
   * it reads, so the n-th committed attempt always sees at least n rows: at most the first
   * `max` attempts can pass, with no lock. A blocked attempt removes its own row again so a
   * stream of 429s does not extend the window.
   */
  async begin(emailKey: string, ip: string): Promise<{ blocked: boolean; attemptId: bigint }> {
    const since = this.since();
    const [, attempt] = await this.prisma.$transaction([
      // Keep the table small: rows outside the window are never needed again.
      this.prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: since } } }),
      this.prisma.loginAttempt.create({ data: { emailKey, ip }, select: { id: true } }),
    ]);
    const [byEmail, byIp] = await Promise.all([
      this.prisma.loginAttempt.count({ where: { emailKey, createdAt: { gte: since } } }),
      this.prisma.loginAttempt.count({ where: { ip, createdAt: { gte: since } } }),
    ]);
    const blocked = byEmail > AUTH.maxFailuresPerEmail || byIp > AUTH.maxFailuresPerIp;
    return { blocked, attemptId: attempt.id };
  }

  /** Removes one attempt row (a blocked attempt, or the attempt of a successful login). */
  async release(attemptId: bigint): Promise<void> {
    await this.prisma.loginAttempt.deleteMany({ where: { id: attemptId } });
  }

  /** A successful login clears that email's failures; the IP counter only expires. */
  async clearEmail(emailKey: string): Promise<void> {
    await this.prisma.loginAttempt.deleteMany({ where: { emailKey } });
  }
}
