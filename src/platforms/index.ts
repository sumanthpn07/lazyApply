import { Platform } from '../types';
import { BasePlatformHandler } from './base';
import { LinkedInHandler } from './linkedin';
import { LeverHandler } from './lever';
import { GreenhouseHandler } from './greenhouse';
import { WellfoundHandler } from './wellfound';
import { WorkableHandler } from './workable';

/**
 * Platform Registry
 *
 * Central registry for all platform handlers
 */

// Initialize handlers
const handlers: Record<string, BasePlatformHandler> = {
  linkedin: new LinkedInHandler(),
  lever: new LeverHandler(),
  greenhouse: new GreenhouseHandler(),
  wellfound: new WellfoundHandler(),
  workable: new WorkableHandler(),
};

/**
 * Generic handler for unsupported platforms
 * Opens the job URL and attempts basic form filling
 */
class GenericHandler extends BasePlatformHandler {
  constructor() {
    super('unknown', 'Generic');
  }

  async isApplicationPage(): Promise<boolean> {
    return true;
  }

  async apply(
    page: any,
    job: any,
    profileService: any
  ): Promise<any> {
    // Try to fill common fields
    await this.fillCommonFields(page, profileService);

    return {
      success: false,
      jobId: job.id,
      status: 'needs_input',
      message: `Platform "${job.platform}" requires manual application. Form has been partially filled.`,
      requiredInputs: [],
    };
  }
}

const genericHandler = new GenericHandler();

/**
 * Get the appropriate handler for a platform
 */
export function getPlatformHandler(platform: Platform): BasePlatformHandler {
  return handlers[platform] || genericHandler;
}

/**
 * Check if a platform is supported
 */
export function isPlatformSupported(platform: Platform): boolean {
  return platform in handlers;
}

/**
 * Get list of supported platforms
 */
export function getSupportedPlatforms(): Platform[] {
  return Object.keys(handlers) as Platform[];
}

/**
 * Register a custom platform handler
 */
export function registerPlatformHandler(
  platform: Platform,
  handler: BasePlatformHandler
): void {
  handlers[platform] = handler;
}

// Export handlers for direct use if needed
export {
  BasePlatformHandler,
  LinkedInHandler,
  LeverHandler,
  GreenhouseHandler,
  WellfoundHandler,
  WorkableHandler,
  GenericHandler,
};
