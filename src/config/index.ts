import dotenv from 'dotenv';
import path from 'path';
import { RateLimitConfig, Platform } from '../types';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Brave Search API
  braveApiKey: process.env.BRAVE_API_KEY || '',
  braveSearchUrl: 'https://api.search.brave.com/res/v1/web/search',

  // Notion
  notionDatabaseId: process.env.NOTION_DATABASE_ID || '',

  // Paths
  dataDir: path.join(__dirname, '../../data'),
  profilePath: path.join(__dirname, '../../data/profile.json'),
  appliedJobsPath: path.join(__dirname, '../../data/applied-jobs.json'),
  pendingInputsPath: path.join(__dirname, '../../data/pending-inputs.json'),
  screenshotsDir: path.join(__dirname, '../../data/screenshots'),
  resumesDir: path.join(__dirname, '../../data/resumes'),

  // Browser
  headless: process.env.HEADLESS === 'true',
  slowMo: parseInt(process.env.SLOW_MO || '50', 10),

  // Rate Limiting defaults
  rateLimits: {
    linkedin: {
      platform: 'linkedin' as Platform,
      delayMin: parseInt(process.env.LINKEDIN_DELAY_MIN || '300000', 10), // 5 min
      delayMax: parseInt(process.env.LINKEDIN_DELAY_MAX || '480000', 10), // 8 min
      hourlyLimit: 10,
      dailyLimit: parseInt(process.env.LINKEDIN_DAILY_LIMIT || '50', 10),
    },
    lever: {
      platform: 'lever' as Platform,
      delayMin: parseInt(process.env.DEFAULT_DELAY_MIN || '120000', 10), // 2 min
      delayMax: parseInt(process.env.DEFAULT_DELAY_MAX || '240000', 10), // 4 min
      hourlyLimit: 20,
      dailyLimit: parseInt(process.env.DEFAULT_DAILY_LIMIT || '100', 10),
    },
    greenhouse: {
      platform: 'greenhouse' as Platform,
      delayMin: parseInt(process.env.DEFAULT_DELAY_MIN || '120000', 10),
      delayMax: parseInt(process.env.DEFAULT_DELAY_MAX || '240000', 10),
      hourlyLimit: 20,
      dailyLimit: parseInt(process.env.DEFAULT_DAILY_LIMIT || '100', 10),
    },
    wellfound: {
      platform: 'wellfound' as Platform,
      delayMin: 180000, // 3 min
      delayMax: 300000, // 5 min
      hourlyLimit: 15,
      dailyLimit: 75,
    },
    workable: {
      platform: 'workable' as Platform,
      delayMin: parseInt(process.env.DEFAULT_DELAY_MIN || '120000', 10),
      delayMax: parseInt(process.env.DEFAULT_DELAY_MAX || '240000', 10),
      hourlyLimit: 20,
      dailyLimit: parseInt(process.env.DEFAULT_DAILY_LIMIT || '100', 10),
    },
    default: {
      platform: 'unknown' as Platform,
      delayMin: parseInt(process.env.DEFAULT_DELAY_MIN || '120000', 10),
      delayMax: parseInt(process.env.DEFAULT_DELAY_MAX || '240000', 10),
      hourlyLimit: 20,
      dailyLimit: parseInt(process.env.DEFAULT_DAILY_LIMIT || '100', 10),
    },
  } as Record<string, RateLimitConfig>,
};

export function getRateLimitConfig(platform: Platform): RateLimitConfig {
  return config.rateLimits[platform] || config.rateLimits.default;
}
