/**
 * Creates the single owner account against a running dev/prod server.
 *   node scripts/seed-owner.mjs "you@example.com" "a-strong-password" "Rashid"
 * Reads BASE_URL from the environment (defaults to http://localhost:3000).
 */
const [email, password, name = "Rashid"] = process.argv.slice(2);
const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

if (!email || !password) {
  console.error('Usage: node scripts/seed-owner.mjs "<email>" "<password>" [name]');
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
  method: "POST",
  // Better Auth rejects cross-origin-looking requests, so declare the origin.
  headers: { "content-type": "application/json", origin: baseUrl },
  body: JSON.stringify({ email, password, name }),
});

const body = await response.text();
if (!response.ok) {
  console.error(`Failed (${response.status}): ${body}`);
  process.exit(1);
}
console.log("Owner account created:", email);
