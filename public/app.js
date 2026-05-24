const state = {
  token: localStorage.getItem("ttm_token"),
  user: JSON.parse(localStorage.getItem("ttm_user") || "null"),
  projects: [],
  tasks: [],
  users: [],
  dashboard: null,
  view: "dashboard"
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.remove("hidden");
  setTimeout(() => node.classList.add("hidden"), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function saveSession({ token, user }) {
  state.token = token;
  state.user = user;
  localStorage.setItem("ttm_token", token);
  localStorage.setItem("ttm_user", JSON.stringify(user));
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("ttm_token");
  localStorage.removeItem("ttm_user");
}

function setAuthenticated(isAuthed) {
  $("#authView").classList.toggle("hidden", isAuthed);
  $("#appView").classList.toggle("hidden", !isAuthed);
  $(".sidebar").classList.toggle("hidden", !isAuthed);
}

function statusClass(status) {
  return status === "Done" ? "done" : status === "In Progress" ? "progress" : "todo";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function projectOptions(selected = "") {
  return state.projects.map(project => `<option value="${project.id}" ${project.id === selected ? "selected" : ""}>${escapeHtml(project.name)}</option>`).join("");
}

function memberOptions(projectId, selected = "") {
  const project = state.projects.find(item => item.id === projectId) || state.projects[0];
  return (project?.members || []).map(member => `<option value="${member.id}" ${member.id === selected ? "selected" : ""}>${escapeHtml(member.name)}</option>`).join("");
}

function adminProjects() {
  return state.projects.filter(project => project.adminId === state.user.id);
}

function renderAccount() {
  $("#accountPanel").innerHTML = state.user ? `
    <div>
      <strong>${escapeHtml(state.user.name)}</strong>
      <small>${escapeHtml(state.user.email)}</small>
    </div>
    <button class="secondary" id="logoutButton">Logout</button>
  ` : "";
  $("#logoutButton")?.addEventListener("click", () => {
    clearSession();
    setAuthenticated(false);
  });
}

function renderDashboard() {
  const dashboard = state.dashboard || { totalTasks: 0, byStatus: {}, tasksPerUser: [], overdueTasks: [] };
  $("#dashboardView").innerHTML = `
    <div class="grid metrics">
      <article class="card metric"><span>Total tasks</span><strong>${dashboard.totalTasks}</strong></article>
      <article class="card metric"><span>To Do</span><strong>${dashboard.byStatus["To Do"] || 0}</strong></article>
      <article class="card metric"><span>In Progress</span><strong>${dashboard.byStatus["In Progress"] || 0}</strong></article>
      <article class="card metric"><span>Done</span><strong>${dashboard.byStatus.Done || 0}</strong></article>
    </div>
    <div class="grid layout" style="margin-top:16px">
      <article class="card">
        <h2>Tasks per user</h2>
        <div class="list">
          ${dashboard.tasksPerUser.length ? dashboard.tasksPerUser.map(row => `
            <div class="row"><span>${escapeHtml(row.user.name)}</span><strong>${row.count}</strong></div>
          `).join("") : `<p class="empty">No assigned tasks yet.</p>`}
        </div>
      </article>
      <article class="card">
        <h2>Overdue tasks</h2>
        <div class="list">
          ${dashboard.overdueTasks.length ? dashboard.overdueTasks.map(renderTaskRow).join("") : `<p class="empty">Nothing overdue. Nice.</p>`}
        </div>
      </article>
    </div>
  `;
}

function renderProjects() {
  $("#projectsView").innerHTML = `
    <div class="grid layout">
      <article class="card">
        <h2>Create project</h2>
        <form id="projectForm" class="stack">
          <label>Project name <input name="name" required /></label>
          <label>Description <textarea name="description"></textarea></label>
          <button type="submit">Create project</button>
        </form>
      </article>
      <article class="card">
        <h2>Your projects</h2>
        <div class="list">
          ${state.projects.length ? state.projects.map(project => `
            <section class="row">
              <div>
                <strong>${escapeHtml(project.name)}</strong>
                <div class="meta">${escapeHtml(project.description || "No description")} · ${project.members.length} member(s)</div>
                <div class="meta">Admin: ${escapeHtml(project.admin.name)}</div>
                <div class="meta">${project.members.map(member => `
                  <span class="badge">
                    ${escapeHtml(member.name)}
                    ${project.adminId === state.user.id && member.id !== project.adminId ? `<button class="inline-remove remove-member" data-project="${project.id}" data-user="${member.id}" title="Remove member">×</button>` : ""}
                  </span>
                `).join(" ")}</div>
              </div>
              ${project.adminId === state.user.id ? `
                <form class="row-actions add-member-form" data-project="${project.id}">
                  <input type="email" name="email" placeholder="member@email.com" required />
                  <button type="submit">Add</button>
                </form>
              ` : `<span class="badge">Member</span>`}
            </section>
          `).join("") : `<p class="empty">Create your first project to begin.</p>`}
        </div>
      </article>
    </div>
  `;

  $("#projectForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), description: form.get("description") })
    });
    toast("Project created");
    await loadData();
  });

  $$(".add-member-form").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const data = new FormData(form);
      await api(`/api/projects/${form.dataset.project}/members`, {
        method: "POST",
        body: JSON.stringify({ email: data.get("email") })
      });
      toast("Member added");
      await loadData();
    });
  });

  $$(".remove-member").forEach(button => {
    button.addEventListener("click", async () => {
      await api(`/api/projects/${button.dataset.project}/members/${button.dataset.user}`, {
        method: "DELETE",
        body: "{}"
      });
      toast("Member removed");
      await loadData();
    });
  });
}

function renderTaskRow(task) {
  return `
    <div class="row">
      <div>
        <div class="task-title">
          <strong>${escapeHtml(task.title)}</strong>
          <span class="badge ${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span>
          <span class="badge ${statusClass(task.status)}">${escapeHtml(task.status)}</span>
        </div>
        <div class="meta">${escapeHtml(task.description || "No description")}</div>
        <div class="meta">Due ${escapeHtml(task.dueDate)} · Assigned to ${escapeHtml(task.assignee?.name || "Unknown")}</div>
      </div>
      <div class="row-actions">
        <select class="status-select" data-task="${task.id}">
          ${["To Do", "In Progress", "Done"].map(status => `<option ${status === task.status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        ${state.projects.find(project => project.id === task.projectId)?.adminId === state.user.id ? `<button class="danger delete-task" data-task="${task.id}">Delete</button>` : ""}
      </div>
    </div>
  `;
}

function renderTasks() {
  const manageableProjects = adminProjects();
  const firstProject = manageableProjects[0];
  $("#tasksView").innerHTML = `
    <div class="grid layout">
      <article class="card">
        <h2>Create task</h2>
        ${firstProject ? `
          <form id="taskForm" class="stack">
            <label>Project <select name="projectId" id="taskProject">${manageableProjects.map(project => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("")}</select></label>
            <label>Title <input name="title" required /></label>
            <label>Description <textarea name="description"></textarea></label>
            <label>Due date <input type="date" name="dueDate" required /></label>
            <label>Priority
              <select name="priority">
                <option>Medium</option><option>High</option><option>Low</option>
              </select>
            </label>
            <label>Assignee <select name="assigneeId" id="taskAssignee">${memberOptions(firstProject.id)}</select></label>
            <button type="submit">Create task</button>
          </form>
        ` : `<p class="empty">Only project admins can create tasks.</p>`}
      </article>
      <article class="card">
        <h2>Tasks</h2>
        <div class="list">
          ${state.tasks.length ? state.tasks.map(renderTaskRow).join("") : `<p class="empty">No visible tasks yet.</p>`}
        </div>
      </article>
    </div>
  `;

  $("#taskProject")?.addEventListener("change", event => {
    $("#taskAssignee").innerHTML = memberOptions(event.target.value);
  });

  $("#taskForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    toast("Task created");
    await loadData();
  });

  $$(".status-select").forEach(select => {
    select.addEventListener("change", async event => {
      await api(`/api/tasks/${select.dataset.task}`, {
        method: "PATCH",
        body: JSON.stringify({ status: event.target.value })
      });
      toast("Status updated");
      await loadData();
    });
  });

  $$(".delete-task").forEach(button => {
    button.addEventListener("click", async () => {
      await api(`/api/tasks/${button.dataset.task}`, { method: "DELETE", body: "{}" });
      toast("Task deleted");
      await loadData();
    });
  });
}

function setView(view) {
  state.view = view;
  $$(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach(node => node.classList.add("hidden"));
  $(`#${view}View`).classList.remove("hidden");
  const titles = {
    dashboard: ["Dashboard", "A current view of your projects and assigned work."],
    projects: ["Projects", "Create projects and manage team membership."],
    tasks: ["Tasks", "Create, assign, and move tasks through delivery."]
  };
  $("#viewTitle").textContent = titles[view][0];
  $("#viewSubtitle").textContent = titles[view][1];
}

async function loadData() {
  if (!state.token) return;
  const [projects, tasks, users, dashboard] = await Promise.all([
    api("/api/projects"),
    api("/api/tasks"),
    api("/api/users"),
    api("/api/dashboard")
  ]);
  state.projects = projects.projects;
  state.tasks = tasks.tasks;
  state.users = users.users;
  state.dashboard = dashboard.dashboard;
  renderAccount();
  renderDashboard();
  renderProjects();
  renderTasks();
  setView(state.view);
}

function wireEvents() {
  $$(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach(item => item.classList.remove("active"));
      tab.classList.add("active");
      $("#loginForm").classList.toggle("hidden", tab.dataset.authTab !== "login");
      $("#signupForm").classList.toggle("hidden", tab.dataset.authTab !== "signup");
    });
  });

  $("#loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      saveSession(await api("/api/auth/login", { method: "POST", body: JSON.stringify(data) }));
      setAuthenticated(true);
      await loadData();
      toast("Logged in");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#signupForm").addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      saveSession(await api("/api/auth/signup", { method: "POST", body: JSON.stringify(data) }));
      setAuthenticated(true);
      await loadData();
      toast("Account created");
    } catch (error) {
      toast(error.message);
    }
  });

  $$(".nav-button").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
  $("#refreshButton").addEventListener("click", loadData);
}

wireEvents();
setAuthenticated(Boolean(state.token));
if (state.token) {
  loadData().catch(error => {
    clearSession();
    setAuthenticated(false);
    toast(error.message);
  });
}
