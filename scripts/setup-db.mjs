import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env.local and add your Neon connection string.");
}

const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
// This initial schema contains only ordinary CREATE TABLE statements. If later
// migrations add functions or procedural blocks, replace this splitter with a
// migration tool that understands PostgreSQL dollar-quoted statements.
const statements = schema
  .split(";")
  .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);
const sql = neon(connectionString);
await sql.transaction(statements.map((statement) => sql.query(statement)));
console.log(`Applied ${statements.length} schema statements. Existing tables were preserved.`);
