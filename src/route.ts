import { Router } from "express";
import { identifyContact } from "./controller/contact";

const router = Router();

router.post("/identify", identifyContact);

export { router };
