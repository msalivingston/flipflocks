import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const deprecatedFunction =
  "seller_create_uploaded_hatching_egg_group_media";
const deprecatedSignature =
  "public.seller_create_uploaded_hatching_egg_group_media(uuid,uuid,uuid,text,text,text,text,bigint,integer,integer,text,text,integer,boolean)";
const migrationName =
  "20260730160000_revoke_hatching_egg_media_actor_impersonation.sql";
const migrationPath = resolve(root, "supabase", "migrations", migrationName);

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function filesUnder(relativePath) {
  const absolutePath = resolve(root, relativePath);

  if (!statSync(absolutePath).isDirectory()) {
    return [absolutePath];
  }

  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(absolutePath, entry.name);
    return entry.isDirectory()
      ? filesUnder(child.slice(root.length + 1))
      : [child];
  });
}

test("the append-only migration revokes the exact unsafe signature from every role", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const compact = migration.replace(/\s+/g, " ").toLowerCase();
  const whitespaceFree = migration.replace(/\s+/g, "").toLowerCase();

  assert.ok(
    whitespaceFree.includes(
      `revokeallonfunction${deprecatedSignature}frompublic,anon,authenticated,service_role;`,
    ),
  );
  assert.doesNotMatch(compact, /\b(?:create|replace|drop)\s+function\b/);
  assert.doesNotMatch(compact, /\bgrant\s+execute\b/);
  assert.doesNotMatch(compact, /request\.jwt\.claim\.sub|set_config\s*\(/);
});

test("no repository application caller references the deprecated RPC", () => {
  const runtimeRoots = ["app", "lib", "scripts", "supabase/functions"];
  const runtimeExtensions = new Set([
    ".cjs",
    ".js",
    ".jsx",
    ".mjs",
    ".sql",
    ".ts",
    ".tsx",
  ]);
  const references = runtimeRoots
    .flatMap(filesUnder)
    .filter((file) => runtimeExtensions.has(extname(file)))
    .filter((file) => readFileSync(file, "utf8").includes(deprecatedFunction));

  assert.deepEqual(references, []);
});

test("the active upload and synchronization callers retain the safe flow", () => {
  const uploadWorker = read("supabase/functions/seller-media-upload/index.ts");
  const hatchingEggForm = read(
    "app/dashboard/listings/new/birds/hatching-eggs-standalone/hatching-eggs-standalone-one-page-form.tsx",
  );

  assert.match(
    uploadWorker,
    /\.rpc\("seller_create_uploaded_media",\s*\{[\s\S]*?p_actor_user_id:\s*user\.id,/,
  );
  assert.doesNotMatch(uploadWorker, new RegExp(deprecatedFunction));
  assert.match(
    hatchingEggForm,
    /\.rpc\(\s*"seller_sync_hatching_egg_group_media_from_item"/,
  );
  assert.doesNotMatch(hatchingEggForm, new RegExp(deprecatedFunction));
});

test("no executable authenticated function can rewrite JWT subject from a request actor", () => {
  const migrationDirectory = resolve(root, "supabase", "migrations");
  const migrationFiles = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const actorRewriteFiles = migrationFiles.filter((name) => {
    const source = readFileSync(resolve(migrationDirectory, name), "utf8");
    return /set_config\s*\(\s*'request\.jwt\.claim\.sub'\s*,\s*p_[a-z0-9_]+(?:::text)?/i.test(
      source,
    );
  });

  assert.deepEqual(actorRewriteFiles, [
    "20260719061000_fix_hatching_egg_group_media_upload_actor.sql",
  ]);
  assert.ok(
    migrationFiles.indexOf(migrationName) >
      migrationFiles.indexOf(actorRewriteFiles[0]),
  );

  const migrationsAfterRevocation = migrationFiles
    .slice(migrationFiles.indexOf(migrationName) + 1)
    .map((name) => readFileSync(resolve(migrationDirectory, name), "utf8"))
    .join("\n")
    .replace(/\s+/g, " ")
    .toLowerCase();

  assert.doesNotMatch(
    migrationsAfterRevocation,
    new RegExp(
      `grant execute on function ${deprecatedSignature.replace(
        /[().]/g,
        "\\$&",
      )}`,
    ),
  );
});
