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

  async isBlocked(emailKey: string, ip: string): Promise<boolean> {
    const since = this.since();
    const [byEmail, byIp] = await Promise.all([
      this.prisma.loginAttempt.count({ where: { emailKey, createdAt: { gte: since } } }),
      this.prisma.loginAttempt.count({ where: { ip, createdAt: { gte: since } } }),
    ]);
    return byEmail >= AUTH.maxFailuresPerEmail || byIp >= AUTH.maxFailuresPerIp;
  }

  async recordFailure(emailKey: string, ip: string): Promise<void> {
    await this.prisma.$transaction([
      // Keep the table small: rows outside the window are never needed again.
      this.prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: this.since() } } }),
      this.prisma.loginAttempt.create({ data: { emailKey, ip } }),
    ]);
  }

  /** A successful login clears that email's failures; the IP counter only expires. */
  async clearEmail(emailKey: string): Promise<void> {
    await this.prisma.loginAttempt.deleteMany({ where: { emailKey } });
  }
}
