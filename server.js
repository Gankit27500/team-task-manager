const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data", "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const STATUS = ["To Do", "In Progress", "Done"];
const PRIORITY = ["Low", "Medium", "High"];

function ensureDb() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    writeDb({ users: [], projects: [], tasks: [] });
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  return hashPassword(password, salt).split(":")[1] === hash;
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

function signToken(user) {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({
    sub: user.id,
    name: user.name,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
  });
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function parseToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (data.exp < Math.floor(Date.now() / 1000)) return null;
  return data;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  send(res, status, { error: message });
}

function sanitizeUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function auth(req, db) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = parseToken(token);
  if (!payload) return null;
  const user = db.users.find(item => item.id === payload.sub);
  return user || null;
}

function projectRole(project, userId) {
  if (!project) return null;
  if (project.adminId === userId) return "Admin";
  return project.memberIds.includes(userId) ? "Member" : null;
}

function requireFields(body, fields) {
  const missing = fields.filter(field => typeof body[field] !== "string" || !body[field].trim());
  return missing.length ? `${missing.join(", ")} required` : null;
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function userCanSeeTask(task, user, project) {
  return projectRole(project, user.id) === "Admin" || task.assigneeId === user.id;
}

function enrichProject(project, db) {
  const members = project.memberIds.map(userId => db.users.find(user => user.id === userId)).filter(Boolean).map(sanitizeUser);
  const admin = sanitizeUser(db.users.find(user => user.id === project.adminId));
  return { ...project, admin, members };
}

function enrichTask(task, db) {
  const assignee = db.users.find(user => user.id === task.assigneeId);
  return { ...task, assignee: assignee ? sanitizeUser(assignee) : null };
}

function dashboardFor(user, db) {
  const projects = db.projects.filter(project => projectRole(project, user.id));
  const projectIds = new Set(projects.map(project => project.id));
  const visibleTasks = db.tasks.filter(task => {
    const project = db.projects.find(item => item.id === task.projectId);
    return projectIds.has(task.projectId) && userCanSeeTask(task, user, project);
  });
  const byStatus = STATUS.reduce((acc, status) => ({ ...acc, [status]: visibleTasks.filter(task => task.status === status).length }), {});
  const tasksPerUser = db.users.map(item => ({
    user: sanitizeUser(item),
    count: visibleTasks.filter(task => task.assigneeId === item.id).length
  })).filter(row => row.count > 0);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = visibleTasks.filter(task => task.dueDate < today && task.status !== "Done");
  return {
    totalTasks: visibleTasks.length,
    byStatus,
    tasksPerUser,
    overdueTasks: overdue.map(task => enrichTask(task, db))
  };
}

async function handleApi(req, res, pathname) {
  const db = readDb();
  const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : {};
  const currentUser = auth(req, db);

  if (pathname === "/api/auth/signup" && req.method === "POST") {
    const missing = requireFields(body, ["name", "email", "password"]);
    if (missing) return sendError(res, 400, missing);
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, "Valid email required");
    if (body.password.length < 6) return sendError(res, 400, "Password must be at least 6 characters");
    if (db.users.some(user => user.email === email)) return sendError(res, 409, "Email already registered");
    const user = {
      id: id("usr"),
      name: body.name.trim(),
      email,
      passwordHash: hashPassword(body.password),
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    writeDb(db);
    return send(res, 201, { user: sanitizeUser(user), token: signToken(user) });
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    const missing = requireFields(body, ["email", "password"]);
    if (missing) return sendError(res, 400, missing);
    const user = db.users.find(item => item.email === body.email.trim().toLowerCase());
    if (!user || !verifyPassword(body.password, user.passwordHash)) return sendError(res, 401, "Invalid email or password");
    return send(res, 200, { user: sanitizeUser(user), token: signToken(user) });
  }

  if (!currentUser) return sendError(res, 401, "Authentication required");

  if (pathname === "/api/me" && req.method === "GET") {
    return send(res, 200, { user: sanitizeUser(currentUser) });
  }

  if (pathname === "/api/users" && req.method === "GET") {
    return send(res, 200, { users: db.users.map(sanitizeUser) });
  }

  if (pathname === "/api/projects" && req.method === "GET") {
    const projects = db.projects.filter(project => projectRole(project, currentUser.id)).map(project => enrichProject(project, db));
    return send(res, 200, { projects });
  }

  if (pathname === "/api/projects" && req.method === "POST") {
    const missing = requireFields(body, ["name"]);
    if (missing) return sendError(res, 400, missing);
    const project = {
      id: id("prj"),
      name: body.name.trim(),
      description: typeof body.description === "string" ? body.description.trim() : "",
      adminId: currentUser.id,
      memberIds: [currentUser.id],
      createdAt: new Date().toISOString()
    };
    db.projects.push(project);
    writeDb(db);
    return send(res, 201, { project: enrichProject(project, db) });
  }

  const projectMemberMatch = pathname.match(/^\/api\/projects\/([^/]+)\/members$/);
  if (projectMemberMatch && req.method === "POST") {
    const project = db.projects.find(item => item.id === projectMemberMatch[1]);
    if (!project) return sendError(res, 404, "Project not found");
    if (project.adminId !== currentUser.id) return sendError(res, 403, "Only admins can add members");
    const user = db.users.find(item => item.email === String(body.email || "").trim().toLowerCase());
    if (!user) return sendError(res, 404, "User not found");
    if (!project.memberIds.includes(user.id)) project.memberIds.push(user.id);
    writeDb(db);
    return send(res, 200, { project: enrichProject(project, db) });
  }

  const removeMemberMatch = pathname.match(/^\/api\/projects\/([^/]+)\/members\/([^/]+)$/);
  if (removeMemberMatch && req.method === "DELETE") {
    const project = db.projects.find(item => item.id === removeMemberMatch[1]);
    if (!project) return sendError(res, 404, "Project not found");
    if (project.adminId !== currentUser.id) return sendError(res, 403, "Only admins can remove members");
    if (removeMemberMatch[2] === project.adminId) return sendError(res, 400, "Project admin cannot be removed");
    project.memberIds = project.memberIds.filter(userId => userId !== removeMemberMatch[2]);
    db.tasks = db.tasks.filter(task => task.projectId !== project.id || task.assigneeId !== removeMemberMatch[2]);
    writeDb(db);
    return send(res, 200, { project: enrichProject(project, db) });
  }

  if (pathname === "/api/tasks" && req.method === "GET") {
    const projectId = body.projectId;
    const tasks = db.tasks.filter(task => {
      const project = db.projects.find(item => item.id === task.projectId);
      if (!project || !projectRole(project, currentUser.id)) return false;
      if (projectId && task.projectId !== projectId) return false;
      return userCanSeeTask(task, currentUser, project);
    }).map(task => enrichTask(task, db));
    return send(res, 200, { tasks });
  }

  if (pathname === "/api/tasks" && req.method === "POST") {
    const missing = requireFields(body, ["projectId", "title", "dueDate", "priority", "assigneeId"]);
    if (missing) return sendError(res, 400, missing);
    const project = db.projects.find(item => item.id === body.projectId);
    if (!project) return sendError(res, 404, "Project not found");
    if (project.adminId !== currentUser.id) return sendError(res, 403, "Only admins can create tasks");
    if (!project.memberIds.includes(body.assigneeId)) return sendError(res, 400, "Assignee must be a project member");
    if (!isValidDate(body.dueDate)) return sendError(res, 400, "Valid due date required");
    if (!PRIORITY.includes(body.priority)) return sendError(res, 400, "Invalid priority");
    const task = {
      id: id("tsk"),
      projectId: body.projectId,
      title: body.title.trim(),
      description: typeof body.description === "string" ? body.description.trim() : "",
      dueDate: body.dueDate,
      priority: body.priority,
      status: STATUS.includes(body.status) ? body.status : "To Do",
      assigneeId: body.assigneeId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.tasks.push(task);
    writeDb(db);
    return send(res, 201, { task: enrichTask(task, db) });
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && req.method === "PATCH") {
    const task = db.tasks.find(item => item.id === taskMatch[1]);
    if (!task) return sendError(res, 404, "Task not found");
    const project = db.projects.find(item => item.id === task.projectId);
    const role = projectRole(project, currentUser.id);
    if (!role) return sendError(res, 403, "No access to this task");
    if (role !== "Admin" && task.assigneeId !== currentUser.id) return sendError(res, 403, "Members can update assigned tasks only");

    if (body.status !== undefined) {
      if (!STATUS.includes(body.status)) return sendError(res, 400, "Invalid status");
      task.status = body.status;
    }
    if (role === "Admin") {
      if (body.title !== undefined) task.title = String(body.title).trim();
      if (body.description !== undefined) task.description = String(body.description).trim();
      if (body.dueDate !== undefined) {
        if (!isValidDate(body.dueDate)) return sendError(res, 400, "Valid due date required");
        task.dueDate = body.dueDate;
      }
      if (body.priority !== undefined) {
        if (!PRIORITY.includes(body.priority)) return sendError(res, 400, "Invalid priority");
        task.priority = body.priority;
      }
      if (body.assigneeId !== undefined) {
        if (!project.memberIds.includes(body.assigneeId)) return sendError(res, 400, "Assignee must be a project member");
        task.assigneeId = body.assigneeId;
      }
    }
    task.updatedAt = new Date().toISOString();
    writeDb(db);
    return send(res, 200, { task: enrichTask(task, db) });
  }

  if (taskMatch && req.method === "DELETE") {
    const task = db.tasks.find(item => item.id === taskMatch[1]);
    if (!task) return sendError(res, 404, "Task not found");
    const project = db.projects.find(item => item.id === task.projectId);
    if (project.adminId !== currentUser.id) return sendError(res, 403, "Only admins can delete tasks");
    db.tasks = db.tasks.filter(item => item.id !== task.id);
    writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (pathname === "/api/dashboard" && req.method === "GET") {
    return send(res, 200, { dashboard: dashboardFor(currentUser, db) });
  }

  return sendError(res, 404, "API route not found");
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          return res.end("Not found");
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(fallback);
      });
      return;
    }
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".svg": "image/svg+xml"
    }[ext] || "text/plain";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    sendError(res, 500, error.message || "Server error");
  }
});

server.listen(PORT, () => {
  ensureDb();
  console.log(`Team Task Manager running on http://localhost:${PORT}`);
});
