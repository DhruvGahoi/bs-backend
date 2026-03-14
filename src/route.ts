import { Router } from "express";
import { z } from "zod";
import { pool } from "./db";
import { identify } from "./identify";

const router = Router();

const schema = z.object({
  email: z.string().email().optional().nullable(),
  phoneNumber: z.string().min(1).optional().nullable(),
}).refine(d => d.email != null || d.phoneNumber != null, {
  message: "At least one of email or phoneNumber is required"
});

router.post("/identify", async (req, res) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  const { email, phoneNumber } = result.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const data = await identify(email ?? null, phoneNumber ?? null, client);
    await client.query("COMMIT");
    res.json(data);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export { router };
