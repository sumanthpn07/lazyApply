import { Platform } from '../types';

/**
 * Platform URL Patterns
 * Maps URL patterns to platform identifiers
 */
const platformPatterns: { pattern: RegExp; platform: Platform }[] = [
  // LinkedIn
  { pattern: /linkedin\.com/i, platform: 'linkedin' },

  // Lever
  { pattern: /lever\.co/i, platform: 'lever' },
  { pattern: /jobs\.lever\.co/i, platform: 'lever' },

  // Greenhouse
  { pattern: /greenhouse\.io/i, platform: 'greenhouse' },
  { pattern: /boards\.greenhouse\.io/i, platform: 'greenhouse' },

  // Wellfound (formerly AngelList)
  { pattern: /wellfound\.com/i, platform: 'wellfound' },
  { pattern: /angel\.co/i, platform: 'wellfound' },

  // Workable
  { pattern: /workable\.com/i, platform: 'workable' },
  { pattern: /apply\.workable\.com/i, platform: 'workable' },

  // Indeed
  { pattern: /indeed\.com/i, platform: 'indeed' },

  // Naukri
  { pattern: /naukri\.com/i, platform: 'naukri' },

  // Glassdoor
  { pattern: /glassdoor\.com/i, platform: 'company_website' },

  // ZipRecruiter
  { pattern: /ziprecruiter\.com/i, platform: 'company_website' },

  // Monster
  { pattern: /monster\.com/i, platform: 'company_website' },

  // CareerBuilder
  { pattern: /careerbuilder\.com/i, platform: 'company_website' },

  // Dice
  { pattern: /dice\.com/i, platform: 'company_website' },

  // SimplyHired
  { pattern: /simplyhired\.com/i, platform: 'company_website' },

  // BambooHR
  { pattern: /bamboohr\.com/i, platform: 'company_website' },

  // JazzHR
  { pattern: /jazzhr\.com/i, platform: 'company_website' },

  // SmartRecruiters
  { pattern: /smartrecruiters\.com/i, platform: 'company_website' },

  // iCIMS
  { pattern: /icims\.com/i, platform: 'company_website' },

  // Jobvite
  { pattern: /jobvite\.com/i, platform: 'company_website' },
];

/**
 * Detect platform from a job URL
 * @param url - The job posting URL
 * @returns The detected platform
 */
export function detectPlatformFromUrl(url: string): Platform {
  if (!url) return 'unknown';

  const urlLower = url.toLowerCase();

  // Check against all patterns
  for (const { pattern, platform } of platformPatterns) {
    if (pattern.test(urlLower)) {
      return platform;
    }
  }

  // Default to company_website for unrecognized URLs
  return 'company_website';
}

/**
 * Get login URL for a platform
 * @param platform - The platform identifier
 * @returns The login URL or null if not applicable
 */
export function getLoginUrl(platform: Platform): string | null {
  const loginUrls: Partial<Record<Platform, string>> = {
    linkedin: 'https://www.linkedin.com/login',
    wellfound: 'https://wellfound.com/login',
    indeed: 'https://secure.indeed.com/account/login',
    naukri: 'https://www.naukri.com/nlogin/login',
  };

  return loginUrls[platform] || null;
}

/**
 * Check if a platform requires login
 * @param platform - The platform identifier
 * @returns Whether login is typically required
 */
export function platformRequiresLogin(platform: Platform): boolean {
  const loginRequiredPlatforms: Platform[] = [
    'linkedin',
    'wellfound',
    'indeed',
    'naukri',
  ];

  return loginRequiredPlatforms.includes(platform);
}

/**
 * Check if a platform is fully supported with automation
 * @param platform - The platform identifier
 * @returns Whether the platform has a dedicated handler
 */
export function isPlatformFullySupported(platform: Platform): boolean {
  const supportedPlatforms: Platform[] = [
    'linkedin',
    'lever',
    'greenhouse',
    'wellfound',
    'workable',
  ];

  return supportedPlatforms.includes(platform);
}

/**
 * Extract company name from career page URL
 * @param url - The job posting URL
 * @returns The company name or null
 */
export function extractCompanyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Common career page patterns
    // careers.company.com or jobs.company.com
    if (hostname.startsWith('careers.') || hostname.startsWith('jobs.')) {
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        return parts[1];
      }
    }

    // company.greenhouse.io or company.lever.co
    if (hostname.includes('greenhouse.io') || hostname.includes('lever.co')) {
      const parts = hostname.split('.');
      if (parts.length >= 3 && parts[0] !== 'boards' && parts[0] !== 'jobs') {
        return parts[0];
      }
    }

    // Fallback: use the main domain
    const parts = hostname.replace('www.', '').split('.');
    if (parts.length >= 2) {
      return parts[0];
    }

    return null;
  } catch {
    return null;
  }
}
