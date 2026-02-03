import { Page } from 'playwright';
import { Job, RequiredInput } from '../types';
import { BasePlatformHandler, ApplicationResult, ProfileServiceInterface } from './base';
import { randomDelay } from '../utils/antiBot';
import { config } from '../config';
import path from 'path';
import fs from 'fs';

/**
 * Workable ATS Handler
 *
 * Handles apply.workable.com job applications
 */
export class WorkableHandler extends BasePlatformHandler {
  constructor() {
    super('workable', 'Workable');
  }

  async isApplicationPage(page: Page): Promise<boolean> {
    const url = page.url();
    return url.includes('workable.com') || url.includes('apply.workable.com');
  }

  async apply(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<ApplicationResult> {
    try {
      this.log('Starting Workable application', 'info');

      // Wait for page to load
      await randomDelay(1500, 2500);

      // Check if on job page or application form
      const isJobPage = await this.elementExists(page, '[data-ui="job-title"], .job-title');

      if (isJobPage) {
        // Click Apply button
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
      }

      // Wait for application form
      const formLoaded = await this.waitForElement(
        page,
        'form[data-ui="application-form"], .application-form, form',
        10000
      );

      if (!formLoaded) {
        return {
          success: false,
          jobId: job.id,
          status: 'failed',
          message: 'Application form did not load',
          error: 'Form not found',
        };
      }

      // Fill application form
      const unfilled = await this.fillApplicationForm(page, job, profileService);

      // Upload resume
      const resumeUploaded = await this.uploadResume(page);
      if (!resumeUploaded) {
        this.log('Resume upload may have failed', 'warn');
      }

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
          message: 'Successfully applied via Workable',
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
      this.log(`Workable apply error: ${errorMessage}`, 'error');
      return {
        success: false,
        jobId: job.id,
        status: 'failed',
        message: `Workable application failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Click Apply button
   */
  private async clickApplyButton(page: Page): Promise<boolean> {
    const buttonSelectors = [
      '[data-ui="apply-button"]',
      'button:has-text("Apply")',
      'a:has-text("Apply")',
      '.apply-button',
      '[data-test-id="apply-now-button"]',
    ];

    for (const selector of buttonSelectors) {
      const clicked = await this.clickButton(page, selector, { waitForNavigation: true });
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

    // Fill basic fields
    const basicFields = [
      { selectors: ['input[name="firstname"], input[name="first_name"]', '[data-ui="first-name"] input'], value: profile.personalInfo.firstName },
      { selectors: ['input[name="lastname"], input[name="last_name"]', '[data-ui="last-name"] input'], value: profile.personalInfo.lastName },
      { selectors: ['input[name="email"], input[type="email"]', '[data-ui="email"] input'], value: profile.personalInfo.email },
      { selectors: ['input[name="phone"], input[type="tel"]', '[data-ui="phone"] input'], value: profile.personalInfo.phone },
      { selectors: ['input[name*="linkedin"]', '[data-ui="linkedin"] input'], value: profile.personalInfo.linkedin },
      { selectors: ['input[name*="address"], input[name*="location"]'], value: profile.personalInfo.location },
    ];

    for (const { selectors, value } of basicFields) {
      if (!value) continue;
      for (const selector of selectors) {
        const filled = await this.fillInput(page, selector, value);
        if (filled) break;
      }
    }

    // Handle custom questions
    await this.handleCustomQuestions(page, job, profileService, unfilled);

    // Handle dropdowns
    await this.handleDropdowns(page, profile);

    return unfilled;
  }

  /**
   * Handle custom questions
   */
  private async handleCustomQuestions(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface,
    unfilled: RequiredInput[]
  ): Promise<void> {
    const profile = profileService.getProfile();
    if (!profile) return;

    // Find all form groups
    const formGroups = await page.$$('.form-group, [data-ui="question"], .field');

    for (const group of formGroups) {
      const labelEl = await group.$('label');
      if (!labelEl) continue;

      const label = await labelEl.textContent();
      if (!label) continue;

      const labelText = label.trim();
      const isRequired = (await group.$('[required], .required')) !== null;

      const input = await group.$('input:not([type="hidden"]):not([type="file"]), textarea');
      if (!input) continue;

      // Check if already filled
      const currentValue = await input.inputValue().catch(() => '');
      if (currentValue) continue;

      // Get answer
      let answer = profileService.getQuestionAnswer(labelText, {
        company: job.company,
        role: job.title,
      });

      if (!answer) {
        answer = this.getAnswerForQuestion(labelText, profile);
      }

      if (answer) {
        await input.fill(answer);
        await randomDelay(200, 400);
      } else if (isRequired) {
        const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
        unfilled.push({
          field: labelText,
          label: labelText,
          type: tagName === 'textarea' ? 'textarea' : 'text',
          required: true,
        });
      }
    }
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

    if (questionLower.includes('current company') || questionLower.includes('employer')) {
      return profile.professional.currentCompany;
    }

    if (questionLower.includes('current title') || questionLower.includes('current role')) {
      return profile.professional.currentTitle;
    }

    if (questionLower.includes('notice') || questionLower.includes('start date')) {
      return profile.professional.noticePeriod;
    }

    if (questionLower.includes('salary') || questionLower.includes('compensation')) {
      return profile.professional.expectedSalary;
    }

    if (questionLower.includes('authorized') || questionLower.includes('legally')) {
      return 'Yes';
    }

    if (questionLower.includes('visa') || questionLower.includes('sponsor')) {
      return 'Yes, I may require visa sponsorship';
    }

    if (questionLower.includes('relocate')) {
      return profile.personalInfo.willingToRelocate ? 'Yes' : 'Open to discuss';
    }

    if (questionLower.includes('remote')) {
      return 'Yes, I am comfortable with remote work';
    }

    return undefined;
  }

  /**
   * Handle dropdowns
   */
  private async handleDropdowns(page: Page, profile: any): Promise<void> {
    const selects = await page.$$('select');

    for (const select of selects) {
      const id = await select.getAttribute('id');
      const name = await select.getAttribute('name');
      const labelEl = await page.$(`label[for="${id}"]`);
      const label = await labelEl?.textContent();

      if (!label) continue;

      const labelLower = label.toLowerCase();
      let value: string | undefined;

      if (labelLower.includes('country')) {
        value = 'India';
      } else if (labelLower.includes('experience')) {
        // Try to find matching option
        const options = await select.$$('option');
        for (const option of options) {
          const optionText = await option.textContent();
          if (optionText?.includes(String(profile.professional.yearsOfExperience))) {
            value = await option.getAttribute('value') || undefined;
            break;
          }
        }
      } else if (labelLower.includes('how did you') || labelLower.includes('source')) {
        value = 'Job Board';
      }

      if (value) {
        await select.selectOption(value).catch(() => {});
        await randomDelay(200, 400);
      }
    }
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
      '[data-ui="cv-dropzone"] input[type="file"]',
      'input[type="file"][name*="resume"]',
      'input[type="file"][name*="cv"]',
      'input[type="file"]',
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
      '[data-ui="submit-button"]',
      'button[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Apply")',
      '[data-test-id="submit-application"]',
    ];

    for (const selector of submitSelectors) {
      const element = await page.$(selector);
      if (element) {
        const isDisabled = await element.getAttribute('disabled');
        if (!isDisabled) {
          await element.click();
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check for success
   */
  protected async checkForSuccess(page: Page): Promise<boolean> {
    const successIndicators = [
      '[data-ui="success-message"]',
      'text="Application submitted"',
      'text="Thanks for applying"',
      'text="Thank you for your application"',
      '.success-page',
      '.confirmation',
    ];

    for (const indicator of successIndicators) {
      if (await this.elementExists(page, indicator)) {
        return true;
      }
    }

    const url = page.url();
    if (url.includes('success') || url.includes('thank') || url.includes('confirmation')) {
      return true;
    }

    return false;
  }

  /**
   * Check for errors
   */
  protected async checkForErrors(page: Page): Promise<string | null> {
    const errorSelectors = [
      '.error-message',
      '.field-error',
      '[data-ui="error"]',
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

export default WorkableHandler;
