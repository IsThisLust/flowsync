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
  },

  /* ─── Low-level Helpers ─── */
  _get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
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
      if (hrs <= 0)       s += 35;   // overdue
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
     COMPUTED STATS
     ═══════════════════════════════════════════ */

  /** Stats for a specific date (ISO date string YYYY-MM-DD) */
  _statsForDate(dateStr) {
    const tasks        = this.getTasks().filter(t => t.completed && t.completedAt && t.completedAt.startsWith(dateStr));
    const sessions     = this.getSessions().filter(s => s.endTime && s.endTime.startsWith(dateStr) && s.type === 'focus');
    const distractions = this.getDistractions().filter(d => d.time.startsWith(dateStr));
    const focusMin     = sessions.reduce((sum, s) => sum + (s.duration || 25), 0);

    return {
      tasksCompleted: tasks.length,
      focusMinutes:   focusMin,
      sessions:       sessions.length,
      distractions:   distractions.length,
    };
  },

  /** Today's full stats */
  getTodayStats() {
    const today = new Date().toISOString().split('T')[0];
    const raw   = this._statsForDate(today);
    const allTasks = this.getTasks();

    return {
      ...raw,
      totalTasks:       allTasks.filter(t => !t.completed).length,
      focusHours:       (raw.focusMinutes / 60).toFixed(1),
      productivityScore: this._prodScore(raw.tasksCompleted, raw.focusMinutes, raw.distractions),
      balanceScore:      this._balanceScore(raw.focusMinutes, raw.sessions),
    };
  },

  /** Last 7 days stats array (oldest → newest) */
  getWeeklyStats() {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
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
    s += Math.min(tasks * 10, 40);
    s += Math.min(focusMin / 3, 40);
    s += Math.max(0, 20 - distractions * 4);
    return Math.min(Math.round(s), 100);
  },

  _balanceScore(focusMin, sessionCount) {
    let s = 70;
    if (focusMin >= 120 && focusMin <= 300) s += 15;
    else if (focusMin > 300)               s -= 10;   // Overtime penalty
    else if (focusMin > 60)                s += 5;

    if (sessionCount > 0 && sessionCount <= 8) s += 10;
    else if (sessionCount > 10)                s -= 10;

    // Distraction penalty
    const today = new Date().toISOString().split('T')[0];
    const distractions = this.getDistractions().filter(d => d.time.startsWith(today)).length;
    s -= distractions * 2;

    return Math.max(0, Math.min(100, s));
  },

  /** Days with at least one focus session (consecutive from today back) */
  getStreak() {
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const has = this.getSessions().some(s => s.endTime && s.endTime.startsWith(ds) && s.type === 'focus');
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
  seedIfEmpty() {
    if (this.getTasks().length > 0) return;

    const now = Date.now();
    const h   = 36e5; // 1 hour in ms

    const tasks = [
      { id:'d1', title:'Complete Q3 Strategy Deck',       description:'Final review and submit to leadership',         priority:'high',   deadline: new Date(now + 3*h).toISOString(),  estimatedMinutes:60,  category:'work',    completed:false, completedAt:null, createdAt: new Date(now - 24*h).toISOString() },
      { id:'d2', title:'Design Sprint with Product Team', description:'Prepare wireframes before the sprint',          priority:'high',   deadline: new Date(now + 5*h).toISOString(),  estimatedMinutes:45,  category:'work',    completed:false, completedAt:null, createdAt: new Date(now - 12*h).toISOString() },
      { id:'d3', title:'Review Pull Requests',            description:'3 pending PRs on the backend repo',             priority:'medium', deadline: new Date(now + 48*h).toISOString(), estimatedMinutes:30,  category:'dev',     completed:false, completedAt:null, createdAt: new Date(now - 6*h).toISOString()  },
      { id:'d4', title:'Send weekly update to manager',   description:'Compile this week\'s metrics and highlights',    priority:'medium', deadline: new Date(now + 24*h).toISOString(), estimatedMinutes:20,  category:'work',    completed:false, completedAt:null, createdAt: new Date(now - 4*h).toISOString()  },
      { id:'d5', title:'Update API documentation',        description:'Add docs for new auth endpoints',               priority:'medium', deadline: new Date(now + 72*h).toISOString(), estimatedMinutes:90,  category:'dev',     completed:false, completedAt:null, createdAt: new Date(now - 50*h).toISOString() },
      { id:'d6', title:'Team standup notes',              description:'Document action items from daily standup',       priority:'low',    deadline:null,                                 estimatedMinutes:15,  category:'work',    completed:true,  completedAt: new Date(now - 2*h).toISOString(),  createdAt: new Date(now - 8*h).toISOString()  },
      { id:'d7', title:'Read industry newsletter',        description:'Catch up on this week\'s tech news',            priority:'low',    deadline:null,                                 estimatedMinutes:20,  category:'personal',completed:true,  completedAt: new Date(now - 5*h).toISOString(),  createdAt: new Date(now - 26*h).toISOString() },
    ];
    this.saveTasks(tasks);

    // Seed Pomodoro sessions for the past 7 days
    const sessions = [];
    for (let i = 6; i >= 0; i--) {
      const day   = new Date(); day.setDate(day.getDate() - i);
      const count = Math.floor(Math.random() * 5) + 2;  // 2–6 sessions/day
      for (let j = 0; j < count; j++) {
        const t = new Date(day);
        t.setHours(9 + j * 1, Math.floor(Math.random() * 50), 0);
        sessions.push({ id:`s${i}${j}`, type:'focus', duration:25, endTime: t.toISOString(), taskId:null });
      }
    }
    this.saveSessions(sessions);

    // Seed a few distractions for today
    const distractions = [];
    for (let i = 0; i < 3; i++) {
      const t = new Date(); t.setHours(10 + i * 2, 15, 0);
      distractions.push({ time: t.toISOString(), note: '' });
    }
    this._set(this.KEYS.DISTRACTIONS, distractions);
  },

  /** Nuke everything (settings / dev) */
  clearAll() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
  },
};

// Auto-seed on first load
Store.seedIfEmpty();
