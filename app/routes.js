import { index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.jsx"),
  route("app", "routes/app.jsx"),
  route("privacy", "routes/privacy.jsx"),
  route("requirements", "routes/requirements.jsx"),
  route("chores", "routes/chores-index.jsx"),
  route("chores/:slug", "routes/chore.jsx"),
  route("*", "routes/not-found.jsx"),
];
