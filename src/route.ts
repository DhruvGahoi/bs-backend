import { Router } from "express";
import { identifyContact } from "./controller/contact";

const router = Router();

router.post("/identify", identifyContact);

export { router };


// TODO :
// Add auth as middleware : brownie
// const data = await identify(email ?? null, phoneNumber ?? null, client); client should not be passed. null check for email and phone nukber
