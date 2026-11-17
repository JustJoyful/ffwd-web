import { index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.jsx"),
  route("app", "routes/app.jsx"),
  route("privacy", "routes/privacy.jsx"),
];
