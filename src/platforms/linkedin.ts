import { Page } from 'playwright';
import { Job, RequiredInput } from '../types';
import { BasePlatformHandler, ApplicationResult, ProfileServiceInterface } from './base';
import { randomDelay, humanScroll } from '../utils/antiBot';
import { config } from '../config';
import path from 'path';

/**
 * LinkedIn Easy Apply Handler
 *
 * Handles LinkedIn's Easy Apply feature
 * Note: Requires user to be logged in to LinkedIn in the browser
 */
export class LinkedInHandler extends BasePlatformHandler {
  constructor() {
    super('linkedin', 'LinkedIn');
  }

  async isApplicationPage(page: Page): Promise<boolean> {
    const url = page.url();
    return url.includes('linkedin.com/jobs') || url.includes('linkedin.com/job');
  }

  async apply(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<ApplicationResult> {
    try {
      this.log('Starting LinkedIn Easy Apply', 'info');

      // Wait for page to load
      await randomDelay(2000, 3000);

      // Check if logged in
      const isLoggedIn = await this.checkLogin(page);
      if (!isLoggedIn) {
        return {
          success: false,
          jobId: job.id,
          status: 'failed',
          message: 'Not logged in to LinkedIn. Please log in manually first.',
          error: 'Not logged in to LinkedIn',
        };
      }

      // Find Easy Apply button
      const easyApplyButton = await this.findEasyApplyButton(page);
      if (!easyApplyButton) {
        return {
          success: false,
          jobId: job.id,
          status: 'failed',
          message: 'Easy Apply button not found. Job may require external application.',
          error: 'Easy Apply not available',
        };
      }

      // Click Easy Apply
      await easyApplyButton.click();
      await randomDelay(1500, 2500);

      // Wait for modal to appear
      const modalVisible = await this.waitForElement(page, '.jobs-easy-apply-modal', 5000);
      if (!modalVisible) {
        // Try alternative modal selectors
        const altModal = await this.waitForElement(page, '[data-test-modal]', 3000);
        if (!altModal) {
          return {
            success: false,
            jobId: job.id,
            status: 'failed',
            message: 'Application modal did not open',
            error: 'Modal not found',
          };
        }
      }

      // Process the Easy Apply flow
      const result = await this.processEasyApplyFlow(page, job, profileService);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log(`LinkedIn apply error: ${errorMessage}`, 'error');
      return {
        success: false,
        jobId: job.id,
        status: 'failed',
        message: `LinkedIn application failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if user is logged in to LinkedIn
   */
  private async checkLogin(page: Page): Promise<boolean> {
    // Check for profile picture or nav elements that indicate login
    const loginIndicators = [
      '.global-nav__me-photo',
      '.feed-identity-module',
      '[data-control-name="nav.settings"]',
      '.nav-item__profile-member-photo',
    ];

    for (const selector of loginIndicators) {
      if (await this.elementExists(page, selector)) {
        return true;
      }
    }

    // Check for login/signup buttons which indicate NOT logged in
    const notLoggedInIndicators = [
      'a[href*="login"]',
      'button:has-text("Sign in")',
      '.nav__button-secondary',
    ];

    for (const selector of notLoggedInIndicators) {
      if (await this.elementExists(page, selector)) {
        return false;
      }
    }

    // Default to true if we can't determine
    return true;
  }

  /**
   * Find the Easy Apply button
   */
  private async findEasyApplyButton(page: Page): Promise<ReturnType<typeof page.$> | null> {
    const buttonSelectors = [
      'button.jobs-apply-button',
      'button:has-text("Easy Apply")',
      '[data-control-name="jobdetails_topcard_inapply"]',
      '.jobs-apply-button--top-card',
      'button[aria-label*="Easy Apply"]',
    ];

    for (const selector of buttonSelectors) {
      const button = await page.$(selector);
      if (button) {
        return button;
      }
    }

    return null;
  }

  /**
   * Process the Easy Apply multi-step flow
   */
  private async processEasyApplyFlow(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<ApplicationResult> {
    let stepCount = 0;
    const maxSteps = 10;
    const requiredInputs: RequiredInput[] = [];

    while (stepCount < maxSteps) {
      stepCount++;
      this.log(`Processing step ${stepCount}`, 'debug');
      await randomDelay(1000, 2000);

      // Check if we've successfully applied
      if (await this.checkForSuccess(page)) {
        this.log('Application submitted successfully!', 'info');
        return {
          success: true,
          jobId: job.id,
          status: 'applied',
          message: 'Successfully applied via LinkedIn Easy Apply',
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

      // Fill in form fields on current step
      const unfilled = await this.fillCurrentStep(page, job, profileService);
      if (unfilled.length > 0) {
        requiredInputs.push(...unfilled);
      }

      // Try to find and click the next/submit button
      const hasNextStep = await this.clickNextOrSubmit(page);

      if (!hasNextStep) {
        // Check if there are required inputs we couldn't fill
        if (requiredInputs.length > 0) {
          return {
            success: false,
            jobId: job.id,
            status: 'needs_input',
            message: 'Application requires additional information',
            requiredInputs,
          };
        }

        // Couldn't find next button and no success
        break;
      }

      await randomDelay(1500, 2500);
    }

    // Final success check
    if (await this.checkForSuccess(page)) {
      return {
        success: true,
        jobId: job.id,
        status: 'applied',
        message: 'Successfully applied via LinkedIn Easy Apply',
      };
    }

    return {
      success: false,
      jobId: job.id,
      status: requiredInputs.length > 0 ? 'needs_input' : 'failed',
      message: requiredInputs.length > 0
        ? 'Application requires additional information'
        : 'Could not complete application flow',
      requiredInputs: requiredInputs.length > 0 ? requiredInputs : undefined,
    };
  }

  /**
   * Fill in form fields on the current step
   */
  private async fillCurrentStep(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<RequiredInput[]> {
    const unfilled: RequiredInput[] = [];
    const profile = profileService.getProfile();
    if (!profile) return unfilled;

    // Fill contact info
    await this.fillInput(page, 'input[name="firstName"]', profile.personalInfo.firstName);
    await this.fillInput(page, 'input[name="lastName"]', profile.personalInfo.lastName);
    await this.fillInput(page, 'input[name="email"]', profile.personalInfo.email);
    await this.fillInput(page, 'input[name="phone"]', profile.personalInfo.phone);

    // Handle phone country code if present
    await this.selectOption(page, 'select[name="phoneCountry"]', 'IN');

    // Handle resume upload
    const resumeUploaded = await this.handleResumeUpload(page);
    if (!resumeUploaded) {
      this.log('Resume upload may be required', 'warn');
    }

    // Handle custom questions
    const customQuestions = await page.$$('.jobs-easy-apply-form-section__grouping');
    for (const question of customQuestions) {
      const labelElement = await question.$('label, .fb-form-element-label');
      const label = await labelElement?.textContent();

      if (!label) continue;

      const labelText = label.trim();

      // Try to get answer from profile
      const answer = profileService.getQuestionAnswer(labelText, {
        company: job.company,
        role: job.title,
      });

      if (answer) {
        // Try textarea first, then input
        const textarea = await question.$('textarea');
        const input = await question.$('input[type="text"], input:not([type])');

        if (textarea) {
          await textarea.fill(answer);
        } else if (input) {
          await input.fill(answer);
        }
      } else {
        // Check if required and unfilled
        const isRequired = await question.$('[required], [aria-required="true"]');
        if (isRequired) {
          const input = await question.$('input, textarea, select');
          const inputType = await input?.getAttribute('type');

          unfilled.push({
            field: labelText,
            label: labelText,
            type: inputType === 'number' ? 'number' : 'text',
            required: true,
          });
        }
      }
    }

    // Handle radio buttons and checkboxes
    await this.handleRadioAndCheckboxes(page, profileService);

    // Handle dropdowns
    await this.handleDropdowns(page, job, profileService);

    return unfilled;
  }

  /**
   * Handle resume upload
   */
  private async handleResumeUpload(page: Page): Promise<boolean> {
    const resumeInputSelectors = [
      'input[type="file"][name*="resume"]',
      'input[type="file"]',
      '.jobs-document-upload-redesign-card__upload-button input',
    ];

    for (const selector of resumeInputSelectors) {
      const input = await page.$(selector);
      if (input) {
        // Find resume file
        const resumePath = path.join(config.resumesDir, 'v1.pdf');
        const dataPath = path.join(config.dataDir, 'P_N_SUMANTH_FULL_STACK_DEVELOPER (3).pdf');

        // Try data path first (the actual resume)
        try {
          const fs = require('fs');
          if (fs.existsSync(dataPath)) {
            await input.setInputFiles(dataPath);
            this.log('Resume uploaded from data folder', 'info');
            return true;
          } else if (fs.existsSync(resumePath)) {
            await input.setInputFiles(resumePath);
            this.log('Resume uploaded from resumes folder', 'info');
            return true;
          }
        } catch (error) {
          this.log(`Resume upload error: ${error}`, 'warn');
        }
      }
    }

    // Check if resume is already attached
    const alreadyAttached = await this.elementExists(
      page,
      '.jobs-document-upload-redesign-card__file-name'
    );
    return alreadyAttached;
  }

  /**
   * Handle radio buttons and checkboxes
   */
  private async handleRadioAndCheckboxes(
    page: Page,
    profileService: ProfileServiceInterface
  ): Promise<void> {
    const profile = profileService.getProfile();
    if (!profile) return;

    // Common Yes/No questions
    const yesNoSelectors = [
      { label: 'authorized to work', value: 'Yes' },
      { label: 'sponsorship', value: 'Yes' }, // May need sponsorship
      { label: 'require visa', value: 'Yes' },
      { label: '18 years', value: 'Yes' },
      { label: 'legally authorized', value: 'Yes' },
      { label: 'background check', value: 'Yes' },
      { label: 'drug test', value: 'Yes' },
    ];

    for (const { label, value } of yesNoSelectors) {
      try {
        // Find question containing this label
        const questionGroups = await page.$$('.jobs-easy-apply-form-section__grouping');
        for (const group of questionGroups) {
          const text = await group.textContent();
          if (text?.toLowerCase().includes(label.toLowerCase())) {
            // Click the radio button with the specified value
            const radio = await group.$(`input[type="radio"][value="${value}"], label:has-text("${value}")`);
            if (radio) {
              await radio.click();
              await randomDelay(200, 400);
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }
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

    // Years of experience dropdowns
    const experienceSelectors = [
      'select[name*="experience"]',
      'select[id*="experience"]',
      'select[aria-label*="experience"]',
    ];

    for (const selector of experienceSelectors) {
      try {
        const select = await page.$(selector);
        if (select) {
          // Select the closest option to actual experience
          const years = profile.professional.yearsOfExperience;
          await select.selectOption({ label: `${years}` });
        }
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Click the Next or Submit button
   */
  private async clickNextOrSubmit(page: Page): Promise<boolean> {
    const buttonSelectors = [
      // Submit buttons
      'button[aria-label="Submit application"]',
      'button:has-text("Submit application")',
      'button:has-text("Submit")',
      // Next buttons
      'button[aria-label="Continue to next step"]',
      'button:has-text("Next")',
      'button:has-text("Continue")',
      // Review button
      'button:has-text("Review")',
      // Generic
      '.jobs-easy-apply-form-footer button[type="submit"]',
      '.jobs-easy-apply-footer__next-btn',
    ];

    for (const selector of buttonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          const isDisabled = await button.getAttribute('disabled');
          if (!isDisabled) {
            await button.click();
            this.log(`Clicked button: ${selector}`, 'debug');
            return true;
          }
        }
      } catch {
        // Try next selector
      }
    }

    return false;
  }

  /**
   * Override success check for LinkedIn-specific indicators
   */
  protected async checkForSuccess(page: Page): Promise<boolean> {
    const successIndicators = [
      'h2:has-text("Your application was sent")',
      '.jpac-modal-success-screen',
      'text="Application submitted"',
      '.jobs-apply-success-modal',
      '[data-test-modal-id="apply-success"]',
      'img[alt*="success"]',
      '.artdeco-modal:has-text("Application sent")',
    ];

    for (const indicator of successIndicators) {
      if (await this.elementExists(page, indicator)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Override error check for LinkedIn-specific errors
   */
  protected async checkForErrors(page: Page): Promise<string | null> {
    const errorSelectors = [
      '.artdeco-inline-feedback--error',
      '.jobs-easy-apply-modal__content .error',
      '[data-test-form-element-error-messages]',
    ];

    for (const selector of errorSelectors) {
      const errorText = await this.getTextContent(page, selector);
      if (errorText && errorText.trim()) {
        return errorText.trim();
      }
    }

    return null;
  }
}

export default LinkedInHandler;
