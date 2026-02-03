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
 * Opens the job URL and attempts basic form filling and submission
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
    this.log(`Starting generic application for ${job.company}`, 'info');

    try {
      // Give page time to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if we're on a login page
      if (await this.isLoginPage(page)) {
        this.log('Detected login page', 'info');
        return {
          success: false,
          jobId: job.id,
          status: 'login_required' as const,
          message: 'This site requires login. Please login in the browser window.',
          loginUrl: page.url(),
        };
      }

      // Try to find and click the apply button first
      const applyClicked = await this.findAndClickApplyButton(page);
      if (applyClicked) {
        this.log('Clicked apply button', 'info');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Try to fill common fields
      await this.fillCommonFields(page, profileService);

      // Fill in any visible form fields
      const profile = profileService.getProfile();
      if (profile) {
        // Try to fill more specific fields
        await this.fillAllVisibleFields(page, profile, profileService, job);
      }

      // Try to find and click submit button
      const submitted = await this.attemptGenericSubmit(page);

      if (submitted) {
        // Wait and check for success
        await new Promise(resolve => setTimeout(resolve, 3000));

        if (await this.checkForSuccess(page)) {
          this.log('Application submitted successfully!', 'info');
          return {
            success: true,
            jobId: job.id,
            status: 'applied',
            message: 'Successfully applied via generic form submission',
          };
        }
      }

      // Check for errors
      const error = await this.checkForErrors(page);
      if (error) {
        return {
          success: false,
          jobId: job.id,
          status: 'failed',
          message: error,
          error,
        };
      }

      // Couldn't complete automatically
      return {
        success: false,
        jobId: job.id,
        status: 'needs_input',
        message: `Platform "${job.platform}" may require manual completion. Form has been partially filled.`,
        requiredInputs: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Generic apply error: ${errorMessage}`, 'error');
      return {
        success: false,
        jobId: job.id,
        status: 'failed',
        message: `Application failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Fill all visible form fields based on their labels/names
   */
  private async fillAllVisibleFields(
    page: any,
    profile: any,
    profileService: any,
    job: any
  ): Promise<void> {
    // Common field patterns and their values
    const fieldPatterns = [
      { patterns: ['first.?name', 'fname'], value: profile.personalInfo.firstName },
      { patterns: ['last.?name', 'lname'], value: profile.personalInfo.lastName },
      { patterns: ['full.?name', 'name'], value: profile.personalInfo.name },
      { patterns: ['email', 'e-mail'], value: profile.personalInfo.email },
      { patterns: ['phone', 'tel', 'mobile'], value: profile.personalInfo.phone },
      { patterns: ['linkedin'], value: profile.personalInfo.linkedin },
      { patterns: ['github', 'portfolio'], value: profile.personalInfo.github },
      { patterns: ['location', 'city', 'address'], value: profile.personalInfo.location },
      { patterns: ['company', 'current.?company'], value: profile.professional.currentCompany },
      { patterns: ['title', 'position', 'role'], value: profile.professional.currentTitle },
      { patterns: ['experience', 'years'], value: String(profile.professional.yearsOfExperience) },
      { patterns: ['salary', 'compensation'], value: profile.professional.expectedSalary },
      { patterns: ['notice', 'start.?date', 'availability'], value: profile.professional.noticePeriod },
    ];

    // Get all visible inputs
    const inputs = await page.$$('input:visible, textarea:visible');

    for (const input of inputs) {
      try {
        const name = await input.getAttribute('name') || '';
        const id = await input.getAttribute('id') || '';
        const placeholder = await input.getAttribute('placeholder') || '';
        const type = await input.getAttribute('type') || 'text';

        // Skip hidden, file, checkbox, radio, submit inputs
        if (['hidden', 'file', 'checkbox', 'radio', 'submit', 'button'].includes(type)) {
          continue;
        }

        // Get label if exists
        let labelText = '';
        if (id) {
          const label = await page.$(`label[for="${id}"]`);
          if (label) {
            labelText = await label.textContent() || '';
          }
        }

        const fieldKey = `${name} ${id} ${placeholder} ${labelText}`.toLowerCase();

        // Try to match with patterns
        for (const { patterns, value } of fieldPatterns) {
          if (!value) continue;

          for (const pattern of patterns) {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(fieldKey)) {
              const currentValue = await input.inputValue().catch(() => '');
              if (!currentValue) {
                await input.fill(value);
                this.log(`Filled field ${name || id || placeholder} with value`, 'debug');
              }
              break;
            }
          }
        }

        // Check if it looks like a question field (textarea with label)
        if (await input.evaluate((el: any) => el.tagName.toLowerCase()) === 'textarea') {
          if (labelText) {
            const answer = profileService.getQuestionAnswer(labelText, {
              company: job.company,
              role: job.title,
            });
            if (answer) {
              const currentValue = await input.inputValue().catch(() => '');
              if (!currentValue) {
                await input.fill(answer);
                this.log(`Filled question field: ${labelText}`, 'debug');
              }
            }
          }
        }
      } catch {
        // Ignore errors for individual fields
      }
    }

    // Handle cover letter fields specially
    const coverLetterSelectors = [
      'textarea[name*="cover"]',
      'textarea[name*="letter"]',
      'textarea[name*="message"]',
      'textarea[id*="cover"]',
      'textarea[placeholder*="cover"]',
      'textarea[placeholder*="message to"]',
    ];

    for (const selector of coverLetterSelectors) {
      try {
        const textarea = await page.$(selector);
        if (textarea) {
          const currentValue = await textarea.inputValue().catch(() => '');
          if (!currentValue) {
            const coverLetter = profileService.getCoverLetter(job.company, job.title);
            await textarea.fill(coverLetter);
            this.log('Filled cover letter', 'debug');
            break;
          }
        }
      } catch {
        // Ignore
      }
    }
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
