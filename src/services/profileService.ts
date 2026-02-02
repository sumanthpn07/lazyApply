import fs from 'fs';
import { Profile } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Service for managing user profile data
 */

class ProfileService {
  private profile: Profile | null = null;

  constructor() {
    this.loadProfile();
  }

  /**
   * Load profile from disk
   */
  private loadProfile(): void {
    try {
      if (fs.existsSync(config.profilePath)) {
        const data = fs.readFileSync(config.profilePath, 'utf-8');
        this.profile = JSON.parse(data);
        logger.info(`Profile loaded for ${this.profile?.personalInfo.name}`);
      } else {
        logger.warn('Profile not found at', config.profilePath);
      }
    } catch (error) {
      logger.error('Error loading profile:', error);
    }
  }

  /**
   * Get the full profile
   */
  getProfile(): Profile | null {
    return this.profile;
  }

  /**
   * Update profile
   */
  updateProfile(updates: Partial<Profile>): void {
    if (this.profile) {
      this.profile = { ...this.profile, ...updates };
      this.saveProfile();
    }
  }

  /**
   * Save profile to disk
   */
  private saveProfile(): void {
    try {
      fs.writeFileSync(config.profilePath, JSON.stringify(this.profile, null, 2));
      logger.info('Profile saved');
    } catch (error) {
      logger.error('Error saving profile:', error);
    }
  }

  /**
   * Get value for form field auto-fill
   */
  getFieldValue(fieldName: string): string | undefined {
    if (!this.profile) return undefined;

    const fieldMappings: Record<string, string | undefined> = {
      // Personal info
      name: this.profile.personalInfo.name,
      fullName: this.profile.personalInfo.name,
      full_name: this.profile.personalInfo.name,
      firstName: this.profile.personalInfo.firstName,
      first_name: this.profile.personalInfo.firstName,
      lastName: this.profile.personalInfo.lastName,
      last_name: this.profile.personalInfo.lastName,
      email: this.profile.personalInfo.email,
      emailAddress: this.profile.personalInfo.email,
      email_address: this.profile.personalInfo.email,
      phone: this.profile.personalInfo.phone,
      phoneNumber: this.profile.personalInfo.phone,
      phone_number: this.profile.personalInfo.phone,
      mobile: this.profile.personalInfo.phone,
      linkedin: this.profile.personalInfo.linkedin,
      linkedinUrl: this.profile.personalInfo.linkedin,
      linkedin_url: this.profile.personalInfo.linkedin,
      github: this.profile.personalInfo.github,
      githubUrl: this.profile.personalInfo.github,
      github_url: this.profile.personalInfo.github,
      location: this.profile.personalInfo.location,
      city: this.profile.personalInfo.location.split(',')[0],
      address: this.profile.personalInfo.location,

      // Professional
      currentTitle: this.profile.professional.currentTitle,
      current_title: this.profile.professional.currentTitle,
      jobTitle: this.profile.professional.currentTitle,
      title: this.profile.professional.currentTitle,
      currentCompany: this.profile.professional.currentCompany,
      current_company: this.profile.professional.currentCompany,
      company: this.profile.professional.currentCompany,
      employer: this.profile.professional.currentCompany,
      yearsOfExperience: String(this.profile.professional.yearsOfExperience),
      years_of_experience: String(this.profile.professional.yearsOfExperience),
      experience: String(this.profile.professional.yearsOfExperience),
      noticePeriod: this.profile.professional.noticePeriod,
      notice_period: this.profile.professional.noticePeriod,
      startDate: this.profile.professional.noticePeriod,
      expectedSalary: this.profile.professional.expectedSalary,
      salary: this.profile.professional.expectedSalary,
      salaryExpectation: this.profile.professional.expectedSalary,

      // Education
      degree: this.profile.education.degree,
      education: `${this.profile.education.degree} in ${this.profile.education.major}`,
      university: this.profile.education.university,
      school: this.profile.education.university,
      college: this.profile.education.university,
      major: this.profile.education.major,
      graduationYear: this.profile.education.endDate,
    };

    // Check direct mapping
    const normalizedField = fieldName.toLowerCase().replace(/[^a-z]/g, '');
    for (const [key, value] of Object.entries(fieldMappings)) {
      if (key.toLowerCase().replace(/[^a-z]/g, '') === normalizedField) {
        return value;
      }
    }

    // Check saved answers
    if (this.profile.savedAnswers[fieldName]) {
      return this.profile.savedAnswers[fieldName];
    }

    return undefined;
  }

  /**
   * Get answer for common questions
   */
  getQuestionAnswer(question: string, context?: { company?: string; role?: string }): string | undefined {
    if (!this.profile) return undefined;

    const questionLower = question.toLowerCase();

    // Match common question patterns
    const questionMappings: { patterns: string[]; key: keyof Profile['commonQuestions'] }[] = [
      { patterns: ['why', 'company', 'interested', 'excite'], key: 'whyThisCompany' },
      { patterns: ['why', 'role', 'position', 'job'], key: 'whyThisRole' },
      { patterns: ['strength'], key: 'greatestStrength' },
      { patterns: ['weakness'], key: 'greatestWeakness' },
      { patterns: ['5 years', 'five years', 'future', 'see yourself'], key: 'whereDoYouSeeYourself' },
      { patterns: ['challenge', 'difficult', 'tough'], key: 'challengingProject' },
      { patterns: ['leaving', 'leave', 'why are you looking'], key: 'whyLeavingCurrentJob' },
      { patterns: ['salary', 'compensation', 'pay'], key: 'salary' },
      { patterns: ['start', 'when can you', 'availability'], key: 'startDate' },
      { patterns: ['relocate', 'relocation', 'move'], key: 'relocation' },
      { patterns: ['remote', 'work from home', 'hybrid'], key: 'remoteWork' },
      { patterns: ['visa', 'sponsorship', 'authorization'], key: 'visaSponsorship' },
    ];

    for (const { patterns, key } of questionMappings) {
      if (patterns.some((p) => questionLower.includes(p))) {
        let answer = this.profile.commonQuestions[key];

        // Replace placeholders
        if (context?.company) {
          answer = answer.replace(/{company}/g, context.company);
        }
        if (context?.role) {
          answer = answer.replace(/{jobTitle}/g, context.role);
          answer = answer.replace(/{role}/g, context.role);
        }

        return answer;
      }
    }

    // Check saved answers
    for (const [savedQuestion, answer] of Object.entries(this.profile.savedAnswers)) {
      if (savedQuestion.toLowerCase().includes(questionLower) ||
          questionLower.includes(savedQuestion.toLowerCase())) {
        return answer;
      }
    }

    return undefined;
  }

  /**
   * Save an answer for future use
   */
  saveAnswer(question: string, answer: string): void {
    if (this.profile) {
      this.profile.savedAnswers[question] = answer;
      this.saveProfile();
      logger.info(`Saved answer for: "${question.substring(0, 50)}..."`);
    }
  }

  /**
   * Get cover letter for a specific job
   */
  getCoverLetter(company: string, jobTitle: string, reason?: string): string {
    if (!this.profile) return '';

    return this.profile.coverLetterTemplate
      .replace(/{company}/g, company)
      .replace(/{jobTitle}/g, jobTitle)
      .replace(/{reason}/g, reason || `your innovative approach and company culture`);
  }

  /**
   * Get all skills as a flat array
   */
  getAllSkills(): string[] {
    if (!this.profile) return [];

    return [
      ...this.profile.skills.languages,
      ...this.profile.skills.frameworks,
      ...this.profile.skills.tools,
      ...this.profile.skills.platforms,
      ...this.profile.skills.concepts,
    ];
  }

  /**
   * Check if profile has a skill (case-insensitive)
   */
  hasSkill(skill: string): boolean {
    const allSkills = this.getAllSkills();
    const normalizedSkill = skill.toLowerCase();
    return allSkills.some((s) => s.toLowerCase().includes(normalizedSkill));
  }
}

// Export singleton instance
export const profileService = new ProfileService();
