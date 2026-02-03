import { Page } from 'playwright';
import { Job, RequiredInput, Platform, Profile } from '../types';
import { logger } from '../utils/logger';
import {
  randomDelay,
  humanType,
  humanClick,
  humanScroll,
  waitForPageLoad,
} from '../utils/antiBot';
import path from 'path';

/**
 * Interface for ProfileService to avoid circular dependency
 */
export interface ProfileServiceInterface {
  getProfile(): Profile | null;
  getFieldValue(fieldName: string): string | undefined;
  getQuestionAnswer(question: string, context?: { company?: string; role?: string }): string | undefined;
  saveAnswer(question: string, answer: string): void;
  getCoverLetter(company: string, jobTitle: string, reason?: string): string;
  getAllSkills(): string[];
  hasSkill(skill: string): boolean;
}

/**
 * Application Result from a platform handler
 */
export interface ApplicationResult {
  success: boolean;
  jobId: string;
  status: 'applied' | 'needs_input' | 'failed';
  message: string;
  requiredInputs?: RequiredInput[];
  screenshotPath?: string;
  error?: string;
}

/**
 * Base Platform Handler
 * Abstract class that all platform-specific handlers extend
 */
export abstract class BasePlatformHandler {
  protected platform: Platform;
  protected name: string;

  constructor(platform: Platform, name: string) {
    this.platform = platform;
    this.name = name;
  }

  /**
   * Apply to a job on this platform
   */
  abstract apply(
    page: Page,
    job: Job,
    profileService: ProfileServiceInterface
  ): Promise<ApplicationResult>;

  /**
   * Check if the page is an application page for this platform
   */
  abstract isApplicationPage(page: Page): Promise<boolean>;

  /**
   * Fill a text input field
   */
  protected async fillInput(
    page: Page,
    selector: string,
    value: string,
    options: { clear?: boolean; delay?: boolean } = {}
  ): Promise<boolean> {
    try {
      const element = await page.$(selector);
      if (!element) {
        logger.debug(`Input not found: ${selector}`);
        return false;
      }

      if (options.clear !== false) {
        await element.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await randomDelay(100, 200);
      }

      if (options.delay !== false) {
        // Type with human-like delay
        await humanType(page, selector, value);
      } else {
        await element.fill(value);
      }

      logger.debug(`Filled input ${selector} with value`);
      return true;
    } catch (error) {
      logger.debug(`Failed to fill input ${selector}: ${error}`);
      return false;
    }
  }

  /**
   * Select an option from a dropdown
   */
  protected async selectOption(
    page: Page,
    selector: string,
    value: string
  ): Promise<boolean> {
    try {
      await page.selectOption(selector, value);
      await randomDelay(200, 400);
      logger.debug(`Selected option ${value} in ${selector}`);
      return true;
    } catch (error) {
      // Try clicking to open dropdown and select
      try {
        await page.click(selector);
        await randomDelay(200, 400);
        await page.click(`text="${value}"`);
        await randomDelay(200, 400);
        return true;
      } catch {
        logger.debug(`Failed to select option ${selector}: ${error}`);
        return false;
      }
    }
  }

  /**
   * Click a button
   */
  protected async clickButton(
    page: Page,
    selector: string,
    options: { waitForNavigation?: boolean } = {}
  ): Promise<boolean> {
    try {
      if (options.waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
          humanClick(page, selector),
        ]);
      } else {
        await humanClick(page, selector);
      }
      await randomDelay(500, 1000);
      logger.debug(`Clicked button ${selector}`);
      return true;
    } catch (error) {
      logger.debug(`Failed to click button ${selector}: ${error}`);
      return false;
    }
  }

  /**
   * Upload a file (resume)
   */
  protected async uploadFile(
    page: Page,
    selector: string,
    filePath: string
  ): Promise<boolean> {
    try {
      const input = await page.$(selector);
      if (!input) {
        // Try to find hidden file input
        const hiddenInput = await page.$('input[type="file"]');
        if (hiddenInput) {
          await hiddenInput.setInputFiles(filePath);
          logger.debug(`Uploaded file via hidden input`);
          return true;
        }
        logger.debug(`File input not found: ${selector}`);
        return false;
      }

      await input.setInputFiles(filePath);
      await randomDelay(1000, 2000);
      logger.debug(`Uploaded file ${filePath}`);
      return true;
    } catch (error) {
      logger.debug(`Failed to upload file ${selector}: ${error}`);
      return false;
    }
  }

  /**
   * Check if an element exists
   */
  protected async elementExists(page: Page, selector: string): Promise<boolean> {
    const element = await page.$(selector);
    return element !== null;
  }

  /**
   * Wait for an element to appear
   */
  protected async waitForElement(
    page: Page,
    selector: string,
    timeout: number = 10000
  ): Promise<boolean> {
    try {
      await page.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get text content of an element
   */
  protected async getTextContent(
    page: Page,
    selector: string
  ): Promise<string | null> {
    try {
      const element = await page.$(selector);
      if (!element) return null;
      return await element.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Check for required fields that couldn't be auto-filled
   */
  protected async detectRequiredInputs(
    page: Page,
    selectors: { selector: string; label: string; type: RequiredInput['type'] }[]
  ): Promise<RequiredInput[]> {
    const requiredInputs: RequiredInput[] = [];

    for (const { selector, label, type } of selectors) {
      try {
        const element = await page.$(selector);
        if (!element) continue;

        // Check if it's required and empty
        const isRequired = await element.getAttribute('required');
        const ariaRequired = await element.getAttribute('aria-required');
        const value = await element.inputValue().catch(() => '');

        if ((isRequired !== null || ariaRequired === 'true') && !value) {
          // Get the actual label from the page if possible
          const labelElement = await page.$(`label[for="${await element.getAttribute('id')}"]`);
          const actualLabel = labelElement
            ? await labelElement.textContent()
            : label;

          requiredInputs.push({
            field: selector,
            label: actualLabel?.trim() || label,
            type,
            required: true,
          });
        }
      } catch {
        // Ignore errors for individual fields
      }
    }

    return requiredInputs;
  }

  /**
   * Fill common fields from profile
   */
  protected async fillCommonFields(
    page: Page,
    profileService: ProfileServiceInterface
  ): Promise<void> {
    const profile = profileService.getProfile();
    if (!profile) return;

    // Common field mappings
    const fieldMappings = [
      // Name fields
      { selectors: ['input[name="name"]', 'input[name="fullName"]', '#name', '#fullName'], value: profile.personalInfo.name },
      { selectors: ['input[name="firstName"]', 'input[name="first_name"]', '#firstName', '#first_name'], value: profile.personalInfo.firstName },
      { selectors: ['input[name="lastName"]', 'input[name="last_name"]', '#lastName', '#last_name'], value: profile.personalInfo.lastName },

      // Contact fields
      { selectors: ['input[name="email"]', 'input[type="email"]', '#email'], value: profile.personalInfo.email },
      { selectors: ['input[name="phone"]', 'input[type="tel"]', '#phone', '#phoneNumber'], value: profile.personalInfo.phone },

      // Links
      { selectors: ['input[name="linkedin"]', 'input[name="linkedinUrl"]', '#linkedin'], value: profile.personalInfo.linkedin },
      { selectors: ['input[name="github"]', 'input[name="githubUrl"]', '#github'], value: profile.personalInfo.github },

      // Location
      { selectors: ['input[name="location"]', 'input[name="city"]', '#location', '#city'], value: profile.personalInfo.location },

      // Professional
      { selectors: ['input[name="currentCompany"]', 'input[name="company"]', '#currentCompany', '#company'], value: profile.professional.currentCompany },
      { selectors: ['input[name="currentTitle"]', 'input[name="title"]', '#currentTitle', '#title'], value: profile.professional.currentTitle },
    ];

    for (const { selectors, value } of fieldMappings) {
      if (!value) continue;

      for (const selector of selectors) {
        const filled = await this.fillInput(page, selector, value);
        if (filled) break;
      }
    }
  }

  /**
   * Log application step
   */
  protected log(message: string, level: 'info' | 'debug' | 'warn' | 'error' = 'debug'): void {
    const formattedMessage = `[${this.name}] ${message}`;
    logger[level](formattedMessage);
  }

  /**
   * Scroll to an element
   */
  protected async scrollToElement(page: Page, selector: string): Promise<void> {
    try {
      await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, selector);
      await randomDelay(300, 600);
    } catch {
      // Ignore scroll errors
    }
  }

  /**
   * Check for success indicators
   */
  protected async checkForSuccess(page: Page): Promise<boolean> {
    const successIndicators = [
      'text="Application submitted"',
      'text="Thank you for applying"',
      'text="Application received"',
      'text="You have applied"',
      'text="Successfully applied"',
      'text="Your application has been submitted"',
      '.application-success',
      '.success-message',
      '[data-test="application-success"]',
    ];

    for (const indicator of successIndicators) {
      if (await this.elementExists(page, indicator)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for error indicators
   */
  protected async checkForErrors(page: Page): Promise<string | null> {
    const errorSelectors = [
      '.error-message',
      '.alert-error',
      '.form-error',
      '[data-test="error"]',
      '[role="alert"]',
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
