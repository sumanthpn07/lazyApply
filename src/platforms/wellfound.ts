import { Page } from 'playwright';
import { Job, RequiredInput } from '../types';
import { BasePlatformHandler, ApplicationResult, ProfileServiceInterface } from './base';
import { randomDelay } from '../utils/antiBot';
import { config } from '../config';
import path from 'path';
import fs from 'fs';

/**
 * Wellfound (formerly AngelList) Handler
 *
 * Handles Wellfound.com job applications
 * Popular for startup job applications
 */
export class WellfoundHandler extends BasePlatformHandler {
  constructor() {
    super('wellfound', 'Wellfound');
  }

  async isApplicationPage(page: Page): Promise<boolean> {
    const url = page.url();
    return url.includes('wellfound.com') || url.includes('angel.co');
  }

  async apply(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<ApplicationResult> {
    try {
      this.log('Starting Wellfound application', 'info');

      // Wait for page to load
      await randomDelay(2000, 3000);

      // Check if logged in
      const isLoggedIn = await this.checkLogin(page);
      if (!isLoggedIn) {
        this.log('Not logged in to Wellfound - navigating to login page', 'info');
        // Navigate to login page
        await page.goto('https://wellfound.com/login', { waitUntil: 'domcontentloaded' });
        await randomDelay(1000, 2000);

        return {
          success: false,
          jobId: job.id,
          status: 'login_required' as const,
          message: 'Please login to Wellfound in the browser window, then click Continue',
          loginUrl: 'https://wellfound.com/login',
        };
      }

      // Find and click Apply button
      const applyClicked = await this.clickApplyButton(page);
      if (!applyClicked) {
        return {
          success: false,
          jobId: job.id,
          status: 'failed',
          message: 'Could not find Apply button',
          error: 'Apply button not found',
        };
      }

      await randomDelay(2000, 3000);

      // Check if application modal opened
      const modalVisible = await this.waitForElement(
        page,
        '[data-test="apply-modal"], .modal, [role="dialog"]',
        5000
      );

      if (!modalVisible) {
        // Might have redirected to application page
        this.log('Application modal not found, checking for form', 'debug');
      }

      // Fill the application form
      const unfilled = await this.fillApplicationForm(page, job, profileService);

      // Handle resume upload if available
      await this.uploadResume(page);

      // Check for required unfilled fields
      if (unfilled.length > 0) {
        return {
          success: false,
          jobId: job.id,
          status: 'needs_input',
          message: 'Application requires additional information',
          requiredInputs: unfilled,
        };
      }

      // Submit application
      const submitted = await this.submitApplication(page);
      if (!submitted) {
        return {
          success: false,
          jobId: job.id,
          status: 'failed',
          message: 'Could not submit application',
          error: 'Submit failed',
        };
      }

      // Wait and check for success
      await randomDelay(2000, 4000);

      if (await this.checkForSuccess(page)) {
        this.log('Application submitted successfully!', 'info');
        return {
          success: true,
          jobId: job.id,
          status: 'applied',
          message: 'Successfully applied via Wellfound',
        };
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

      return {
        success: false,
        jobId: job.id,
        status: 'failed',
        message: 'Application status unclear',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Wellfound apply error: ${errorMessage}`, 'error');
      return {
        success: false,
        jobId: job.id,
        status: 'failed',
        message: `Wellfound application failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if user is logged in
   */
  private async checkLogin(page: Page): Promise<boolean> {
    const loginIndicators = [
      '[data-test="user-menu"]',
      '.user-menu',
      '[data-test="profile-link"]',
      'a[href*="/profile"]',
    ];

    for (const selector of loginIndicators) {
      if (await this.elementExists(page, selector)) {
        return true;
      }
    }

    // Check for login/signup buttons
    const notLoggedIn = await this.elementExists(page, 'a[href*="/login"], button:has-text("Log In")');
    return !notLoggedIn;
  }

  /**
   * Click Apply button
   */
  private async clickApplyButton(page: Page): Promise<boolean> {
    const buttonSelectors = [
      '[data-test="apply-button"]',
      'button:has-text("Apply")',
      'a:has-text("Apply")',
      '.apply-button',
      '[data-test="job-card-apply"]',
    ];

    for (const selector of buttonSelectors) {
      const clicked = await this.clickButton(page, selector);
      if (clicked) return true;
    }

    return false;
  }

  /**
   * Fill application form
   */
  private async fillApplicationForm(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<RequiredInput[]> {
    const unfilled: RequiredInput[] = [];
    const profile = profileService.getProfile();
    if (!profile) return unfilled;

    // Fill cover letter / message to hiring manager
    const coverLetterSelectors = [
      'textarea[name*="cover"]',
      'textarea[name*="message"]',
      'textarea[placeholder*="message"]',
      '[data-test="cover-letter"]',
    ];

    for (const selector of coverLetterSelectors) {
      const textarea = await page.$(selector);
      if (textarea) {
        const coverLetter = profileService.getCoverLetter(job.company, job.title);
        await textarea.fill(coverLetter);
        this.log('Cover letter filled', 'debug');
        break;
      }
    }

    // Handle custom questions
    const questionContainers = await page.$$('[data-test="question"], .question, .form-group');

    for (const container of questionContainers) {
      const labelEl = await container.$('label, .label');
      if (!labelEl) continue;

      const label = await labelEl.textContent();
      if (!label) continue;

      const labelText = label.trim();
      const isRequired = (await container.$('[required], .required')) !== null;

      const input = await container.$('input, textarea, select');
      if (!input) continue;

      // Get answer
      let answer = profileService.getQuestionAnswer(labelText, {
        company: job.company,
        role: job.title,
      });

      if (!answer) {
        answer = this.getAnswerForQuestion(labelText, profile);
      }

      if (answer) {
        const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
        if (tagName === 'select') {
          await input.selectOption({ label: answer }).catch(() => {});
        } else {
          await input.fill(answer);
        }
        await randomDelay(200, 400);
      } else if (isRequired) {
        const currentValue = await input.inputValue().catch(() => '');
        if (!currentValue) {
          const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
          unfilled.push({
            field: labelText,
            label: labelText,
            type: tagName === 'textarea' ? 'textarea' : tagName === 'select' ? 'select' : 'text',
            required: true,
          });
        }
      }
    }

    return unfilled;
  }

  /**
   * Get answer for common questions
   */
  private getAnswerForQuestion(question: string, profile: any): string | undefined {
    const questionLower = question.toLowerCase();

    if (questionLower.includes('years') && questionLower.includes('experience')) {
      return String(profile.professional.yearsOfExperience);
    }

    if (questionLower.includes('linkedin')) {
      return profile.personalInfo.linkedin;
    }

    if (questionLower.includes('github') || questionLower.includes('portfolio')) {
      return profile.personalInfo.github;
    }

    if (questionLower.includes('notice') || questionLower.includes('start')) {
      return profile.professional.noticePeriod;
    }

    if (questionLower.includes('salary') || questionLower.includes('compensation')) {
      return profile.professional.expectedSalary;
    }

    if (questionLower.includes('visa') || questionLower.includes('sponsor')) {
      return 'May require sponsorship';
    }

    if (questionLower.includes('relocate')) {
      return profile.personalInfo.willingToRelocate ? 'Yes' : 'Open to discuss';
    }

    return undefined;
  }

  /**
   * Upload resume
   */
  private async uploadResume(page: Page): Promise<boolean> {
    const resumePaths = [
      path.join(config.dataDir, 'P_N_SUMANTH_FULL_STACK_DEVELOPER (3).pdf'),
      path.join(config.resumesDir, 'v1.pdf'),
    ];

    let resumePath: string | null = null;
    for (const p of resumePaths) {
      if (fs.existsSync(p)) {
        resumePath = p;
        break;
      }
    }

    if (!resumePath) return false;

    const fileInputSelectors = [
      'input[type="file"][name*="resume"]',
      'input[type="file"]',
      '[data-test="resume-upload"]',
    ];

    for (const selector of fileInputSelectors) {
      const uploaded = await this.uploadFile(page, selector, resumePath);
      if (uploaded) {
        this.log('Resume uploaded', 'info');
        await randomDelay(1500, 2500);
        return true;
      }
    }

    return false;
  }

  /**
   * Submit application
   */
  private async submitApplication(page: Page): Promise<boolean> {
    const submitSelectors = [
      '[data-test="submit-application"]',
      'button[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Apply")',
    ];

    for (const selector of submitSelectors) {
      const clicked = await this.clickButton(page, selector);
      if (clicked) return true;
    }

    return false;
  }

  /**
   * Check for success
   */
  protected async checkForSuccess(page: Page): Promise<boolean> {
    const successIndicators = [
      '[data-test="application-success"]',
      'text="Application sent"',
      'text="Thanks for applying"',
      'text="Application submitted"',
      '.success-message',
    ];

    for (const indicator of successIndicators) {
      if (await this.elementExists(page, indicator)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for errors
   */
  protected async checkForErrors(page: Page): Promise<string | null> {
    const errorSelectors = [
      '.error-message',
      '[data-test="error"]',
      '.alert-error',
    ];

    for (const selector of errorSelectors) {
      const text = await this.getTextContent(page, selector);
      if (text && text.trim()) {
        return text.trim();
      }
    }

    return null;
  }
}

export default WellfoundHandler;
