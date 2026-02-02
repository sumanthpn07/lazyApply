import { Page } from 'playwright';
import { logger } from './logger';

/**
 * Anti-bot detection utilities for human-like browser automation
 */

// Random delay between min and max milliseconds
export const randomDelay = (min: number, max: number): Promise<void> => {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
};

// Human-like typing with variable speed
export const humanType = async (page: Page, selector: string, text: string): Promise<void> => {
  await page.click(selector);
  await randomDelay(100, 300);

  for (const char of text) {
    await page.keyboard.type(char);
    // Variable typing speed: 50-150ms per character
    await randomDelay(50, 150);
  }
};

// Simulate human-like mouse movement
export const humanMouseMove = async (page: Page, x: number, y: number): Promise<void> => {
  const currentMouse = { x: 0, y: 0 };
  const steps = Math.floor(Math.random() * 10) + 5;

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    // Add some curve/randomness to the movement
    const curveOffset = Math.sin(progress * Math.PI) * (Math.random() * 20 - 10);

    const newX = currentMouse.x + (x - currentMouse.x) * progress + curveOffset;
    const newY = currentMouse.y + (y - currentMouse.y) * progress + curveOffset;

    await page.mouse.move(newX, newY);
    await randomDelay(10, 30);
  }
};

// Human-like scrolling
export const humanScroll = async (page: Page, direction: 'up' | 'down' = 'down', amount?: number): Promise<void> => {
  const scrollAmount = amount || Math.floor(Math.random() * 300) + 100;
  const scrollDirection = direction === 'down' ? scrollAmount : -scrollAmount;

  // Scroll in smaller increments
  const steps = Math.floor(Math.random() * 5) + 3;
  const stepAmount = scrollDirection / steps;

  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, stepAmount);
    await randomDelay(50, 150);
  }

  await randomDelay(200, 500);
};

// Random viewport sizes to avoid fingerprinting
export const randomViewport = (): { width: number; height: number } => {
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
  ];

  return viewports[Math.floor(Math.random() * viewports.length)];
};

// Random user agents
export const randomUserAgent = (): string => {
  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  ];

  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

// Add stealth scripts to page
export const addStealthScripts = async (page: Page): Promise<void> => {
  // Override navigator.webdriver
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // Override chrome property
    (window as any).chrome = {
      runtime: {},
    };

    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);

    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });

  logger.debug('Stealth scripts added to page');
};

// Wait for page load with human-like behavior
export const waitForPageLoad = async (page: Page): Promise<void> => {
  await page.waitForLoadState('domcontentloaded');
  await randomDelay(500, 1500);
  await page.waitForLoadState('networkidle').catch(() => {
    // Network idle might not happen, that's ok
  });
  await randomDelay(300, 800);
};

// Click with human-like behavior
export const humanClick = async (page: Page, selector: string): Promise<void> => {
  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  const box = await element.boundingBox();
  if (!box) {
    throw new Error(`Element has no bounding box: ${selector}`);
  }

  // Click at a random position within the element
  const x = box.x + Math.random() * box.width;
  const y = box.y + Math.random() * box.height;

  await humanMouseMove(page, x, y);
  await randomDelay(100, 300);
  await page.mouse.click(x, y);
  await randomDelay(200, 500);
};

// Check if we might be detected
export const checkForBotDetection = async (page: Page): Promise<boolean> => {
  const indicators = [
    // Common CAPTCHA indicators
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '.g-recaptcha',
    '#captcha',
    '[class*="captcha"]',
    // Bot detection messages
    'text=suspicious activity',
    'text=verify you are human',
    'text=unusual traffic',
    'text=blocked',
    'text=access denied',
  ];

  for (const indicator of indicators) {
    try {
      const found = await page.$(indicator);
      if (found) {
        logger.warn(`Potential bot detection triggered: ${indicator}`);
        return true;
      }
    } catch {
      // Ignore errors from checking
    }
  }

  return false;
};
