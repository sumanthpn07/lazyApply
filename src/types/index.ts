// Job Types
export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  salary?: string;
  description: string;
  url: string;
  platform: Platform;
  postedDate?: string;
  status: JobStatus;
  appliedDate?: string;
  requiredInputs?: RequiredInput[];
  userInputs?: Record<string, string>;
  error?: string;
  screenshotPath?: string;
  notionPageId?: string;
  resumeVersion?: string;
  notes?: string;
}

export type Platform =
  | 'linkedin'
  | 'lever'
  | 'greenhouse'
  | 'wellfound'
  | 'workable'
  | 'company_website'
  | 'naukri'
  | 'indeed'
  | 'unknown';

export type JobStatus =
  | 'ready'           // ⚪ Ready to apply
  | 'needs_input'     // 🟡 Requires additional info
  | 'applying'        // 🔵 Currently processing
  | 'applied'         // 🟢 Successfully applied
  | 'failed'          // 🔴 Application failed
  | 'skipped';        // ⚫ User skipped

export interface RequiredInput {
  field: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'file';
  options?: string[];
  required: boolean;
  value?: string;
}

// Search Types
export interface SearchParams {
  query: string;
  location?: string;
  remote?: boolean;
  experienceLevel?: string;
  postedWithin?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  source: string;
}

// Profile Types
export interface Profile {
  personalInfo: {
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    linkedin: string;
    github: string;
    location: string;
    currentLocation: string;
    willingToRelocate: boolean;
    workAuthorization: {
      india: string;
      usa: string;
    };
  };
  professional: {
    yearsOfExperience: number;
    currentTitle: string;
    currentCompany: string;
    noticePeriod: string;
    expectedSalary: string;
    preferredWorkType: string[];
  };
  targetRoles: string[];
  preferredLocations: string[];
  skills: {
    languages: string[];
    frameworks: string[];
    tools: string[];
    platforms: string[];
    concepts: string[];
    softSkills: string[];
  };
  education: {
    degree: string;
    major: string;
    university: string;
    location: string;
    startDate: string;
    endDate: string;
    courses: string[];
  };
  experience: Experience[];
  projects: Project[];
  commonQuestions: Record<string, string>;
  coverLetterTemplate: string;
  savedAnswers: Record<string, string>;
}

export interface Experience {
  company: string;
  title: string;
  type: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  highlights: string[];
  technologies: string[];
}

export interface Project {
  name: string;
  description: string;
  technologies: string[];
}

// Queue Types
export interface ApplicationQueue {
  id: string;
  jobs: Job[];
  status: 'idle' | 'running' | 'paused';
  currentIndex: number;
  startedAt?: string;
  completedAt?: string;
}

// Rate Limiter Types
export interface RateLimitConfig {
  platform: Platform;
  delayMin: number;
  delayMax: number;
  hourlyLimit: number;
  dailyLimit: number;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Notion Types
export interface NotionJobEntry {
  'Job Title': string;
  'Company': string;
  'Role': string;
  'Job Link': string;
  'Portal': string;
  'Status': string;
  'Applied Date'?: string;
  'Follow-up Date'?: string;
  'Resume Version'?: string;
  'Response Received'?: string;
  'Interview Stage'?: string;
  'Notes'?: string;
}

// Stats Types
export interface ApplicationStats {
  totalSearched: number;
  totalApplied: number;
  totalFailed: number;
  totalSkipped: number;
  totalPendingInput: number;
  byPlatform: Record<Platform, number>;
  byDate: Record<string, number>;
  successRate: number;
}
