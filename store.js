/**
 * ============================================
 * FlowSync — Data Store (localStorage)
 * ============================================
 * All data persistence and computed stats.
 * No backend required — everything lives in the browser.
 */

const Store = {

  /* ─── Storage Keys ─── */
  KEYS: {
    TASKS:        'fs-tasks',
    SESSIONS:     'fs-sessions',
    DISTRACTIONS: 'fs-distractions',
    THEME:        'fs-theme',
    GOAL:         'fs-daily-goal',
    SURVEY:       'fs-survey',
    SEEDED:       'fs-seeded',
  },

  /* ─── Low-level Helpers ─── */
  _get(key, fallback) {
    try {
      const val = JSON.parse(localStorage.getItem(key));
      if (val == null) return fallback;
      if (Array.isArray(fallback) && !Array.isArray(val)) return fallback;
      return val;
    } catch {
      return fallback;
    }
  },
  _set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },

  /* ═══════════════════════════════════════════
     TASKS
     ═══════════════════════════════════════════ */
  getTasks()  { return this._get(this.KEYS.TASKS, []); },
  saveTasks(t){ this._set(this.KEYS.TASKS, t); },

  addTask(data) {
    const tasks = this.getTasks();
    const task = {
      id:               Date.now().toString(36) + Math.random().toString(36).substr(2,5),
      title:            data.title || 'Untitled Task',
      description:      data.description || '',
      priority:         data.priority || 'medium',       // high | medium | low
      deadline:         data.deadline || null,            // ISO string
      estimatedMinutes: data.estimatedMinutes || null,
      category:         data.category || 'general',
      completed:        false,
      completedAt:      null,
      createdAt:        new Date().toISOString(),
    };
    tasks.unshift(task);
    this.saveTasks(tasks);
    return task;
  },

  updateTask(id, updates) {
    const tasks = this.getTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    tasks[idx] = { ...tasks[idx], ...updates };
    this.saveTasks(tasks);
    return tasks[idx];
  },

  deleteTask(id) {
    this.saveTasks(this.getTasks().filter(t => t.id !== id));
  },

  toggleTask(id) {
    const tasks = this.getTasks();
    const t = tasks.find(t => t.id === id);
    if (!t) return null;
    t.completed  = !t.completed;
    t.completedAt = t.completed ? new Date().toISOString() : null;
    this.saveTasks(tasks);
    return t;
  },

  clearCompleted() {
    this.saveTasks(this.getTasks().filter(t => !t.completed));
  },

  /* ═══════════════════════════════════════════
     POMODORO SESSIONS
     ═══════════════════════════════════════════ */
  getSessions()  { return this._get(this.KEYS.SESSIONS, []); },
  saveSessions(s){ this._set(this.KEYS.SESSIONS, s); },

  addSession(session) {
    const sessions = this.getSessions();
    session.id      = Date.now().toString(36);
    session.endTime = new Date().toISOString();
    sessions.push(session);
    this.saveSessions(sessions);
    return session;
  },

  /* ═══════════════════════════════════════════
     DISTRACTIONS
     ═══════════════════════════════════════════ */
  getDistractions()  { return this._get(this.KEYS.DISTRACTIONS, []); },

  addDistraction(note) {
    const d = this.getDistractions();
    d.push({ time: new Date().toISOString(), note: note || '' });
    this._set(this.KEYS.DISTRACTIONS, d);
    return d.length;
  },

  /* ═══════════════════════════════════════════
     DAILY GOAL (customizable target minutes)
     ═══════════════════════════════════════════ */
  getDailyGoal() {
    const val = localStorage.getItem(this.KEYS.GOAL);
    return val ? parseInt(val, 10) : 240;
  },

  setDailyGoal(minutes) {
    const m = Math.max(1, Math.min(1440, parseInt(minutes, 10) || 240));
    localStorage.setItem(this.KEYS.GOAL, m.toString());
    return m;
  },

  /* ═══════════════════════════════════════════
     CUSTOMER DISCOVERY SURVEY
     ═══════════════════════════════════════════ */
  getSurvey() {
    return this._get(this.KEYS.SURVEY, null);
  },

  saveSurvey(responses) {
    this._set(this.KEYS.SURVEY, {
      responses,
      submittedAt: new Date().toISOString(),
    });
  },

  hasSurvey() {
    return !!localStorage.getItem(this.KEYS.SURVEY);
  },

  /* ═══════════════════════════════════════════
     AI PRIORITIZATION  (rule-based scoring)
     ═══════════════════════════════════════════
     Combines:
       • Priority weight        (0–40)
       • Deadline urgency       (0–35)
       • Task age bonus         (0–15)
       • Quick-win bonus        (0–10)
     Total possible: 100
  */
  getAISortedTasks() {
    return this.getTasks()
      .filter(t => !t.completed)
      .map(t => ({ ...t, aiScore: this._aiScore(t) }))
      .sort((a, b) => b.aiScore - a.aiScore);
  },

  _aiScore(task) {
    let s = 0;

    // Priority weight
    const pw = { high: 40, medium: 25, low: 10 };
    s += pw[task.priority] || 15;

    // Deadline urgency
    if (task.deadline) {
      const hrs = (new Date(task.deadline) - new Date()) / 36e5;
      if (Number.isNaN(hrs)) s += 8; // Fallback for corrupted date
      else if (hrs <= 0)  s += 35;   // overdue
      else if (hrs <= 4)  s += 30;
      else if (hrs <= 24) s += 22;
      else if (hrs <= 72) s += 12;
      else                s += 5;
    } else {
      s += 8;
    }

    // Age bonus — older incomplete tasks get nudged up
    const ageHrs = (Date.now() - new Date(task.createdAt)) / 36e5;
    if (ageHrs > 48)      s += 15;
    else if (ageHrs > 24) s += 10;
    else if (ageHrs > 6)  s += 5;

    // Quick-win bonus — short tasks first for momentum
    if (task.estimatedMinutes) {
      if (task.estimatedMinutes <= 15) s += 10;
      else if (task.estimatedMinutes <= 30) s += 7;
      else if (task.estimatedMinutes <= 60) s += 3;
    }

    return Math.min(s, 100);
  },

  /* ═══════════════════════════════════════════
     DEADLINE REMINDERS
     ═══════════════════════════════════════════ */
  REMINDER_WINDOW_MS: 30 * 60 * 1000,

  getTaskReminderMeta(task, now = Date.now()) {
    if (!task || task.completed || !task.deadline) return null;

    const deadlineMs = new Date(task.deadline).getTime();
    if (Number.isNaN(deadlineMs)) return null;

    const msUntilDeadline = deadlineMs - now;
    if (msUntilDeadline > this.REMINDER_WINDOW_MS) return null;

    return {
      ...task,
      deadlineMs,
      msUntilDeadline,
      minutesUntilDeadline: msUntilDeadline > 0 ? Math.ceil(msUntilDeadline / 6e4) : 0,
      isOverdue: msUntilDeadline < 0,
      isDueSoon: msUntilDeadline >= 0,
    };
  },

  getTasksNeedingReminders(now = Date.now()) {
    return this.getTasks()
      .map(task => this.getTaskReminderMeta(task, now))
      .filter(Boolean)
      .sort((a, b) => a.msUntilDeadline - b.msUntilDeadline);
  },

  getReminderMessage(taskOrMeta) {
    const reminder = taskOrMeta?.msUntilDeadline !== undefined
      ? taskOrMeta
      : this.getTaskReminderMeta(taskOrMeta);

    if (!reminder) return null;
    if (reminder.isOverdue) return `OVERDUE: ${reminder.title}`;
    if (reminder.msUntilDeadline < 6e4) return `⏰ Reminder: "${reminder.title}" is due very soon.`;

    const mins = reminder.minutesUntilDeadline;
    return `⏰ Reminder: "${reminder.title}" is due in ${mins} minute${mins === 1 ? '' : 's'}.`;
  },

  createReminderController({
    toast,
    notify,
    onTick,
    intervalMs = 30000,
    spacingMs = 2000,
  } = {}) {
    const shownReminders = new Set();
    const queuedReminders = new Set();
    const queue = [];
    let intervalId = null;
    let queueTimerId = null;

    const processQueue = (delay = 0) => {
      if (queueTimerId || queue.length === 0) return;

      queueTimerId = window.setTimeout(() => {
        queueTimerId = null;

        const queuedTask = queue.shift();
        if (!queuedTask) return;

        queuedReminders.delete(queuedTask.id);

        const latestTask = Store.getTasks().find(task => task.id === queuedTask.id);
        const reminder = Store.getTaskReminderMeta(latestTask);
        if (!reminder || shownReminders.has(reminder.id)) {
          if (queue.length > 0) processQueue(spacingMs);
          return;
        }

        const message = Store.getReminderMessage(reminder);
        shownReminders.add(reminder.id);

        if (typeof toast === 'function' && message) toast(message);
        if (typeof notify === 'function' && message) notify(message, reminder);

        if (queue.length > 0) processQueue(spacingMs);
      }, delay);
    };

    const checkNow = () => {
      const reminders = Store.getTasksNeedingReminders();

      reminders.forEach(reminder => {
        if (shownReminders.has(reminder.id) || queuedReminders.has(reminder.id)) return;
        queuedReminders.add(reminder.id);
        queue.push(reminder);
      });

      processQueue(0);

      if (typeof onTick === 'function') onTick(reminders);
      return reminders;
    };

    return {
      start() {
        if (intervalId) return this;
        checkNow();
        intervalId = window.setInterval(checkNow, intervalMs);
        return this;
      },

      stop() {
        if (intervalId) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
        if (queueTimerId) {
          window.clearTimeout(queueTimerId);
          queueTimerId = null;
        }
        queue.length = 0;
        queuedReminders.clear();
      },

      checkNow,
    };
  },

  /* ═══════════════════════════════════════════
     LOCAL DATE HELPERS
     ═══════════════════════════════════════════ */
  _localDateKey(dateInput = new Date()) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return null;

    const year  = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day   = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  _matchesLocalDate(isoString, dateStr) {
    if (!isoString || !dateStr) return false;
    return this._localDateKey(isoString) === dateStr;
  },

  /* ═══════════════════════════════════════════
     COMPUTED STATS
     ═══════════════════════════════════════════ */

  /** Stats for a specific date (ISO date string YYYY-MM-DD) */
  _statsForDate(dateStr) {
    const allSessions  = this.getSessions().filter(s => s.endTime && this._matchesLocalDate(s.endTime, dateStr));
    const tasks        = this.getTasks().filter(t => t.completed && t.completedAt && this._matchesLocalDate(t.completedAt, dateStr));
    const focusSessions = allSessions.filter(s => s.type === 'focus');
    const breakSessions = allSessions.filter(s => s.type === 'break' || s.type === 'longBreak');
    const distractions  = this.getDistractions().filter(d => this._matchesLocalDate(d.time, dateStr));
    const focusMin      = focusSessions.reduce((sum, s) => sum + (s.duration || 25), 0);

    return {
      tasksCompleted: tasks.length,
      focusMinutes:   focusMin,
      sessions:       focusSessions.length,
      breaksTaken:    breakSessions.length,
      distractions:   distractions.length,
    };
  },

  /** Today's full stats */
  getTodayStats() {
    const today = this._localDateKey();
    const raw   = this._statsForDate(today);
    const allTasks = this.getTasks();

    return {
      ...raw,
      totalTasks:       allTasks.filter(t => !t.completed).length,
      focusHours:       (raw.focusMinutes / 60).toFixed(1),
      productivityScore: this._prodScore(raw.tasksCompleted, raw.focusMinutes, raw.distractions),
      balanceScore:      this._balanceScore(raw.focusMinutes, raw.sessions, raw.distractions),
    };
  },

  /** Last 7 days stats array (oldest → newest) */
  getWeeklyStats() {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = this._localDateKey(d);
      const raw = this._statsForDate(ds);
      out.push({
        date: ds,
        day:  d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayFull: d.toLocaleDateString('en-US', { weekday: 'long' }),
        isToday: i === 0,
        ...raw,
        productivityScore: this._prodScore(raw.tasksCompleted, raw.focusMinutes, raw.distractions),
      });
    }
    return out;
  },

  _prodScore(tasks, focusMin, distractions) {
    let s = 0;
    s += Math.min(tasks * 10, 50);      // Up to 50 points from tasks
    s += Math.min(focusMin / 3, 50);    // Up to 50 points from focus time
    s -= (distractions * 5);            // Penalty: -5 points per distraction
    return Math.max(0, Math.min(Math.round(s), 100));
  },

  _balanceScore(focusMin, sessionCount, distractions) {
    let s = 70; // Base score
    if (focusMin >= 120 && focusMin <= 300) s += 15;
    else if (focusMin > 300)               s -= 15;   // Overtime penalty increased
    else if (focusMin > 60)                s += 5;

    if (sessionCount > 0 && sessionCount <= 8) s += 15;
    else if (sessionCount > 10)                s -= 15;

    // Distraction penalty
    s -= (distractions * 5); // Penalty: -5 points per distraction

    return Math.max(0, Math.min(100, s));
  },

  /** Days with at least one focus session (consecutive from today back) */
  getStreak() {
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = this._localDateKey(d);
      const has = this.getSessions().some(s => s.endTime && this._matchesLocalDate(s.endTime, ds) && s.type === 'focus');
      if (has) streak++;
      else break;
    }
    return streak;
  },

  /* ═══════════════════════════════════════════
     THEME
     ═══════════════════════════════════════════ */
  getTheme() { return localStorage.getItem(this.KEYS.THEME) || 'light'; },
  setTheme(t){ localStorage.setItem(this.KEYS.THEME, t); },

  /* ═══════════════════════════════════════════
     DEMO DATA SEEDER
     ═══════════════════════════════════════════
     Populates realistic data on first load so
     dashboard / reports look populated.
  */
  seedIfEmpty(force = false) {
    if (!force && localStorage.getItem(this.KEYS.SEEDED) === 'true') return;
    if (this.getTasks().length > 0) return;

    const now = Date.now();
    const h   = 36e5; // 1 hour in ms

    const tasks = [
      { id:'d1', title:'Complete Q3 Strategy Deck',       description:'Final review and submit to leadership',         priority:'high',   deadline: new Date(now + 3*h).toISOString(),  estimatedMinutes:60,  category:'work',    completed:false, completedAt:null, createdAt: new Date(now - 24*h).toISOString() },
      { id:'d2', title:'Design Sprint with Product Team', description:'Prepare wireframes before the sprint',          priority:'high',   deadline: new Date(now + 5*h).toISOString(),  estimatedMinutes:45,  category:'work',    completed:false, completedAt:null, createdAt: new Date(now - 12*h).toISOString() },
      { id:'d3', title:'Review Pull Requests',            description:'3 pending PRs on the backend repo',             priority:'medium', deadline: new Date(now + 48*h).toISOString(), estimatedMinutes:30,  category:'dev',     completed:false, completedAt:null, createdAt: new Date(now - 6*h).toISOString()  },
      { id:'d4', title:'Send weekly update to manager',   description:'Compile this week\'s metrics and highlights',    priority:'medium', deadline: new Date(now + 24*h).toISOString(), estimatedMinutes:20,  category:'work',    completed:false, completedAt:null, createdAt: new Date(now - 4*h).toISOString()  },
      { id:'d5', title:'Update API documentation',        description:'Add docs for new auth endpoints',               priority:'medium', deadline: new Date(now + 72*h).toISOString(), estimatedMinutes:90,  category:'dev',     completed:false, completedAt:null, createdAt: new Date(now - 50*h).toISOString() },
    ];

    // Seed completed tasks for the past 7 days
    for (let i = 0; i < 7; i++) {
      const day = new Date(); day.setDate(day.getDate() - i);
      const count = Math.floor(Math.random() * 3) + 1; // 1-3 tasks per day
      for (let j = 0; j < count; j++) {
        tasks.push({
          id: `dt${i}${j}`,
          title: ['Review logs', 'Email follow-up', 'Bug fix #12', 'Update readme', 'Check analytics'][Math.floor(Math.random() * 5)],
          priority: ['high', 'medium', 'low'][Math.floor(Math.random() * 3)],
          completed: true,
          completedAt: new Date(day.getTime() - Math.random() * 8*h).toISOString(),
          createdAt: new Date(day.getTime() - 24*h).toISOString(),
        });
      }
    }
    this.saveTasks(tasks);

    // Seed Pomodoro sessions for the past 7 days
    const sessions = [];
    for (let i = 6; i >= 0; i--) {
      const day   = new Date(); day.setDate(day.getDate() - i);
      const count = Math.floor(Math.random() * 4) + 2;  // 2–5 focus sessions/day
      for (let j = 0; j < count; j++) {
        const tFocus = new Date(day);
        tFocus.setHours(9 + j * 2, Math.floor(Math.random() * 30), 0);
        sessions.push({ id:`sf${i}${j}`, type:'focus', duration:25, endTime: tFocus.toISOString(), taskId:null });
        
        // Add a break after each focus session
        const tBreak = new Date(tFocus);
        tBreak.setMinutes(tBreak.getMinutes() + 30);
        sessions.push({ id:`sb${i}${j}`, type:'break', duration:5, endTime: tBreak.toISOString() });
      }
      // Add one long break at the end of the day
      const tLong = new Date(day);
      tLong.setHours(17, 0, 0);
      sessions.push({ id:`sl${i}`, type:'longBreak', duration:15, endTime: tLong.toISOString() });
    }
    this.saveSessions(sessions);

    // Seed a few distractions for today
    const distractions = [];
    for (let i = 0; i < 3; i++) {
      const t = new Date(); t.setHours(10 + i * 2, 15, 0);
      distractions.push({ time: t.toISOString(), note: '' });
    }
    this._set(this.KEYS.DISTRACTIONS, distractions);
    localStorage.setItem(this.KEYS.SEEDED, 'true');
  },

  /** Nuke everything except theme */
  clearAll() {
    Object.values(this.KEYS).forEach(k => {
      if (k !== this.KEYS.THEME) localStorage.removeItem(k);
    });
    // Also clear any ancillary keys
    localStorage.removeItem('fs-task-filter');
    localStorage.removeItem('fs-task-sort');
    localStorage.removeItem('fs-timer-state');
    localStorage.setItem(this.KEYS.SEEDED, 'true');
  },
};

// Auto-seed on first load
Store.seedIfEmpty();

// Multi-Tab Sync: Auto-reload if data changes in another tab
window.addEventListener('storage', (e) => {
  // If data changed (but not theme), reload to stay in sync
  if (e.key && e.key.startsWith('fs-') && e.key !== Store.KEYS.THEME) {
    window.location.reload();
  }
});
