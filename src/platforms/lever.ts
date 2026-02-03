import { Page } from 'playwright';
import { Job, RequiredInput } from '../types';
import { BasePlatformHandler, ApplicationResult, ProfileServiceInterface } from './base';
import { randomDelay } from '../utils/antiBot';
import { config } from '../config';
import path from 'path';
import fs from 'fs';

/**
 * Lever ATS Handler
 *
 * Handles Lever.co job applications
 * Lever is used by many startups and tech companies
 */
export class LeverHandler extends BasePlatformHandler {
  constructor() {
    super('lever', 'Lever');
  }

  async isApplicationPage(page: Page): Promise<boolean> {
    const url = page.url();
    return url.includes('lever.co') || url.includes('jobs.lever.co');
  }

  async apply(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<ApplicationResult> {
    try {
      this.log('Starting Lever application', 'info');

      // Wait for page to load
      await randomDelay(1500, 2500);

      // Check if we're on the job page or application page
      const isJobPage = await this.elementExists(page, '.posting-headline');
      if (isJobPage) {
        // Click Apply button to go to application form
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
        await randomDelay(1500, 2500);
      }

      // Wait for application form
      const formLoaded = await this.waitForElement(
        page,
        '.application-form, #application-form, .postings-btn-wrapper',
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

      // Fill in the application form
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

      // Submit the application
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
      await randomDelay(2000, 3000);

      if (await this.checkForSuccess(page)) {
        this.log('Application submitted successfully!', 'info');
        return {
          success: true,
          jobId: job.id,
          status: 'applied',
          message: 'Successfully applied via Lever',
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
        message: 'Application may not have been submitted successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Lever apply error: ${errorMessage}`, 'error');
      return {
        success: false,
        jobId: job.id,
        status: 'failed',
        message: `Lever application failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Click the Apply button
   */
  private async clickApplyButton(page: Page): Promise<boolean> {
    const buttonSelectors = [
      '.postings-btn',
      'a[href*="/apply"]',
      'a.postings-btn',
      'button:has-text("Apply")',
      '.posting-apply-button',
    ];

    for (const selector of buttonSelectors) {
      const clicked = await this.clickButton(page, selector, { waitForNavigation: true });
      if (clicked) return true;
    }

    return false;
  }

  /**
   * Fill the application form
   */
  private async fillApplicationForm(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<RequiredInput[]> {
    const unfilled: RequiredInput[] = [];
    const profile = profileService.getProfile();
    if (!profile) return unfilled;

    // Fill basic info fields
    const basicFields = [
      { selector: 'input[name="name"]', value: profile.personalInfo.name },
      { selector: 'input[name="email"]', value: profile.personalInfo.email },
      { selector: 'input[name="phone"]', value: profile.personalInfo.phone },
      { selector: 'input[name="org"]', value: profile.professional.currentCompany },
      { selector: 'input[name="urls[LinkedIn]"]', value: profile.personalInfo.linkedin },
      { selector: 'input[name="urls[GitHub]"]', value: profile.personalInfo.github },
      { selector: 'input[name="urls[Portfolio]"]', value: profile.personalInfo.github },
    ];

    for (const { selector, value } of basicFields) {
      if (value) {
        await this.fillInput(page, selector, value);
      }
    }

    // Handle custom questions
    const customQuestions = await page.$$('.application-question');
    for (const questionEl of customQuestions) {
      const labelEl = await questionEl.$('label');
      const label = await labelEl?.textContent();
      if (!label) continue;

      const labelText = label.trim();
      const isRequired = await questionEl.$('.required, [required]');

      // Get input element
      const input = await questionEl.$('input:not([type="hidden"]), textarea, select');
      if (!input) continue;

      const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
      const inputType = await input.getAttribute('type');

      // Try to get answer from profile
      let answer = profileService.getQuestionAnswer(labelText, {
        company: job.company,
        role: job.title,
      });

      // If no answer, check for common field mappings
      if (!answer) {
        answer = this.getAnswerForLeverQuestion(labelText, profile);
      }

      if (answer) {
        if (tagName === 'textarea') {
          await input.fill(answer);
        } else if (tagName === 'select') {
          await input.selectOption({ label: answer }).catch(() => {
            // Try value instead of label
            input.selectOption(answer).catch(() => {});
          });
        } else if (inputType === 'checkbox') {
          // Skip checkboxes for now
        } else {
          await input.fill(answer);
        }
        await randomDelay(200, 400);
      } else if (isRequired) {
        // Add to unfilled list
        const currentValue = await input.inputValue().catch(() => '');
        if (!currentValue) {
          unfilled.push({
            field: labelText,
            label: labelText,
            type: tagName === 'textarea' ? 'textarea' : tagName === 'select' ? 'select' : 'text',
            required: true,
          });
        }
      }
    }

    // Handle additional questions sections
    await this.handleAdditionalQuestions(page, job, profileService, unfilled);

    return unfilled;
  }

  /**
   * Get answer for common Lever questions
   */
  private getAnswerForLeverQuestion(question: string, profile: any): string | undefined {
    const questionLower = question.toLowerCase();

    // LinkedIn URL
    if (questionLower.includes('linkedin')) {
      return profile.personalInfo.linkedin;
    }

    // GitHub URL
    if (questionLower.includes('github') || questionLower.includes('portfolio')) {
      return profile.personalInfo.github;
    }

    // Website/Portfolio
    if (questionLower.includes('website') || questionLower.includes('personal site')) {
      return profile.personalInfo.github;
    }

    // Current company
    if (questionLower.includes('current company') || questionLower.includes('current employer')) {
      return profile.professional.currentCompany;
    }

    // Current title
    if (questionLower.includes('current title') || questionLower.includes('current role')) {
      return profile.professional.currentTitle;
    }

    // Location
    if (questionLower.includes('location') || questionLower.includes('city')) {
      return profile.personalInfo.location;
    }

    // Notice period / Start date
    if (questionLower.includes('notice') || questionLower.includes('start date') || questionLower.includes('when can you')) {
      return profile.professional.noticePeriod;
    }

    // Salary
    if (questionLower.includes('salary') || questionLower.includes('compensation')) {
      return profile.professional.expectedSalary;
    }

    // Years of experience
    if (questionLower.includes('years') && questionLower.includes('experience')) {
      return String(profile.professional.yearsOfExperience);
    }

    // Work authorization
    if (questionLower.includes('authorized') || questionLower.includes('legally')) {
      return 'Yes';
    }

    // Visa sponsorship
    if (questionLower.includes('visa') || questionLower.includes('sponsorship')) {
      return 'Yes, I will require visa sponsorship';
    }

    // Relocation
    if (questionLower.includes('relocate') || questionLower.includes('relocation')) {
      return profile.personalInfo.willingToRelocate ? 'Yes' : 'No';
    }

    // Remote work
    if (questionLower.includes('remote') || questionLower.includes('work from home')) {
      return 'Yes, I am comfortable working remotely';
    }

    return undefined;
  }

  /**
   * Handle additional questions sections
   */
  private async handleAdditionalQuestions(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface,
    unfilled: RequiredInput[]
  ): Promise<void> {
    const profile = profileService.getProfile();
    if (!profile) return;

    // Look for cards and other question containers
    const cardContainers = await page.$$('.application-additional, .card, [class*="question"]');

    for (const container of cardContainers) {
      const labelEl = await container.$('label, .label, h4, h5');
      const label = await labelEl?.textContent();
      if (!label) continue;

      const labelText = label.trim();

      // Get answer
      let answer = profileService.getQuestionAnswer(labelText, {
        company: job.company,
        role: job.title,
      });

      if (!answer) {
        answer = this.getAnswerForLeverQuestion(labelText, profile);
      }

      if (answer) {
        const input = await container.$('input, textarea, select');
        if (input) {
          const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
          if (tagName === 'textarea') {
            await input.fill(answer);
          } else if (tagName === 'select') {
            await input.selectOption({ label: answer }).catch(() => {});
          } else {
            await input.fill(answer);
          }
        }
      }
    }
  }

  /**
   * Upload resume
   */
  private async uploadResume(page: Page): Promise<boolean> {
    // Find resume file
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

    if (!resumePath) {
      this.log('No resume file found', 'warn');
      return false;
    }

    // Find file input
    const fileInputSelectors = [
      'input[type="file"][name="resume"]',
      'input[type="file"]',
      '.upload-btn input[type="file"]',
    ];

    for (const selector of fileInputSelectors) {
      const uploaded = await this.uploadFile(page, selector, resumePath);
      if (uploaded) {
        this.log('Resume uploaded successfully', 'info');
        await randomDelay(1000, 2000);
        return true;
      }
    }

    return false;
  }

  /**
   * Submit the application
   */
  private async submitApplication(page: Page): Promise<boolean> {
    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Submit application")',
      'button:has-text("Submit")',
      'input[type="submit"]',
      '.postings-btn[type="submit"]',
    ];

    for (const selector of submitSelectors) {
      const clicked = await this.clickButton(page, selector);
      if (clicked) {
        this.log('Submit button clicked', 'debug');
        return true;
      }
    }

    return false;
  }

  /**
   * Override success check for Lever-specific indicators
   */
  protected async checkForSuccess(page: Page): Promise<boolean> {
    const successIndicators = [
      '.application-confirmation',
      'text="Thanks for applying"',
      'text="Application submitted"',
      'text="Thank you for your application"',
      'text="We have received your application"',
      '.posting-headline + p:has-text("Thanks")',
      'h3:has-text("Thanks")',
    ];

    for (const indicator of successIndicators) {
      if (await this.elementExists(page, indicator)) {
        return true;
      }
    }

    // Check URL for confirmation
    const url = page.url();
    if (url.includes('/thanks') || url.includes('/confirmation') || url.includes('/submitted')) {
      return true;
    }

    return false;
  }

  /**
   * Override error check for Lever-specific errors
   */
  protected async checkForErrors(page: Page): Promise<string | null> {
    const errorSelectors = [
      '.error',
      '.error-message',
      '.application-error',
      '[class*="error"]',
    ];

    for (const selector of errorSelectors) {
      const elements = await page.$$(selector);
      for (const element of elements) {
        const text = await element.textContent();
        if (text && text.trim() && !text.toLowerCase().includes('no error')) {
          return text.trim();
        }
      }
    }

    return null;
  }
}

export default LeverHandler;
