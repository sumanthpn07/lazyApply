import { Page } from 'playwright';
import { Job, RequiredInput } from '../types';
import { BasePlatformHandler, ApplicationResult, ProfileServiceInterface } from './base';
import { randomDelay } from '../utils/antiBot';
import { config } from '../config';
import path from 'path';
import fs from 'fs';

/**
 * Greenhouse ATS Handler
 *
 * Handles Greenhouse.io job applications
 * Greenhouse is used by many large tech companies
 */
export class GreenhouseHandler extends BasePlatformHandler {
  constructor() {
    super('greenhouse', 'Greenhouse');
  }

  async isApplicationPage(page: Page): Promise<boolean> {
    const url = page.url();
    return url.includes('greenhouse.io') || url.includes('boards.greenhouse.io');
  }

  async apply(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<ApplicationResult> {
    try {
      this.log('Starting Greenhouse application', 'info');

      // Wait for page to load
      await randomDelay(1500, 2500);

      // Check if we're on job listing or application form
      const isJobListing = await this.elementExists(page, '#content h1, .job__title');

      if (isJobListing) {
        // Look for Apply button
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
        '#application-form, .application-form, form[data-ui="app-form"]',
        10000
      );
      if (!formLoaded) {
        // Try scrolling down to find the form
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await randomDelay(1000, 1500);

        const formAfterScroll = await this.waitForElement(page, '#application-form, form', 5000);
        if (!formAfterScroll) {
          return {
            success: false,
            jobId: job.id,
            status: 'failed',
            message: 'Application form did not load',
            error: 'Form not found',
          };
        }
      }

      // Fill the application form
      const unfilled = await this.fillApplicationForm(page, job, profileService);

      // Upload resume
      const resumeUploaded = await this.uploadResume(page);
      if (!resumeUploaded) {
        this.log('Resume upload may have failed', 'warn');
      }

      // Handle cover letter if present
      await this.handleCoverLetter(page, job, profileService);

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
      await randomDelay(2000, 4000);

      if (await this.checkForSuccess(page)) {
        this.log('Application submitted successfully!', 'info');
        return {
          success: true,
          jobId: job.id,
          status: 'applied',
          message: 'Successfully applied via Greenhouse',
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
      this.log(`Greenhouse apply error: ${errorMessage}`, 'error');
      return {
        success: false,
        jobId: job.id,
        status: 'failed',
        message: `Greenhouse application failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Click the Apply button
   */
  private async clickApplyButton(page: Page): Promise<boolean> {
    const buttonSelectors = [
      '#apply_button',
      'a.btn[href*="apply"]',
      'button:has-text("Apply")',
      'a:has-text("Apply")',
      '.job__apply-button',
      '[data-qa="btn-apply"]',
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

    // Fill basic fields
    const basicFields = [
      // Name fields
      { selectors: ['#first_name', 'input[name="job_application[first_name]"]', 'input[name="first_name"]'], value: profile.personalInfo.firstName },
      { selectors: ['#last_name', 'input[name="job_application[last_name]"]', 'input[name="last_name"]'], value: profile.personalInfo.lastName },

      // Contact fields
      { selectors: ['#email', 'input[name="job_application[email]"]', 'input[type="email"]'], value: profile.personalInfo.email },
      { selectors: ['#phone', 'input[name="job_application[phone]"]', 'input[type="tel"]'], value: profile.personalInfo.phone },

      // Location
      { selectors: ['#location', 'input[name="job_application[location]"]', 'input[name="location"]'], value: profile.personalInfo.location },

      // LinkedIn
      { selectors: ['input[name*="linkedin"]', '#linkedin', 'input[placeholder*="LinkedIn"]'], value: profile.personalInfo.linkedin },

      // GitHub
      { selectors: ['input[name*="github"]', '#github', 'input[placeholder*="GitHub"]'], value: profile.personalInfo.github },

      // Current company
      { selectors: ['input[name*="company"]', '#company', 'input[name*="current_company"]'], value: profile.professional.currentCompany },
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

    // Handle dropdown questions
    await this.handleDropdowns(page, job, profileService);

    // Handle checkbox questions
    await this.handleCheckboxes(page, profileService);

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

    // Find all question containers
    const questionContainers = await page.$$(
      '.field, .question, [class*="field"], .application-question'
    );

    for (const container of questionContainers) {
      const labelEl = await container.$('label');
      if (!labelEl) continue;

      const label = await labelEl.textContent();
      if (!label) continue;

      const labelText = label.trim();
      const isRequired = (await container.$('.required, [required]')) !== null;

      // Find input in container
      const input = await container.$('input:not([type="hidden"]):not([type="file"]), textarea');
      if (!input) continue;

      // Check if already filled
      const currentValue = await input.inputValue().catch(() => '');
      if (currentValue) continue;

      // Try to get answer
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

    // Years of experience
    if (questionLower.includes('years') && questionLower.includes('experience')) {
      return String(profile.professional.yearsOfExperience);
    }

    // LinkedIn
    if (questionLower.includes('linkedin')) {
      return profile.personalInfo.linkedin;
    }

    // GitHub
    if (questionLower.includes('github') || questionLower.includes('portfolio')) {
      return profile.personalInfo.github;
    }

    // Website
    if (questionLower.includes('website') || questionLower.includes('personal site')) {
      return profile.personalInfo.github;
    }

    // Current company
    if (questionLower.includes('current company') || questionLower.includes('employer')) {
      return profile.professional.currentCompany;
    }

    // Current title
    if (questionLower.includes('current title') || questionLower.includes('current role')) {
      return profile.professional.currentTitle;
    }

    // Location
    if (questionLower.includes('location') || questionLower.includes('where are you')) {
      return profile.personalInfo.location;
    }

    // Notice period
    if (questionLower.includes('notice') || questionLower.includes('start date') || questionLower.includes('when can you start')) {
      return profile.professional.noticePeriod;
    }

    // Salary
    if (questionLower.includes('salary') || questionLower.includes('compensation') || questionLower.includes('expected')) {
      return profile.professional.expectedSalary;
    }

    // Work authorization
    if (questionLower.includes('authorized') || questionLower.includes('legally authorized') || questionLower.includes('eligible')) {
      return 'Yes';
    }

    // Sponsorship
    if (questionLower.includes('sponsor') || questionLower.includes('visa')) {
      return 'Yes, I will require visa sponsorship';
    }

    // Relocation
    if (questionLower.includes('relocate') || questionLower.includes('willing to move')) {
      return profile.personalInfo.willingToRelocate ? 'Yes' : 'Open to discuss';
    }

    // Remote
    if (questionLower.includes('remote') || questionLower.includes('work from home')) {
      return 'Yes, I am comfortable working remotely';
    }

    // Education
    if (questionLower.includes('education') || questionLower.includes('degree')) {
      return `${profile.education.degree} in ${profile.education.major} from ${profile.education.university}`;
    }

    return undefined;
  }

  /**
   * Handle dropdown selections
   */
  private async handleDropdowns(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<void> {
    const profile = profileService.getProfile();
    if (!profile) return;

    // Find all selects
    const selects = await page.$$('select');

    for (const select of selects) {
      const id = await select.getAttribute('id');
      const name = await select.getAttribute('name');
      const labelEl = await page.$(`label[for="${id}"]`);
      const label = await labelEl?.textContent();

      if (!label) continue;

      const labelLower = label.toLowerCase();

      // Determine value to select
      let value: string | undefined;

      if (labelLower.includes('country')) {
        value = 'India';
      } else if (labelLower.includes('years') || labelLower.includes('experience')) {
        const years = profile.professional.yearsOfExperience;
        // Try different formats
        const options = await select.$$('option');
        for (const option of options) {
          const optionText = await option.textContent();
          if (optionText?.includes(String(years))) {
            value = await option.getAttribute('value') || undefined;
            break;
          }
        }
      } else if (labelLower.includes('hear') || labelLower.includes('how did you')) {
        value = 'LinkedIn';
      } else if (labelLower.includes('race') || labelLower.includes('ethnicity') || labelLower.includes('gender') || labelLower.includes('veteran') || labelLower.includes('disability')) {
        // EEO questions - select "Decline to answer" option
        const options = await select.$$('option');
        for (const option of options) {
          const optionText = await option.textContent();
          if (optionText?.toLowerCase().includes('decline') || optionText?.toLowerCase().includes('prefer not')) {
            value = await option.getAttribute('value') || undefined;
            break;
          }
        }
      }

      if (value) {
        await select.selectOption(value).catch(() => {});
        await randomDelay(200, 400);
      }
    }
  }

  /**
   * Handle checkbox questions
   */
  private async handleCheckboxes(page: Page, profileService: ProfileServiceInterface): Promise<void> {
    // Find checkboxes for agreements/acknowledgments
    const checkboxContainers = await page.$$('.field input[type="checkbox"], .checkbox');

    for (const checkbox of checkboxContainers) {
      const id = await checkbox.getAttribute('id');
      const labelEl = await page.$(`label[for="${id}"]`);
      const label = await labelEl?.textContent();

      if (label) {
        const labelLower = label.toLowerCase();

        // Auto-accept common agreements
        if (
          labelLower.includes('agree') ||
          labelLower.includes('acknowledge') ||
          labelLower.includes('consent') ||
          labelLower.includes('confirm')
        ) {
          const isChecked = await checkbox.isChecked();
          if (!isChecked) {
            await checkbox.check();
            await randomDelay(100, 200);
          }
        }
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

    if (!resumePath) {
      this.log('No resume file found', 'warn');
      return false;
    }

    const fileInputSelectors = [
      '#resume_text, input[name*="resume"]',
      'input[type="file"][name*="resume"]',
      'input[type="file"]',
      '[data-qa="file-input"]',
    ];

    for (const selector of fileInputSelectors) {
      const uploaded = await this.uploadFile(page, selector, resumePath);
      if (uploaded) {
        this.log('Resume uploaded successfully', 'info');
        await randomDelay(1500, 2500);
        return true;
      }
    }

    return false;
  }

  /**
   * Handle cover letter upload/input
   */
  private async handleCoverLetter(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<void> {
    const profile = profileService.getProfile();
    if (!profile) return;

    // Check for cover letter textarea
    const coverLetterSelectors = [
      '#cover_letter, textarea[name*="cover_letter"]',
      'textarea[name*="cover"]',
      '#cover-letter',
    ];

    for (const selector of coverLetterSelectors) {
      const textarea = await page.$(selector);
      if (textarea) {
        const coverLetter = profileService.getCoverLetter(job.company, job.title);
        if (coverLetter) {
          await textarea.fill(coverLetter);
          this.log('Cover letter filled', 'debug');
        }
        return;
      }
    }
  }

  /**
   * Submit the application
   */
  private async submitApplication(page: Page): Promise<boolean> {
    const submitSelectors = [
      '#submit_app',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit Application")',
      'button:has-text("Submit")',
      '[data-qa="btn-submit"]',
    ];

    for (const selector of submitSelectors) {
      const element = await page.$(selector);
      if (element) {
        const isDisabled = await element.getAttribute('disabled');
        if (!isDisabled) {
          await element.click();
          this.log('Submit button clicked', 'debug');
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Override success check for Greenhouse-specific indicators
   */
  protected async checkForSuccess(page: Page): Promise<boolean> {
    const successIndicators = [
      '#application_confirmation',
      '.application-confirmation',
      'text="Application submitted"',
      'text="Thanks for applying"',
      'text="Thank you for applying"',
      'h1:has-text("Thanks")',
      'h1:has-text("Thank you")',
      '.flash-success',
    ];

    for (const indicator of successIndicators) {
      if (await this.elementExists(page, indicator)) {
        return true;
      }
    }

    const url = page.url();
    if (url.includes('confirmation') || url.includes('thanks') || url.includes('submitted')) {
      return true;
    }

    return false;
  }

  /**
   * Override error check for Greenhouse-specific errors
   */
  protected async checkForErrors(page: Page): Promise<string | null> {
    const errorSelectors = [
      '.error',
      '.field-error',
      '.validation-error',
      '[class*="error"]',
      '.flash-error',
    ];

    for (const selector of errorSelectors) {
      const elements = await page.$$(selector);
      for (const element of elements) {
        const isVisible = await element.isVisible();
        if (isVisible) {
          const text = await element.textContent();
          if (text && text.trim()) {
            return text.trim();
          }
        }
      }
    }

    return null;
  }
}

export default GreenhouseHandler;
