# Team Task Manager

A full-stack Team Task Management web application built for the assignment requirements. Users can sign up, log in, create projects, add members, assign tasks, update task status, and view dashboard metrics.

## Features

- Signup and login with HMAC-signed JWT-style tokens
- Password hashing with Node.js `crypto.pbkdf2Sync`
- Project creation with creator as Admin
- Admin-only member management and task management
- Member access limited to assigned project tasks
- Task status workflow: To Do, In Progress, Done
- Dashboard totals, status counts, tasks per user, and overdue tasks
- RESTful API served from the same Node app as the frontend
- JSON-backed NoSQL database for simple deployment without external services

## Tech Stack

- Backend: Node.js HTTP server
- Frontend: HTML, CSS, vanilla JavaScript
- Database: JSON file store (`data/db.json`)
- Deployment target: Railway

## Local Setup

```bash
npm install
npm start
```

Open `http://localhost:3000`.

The app does not require third-party npm packages, so `npm install` is optional unless you want a lockfile.

## Environment Variables

Create a `.env` in production or configure these in Railway:

```bash
PORT=3000
JWT_SECRET=replace-with-a-long-random-secret
DB_FILE=data/db.json
```

Railway automatically provides `PORT`; set `JWT_SECRET` yourself.

## Railway Deployment

1. Push this project to GitHub.
2. Create a new Railway project from the GitHub repository.
3. Set `JWT_SECRET` in Railway variables.
4. Railway will run `npm start`.
5. Use the generated public Railway URL as the live application URL.

## API Overview

Authentication:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/me`

Projects:

- `GET /api/projects`
- `POST /api/projects`
- `POST /api/projects/:projectId/members`
- `DELETE /api/projects/:projectId/members/:userId`

Tasks:

- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:taskId`
- `DELETE /api/tasks/:taskId`

Dashboard:

- `GET /api/dashboard`

## Demo Flow

1. Sign up as the first user.
2. Create a project.
3. Sign up a second user in another browser or after logging out.
4. Log back in as the Admin and add the second user's email to the project.
5. Create tasks and assign them to team members.
6. Update task status and review dashboard metrics.
