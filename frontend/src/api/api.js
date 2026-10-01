import axios from 'axios';

// Create axios instance with default config
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL !== undefined ? import.meta.env.VITE_API_URL : 'http://localhost:4000',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add response interceptor to handle errors
api.interceptors.response.use(
  response => response,
  error => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Add Auth0 token interceptor
api.interceptors.request.use(async (config) => {
  try {
    const token = localStorage.getItem('auth0_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (error) {
    console.error('Error setting auth token:', error);
  }
  return config;
});

// Auth API endpoints
export const authAPI = {
  async register(auth0User) {
    const response = await api.post('/api/auth/register', { user: auth0User });
    return response.data;
  },

  async getCurrentUser() {
    const response = await api.get('/api/auth/user');
    return response.data;
  },

  async updateUser(userData) {
    const response = await api.put('/api/auth/user', userData);
    return response.data;
  },

  /**
   * Login user with email and password
   * @param {string} email User's email
   * @param {string} password User's password 
   * @returns {Promise} Response with user data
   */
  login: (email, password) => 
    api.post('/api/login', { email, password }),

  /**
   * Logout current user
   * @returns {Promise} Response with logout status
   */
  logout: () => 
    api.post('/api/logout'),

  async completeOnboarding(formData) {
    const response = await api.post('/api/auth/onboarding', formData);
    return response.data;
  },

  async updateProfile(profileData) {
    const response = await api.put('/api/auth/profile', profileData);
    return response.data;
  },

  async updateEducation(educationData) {
    const response = await api.put('/api/auth/education', { education: educationData });
    return response.data;
  },

  async updateSkills(skillsData) {
    const response = await api.put('/api/auth/skills', { skills: skillsData });
    return response.data;
  },

  async updateSocialProfiles(socialData) {
    const response = await api.put('/api/auth/social', { socialProfiles: socialData });
    return response.data;
  }
};

// Events API endpoints
export const eventsAPI = {
  /**
   * Get all events with related data (timeline, links, branding, tracks, sponsors, etc)
   * @returns {Promise} Response with events array
   */
  async getEvents() {
    const response = await api.get('/api/events');
    return response.data;
  },

  /**
   * Get single event by ID with all related data
   * @param {string} id Event ID
   * @returns {Promise} Response with event data
   */
  async getEvent(id) {
    const response = await api.get(`/api/events/${id}`);
    return response.data;
  },

  /**
   * Create new event with all related data
   * @param {Object} eventData Event creation data including:
   * - Basic info (name, type, tagline, about, etc)
   * - Timeline (eventStart, eventEnd, applicationsStart, etc)
   * - Links (websiteUrl, micrositeUrl, etc)
   * - Branding (brandColor, logoUrl, etc)
   * - Tracks & Prizes
   * - Sponsors
   * - Event People (judges, speakers)
   * @returns {Promise} Response with created event
   */
  async createEvent(eventData) {
    const response = await api.post('/api/events', {
      ...eventData,
      status: eventData.status || 'DRAFT'
    });
    return response.data;
  },

  /**
   * Save event as a draft with partial data
   * @param {Object} eventData Event draft data including:
   * - Basic info (name, type, event timeline)
   * - optional or partial eventLinks, eventBranding, etc
   * @returns {Promise} Response with draft event
   */
  saveDraft: (eventData) => 
    api.post('/api/events/draft', eventData),

  /**
   * Update existing event
   * @param {string} id Event ID
   * @param {Object} eventData Updated event data
   * @returns {Promise} Response with updated event
   */
  async updateEvent(id, eventData) {
    const response = await api.put(`/api/events/${id}`, {
      ...eventData,
      status: eventData.status || 'DRAFT'
    });
    return response.data;
  },

  /**
   * Delete an event
   * @param {string} id Event ID
   * @returns {Promise} Response confirming the event deletion
   */
  async deleteEvent(id) {
    const response = await api.delete(`/api/events/${id}`);
    return response.data;
  },

  /**
   * Join an event as a participant
   * @param {string} eventId Event ID
   * @param {Object} applicationData Application details
   * @returns {Promise} Response with application status
   */
  async joinEvent(eventId, applicationData) {
    const response = await api.post(`/api/events/${eventId}/apply`, applicationData);
    return response.data;
  }
};

// Teams API endpoints
export const teamsAPI = {
  /**
   * Get all teams for current user
   * @returns {Promise} Response with teams array
   */
  getTeams: () => 
    api.get('/api/teams'),

  /**
   * Create new team for an event
   * @param {Object} teamData Team creation data including:
   * - eventId: ID of the event
   * - name: Team name
   * @returns {Promise} Response with created team
   */
  createTeam: (teamData) => 
    api.post('/api/teams', teamData),

  /**
   * Get team members
   * @param {string} teamId Team ID
   * @returns {Promise} Response with team members
   */
  getTeamMembers: (teamId) =>
    api.get(`/api/teams/${teamId}/members`),

  /**
   * Add member to team
   * @param {string} teamId Team ID
   * @param {Object} memberData Member data
   * @returns {Promise} Response with updated team
   */
  addTeamMember: (teamId, memberData) =>
    api.post(`/api/teams/${teamId}/members`, memberData)
};

// Projects API endpoints
export const projectsAPI = {
  /**
   * Submit new project for a team
   * @param {Object} projectData Project submission data including:
   * - eventId: ID of the event
   * - teamId: ID of the team
   * - title: Project title
   * - description: Project description
   * - githubUrl: GitHub repository URL
   * - demoUrl: Demo/live project URL
   * @returns {Promise} Response with submitted project
   */
  submitProject: (projectData) => 
    api.post('/api/projects', projectData),

  /**
   * Get project details
   * @param {string} projectId Project ID
   * @returns {Promise} Response with project data
   */
  getProject: (projectId) =>
    api.get(`/api/projects/${projectId}`)
};

// Profile API endpoints
export const profileAPI = {
  /**
   * Get user profile with all related data (education, experience, skills, social)
   * @returns {Promise} Response with profile data
   */
  getProfile: () => 
    api.get('/api/profile'),

  /**
   * Update user profile and related data
   * @param {Object} profileData Updated profile data including:
   * - Basic info (firstName, lastName, bio, etc)
   * - Education history
   * - Work experience
   * - Skills
   * - Social profiles
   * @returns {Promise} Response with updated profile
   */
  updateProfile: (profileData) => 
    api.put('/api/profile', profileData)
};

export default api;
