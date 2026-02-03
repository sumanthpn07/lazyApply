import { config } from '../config';
import { Job, Platform, SearchParams, SearchResult } from '../types';
import { logger, logJobSearch } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Brave Search API integration for job discovery
 */

// Platform detection patterns
const platformPatterns: { pattern: RegExp; platform: Platform }[] = [
  { pattern: /linkedin\.com/i, platform: 'linkedin' },
  { pattern: /lever\.co/i, platform: 'lever' },
  { pattern: /greenhouse\.io/i, platform: 'greenhouse' },
  { pattern: /wellfound\.com|angel\.co/i, platform: 'wellfound' },
  { pattern: /apply\.workable\.com/i, platform: 'workable' },
  { pattern: /naukri\.com/i, platform: 'naukri' },
  { pattern: /indeed\.com/i, platform: 'indeed' },
];

/**
 * Detect the platform from a URL
 */
export function detectPlatform(url: string): Platform {
  for (const { pattern, platform } of platformPatterns) {
    if (pattern.test(url)) {
      return platform;
    }
  }
  return 'company_website';
}

/**
 * Extract company name from search result
 */
function extractCompany(title: string, url: string, description: string): string {
  // Try to extract from common patterns
  const patterns = [
    /at\s+([A-Z][A-Za-z0-9\s&.-]+?)(?:\s*[-|]|$)/,
    /([A-Z][A-Za-z0-9\s&.-]+?)\s+is\s+hiring/i,
    /Join\s+([A-Z][A-Za-z0-9\s&.-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern) || description.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  // Try to extract from URL
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // For Lever/Greenhouse, company is usually in subdomain
    if (hostname.includes('lever.co') || hostname.includes('greenhouse.io')) {
      const subdomain = hostname.split('.')[0];
      if (subdomain !== 'www' && subdomain !== 'jobs') {
        return subdomain.charAt(0).toUpperCase() + subdomain.slice(1);
      }
    }

    // For company career pages
    const domainParts = hostname.replace('www.', '').split('.');
    if (domainParts.length >= 2) {
      return domainParts[0].charAt(0).toUpperCase() + domainParts[0].slice(1);
    }
  } catch {
    // Ignore URL parsing errors
  }

  return 'Unknown Company';
}

/**
 * Extract job title from search result
 */
function extractJobTitle(title: string): string {
  // Remove common suffixes
  let cleanTitle = title
    .replace(/\s*[-|]\s*.*$/, '') // Remove everything after dash or pipe
    .replace(/\s*at\s+.*$/i, '') // Remove "at Company"
    .replace(/\s*@\s+.*$/i, '') // Remove "@ Company"
    .replace(/\(.*?\)/g, '') // Remove parentheses
    .trim();

  // If title is too short, use the original
  if (cleanTitle.length < 5) {
    cleanTitle = title.split(/[-|]/)[0].trim();
  }

  return cleanTitle;
}

/**
 * Search for jobs using Brave Search API
 */
export async function searchJobs(params: SearchParams): Promise<Job[]> {
  const { query, location, remote, experienceLevel, postedWithin } = params;

  // Build search query
  let searchQuery = query;

  if (location) {
    searchQuery += ` ${location}`;
  }

  if (remote) {
    searchQuery += ' remote';
  }

  if (experienceLevel) {
    searchQuery += ` ${experienceLevel}`;
  }

  // Add job-related keywords
  searchQuery += ' jobs hiring apply';

  // Add site filters for better results
  const siteFilters = [
    'site:linkedin.com/jobs',
    'site:lever.co',
    'site:greenhouse.io',
    'site:wellfound.com',
    'site:apply.workable.com',
  ].join(' OR ');

  const fullQuery = `${searchQuery} (${siteFilters})`;

  logger.info(`Searching Brave API: "${searchQuery}"`);

  try {
    const url = new URL(config.braveSearchUrl);
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('count', '20');

    logger.debug(`Brave API URL: ${url.toString()}`);

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': config.braveApiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brave API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { web?: { results?: SearchResult[] } };
    const results: SearchResult[] = data.web?.results || [];

    logJobSearch(query, results.length);

    // Convert search results to Job objects
    const jobs: Job[] = results
      .filter((result) => {
        // Filter out non-job pages
        const url = result.url.toLowerCase();
        return (
          url.includes('/jobs/') ||
          url.includes('/careers/') ||
          url.includes('/job/') ||
          url.includes('lever.co') ||
          url.includes('greenhouse.io') ||
          url.includes('workable.com') ||
          url.includes('wellfound.com')
        );
      })
      .map((result) => {
        const platform = detectPlatform(result.url);
        const company = extractCompany(result.title, result.url, result.description);
        const title = extractJobTitle(result.title);

        return {
          id: uuidv4(),
          title,
          company,
          location: location || 'Not specified',
          description: result.description,
          url: result.url,
          platform,
          status: 'ready' as const,
        };
      });

    // Remove duplicates based on URL
    const uniqueJobs = jobs.filter(
      (job, index, self) => index === self.findIndex((j) => j.url === job.url)
    );

    logger.info(`Found ${uniqueJobs.length} unique job listings`);
    return uniqueJobs;
  } catch (error) {
    logger.error('Error searching jobs:', error);
    throw error;
  }
}

/**
 * Get job details by fetching the actual page
 */
export async function getJobDetails(url: string): Promise<Partial<Job>> {
  // This would be implemented with Playwright to scrape actual job details
  // For now, return basic info
  return {
    url,
    platform: detectPlatform(url),
  };
}

/**
 * Build search queries for multiple job titles
 */
export function buildSearchQueries(
  titles: string[],
  locations: string[],
  remote: boolean = true
): SearchParams[] {
  const queries: SearchParams[] = [];

  for (const title of titles) {
    for (const location of locations) {
      queries.push({
        query: title,
        location: location === 'Remote' ? undefined : location,
        remote: location === 'Remote' || remote,
      });
    }
  }

  return queries;
}
