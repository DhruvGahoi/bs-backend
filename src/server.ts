import express from "express";
import { pool } from "./database/db";
import { router } from "./route";

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(router);

app.get("/", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch {
    res.status(500).json({ status: "error", db: "unreachable" });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export { app, server };
