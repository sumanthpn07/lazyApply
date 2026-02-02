import { Platform } from '../types';
import { getRateLimitConfig } from '../config';
import { logger, logRateLimit } from './logger';

interface PlatformUsage {
  hourlyCount: number;
  dailyCount: number;
  lastApplicationTime: number;
  hourlyResetTime: number;
  dailyResetTime: number;
}

class RateLimiter {
  private usage: Map<Platform, PlatformUsage> = new Map();

  constructor() {
    // Initialize usage tracking for all platforms
    this.resetDailyLimits();
  }

  private getUsage(platform: Platform): PlatformUsage {
    if (!this.usage.has(platform)) {
      const now = Date.now();
      this.usage.set(platform, {
        hourlyCount: 0,
        dailyCount: 0,
        lastApplicationTime: 0,
        hourlyResetTime: now + 3600000, // 1 hour
        dailyResetTime: now + 86400000, // 24 hours
      });
    }
    return this.usage.get(platform)!;
  }

  private checkAndResetLimits(platform: Platform): void {
    const usage = this.getUsage(platform);
    const now = Date.now();

    // Reset hourly limit if needed
    if (now >= usage.hourlyResetTime) {
      usage.hourlyCount = 0;
      usage.hourlyResetTime = now + 3600000;
      logger.debug(`Hourly limit reset for ${platform}`);
    }

    // Reset daily limit if needed
    if (now >= usage.dailyResetTime) {
      usage.dailyCount = 0;
      usage.dailyResetTime = now + 86400000;
      logger.debug(`Daily limit reset for ${platform}`);
    }
  }

  /**
   * Check if we can apply to a job on this platform
   */
  canApply(platform: Platform): { allowed: boolean; waitTime?: number; reason?: string } {
    this.checkAndResetLimits(platform);

    const config = getRateLimitConfig(platform);
    const usage = this.getUsage(platform);
    const now = Date.now();

    // Check daily limit
    if (usage.dailyCount >= config.dailyLimit) {
      const waitTime = usage.dailyResetTime - now;
      logRateLimit(platform, new Date(usage.dailyResetTime));
      return {
        allowed: false,
        waitTime,
        reason: `Daily limit reached (${config.dailyLimit}). Resets in ${Math.ceil(waitTime / 60000)} minutes.`,
      };
    }

    // Check hourly limit
    if (usage.hourlyCount >= config.hourlyLimit) {
      const waitTime = usage.hourlyResetTime - now;
      logRateLimit(platform, new Date(usage.hourlyResetTime));
      return {
        allowed: false,
        waitTime,
        reason: `Hourly limit reached (${config.hourlyLimit}). Resets in ${Math.ceil(waitTime / 60000)} minutes.`,
      };
    }

    // Check minimum delay between applications
    const timeSinceLastApp = now - usage.lastApplicationTime;
    if (timeSinceLastApp < config.delayMin) {
      const waitTime = config.delayMin - timeSinceLastApp;
      return {
        allowed: false,
        waitTime,
        reason: `Please wait ${Math.ceil(waitTime / 1000)} seconds before next application.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a successful application
   */
  recordApplication(platform: Platform): void {
    this.checkAndResetLimits(platform);

    const usage = this.getUsage(platform);
    usage.hourlyCount++;
    usage.dailyCount++;
    usage.lastApplicationTime = Date.now();

    logger.debug(
      `Recorded application for ${platform}. Hourly: ${usage.hourlyCount}, Daily: ${usage.dailyCount}`
    );
  }

  /**
   * Get random delay between min and max for human-like behavior
   */
  getRandomDelay(platform: Platform): number {
    const config = getRateLimitConfig(platform);
    return Math.floor(Math.random() * (config.delayMax - config.delayMin + 1)) + config.delayMin;
  }

  /**
   * Get current usage stats
   */
  getStats(): Record<Platform, { hourly: number; daily: number; hourlyLimit: number; dailyLimit: number }> {
    const stats: Record<string, any> = {};

    for (const [platform, usage] of this.usage.entries()) {
      const config = getRateLimitConfig(platform);
      stats[platform] = {
        hourly: usage.hourlyCount,
        daily: usage.dailyCount,
        hourlyLimit: config.hourlyLimit,
        dailyLimit: config.dailyLimit,
      };
    }

    return stats as any;
  }

  /**
   * Reset all daily limits (call at midnight)
   */
  resetDailyLimits(): void {
    this.usage.clear();
    logger.info('All rate limits have been reset');
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();
