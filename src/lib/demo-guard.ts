import { demoMode } from "@/config/brand";
import { UserError } from "./user-error";

/** On the public demo server, actions that could lock other visitors out (passwords, staff, center settings) are off. */
export function assertNotDemo(): void {
  if (demoMode()) throw new UserError("demo.blocked");
}
