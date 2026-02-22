/* eslint-disable no-console */

const fs = require("node:fs/promises");
const path = require("node:path");

async function loadDotEnvIfPresent() {
  const candidates = [".env.local", ".env"];
  for (const filename of candidates) {
    const filePath = path.resolve(process.cwd(), filename);
    try {
      // eslint-disable-next-line no-await-in-loop
      const content = await fs.readFile(filePath, "utf8");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const m = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (!m) continue;
        const key = m[1];
        if (process.env[key] !== undefined) continue;
        let val = m[2] ?? "";
        val = val.trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    } catch {
      // ignore missing file
    }
  }
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let current = "";

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let dollarTag = null; // e.g. "$$" or "$tag$"

  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];
    const next = sqlText[i + 1];

    // Handle line comments when not in any quote/dollar block.
    if (!inSingleQuote && !inDoubleQuote && !dollarTag && ch === "-" && next === "-") {
      // Skip until newline.
      while (i < sqlText.length && sqlText[i] !== "\n") i++;
      current += "\n";
      continue;
    }

    // Toggle single quotes (ignore in dollar block or double quotes).
    if (!inDoubleQuote && !dollarTag && ch === "'") {
      current += ch;
      if (inSingleQuote && next === "'") {
        // Escaped single quote '' inside string.
        current += next;
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    // Toggle double quotes (identifiers).
    if (!inSingleQuote && !dollarTag && ch === '"') {
      current += ch;
      if (inDoubleQuote && next === '"') {
        // Escaped double quote "" inside identifier.
        current += next;
        i++;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    // Enter/exit dollar-quoted blocks when not in single/double quotes.
    if (!inSingleQuote && !inDoubleQuote && ch === "$") {
      // Detect a dollar tag like $tag$ or $$.
      const rest = sqlText.slice(i);
      const m = rest.match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        const tag = m[0];
        current += tag;
        i += tag.length - 1;
        if (dollarTag === tag) {
          dollarTag = null;
        } else if (!dollarTag) {
          dollarTag = tag;
        }
        continue;
      }
    }

    // Statement boundary: semicolon not inside quotes/dollar blocks.
    if (!inSingleQuote && !inDoubleQuote && !dollarTag && ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

async function main() {
  await loadDotEnvIfPresent();

  const fileArgs = process.argv.slice(2);
  const defaultFiles = ["migrations/001_paywall.sql", "migrations/002_admin_role.sql"];
  const files = fileArgs.length > 0 ? fileArgs : defaultFiles;

  if (!process.env.POSTGRES_URL) {
    throw new Error("Missing POSTGRES_URL env var.");
  }

  const { sql } = require("@vercel/postgres");

  for (const file of files) {
    const filePath = path.resolve(process.cwd(), file);
    // eslint-disable-next-line no-await-in-loop
    const raw = await fs.readFile(filePath, "utf8");
    const statements = splitSqlStatements(raw);

    console.log(`Running migration: ${path.relative(process.cwd(), filePath)} (${statements.length} statements)`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        // sql is a Pool proxy; query() is available.
        // eslint-disable-next-line no-await-in-loop
        await sql.query(stmt);
        console.log(`  OK ${i + 1}/${statements.length}`);
      } catch (err) {
        console.error(`  FAIL at statement ${i + 1}/${statements.length}`);
        console.error(stmt);
        throw err;
      }
    }

    console.log("Migration complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
