/**
 * Einfacher API Client für Railway Backend
 * Kommuniziert direkt mit Express API über MySQL
 * Unterstützt Multi-Tenant via DB-Token
 */

import { toast as showToast } from "@/components/ui/use-toast";

const API_URL = import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? 'http://localhost:3000' : '');
const TOKEN_KEY = 'radioplan_jwt_token';
const DB_TOKEN_KEY = 'db_credentials';
const DB_TOKEN_ENABLED_KEY = 'db_token_enabled';
const REQUEST_RETRY_DELAYS_MS = [300, 900];
const DATABASE_TOAST_COOLDOWN_MS = 15000;
const DATABASE_ERROR_PATTERNS = [
  /database/i,
  /mysql/i,
  /sql/i,
  /connection.*closed/i,
  /lost connection/i,
  /server has gone away/i,
  /unknown column/i,
  /doesn't exist/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /PROTOCOL_CONNECTION_LOST/i,
  /ER_[A-Z_]+/i,
];

let lastDatabaseToastAt = 0;

function shouldAttachDbToken(endpoint) {
  return !endpoint.startsWith('/api/auth/') && !endpoint.startsWith('/api/master/');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(errorData) {
  if (!errorData) return '';
  if (typeof errorData === 'string') return errorData;
  return errorData.error || errorData.message || errorData.details || '';
}

function isDatabaseProblem({ status, errorData, error }) {
  if (errorData?.databaseError === true) {
    return true;
  }

  if (status === 503) {
    return true;
  }

  const code = errorData?.code || error?.code || '';
  if (typeof code === 'string' && (code.startsWith('ER_') || code.startsWith('PROTOCOL_') || code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT')) {
    return true;
  }

  const message = [extractErrorMessage(errorData), error?.message || ''].join(' ').trim();
  return DATABASE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function notifyDatabaseProblem(message) {
  const now = Date.now();
  if (now - lastDatabaseToastAt < DATABASE_TOAST_COOLDOWN_MS) {
    return;
  }

  lastDatabaseToastAt = now;
  showToast({
    variant: 'destructive',
    title: 'Datenbankproblem',
    description: message || 'Die Datenbank ist momentan nicht stabil erreichbar. Bitte versuchen Sie es erneut.',
  });
}

function createRequestError(message, extras = {}) {
  const error = new Error(message);
  Object.assign(error, extras);
  return error;
}

class APIClient {
  constructor() {
    this.baseURL = API_URL;
  }

  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  // Get active DB token (only if enabled)
  getDbToken() {
    const enabled = localStorage.getItem(DB_TOKEN_ENABLED_KEY) === 'true';
    if (!enabled) return null;
    return localStorage.getItem(DB_TOKEN_KEY);
  }

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const dbToken = shouldAttachDbToken(endpoint) ? this.getDbToken() : null;
    
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(dbToken && { 'X-DB-Token': dbToken }),
      ...options.headers,
    };

    const config = {
      ...options,
      headers,
    };

    const url = `${this.baseURL}${endpoint}`;

    for (let attempt = 1; attempt <= REQUEST_RETRY_DELAYS_MS.length + 1; attempt += 1) {
      try {
        const response = await fetch(url, config);

        if (!response.ok) {
          const errorData = await response.json().catch(async () => {
            const text = await response.text().catch(() => 'Request failed');
            return { error: text || 'Request failed' };
          });
          const message = extractErrorMessage(errorData) || `HTTP ${response.status}`;
          const databaseError = isDatabaseProblem({ status: response.status, errorData });
          throw createRequestError(message, {
            status: response.status,
            code: errorData?.code,
            details: errorData,
            databaseError,
            retryable: databaseError && (response.status >= 500 || response.status === 503),
          });
        }

        return response.json();
      } catch (error) {
        const databaseError = isDatabaseProblem({ status: error.status, errorData: error.details, error });
        const networkError = error instanceof TypeError || /Failed to fetch/i.test(error.message || '');
        const canRetry = attempt <= REQUEST_RETRY_DELAYS_MS.length && (networkError || (databaseError && (error.retryable !== false)));

        if (canRetry) {
          console.warn(`[API] Retry ${attempt}/${REQUEST_RETRY_DELAYS_MS.length + 1} for ${endpoint}`, {
            message: error.message,
            status: error.status || null,
            code: error.code || null,
          });
          await wait(REQUEST_RETRY_DELAYS_MS[attempt - 1]);
          continue;
        }

        if (databaseError || networkError) {
          console.error(`[API] Database/server issue on ${endpoint}`, {
            message: error.message,
            status: error.status || null,
            code: error.code || null,
            details: error.details || null,
          });
          notifyDatabaseProblem('Beim Speichern oder Laden gab es ein Datenbankproblem. Bitte versuchen Sie es erneut.');
        }

        throw error;
      }
    }
  }

  // ==================== Auth ====================

  async login(email, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.token) {
      this.setToken(data.token);
    }
    return data;
  }

  async register(userData) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async me() {
    return this.request('/api/auth/me');
  }

  async updatePresence() {
    return this.request('/api/auth/presence', {
      method: 'POST',
    });
  }

  async getJitsiToken() {
    return this.request('/api/auth/jitsi-token');
  }

  async listCoworkContacts() {
    return this.request(`/api/auth/cowork/contacts?_=${Date.now()}`, {
      cache: 'no-store',
    });
  }

  async listCoworkInvites() {
    return this.request(`/api/auth/cowork/invites?_=${Date.now()}`, {
      cache: 'no-store',
    });
  }

  async sendCoworkInvite(inviteeUserId) {
    return this.request('/api/auth/cowork/invites', {
      method: 'POST',
      body: JSON.stringify({ inviteeUserId }),
    });
  }

  async declineCoworkInvite(inviteId) {
    return this.request(`/api/auth/cowork/invites/${inviteId}/decline`, {
      method: 'POST',
    });
  }

  async cancelCoworkInvite(inviteId) {
    return this.request(`/api/auth/cowork/invites/${inviteId}/cancel`, {
      method: 'POST',
    });
  }

  async joinCoworkInvite(inviteId) {
    return this.request(`/api/auth/cowork/session/${inviteId}`, {
      method: 'POST',
    });
  }

  async updateMe(updates) {
    return this.request('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async changePassword(currentPassword, newPassword) {
    return this.request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async forceChangePassword(newPassword) {
    return this.request('/api/auth/force-change-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
  }

  async changeEmail(newEmail, password) {
    return this.request('/api/auth/change-email', {
      method: 'POST',
      body: JSON.stringify({ newEmail, password }),
    });
  }

  async logout() {
    this.setToken(null);
    return { success: true };
  }

  async verify() {
    try {
      await this.me();
      return true;
    } catch {
      return false;
    }
  }

  // Get allowed tenants for the current user
  async getMyTenants() {
    return this.request('/api/auth/my-tenants');
  }

  // Activate a specific tenant/db-token (uses auth route for non-admin users)
  async activateTenant(tokenId) {
    return this.request(`/api/auth/activate-tenant/${tokenId}`, {
      method: 'POST'
    });
  }

  // ==================== Admin User Management ====================

  async listUsers() {
    return this.request('/api/auth/users');
  }

  async updateUser(userId, data) {
    return this.request(`/api/auth/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ data }),
    });
  }

  async deleteUser(userId) {
    return this.request(`/api/auth/users/${userId}`, {
      method: 'DELETE',
    });
  }

  async sendPasswordEmail(userId) {
    return this.request(`/api/auth/users/${userId}/reset-password`, {
      method: 'POST',
    });
  }

  async getEmailVerificationStatus(userId) {
    return this.request(`/api/auth/email-verification-status/${userId}`);
  }

  // ==================== Database Operations ====================

  async dbAction(action, table, params = {}) {
    return this.request('/api/db', {
      method: 'POST',
      body: JSON.stringify({ action, table, ...params }),
    });
  }

  async list(table, options = {}) {
    return this.dbAction('list', table, options);
  }

  async filter(table, query, options = {}) {
    return this.dbAction('filter', table, { query, ...options });
  }

  async get(table, id) {
    return this.dbAction('get', table, { id });
  }

  async create(table, data) {
    return this.dbAction('create', table, { data });
  }

  async update(table, id, data) {
    return this.dbAction('update', table, { id, data });
  }

  async delete(table, id) {
    return this.dbAction('delete', table, { id });
  }

  async bulkCreate(table, dataArray) {
    return this.dbAction('bulkCreate', table, { data: dataArray });
  }

  // ==================== Schedule ====================

  async getSchedule(year, month) {
    return this.request(`/api/schedule/${year}/${month}`);
  }

  async updateSchedule(year, month, entries) {
    return this.request(`/api/schedule/${year}/${month}`, {
      method: 'POST',
      body: JSON.stringify({ entries }),
    });
  }

  async exportScheduleToExcel(startDate, endDate, hiddenRows = []) {
    return this.request('/api/schedule/export', {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate, hiddenRows }),
    });
  }

  // ==================== Holidays ====================

  async getHolidays(year, state = 'NW') {
    return this.request(`/api/holidays?year=${year}&state=${state}`);
  }

  // ==================== Qualification Certificates ====================

  async listCertificates(params = {}) {
    const search = new URLSearchParams();
    if (params.doctor_id) search.set('doctor_id', params.doctor_id);
    if (params.qualification_id) search.set('qualification_id', params.qualification_id);
    const qs = search.toString();
    return this.request(`/api/certificates${qs ? `?${qs}` : ''}`);
  }

  async listExpiringCertificates(days = 60) {
    return this.request(`/api/certificates/expiring?days=${encodeURIComponent(days)}`);
  }

  async uploadCertificate({ file, doctor_id, qualification_id, doctor_qualification_id, granted_date, expiry_date, notes, qualification_name, qualification_description }) {
    if (!file) throw new Error('Datei fehlt');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('doctor_id', doctor_id);
    formData.append('qualification_id', qualification_id);
    if (doctor_qualification_id) formData.append('doctor_qualification_id', doctor_qualification_id);
    if (granted_date) formData.append('granted_date', granted_date);
    if (expiry_date) formData.append('expiry_date', expiry_date);
    if (notes) formData.append('notes', notes);
    if (qualification_name) formData.append('qualification_name', qualification_name);
    if (qualification_description) formData.append('qualification_description', qualification_description);

    const token = this.getToken();
    const dbToken = this.getDbToken();
    const headers = {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(dbToken && { 'X-DB-Token': dbToken }),
    };

    const response = await fetch(`${this.baseURL}/api/certificates/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Upload fehlgeschlagen (HTTP ${response.status})`);
    }
    return response.json();
  }

  async updateCertificate(id, { granted_date, expiry_date, notes } = {}) {
    return this.request(`/api/certificates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ granted_date, expiry_date, notes }),
    });
  }

  async deleteCertificate(id) {
    return this.request(`/api/certificates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async reanalyzeCertificate(id, { qualification_name, qualification_description } = {}) {
    return this.request(`/api/certificates/${encodeURIComponent(id)}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ qualification_name, qualification_description }),
    });
  }

  async fetchCertificateBlob(id) {
    const token = this.getToken();
    const dbToken = this.getDbToken();
    const headers = {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(dbToken && { 'X-DB-Token': dbToken }),
    };
    const response = await fetch(`${this.baseURL}/api/certificates/${encodeURIComponent(id)}/download`, {
      headers,
    });
    if (!response.ok) {
      throw new Error(`Download fehlgeschlagen (HTTP ${response.status})`);
    }
    return response.blob();
  }

  // ==================== Staff ====================

  async notifyStaff(params) {
    return this.request('/api/staff/notify', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async sendScheduleNotifications(year, month) {
    return this.request('/api/staff/schedule-notifications', {
      method: 'POST',
      body: JSON.stringify({ year, month }),
    });
  }

  async sendShiftNotification(shiftData) {
    return this.request('/api/staff/shift-notification', {
      method: 'POST',
      body: JSON.stringify(shiftData),
    });
  }

  // ==================== Calendar ====================

  async syncCalendar(year, month) {
    return this.request('/api/calendar/sync', {
      method: 'POST',
      body: JSON.stringify({ year, month }),
    });
  }

  async getServiceAccountEmail() {
    return this.request('/api/calendar/service-account-email');
  }

  // ==================== Voice ====================

  async processVoiceCommand(command) {
    return this.request('/api/voice/process', {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  async transcribeAudio(audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob);

    const token = this.getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const response = await fetch(`${this.baseURL}/api/voice/transcribe`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Transcription failed');
    }

    return response.json();
  }

  // ==================== Admin ====================

  async getDatabaseStats() {
    return this.request('/api/admin/stats');
  }

  async optimizeDatabase() {
    return this.request('/api/admin/optimize', {
      method: 'POST',
    });
  }

  async getLogs(limit = 100) {
    return this.request(`/api/admin/logs?limit=${limit}`);
  }

  async renamePosition(oldName, newName) {
    return this.request('/api/admin/rename-position', {
      method: 'POST',
      body: JSON.stringify({ oldName, newName }),
    });
  }

  async adminTools(action, data = {}) {
    return this.request('/api/admin/tools', {
      method: 'POST',
      body: JSON.stringify({ action, data }),
    });
  }

  // ==================== Atomic Operations ====================

  async atomicOperation(operation, entity, params = {}) {
    return this.request('/api/atomic', {
      method: 'POST',
      body: JSON.stringify({ operation, entity, ...params }),
    });
  }

  async checkAndUpdate(entity, id, data, check) {
    return this.atomicOperation('checkAndUpdate', entity, { id, data, check });
  }

  async checkAndCreate(entity, data, check) {
    return this.atomicOperation('checkAndCreate', entity, { data, check });
  }

  async upsertStaffing(data) {
    return this.atomicOperation('upsertStaffing', 'StaffingPlanEntry', { data });
  }
}

// Singleton Instance
export const api = new APIClient();

// Entity-spezifische Wrapper für Kompatibilität
export class EntityClient {
  constructor(entityName) {
    this.entityName = entityName;
  }

  async list(options = {}) {
    return api.list(this.entityName, options);
  }

  async filter(query, options = {}) {
    return api.filter(this.entityName, query, options);
  }

  async get(id) {
    return api.get(this.entityName, id);
  }

  async create(data) {
    return api.create(this.entityName, data);
  }

  async update(id, data) {
    return api.update(this.entityName, id, data);
  }

  async delete(id) {
    return api.delete(this.entityName, id);
  }

  async bulkCreate(dataArray) {
    return api.bulkCreate(this.entityName, dataArray);
  }
}

// Database Collections - für Abwärtskompatibilität
export const db = {
  Doctor: new EntityClient('Doctor'),
  ShiftEntry: new EntityClient('ShiftEntry'),
  WishRequest: new EntityClient('WishRequest'),
  Workplace: new EntityClient('Workplace'),
  WorkplaceTimeslot: new EntityClient('WorkplaceTimeslot'),
  TimeslotTemplate: new EntityClient('TimeslotTemplate'),
  ShiftNotification: new EntityClient('ShiftNotification'),
  DemoSetting: new EntityClient('DemoSetting'),
  TrainingRotation: new EntityClient('TrainingRotation'),
  ScheduleRule: new EntityClient('ScheduleRule'),
  ColorSetting: new EntityClient('ColorSetting'),
  ScheduleNote: new EntityClient('ScheduleNote'),
  SystemSetting: new EntityClient('SystemSetting'),
  CustomHoliday: new EntityClient('CustomHoliday'),
  StaffingPlanEntry: new EntityClient('StaffingPlanEntry'),
  BackupLog: new EntityClient('BackupLog'),
  SystemLog: new EntityClient('SystemLog'),
  VoiceAlias: new EntityClient('VoiceAlias'),
  User: new EntityClient('User'),
  TeamRole: new EntityClient('TeamRole'),
  Qualification: new EntityClient('Qualification'),
  DoctorQualification: new EntityClient('DoctorQualification'),
  WorkplaceQualification: new EntityClient('WorkplaceQualification'),
  ShiftTimeRule: new EntityClient('ShiftTimeRule'),
  ScheduleBlock: new EntityClient('ScheduleBlock'),
  
  collection: (name) => new EntityClient(name)
};

// Base44-Kompatibilitätsschicht für base44.functions.invoke()
// Wird schrittweise durch direkte API-Aufrufe ersetzt
export const base44 = {
  // Entities-Kompatibilitätsschicht - mappt auf db
  entities: db,
  
  functions: {
    invoke: async (functionName, params) => {
      console.warn(`[Deprecated] base44.functions.invoke('${functionName}') - migrate to direct API calls`);
      
      // Map alte Base44-Funktionen zu neuen API-Endpunkten
      switch (functionName) {
        case 'getHolidays':
          return { data: await api.getHolidays(params.year, params.stateCode) };
        
        case 'transcribeAudio':
          return { data: { text: await api.transcribeAudio(params.audioBlob) } };
        
        case 'processVoiceAudio':
          return { data: await api.processVoiceCommand(params.text) };
        
        case 'exportScheduleToExcel':
          return { data: await api.exportScheduleToExcel(params.startDate, params.endDate, params.hiddenRows) };
        
        case 'sendShiftEmails':
        case 'sendScheduleNotifications':
          return { data: await api.sendScheduleNotifications(params.year, params.month) };
        
        case 'sendShiftNotification':
          return { data: await api.sendShiftNotification(params) };
        
        case 'syncCalendar':
          return { data: await api.syncCalendar(params.year, params.month) };
        
        case 'getServiceAccountEmail':
          return { data: await api.getServiceAccountEmail() };
        
        case 'notifyStaff':
          return { data: await api.notifyStaff(params) };
        
        case 'auth':
          // Auth-Funktionen direkt ausführen
          switch (params.action) {
            case 'login':
              return { data: await api.login(params.email, params.password) };
            case 'me':
              return { data: await api.me() };
            case 'updateMe':
              return { data: await api.updateMe(params.data) };
            case 'register':
              return { data: await api.register(params) };
            default:
              throw new Error(`Unknown auth action: ${params.action}`);
          }
        
        case 'dbProxy':
          // DB-Proxy-Funktionen
          const { action, table, ...rest } = params;
          return { data: await api.dbAction(action, table, rest) };
        
        case 'renamePosition':
          // Position umbenennen - jetzt migriert!
          return { data: await api.renamePosition(params.oldName, params.newName) };
        
        case 'atomicOperations':
          // Atomic Operations - jetzt migriert!
          return { data: await api.atomicOperation(params.operation, params.entity, params) };
        
        case 'adminTools':
          // Admin Tools - jetzt migriert!
          return { data: await api.adminTools(params.action, params) };
        
        default:
          console.error(`Unknown function: ${functionName}`);
          throw new Error(`Unknown function: ${functionName}`);
      }
    }
  },
  // Auth-Kompatibilitätsschicht für base44.auth.*
  auth: {
    updateMe: async (data) => {
      return api.updateMe(data);
    },
    me: async () => {
      return api.me();
    },
    login: async (email, password) => {
      return api.login(email, password);
    },
    logout: () => {
      return api.logout();
    }
  },
  analytics: {
    track: () => {
      // Analytics deaktiviert
      console.log('[Analytics disabled]');
    }
  },
  // Integrations-Kompatibilitätsschicht für base44.integrations.Core.*
  integrations: {
    Core: {
      SendEmail: async ({ to, subject, body, html }) => {
        return api.request('/api/staff/send-email', {
          method: 'POST',
          body: JSON.stringify({ to, subject, body, html }),
        });
      },
      UploadFile: async ({ file }) => {
        console.warn('[Integrations] UploadFile ist im Railway-Backend nicht verfügbar');
        throw new Error('UploadFile ist im Railway-Backend nicht verfügbar. ICS-Dateien werden stattdessen als E-Mail-Anhang versendet.');
      },
      InvokeLLM: async (params) => {
        console.warn('[Integrations] InvokeLLM ist im Railway-Backend nicht verfügbar');
        throw new Error('InvokeLLM ist im Railway-Backend nicht verfügbar');
      }
    }
  }
};
